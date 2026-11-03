---
phase: 3
title: "Audio unlock and HRTF bus"
status: pending
effort: 2h
pr: PR A
---

# Phase 3: Audio unlock and HRTF bus

## Goal

- The AudioContext is created and running before the first move, on the first user gesture anywhere on the page.
- The first move does no audio set-up work: noise buffers are pre-built.
- Clash, shatter and signature-attack sounds come from the board square where they happen, through an HRTF `PannerNode`. The listener follows the camera.
- Phones and browsers without HRTF still play sound (the panner falls back to `equalpower` or the dry path).

## Facts verified before planning

- `src/soundEngine.ts` `WizardAudioEngine`:
  - `ensureContext()` (lines 16-30) creates the context lazily on the first sound, and returns `null` when muted.
  - `unlock()` (line 34) is only called from the canvas `pointerdown` handler in `src/wizardChessEngine.js` (line 8627). Clicking HUD buttons or using the keyboard never unlocks.
  - Every sound connects straight to `ctx.destination`.
  - `getSlideNoiseBuffer` (1.4 s of samples) and `getShatterNoiseBuffer` are built lazily on first use.
  - `getState()` returns `{ muted, supported, playCount, lastCue }`; no context state.
- Engine call sites: `playMoveSlide` (6731), `playWeaponClash` (7137), `playSignatureAttack` (6967, 7138, 7161, 7170), `playStoneShatter` (7169, 9965), `playCheckmateFanfare` (8390), `playCheckWarning` (8419), `playPromotionChime` (1503, 6806).

## Root-cause check (do this first)

Task 3.1 proves the stall exists and where it comes from before anything is changed. If the measurement shows no stall on the first move (first-move frame ≤ 33 ms in both runs), record that, skip Task 3.3's prewarm part, and keep only the gesture unlock.

## Files

- `src/soundEngine.ts`
- `src/wizardChessEngine.js` (unlock wiring, spatial call sites, listener update in `stepScene`)
- `e2e/game-smoke.spec.ts`

## Tasks

### Task 3.1 — Measure the first-move audio cost

- **Goal:** a recorded number for the first move's longest frame, with and without a prior unlock.
- **Steps:**
  1. Add `contextState: string` (`this.ctx ? this.ctx.state : 'none'`) to `AudioStateSnapshot` and `getState()` in `src/soundEngine.ts`. This is needed by later checks anyway.
  2. Write a temporary Playwright script (not committed) that opens the game, clicks a HUD button only (not the canvas), plays the first move via the existing e2e helper path, and records the longest `requestAnimationFrame` delta over the 1.5 s after the move. Run it 3 times. Then repeat with a canvas click first.
  3. Record both maxima and `contextState` at move time in "Execution notes".
- **Success criteria:** numbers are recorded.
- **Verify:** no verification needed; this task produces evidence only.

### Task 3.2 — Unlock on the first gesture anywhere

- **Goal:** any `pointerdown`, `keydown` or `touchend` on the document starts audio.
- **Target:** `src/wizardChessEngine.js` near line 8627; `src/soundEngine.ts` `unlock()`.
- **Steps:**
  1. In the engine, add one `document.addEventListener` for each of `pointerdown`, `keydown`, `touchend` with `{ capture: true, passive: true }` calling `wizardAudio.unlock()`. Remove all three listeners once `wizardAudio.getState().contextState === 'running'`.
  2. Keep the existing canvas `pointerdown` call; it is harmless.
  3. In `unlock()`: after `ensureContext()`, if a context exists, play one silent 1-sample buffer through `ctx.destination` (iOS Safari needs a started source inside the gesture), then call `resume()`.
- **Success criteria:** after any click, `contextState` becomes `running`.
- **Verify:** covered by Task 3.5.

### Task 3.3 — Prewarm buffers and add the spatial bus

- **Goal:** no allocation on the first move; an HRTF bus exists.
- **Target:** `src/soundEngine.ts`.
- **Steps:**
  1. In `unlock()`, after the context exists, call `getSlideNoiseBuffer(ctx)` and `getShatterNoiseBuffer(ctx)` once.
  2. Add a private `master: GainNode | null`. Create it in `ensureContext` right after the context, connected to `ctx.destination`. Change every `.connect(ctx.destination)` in the file to `.connect(this.output(ctx))` where `output()` returns `this.master`.
  3. Add `public setListener(pos: {x,y,z}, forward: {x,y,z}, up: {x,y,z})`. If `ctx.listener.positionX` exists, set `.value` on position/forward/up AudioParams; else call the legacy `setPosition` / `setOrientation`. Do nothing when there is no context.
  4. Add a private `spatialOut(ctx, at?: {x,y,z}): AudioNode`. When `at` is missing, return `this.output(ctx)`. Otherwise create a `PannerNode` with `panningModel = 'HRTF'`, `distanceModel = 'inverse'`, `refDistance = 2`, `rolloffFactor = 0.6`, positioned at `at`, connected to `this.output(ctx)`, and return it. Wrap creation in try/catch; on error return `this.output(ctx)`. Disconnect the panner in the same `bindAutoDisconnect` call as the sound's other nodes.
  5. Add an optional last parameter `at?: {x:number,y:number,z:number}` to `playWeaponClash`, `playStoneShatter` and `playSignatureAttack`. Inside, route the final gain into `spatialOut(ctx, at)` instead of the output.
- **Success criteria:** `npx tsc --noEmit` passes. Calls without `at` sound as before.
- **Verify:** `npx tsc --noEmit; echo EXIT=$?` prints `EXIT=0`.

### Task 3.4 — Pass square positions and follow the camera

- **Goal:** combat sounds are placed at the target square; the listener tracks the camera.
- **Target:** `src/wizardChessEngine.js` call sites listed above (6967, 7137-7170, 9965) and `stepScene` (near line 10600).
- **Steps:**
  1. At each clash/shatter/signature call site, pass the world position of the target square. Use `boardToWorld(r, c)` (it returns the square's world position; see `projectBoardSquareToScreen` near line 8610) with `y = BOARD_SURFACE_Y`. Pass a plain `{ x, y, z }` object, not the `Vector3` itself.
  2. In `stepScene`, once per frame and only when `wizardAudio.getState().contextState === 'running'`, call `wizardAudio.setListener(camera.position, forward, camera.up)`. Compute `forward` with `camera.getWorldDirection(scratchVec)` using a module-level scratch `Vector3` (no per-frame allocation; phase 4 of the previous plan removed those). Cache the `getState()` result check in a boolean updated on `statechange` instead of calling it per frame if it allocates.
- **Success criteria:** no new allocation per frame; sounds play.
- **Verify:** covered by Task 3.5.

### Task 3.5 — E2E check

- **Goal:** audio unlocks without a canvas click and the first move produces no context creation.
- **Target:** `e2e/game-smoke.spec.ts`, new test `'audio unlocks on first gesture before the first move'`.
- **Steps:**
  1. Launch with Chromium flag `--autoplay-policy=no-user-gesture-required` **not** set (default policy). Open the game.
  2. Click a HUD button that changes nothing important (for example `#btn-cam-top`).
  3. Expect `getState().audioState.contextState` to become `running` within 2 s (`waitForState`).
  4. Play a move with the same helper the existing move test uses. Expect `audioState.playCount` to increase.
- **Verify:** `npx playwright test e2e/game-smoke.spec.ts -g "audio unlocks" 2>&1 | tail -5` shows `1 passed`.

## Phase exit check

- **Verify:** `npm run lint && npm test && npx playwright test 2>&1 | tail -5` exits 0 with all tests passed. Re-run the Task 3.1 script once with a HUD click first and record the new first-move maximum; it must be ≤ the earlier HUD-click maximum.

## Execution notes

(fill in during execution)

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.
