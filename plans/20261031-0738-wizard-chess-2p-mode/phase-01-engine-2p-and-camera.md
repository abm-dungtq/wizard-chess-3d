# Phase 1: 2-Player Pass & Play State, Seamless Capture-Duel Auto-Flip Camera & 1-Ply Undo

## Goal
Add module-scoped 2-Player Pass & Play state (`isPassAndPlay`, `autoFlipCamera2P`) in `src/wizardChessEngine.js`, coordinate `executeChessMove` / `finishMove` so both standard moves and capture duels smoothly transition the 3D camera to the next player's side without a 1-frame snap-back while always re-enabling `orbitControls`, and update `undoLastMove` to pop 1 ply in 2-Player mode.

## Files to Create or Modify
- `src/wizardChessEngine.js` (modify)

## Tasks & Steps

### Task 1.1 — Declare module-scoped 2P state variables and update `undoLastMove` & `resetChessBoard`
- **Goal:** Declare `isPassAndPlay` and `autoFlipCamera2P` in `src/wizardChessEngine.js` so `tsc --allowJs --checkJs` reports 0 undeclared errors, ensure `undoLastMove` pops 1 ply (and flips camera when applicable) in 2P mode, and orient the board to White (`'w'`) on `resetChessBoard` when in 2P Pass & Play mode.
- **Target files and symbols:** `src/wizardChessEngine.js` (`isPassAndPlay`, `autoFlipCamera2P`, `undoLastMove`, `resetChessBoard`).
- **Steps:**
  1. In `src/wizardChessEngine.js` around line 1634 (next to `let aiAutoPlay = true;`), declare `let isPassAndPlay = false;` and `let autoFlipCamera2P = true;`.
  2. In `undoLastMove()` (`lines 2049–2076`), change the 2-ply pop condition to require `!isPassAndPlay && aiAutoPlay` so 2-Player Pass & Play only pops 1 ply. After `restoreBoardSnapshot(targetEntry.snapshot)` succeeds, if `gameMode === 'single' && isPassAndPlay`, set `playerColor = currentTurn;` and if `autoFlipCamera2P && document.getElementById('btn-cam-player')?.classList.contains('active')`, set `playerCamSide = currentTurn; setCameraForSide(currentTurn, false);`, then call `updateTurnUI()`.
  3. In `resetChessBoard()` (`lines 2078–2135`), if `gameMode === 'single' && isPassAndPlay`, set `playerColor = 'w';` so a fresh 2P game starts with White's perspective (`viewSide = 'w'`).
- **Success criteria:** `isPassAndPlay` and `autoFlipCamera2P` are declared in module scope, `undoLastMove()` pops 1 ply in 2P mode, and `resetChessBoard()` resets `playerColor = 'w'` in 2P mode.
- **Verify:** `node --test test/applet.test.mjs` exits 0 and prints `JS/TS Static Scope Gate: src/wizardChessEngine.js has zero undeclared identifier errors`.

### Task 1.2 — Coordinate seamless 3D camera auto-flip across capture duels and standard moves in `executeChessMove` / `finishMove`
- **Goal:** Prevent the 1-frame `savedCamPos` snap-back after capture duels in 2P Pass & Play mode by easing directly from `duelCamClose` to the next turn's camera pose during Phase 3 (`return`), while smoothly rotating the camera via `setCameraForSide(currentTurn, false)` after non-capture moves and always re-enabling `orbitControls`.
- **Target files and symbols:** `src/wizardChessEngine.js` (`executeChessMove`, `finishMove`, `stepMove`).
- **Steps:**
  1. In `executeChessMove` (around line 2675, right after `savedCamPos` and `savedTarget` are defined), compute:
     - `const nextTurnColor = piece.color === 'w' ? 'b' : 'w';`
     - `const isPlayerCamPresetActive = Boolean(document.getElementById('btn-cam-player')?.classList.contains('active'));`
     - `const shouldAutoFlip2P = gameMode === 'single' && isPassAndPlay && autoFlipCamera2P && !scriptedGameActive && isPlayerCamPresetActive;`
     - `const returnCamPos = shouldAutoFlip2P ? new THREE.Vector3(0, 2.88, (nextTurnColor === 'b' ? -1 : 1) * 3.05) : savedCamPos;`
     - `const returnTarget = shouldAutoFlip2P ? new THREE.Vector3(0, 0.78, (nextTurnColor === 'b' ? -1 : 1) * -0.08) : savedTarget;`
  2. In `executeChessMove` (around line 2787), compute `camReturnDist = returnCamPos.distanceTo(duelCamClose);` and in `stepMove` Phase 3 (`return`, lines 3074–3075), lerp `camera.position.lerpVectors(duelCamClose, returnCamPos, easeRet)` and `orbitControls.target.lerpVectors(duelTargetEnd, returnTarget, easeRet)`.
  3. In `finishMove()` (`lines 2886–2901`):
     - In `if (isCapture)`, set `activeDuelSavedCam = null; camera.position.copy(returnCamPos); orbitControls.target.copy(returnTarget); if (shouldAutoFlip2P) { playerCamSide = nextTurnColor; } orbitControls.enabled = true; orbitControls.update();`.
     - After `currentTurn = currentTurn === 'w' ? 'b' : 'w'`, if `gameMode === 'single' && isPassAndPlay`, set `playerColor = currentTurn;` and if `!isCapture && shouldAutoFlip2P`, set `playerCamSide = currentTurn; setCameraForSide(currentTurn, false);`.
- **Success criteria:** Capture duels in 2P mode glide directly from `duelCamClose` to the next player's side (`returnCamPos`), non-capture moves glide via `setCameraForSide(currentTurn, false)`, and `orbitControls.enabled` is always restored to `true`.
- **Verify:** `npm run lint` exits 0 with empty error output.

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
