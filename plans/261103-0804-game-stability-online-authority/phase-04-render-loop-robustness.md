---
phase: 4
title: "Render loop robustness and smoothness"
status: pending
effort: 3h
pr: PR 1
---

# Phase 4: Render loop robustness and smoothness

## Goal

- One faulty animation cannot freeze the game.
- Mobile viewport resizes are coalesced.
- The hot render path stops allocating or querying the DOM each frame.
- A failed xiangqi asset load does not trigger a refetch storm.

## Verified defects (all in `src/wizardChessEngine.js`)

1. **No error isolation for tweens.** `stepScene` (around line 10494) runs `activeMoveTweens[i](dt)` with no try/catch.
   - A throwing tween is never removed.
   - It throws every frame, so `renderer.render` is never reached.
   - `isAnimatingMove` stays true, so input is blocked.
   - `completeCurrentMoveImmediately` (around line 7644) has the same loop.
2. **Resize is not coalesced.** `handleViewportResize` (around line 10864) is bound directly to both `window` `resize` and `visualViewport` `resize` (around lines 10893-10894).
   - Each event runs `setPixelRatio`, `setSize` (reallocating the drawing buffer), and `render`.
   - On mobile, the URL bar showing or hiding fires many of these events.
3. **Per-frame DOM queries.**
   - `document.querySelectorAll('#btn-cam-player, #btn-cam-wide, #btn-cam-top, #btn-cam-side')` runs every frame while a camera key is held (around line 10583).
   - It also runs on every orbit `change` event (around line 381).
4. **Per-frame allocations in `stepScene`.**
   - `camera.position.clone()` runs every frame (around line 10439).
   - `new THREE.Vector3()` runs three times per frame on the key-move path (around lines 10508-10520).
5. **`matchMedia` on every frame.** `feedFrameTimeSample` calls `window.matchMedia('(pointer: coarse)')` each frame (around line 10783).
6. **Refetch storm.** `ensureXiangqiModelsLoaded` (around line 3784) sets `xiangqiModelsLoadPromise = null` on failure. `attachSkinKitbashToPiece` (around line 1745) calls it for every piece with a missing template. So one network failure triggers dozens of full refetches.

Verified non-issue, do not change: when a promotion is pending, `undoLastMove` (around line 4986) cancels the promotion choice and keeps the previous move. The pawn move is not committed until a piece is chosen, so cancelling it is the correct undo.

## Files

| Action | Path | Change |
|---|---|---|
| create | `src/tweenRunner.ts` | Pure helper `runTweens(tweens, dt, onError)`. |
| modify | `src/wizardChessEngine.js` | Use `runTweens` with dropped-move recovery, add `injectFaultyTweenForTest` debug hook, coalesce resize, cache DOM and media query, scratch vectors, load backoff. |
| modify | `test/applet.test.mjs` | Unit test for `runTweens`. |
| modify | `e2e/game-smoke.spec.ts` | Resize burst test. |

## Tasks

### Task 4.1: `runTweens` with a failing test first

- **Goal:** A pure, unit-tested tween runner that drops and reports a throwing tween.
- **Target files:** `src/tweenRunner.ts`, `test/applet.test.mjs`.
- **Steps:**
  1. Add the test `'runTweens isolates a throwing tween and keeps the others running'` to `test/applet.test.mjs`. It imports `runTweens` from `../src/tweenRunner.ts`. Set up `tweens = [ok1, throwing, ok2]`, where:
     - `ok1` returns `true` (done)
     - `throwing` throws `new Error('boom')`
     - `ok2` returns `false` and counts its calls
  2. Call `runTweens(tweens, 0.016, onError)`. Assert:
     - `tweens.length === 1`, and the remaining item is `ok2`
     - `onError` was called once with an error whose message is `boom`
     - `ok2` was called once
  3. Run the test and confirm it fails because the module does not exist.
  4. Create `src/tweenRunner.ts`:

     ```ts
     export type Tween = ((dt: number) => boolean) & { _isKingFallTween?: boolean };

     export function runTweens(tweens: Tween[], dt: number, onError: (err: unknown) => void): void {
       for (let i = tweens.length - 1; i >= 0; i--) {
         let done = true;
         try {
           done = tweens[i](dt);
         } catch (err) {
           onError(err);
         }
         if (done) tweens.splice(i, 1);
       }
     }
     ```
- **Success criteria:** The new test passes.
- **Verify:** `node --test test/applet.test.mjs` exits 0. The output contains `runTweens isolates a throwing tween`.

### Task 4.2: Use `runTweens` in the engine

- **Target files:** `src/wizardChessEngine.js`. Functions: `stepScene` (tween loop) and `completeCurrentMoveImmediately`.
- **Steps:**
  1. Import `runTweens` at the top of the file, following how `chessAI.ts` is already imported there.
  2. Add one handler in `initWizardChess`:
     ```js
     const reportTweenError = (err) => console.error('Move tween failed; dropped', err);
     ```
  3. Replace the loop in `stepScene` with `runTweens(activeMoveTweens, dt, reportTweenError);`.
  4. Replace the inner `for` loop in `completeCurrentMoveImmediately` with `runTweens(activeMoveTweens, 0.05, reportTweenError);`. Keep the `while` and `safety` guard.
  5. Find the code that sets `isAnimatingMove = false` when a move finishes. Run `grep -n "isAnimatingMove = false" src/wizardChessEngine.js`.
  6. In `stepScene`, right after `runTweens`, add a watchdog:
     ```js
     if (isAnimatingMove && activeMoveTweens.length === 0 && !preMoveHighlightTask) {
       animIdleFrames += 1;
     } else {
       animIdleFrames = 0;
     }
     if (animIdleFrames > 90) {
       isAnimatingMove = false;
       animIdleFrames = 0;
       syncActionButtonsUI();
     }
     ```
     Declare `let animIdleFrames = 0;` next to `shadowUpdateAccum`.
     - This condition has been checked against the code and is safe:
       - `isAnimatingMove = true` is set only around line 6269.
       - `stepMove` is pushed synchronously around line 7212.
       - Combat mixers only tick while that tween exists.
       - The king-fall tween runs after the flag is already false.
     The watchdog is a last-resort fallback only.
  7. Recover the board when a move tween is dropped. A dropped tween never ran `finishMove` (around line 6717), so `moveHistory` has an entry for a move whose board and turn were never finalized.
     - In `reportTweenError`, only set `tweenErrorPending = true` and log. Never touch `activeMoveTweens` inside the callback, because `runTweens` is iterating it.
     - In `stepScene`, right after `runTweens`:
       ```js
       if (tweenErrorPending) {
         tweenErrorPending = false;
         recoverFromDroppedMoveTween();
       }
       ```
     - Write `recoverFromDroppedMoveTween()`:
       - Read `undoLastMove` (around line 4986) and repeat its one-ply restore steps: pop `moveHistory` and call `restoreBoardSnapshot` (around line 4914) with the entry. Skip its `gameMode === 'multi'` guard.
       - Then set `isAnimatingMove = false` and call `syncActionButtonsUI()`.
       - In multi mode with `latestRemoteRoom` set, call `resyncFromRoomMoves(latestRemoteRoom)` afterwards.
       - Declare `let tweenErrorPending = false;`.
  8. Add a debug hook to the existing `window.wizardChess` object, in the same style as `testColumnCollisionSlide`: `injectFaultyTweenForTest()`. It pushes a tween that throws `new Error('injected tween fault')` on its first call.
  9. Add a Playwright test **"faulty tween does not freeze the game"**:
     - Do the e2-e4 move.
     - Immediately call `injectFaultyTweenForTest()`.
     - `waitIdle`.
     - Then play another legal white move if it is white's turn, or wait for the AI reply.
     - Expect `getState().aiSearchInFlight === false` and `moveHistoryCount >= 1`.
     - Expect the rAF counter to keep advancing: record `performance.now()` frames for 1 s and require > 20 frames.
     - The `console.error` from `reportTweenError` is expected. Filter exactly that message out of the error list; any other error fails the test.
- **Success criteria:** The game still plays normally, and an injected fault does not freeze it.
- **Verify:** `npm run lint` exits 0, and `npx playwright test e2e/game-smoke.spec.ts --reporter=line` exits 0.

### Task 4.3: Coalesce resize

- **Target files:** `src/wizardChessEngine.js`. Function: `handleViewportResize` and its two `addEventListener` lines.
- **Steps:**
  1. Add:
     ```js
     let resizeRafId = 0;
     function scheduleViewportResize() {
       if (resizeRafId) return;
       resizeRafId = requestAnimationFrame(() => {
         resizeRafId = 0;
         handleViewportResize();
       });
     }
     ```
  2. Bind `window` `resize` and `visualViewport` `resize` to `scheduleViewportResize` instead of `handleViewportResize`.
  3. Add a test to `e2e/game-smoke.spec.ts`:
     - Dispatch `window.dispatchEvent(new Event('resize'))` 50 times in one synchronous loop.
     - Wait 2 animation frames.
     - Expect `document.querySelector('canvas').clientWidth === window.innerWidth`.
     - Expect no console errors.
- **Verify:** `npx playwright test e2e/game-smoke.spec.ts --reporter=line` exits 0.

### Task 4.4: Remove per-frame DOM queries and allocations

- **Target files:** `src/wizardChessEngine.js`. Code: `orbitControls` `change` listener, `stepScene`, and `feedFrameTimeSample`.
- **Steps:**
  1. Add a helper `clearCameraPresetActive()`:
     - It lazily caches `camPresetButtons = document.querySelectorAll('#btn-cam-player, #btn-cam-wide, #btn-cam-top, #btn-cam-side')` on its first call when the result has length 4.
     - It removes `active` from each button.
     - It does nothing when no button has `active`. Track this with a boolean `camPresetActiveCleared`. Set the boolean to `false` wherever code adds `active` to one of these buttons. Find those places with `grep -n "classList.add('active')" src/wizardChessEngine.js` and filter to the camera buttons.
  2. Replace both `querySelectorAll(...).forEach(...)` occurrences (orbit `change` and `stepScene`) with `clearCameraPresetActive()`.
  3. In `stepScene`:
     - Replace `const prevCamPos = camera.position.clone();` with a module-level `const _prevCamPos = new THREE.Vector3();` plus `_prevCamPos.copy(camera.position)`.
     - Rename the uses of `prevCamPos` in the function.
  4. On the key-move path, replace `new THREE.Vector3()` for `forward`, `right`, and `horizDir` with module-level scratch vectors `_camForward`, `_camRight`, `_camHorizDir`. Use `.subVectors`, `.set`, and `.set(0, 0, 0)`.
     - Read the next 60 lines first. If any of these vectors is stored beyond the frame (assigned to an outer variable or pushed to an array), keep `new` for that one.
  5. In `feedFrameTimeSample`:
     - Create `const coarsePointerQuery = window.matchMedia?.('(pointer: coarse)');` once at init.
     - Use `coarsePointerQuery?.matches`. Do the same in `handleViewportResize`.
- **Success criteria:** Behavior is unchanged. Camera keys still move the camera.
- **Verify:**
  - `npm run lint` exits 0.
  - `npx playwright test --reporter=line` exits 0.
  - `grep -c "querySelectorAll('#btn-cam-player" src/wizardChessEngine.js` prints `1` (only the helper).

### Task 4.5: Back off after a failed xiangqi load

- **Target files:** `src/wizardChessEngine.js`. Functions: `ensureXiangqiModelsLoaded`.
- **Steps:**
  1. Add `let xiangqiLoadRetryAt = 0;`.
  2. At the top of `ensureXiangqiModelsLoaded`, add `if (!xiangqiModelsLoadPromise && Date.now() < xiangqiLoadRetryAt) return Promise.resolve();`.
  3. In the `catch`, keep `xiangqiModelsLoadPromise = null` and add `xiangqiLoadRetryAt = Date.now() + 5000;`.
  4. Add a Playwright test:
     - Use `page.route('**/assets/glb/xiangqi/**', r => r.abort())` before `setGameVariant('xiangqi')`.
     - Count requests matching `/assets/glb/xiangqi/` over 3 s.
     - Expect at most 28 requests. One load attempt makes up to 14 requests, because `loadGltfModel` (around lines 3496-3523) tries `.glb.gz.b64` and then falls back to `.glb` for each of the 7 pieces. 28 allows 2 attempts in 3 s.
     - Expect no `pageerror`. `console.warn` lines are allowed. Filter the error collector to `error` type only, which is already its behavior.
- **Verify:** `npx playwright test e2e/game-smoke.spec.ts --reporter=line` exits 0.

### Task 4.6: Manual smoothness check and commit

- **Steps:**
  1. Start `npx vite --port=3107 --strictPort` in the background and open `http://localhost:3107`.
  2. Run this script in the page:
     ```js
     const t=[];let l=performance.now();const end=l+5000;
     await new Promise(r=>{(function f(n){t.push(n-l);l=n;n<end?requestAnimationFrame(f):r()})(l)});
     t.sort((a,b)=>a-b);
     ({p95:t[Math.floor(t.length*.95)], max:t.at(-1)})
     ```
     Run it once while idle and once while a move plus AI reply runs.
  3. Record the numbers in the commit body. The audit baseline is idle p95 10.8 ms and move max 20 ms on desktop at DPR 1.
  4. Stop the dev server you started.
  5. Run `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e`.
  6. Commit `fix(engine): isolate tween failures, coalesce resize, trim per-frame work`.
- **Verify:**
  - All four commands exit 0.
  - Move max frame ≤ 30 ms on the same machine. If it is higher, use the Failure Protocol with both measurements.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same failure evidence to the user. Never continue by self-reasoning.

## PR 1 boundary

After this phase, open PR 1 against `main` with phases 1-4. Opening the PR is outward-facing, so ask the user in chat first. Wait for CI and review before starting phase 5.
