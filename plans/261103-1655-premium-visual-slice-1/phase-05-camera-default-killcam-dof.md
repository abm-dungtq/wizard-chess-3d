---
phase: 5
title: "3/4 default camera, top-down toggle, kill-cam DOF"
status: completed
effort: 4h
pr: PR B
---

# Phase 5: 3/4 default camera, top-down toggle, kill-cam DOF

## Goal

- A new `spectator` camera preset (3/4 view from the player's side) is the default at start-up and after a new game.
- `#btn-quick-cam` toggles between `spectator` and `top`. The existing `player`, `top`, `side` and `wide` presets and buttons keep working.
- The whole board stays in view in `spectator` on desktop (1470x956) and phone portrait (390x844).
- On checkmate with Motion `full`, a kill-cam frames the falling king for at most 4 s and then returns. On `ultra` it turns on depth of field. One click, tap or key press skips it.
- The kill-cam uses a separate `cinematicActive` flag. It never sets `isAnimatingMove`.

## Facts verified before planning

- Camera: `PerspectiveCamera(40, aspect, 0.22, 65)` near line 320, start position (0, 7.35, 3.95); OrbitControls near line 361 with target (0, 0.78, -0.06). `syncResponsiveCameraFov()` (lines 331-340) returns `tPortrait`, a 0..1 portrait factor. `getPortraitFramingFactor()` at line 323.
- `let isCameraLocked = true` (line 359). The camera starts locked in `top`.
- `setCameraPreset(preset)` (line 9406) is an if-chain. `top` uses `smoothCameraTo(pos, lookAt, 0.75)` and flips `overheadCamSide` on a repeat click. `player` uses `setCameraForSide(side)` with position y = 3.82 + tPortrait·3.03, z = ±(3.58 + tPortrait·2.10).
- `smoothCameraTo` at line 4213; `setCameraForSide` at 4228; `setOverheadCameraForSide` at 4255; `setActiveCamButton` near 9376; `camButtons` near 9368.
- `#btn-quick-cam` click handler near line 9532 toggles `top` ↔ `player`.
- New-game camera orientation near line 5146 (`if (orientCamera) { ... }`) re-applies the active preset.
- `handleViewportResize` (line 11036) re-applies `player` or `top` by checking which button has `.active`.
- App buttons: `#btn-cam-player` L401, `#btn-cam-top` L408 (has `active` class by default), `#btn-cam-side` L415, `#btn-cam-wide` L422, `#btn-quick-cam` L467.
- Checkmate: `triggerCheckmateSequence(defeatedColor, winnerColor)` (line 8035) is exposed on `window.wizardChess`. Its existing camera framing (near line 8172) only runs when `!isCameraLocked && combatCameraZoomEnabled`. Timing: `tStagger 0.36`, `tImpact 1.12`, `tTotal 1.82` (near line 8184). The king-fall tween is pushed with `_isKingFallTween`.
- `combatCameraZoomEnabled = false` (line 4646) gates duel swoops and tremors.

## Motion level mapping (used by this phase)

| Effect | full | quick | off |
|---|---|---|---|
| Kill-cam on checkmate | yes | no | no |
| Kill-cam DOF | `ultra` tier only | no | no |
| Impact and king-fall tremor | as today | as today | no |
| `smoothCameraTo` duration | as given | as given | 0 (instant cut) |

Move animations themselves are not changed by Motion level in this slice. Their timing is part of online play.

## Files

- `src/wizardChessEngine.js`, `src/App.tsx`, `e2e/game-smoke.spec.ts`.

## Tasks

### Task 5.1 — Add the `spectator` preset

- **Goal:** `setCameraPreset('spectator')` frames a 3/4 view from the current player's side.
- **Steps:**
  1. Add `let spectatorCamSide = 'w';` next to `overheadCamSide` (line 9390).
  2. Add `function getSpectatorPose(side, tPortrait)` returning `{ pos, lookAt }` as `THREE.Vector3`s. Start values, with `s = side === 'b' ? -1 : 1`:
     - `pos = (s * 1.25, 4.6 + tPortrait * 2.6, s * (4.55 + tPortrait * 1.9))`
     - `lookAt = (0, 0.55, s * (0.15 - tPortrait * 0.2))`
     These are a starting point. Task 5.2 adjusts them until the board-fit check passes.
  3. In `setCameraPreset`, add a `spectator` branch modeled on `top`: a repeat click flips `spectatorCamSide`; otherwise it follows `playerColor`. Call `setActiveCamButton('btn-cam-spectator')` and `smoothCameraTo(pose.pos, pose.lookAt, 0.75)`.
  4. In `handleViewportResize`, add the `btn-cam-spectator` case beside the `btn-cam-top` case, placing the camera directly at the pose (no tween) and calling `flushOrbitControlsDamping()` like the `top` case does.
  5. In the new-game orientation block in `resetChessBoard` (near lines 5146-5156): this block is what actually sets the camera at start-up, because `resetChessBoard(true, true)` runs during init (near line 11112), and its final `else` forces `btn-cam-top`. Add a `spectator` branch **before** that `else`: if `#btn-cam-spectator` has `.active` (or no camera button is active yet), set `spectatorCamSide = viewSide`, call `setActiveCamButton('btn-cam-spectator')` and place the camera at `getSpectatorPose(viewSide, getPortraitFramingFactor())` immediately.
  6. Note: `enforceCathedralBoundsAndSolidColumns` (near line 4217) clamps camera positions inside the cathedral. When tuning in Task 5.2, record the camera position read back from `getState().cameraPos`, not only the numbers you passed in.
- **Verify:** no verification needed; Task 5.2 checks the framing.

### Task 5.2 — Board-fit check and tuning

- **Goal:** a mechanical check that all four board corners are on screen in `spectator`.
- **Steps:**
  1. Add `boardCornersInView` to `getState()`. Compute it on demand: take the four outer corners of the board top surface (use `getBoardRows()`, `getBoardCols()`, `getActiveSqSize()` and `BOARD_SURFACE_Y`, the same helpers `triggerCheckmateSequence` uses), project each with `vector.project(camera)`, and return `true` only if every corner has `|x| ≤ 0.96` and `|y| ≤ 0.92`. Also return `boardCornerNdc` (the 4 projected `[x, y]` pairs rounded to 3 decimals) to help tuning.
  2. Write e2e test `'spectator camera keeps the whole board in view'`. For each viewport `{1470, 956}` and `{390, 844}`, and for both `chess` and `xiangqi` variants: set the viewport, open the game, call `setCameraPreset('spectator')` via `window.wizardChess` (expose `setCameraPreset` if it is not exposed yet), wait for the tween (`waitIdle` plus 900 ms), and expect `boardCornersInView === true`.
  3. If it fails, adjust only the numbers in `getSpectatorPose`. Raise y or pull z back for a corner that is out at the top or bottom. Record each attempt and its `boardCornerNdc` in "Execution notes".
  4. Also record the on-screen piece height gain versus `top`: project the top and bottom of the white king's bounding box in both presets at 1470x956 and record the pixel heights. The brainstorm target is 2-3x; at least 1.6x is acceptable. If below 1.6x, record it and ask `kongming` before moving on.
- **Success criteria:** the test passes in all 4 combinations.
- **Verify:** `npx playwright test e2e/game-smoke.spec.ts -g "spectator camera" 2>&1 | tail -5` shows `1 passed`.

### Task 5.3 — Make `spectator` the default and wire the buttons

- **Steps:**
  1. In `src/App.tsx`, add `<button id="btn-cam-spectator" className="hud-btn active" ...>🎥 Góc 3/4</button>` before `#btn-cam-player` (line 401), following the markup of its neighbours. Remove `active` from `#btn-cam-top` (line 408).
  2. Add `btn-cam-spectator` to `camButtons` (near line 9368) and to `camPresetButtons` (near line 374) so `clearCameraPresetActive` and orbit changes treat it like the others. Bind its click to `setCameraPreset('spectator')`, like `#btn-cam-top`.
  3. Set the start-up camera to the spectator pose: replace the initial `camera.position.set(0, 7.35, 3.95)` (line ~320) and the OrbitControls target (line ~361) with `getSpectatorPose('w', getPortraitFramingFactor())`. If `getSpectatorPose` is declared later in the file than those lines, it is still callable because function declarations are hoisted, but it must not read any `let` variable that is declared later; keep it pure.
  4. Change the `#btn-quick-cam` handler (near line 9532) to toggle `top` ↔ `spectator` instead of `top` ↔ `player`. Update its label/title in `src/App.tsx` L467 if it names the player view.
- **Success criteria:** a fresh load shows the spectator view with `#btn-cam-spectator.active`.
- **Verify:** extend the spectator e2e test: on a fresh `openGame` at 1470x956, expect `#btn-cam-spectator` to have class `active` and `boardCornersInView === true` without calling `setCameraPreset`. Then click `#btn-quick-cam`; expect `#btn-cam-top` active; click again; expect `#btn-cam-spectator` active. Run `npx playwright test e2e/game-smoke.spec.ts 2>&1 | tail -5`: all passed. No existing e2e test asserts the default camera button (checked). The test `'a burst of resize events'` (`e2e/game-smoke.spec.ts` near line 114) goes through `handleViewportResize`, so it relies on Task 5.1 step 4.

### Task 5.4 — Apply the Motion mapping

- **Steps:**
  1. In `smoothCameraTo` (line 4213), if `motionLevel === 'off'`, do not pass a 0 duration: the function clamps durations to at least 0.05 s (near line 4224). Instead, at the top of `smoothCameraTo`, when `motionLevel === 'off'`, copy the clamped target position and look-at straight into `camera.position` and `orbitControls.target`, call `flushOrbitControlsDamping()`, and return. Use the same immediate path `setCameraForSide(side, true)` uses.
  2. Wrap the impact tremor (near line 7192) and king-fall tremor (near line 8257) so they do not run when `motionLevel === 'off'`. Keep their existing `combatCameraZoomEnabled` conditions.
- **Verify:** covered by Task 5.6.

### Task 5.5 — Kill-cam with DOF

- **Goal:** a skippable ≤ 4 s cinematic around the falling king.
- **Steps:**
  1. Add `let cinematicActive = false; let cinematicRestore = null; let cinematicTimer = 0;` near `checkmateState` (line 4876).
  2. Add `function startKillCam(kingWorldPos, fallDir)`:
     - Return early unless `motionLevel === 'full'` and `heldCameraKeys.size === 0`.
     - Save `cinematicRestore = { pos: camera.position.clone(), target: orbitControls.target.clone(), locked: isCameraLocked }`.
     - Set `cinematicActive = true`, `cinematicTimer = 0`. Disable orbit input (`orbitControls.enabled = false`).
     - Call `smoothCameraTo` with the same framing math the existing checkmate framing uses (near line 8172: side offset 1.35, height `BOARD_SURFACE_Y + 1.15`, look-at slightly along `fallDir`), duration 0.95.
     - If `postPasses.bokeh` exists (only on `ultra`), set `postPasses.bokeh.enabled = true` and set its `uniforms.focus.value` to the camera-to-king distance after the tween target (distance from the new camera position to `kingWorldPos`).
  3. Add `function endKillCam(immediate)`: if not active, return. Disable bokeh. Restore the camera: if `immediate`, set `camera.position` and `orbitControls.target` directly from `cinematicRestore` and call `flushOrbitControlsDamping()`; otherwise `smoothCameraTo(cinematicRestore.pos, cinematicRestore.target, 0.8)`. Restore `orbitControls.enabled`. Set `cinematicActive = false`, `cinematicRestore = null`.
  4. In `triggerCheckmateSequence`, right where the existing framing block is (near line 8172): keep the existing block as is, and add an `else` that calls `startKillCam(homePos, { x: fallDirX, z: fallDirZ })` only when the existing block did not run.
  5. In `stepScene`, when `cinematicActive`, add `dt` (real seconds, before any hit-stop scaling) to `cinematicTimer`. Call `endKillCam(false)` when `cinematicTimer >= 3.2` (so with the 0.8 s return, total ≤ 4 s).
  6. Skip: add one `pointerdown` and one `keydown` listener on `document` that call `endKillCam(true)` when `cinematicActive`. They must not consume or stop the event.
  7. Call `endKillCam(true)` at the start of new game / reset / undo handling and when the variant or skin changes (search for the reset function that rebuilds `boardState`, near line 5100, and `undoLastMove`).
  8. Do not touch `isAnimatingMove` anywhere in these functions. `drainRemoteMoves` must not check `cinematicActive`.
  9. Add `cinematicActive` and `killCamDof: Boolean(postPasses.bokeh?.enabled)` to `getState()`.
- **Verify:** covered by Task 5.6.

### Task 5.6 — Kill-cam e2e

- **Target:** `e2e/game-smoke.spec.ts`, new test `'kill-cam runs on checkmate, skips, and never blocks moves'`.
- **Steps:**
  1. Open the game. Call `setMotionLevel('full')` and `setQualityTier('ultra')`.
  2. Call `window.wizardChess.triggerCheckmateSequence('b', 'w')`.
  3. Within 500 ms expect `cinematicActive === true`, `killCamDof === true`, and `isAnimatingMove === false`.
  4. `page.mouse.click` on an empty HUD area. Within 1.2 s expect `cinematicActive === false` and `killCamDof === false`.
  5. Trigger again without clicking. Expect `cinematicActive === false` within 4.5 s.
  6. Call `setMotionLevel('off')` and trigger again. Expect `cinematicActive` to stay `false` over 1 s of sampling.
  7. Expect zero console errors.
- **Verify:** `npx playwright test e2e/game-smoke.spec.ts -g "kill-cam" 2>&1 | tail -5` shows `1 passed`.

## Phase exit check

- **Verify:** `npm run lint && npm test && npx playwright test 2>&1 | tail -5` exits 0 with all tests passed, including all 7+ online-room tests.

## Execution notes

- Task 5.1-5.3: `spectator` preset, default at start-up and after a new game, `#btn-cam-spectator` added (active by default), `#btn-quick-cam` toggles `top` and `spectator`.
- Task 5.2 tuning (NDC of the 4 corners; limit |x| <= 0.96, |y| <= 0.92):
  - Start values: desktop chess and xiangqi pass (worst x -0.755, y -0.899). Phone 390x844 chess fails: x -1.032 (near-left corner out at the side, not top/bottom).
  - Attempt 2, lateral offset `1.25 - tPortrait * 0.85`: phone chess x -0.961, still out. The board is too wide for portrait from an off-centre seat.
  - Attempt 3, lateral offset `1.25 * (1 - tPortrait)` (centred on phones) and z `4.55 + tPortrait * 2.3`: all four pass. Phone chess x ±0.887, y 0.198 to -0.295; phone xiangqi x ±0.873. Desktop unchanged. Camera read back from `getState().cameraPos` matched the pose (the cathedral clamp did not move it).
  - The plan only named top/bottom fixes; the side overflow needed the lateral offset. Only `getSpectatorPose` numbers changed.
- Piece height gain at 1470x956, white king square e1, analytic projection of a vertical segment (no piece-mesh API exposed): `spectator` 2.6x `top` (92.6 vs 35.7 px for a 0.5 m segment). Within the 2-3x target.
- Task 5.4: `smoothCameraTo` cuts instantly on Motion `off`; duel impact and king-fall tremors are skipped on `off`.
- Task 5.5: kill-cam with `cinematicActive`, never touches `isAnimatingMove`. Hold 3.2 s plus 0.8 s return. Skipped by any pointerdown/keydown (capture, passive, not consumed). Ended immediately by reset, undo, variant change and skin change. Bokeh enabled only when the pass exists (ultra) with focus = distance from the tween's end position to the king.
- Carried from the phase 4 checkpoint: the Bokeh wrapper sets `scene.background = null` during its depth render and restores it.
- Visuals: `visuals/spectator-default.png`, `visuals/killcam-ultra-dof.png` (background blurred, king sharp).
- e2e: 'spectator camera keeps the whole board in view' and 'kill-cam runs on checkmate, skips, and never blocks moves' pass. The quick-cam button is hidden on desktop, so the test clicks it through the DOM.
- Phase exit check: lint OK, unit 31 pass, e2e 20 pass + 1 pre-existing skip.

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
