# Phase 2: HUD Mode Cycling, Null-Safe Cross-Tab `?room=CODE` Sync & Verification Suite

## Goal
Wire 2-Player Pass & Play mode into `#btn-ai-difficulty` and `#btn-side-toggle` without violating any of the 14 required or 12 forbidden HUD IDs in `src/App.tsx`, make `createMultiplayerRoom` / `joinMultiplayerRoom` / `applyRemoteRoomState` null-safe and promotion-aware for Cross-Tab `?room=CODE` sync, expose 2P helpers on `window.wizardChess`, and add automated unit/integration tests in `test/applet.test.mjs`.

## Files to Create or Modify
- `src/wizardChessEngine.js` (modify)
- `src/App.tsx` (modify titles/tooltips only, preserving all 14 required IDs and 0 forbidden IDs)
- `test/applet.test.mjs` (modify)

## Tasks & Steps

### Task 2.1 — Wire `#btn-ai-difficulty`, `#btn-side-toggle`, `updateTurnUI`, null-safe room sync, and `window.wizardChess` 2P API
- **Goal:** Enable switching to `2 Players` mode from `#btn-ai-difficulty`, toggling `Auto-Flip: On/Off` (or leaving a room) from `#btn-side-toggle`, null-safe `?room=CODE` cross-tab sync with promotion support, startup `?mode=2p` / `?room=CODE` parsing, and `window.wizardChess` 2P API methods.
- **Target files and symbols:** `src/wizardChessEngine.js` (`updateTurnUI`, `applyRemoteRoomState`, `createMultiplayerRoom`, `joinMultiplayerRoom`, `#btn-ai-difficulty`, `#btn-side-toggle`, `window.wizardChess`), `src/App.tsx`.
- **Steps:**
  1. In `updateTurnUI()` (`lines 4154–4203`):
     - Compute `isAiTurn` only when `!isPassAndPlay && aiAutoPlay` (or when `aiSearchInFlight` is actively running).
     - Update `#mode-badge`:
       - If `gameMode === 'multi' && roomCode`: `Room ${roomCode} • ${playerColor === 'w' ? 'White' : 'Black'}`
       - Else if `isPassAndPlay`: `2 Players • ${currentTurn === 'w' ? 'White' : 'Black'}`
       - Else: `Playing as ${playerColor === 'w' ? 'White' : 'Black'}`
     - Update `#btn-ai-difficulty`:
       - If `gameMode === 'multi' && roomCode`: `Room: ${roomCode}`
       - Else if `isPassAndPlay`: `Mode: 2 Players`
       - Else: `AI: ${diffLabel}`
     - Update `#btn-side-toggle`:
       - If `gameMode === 'multi' && roomCode`: `Leave Room`
       - Else if `isPassAndPlay`: `autoFlipCamera2P ? 'Auto-Flip: On' : 'Auto-Flip: Off'`
       - Else: `playerColor === 'w' ? 'Play as Black' : 'Play as White'`
  2. In `applyRemoteRoomState` (`line 4460`), pass `{ fromRemote: true, promotion: nextMove.promotion || 'queen' }` to `executeChessMove`, and guard all optional DOM accesses in `createMultiplayerRoom` and `joinMultiplayerRoom` (`lines 4509–4635`) with optional chaining (`if (mpMsg) mpMsg.textContent = ...`, etc.).
  3. In `#btn-ai-difficulty` click listener (`lines 4739–4747`), cycle through `['novice', 'tactical', 'grandmaster', '2p']` via helper `setGameModeOrDifficulty(mode)`:
     - When `'2p'` is selected: stop any active multiplayer room sync, set `gameMode = 'single'; isPassAndPlay = true; aiAutoPlay = false; playerColor = currentTurn; cancelPendingAISearch(); updateTurnUI();`.
     - When `'novice' | 'tactical' | 'grandmaster'` is selected: set `gameMode = 'single'; isPassAndPlay = false; aiAutoPlay = true; aiDifficulty = mode; updateTurnUI(); maybeScheduleAIMove();`.
  4. In `#btn-side-toggle` click listener (`lines 4778–4782`):
     - If `gameMode === 'multi'`: call `stopMultiplayerSync(); roomCode = null; gameMode = 'single'; isPassAndPlay = false; aiAutoPlay = true; playerColor = 'w'; window.history.replaceState({}, '', window.location.pathname); resetChessBoard(true, false);`.
     - Else if `isPassAndPlay`: toggle `autoFlipCamera2P = !autoFlipCamera2P; if (autoFlipCamera2P && document.getElementById('btn-cam-player')?.classList.contains('active')) { playerCamSide = currentTurn; setCameraForSide(currentTurn, false); } updateTurnUI();`.
     - Else: flip `playerColor = playerColor === 'w' ? 'b' : 'w'; resetChessBoard(true, scriptedGameActive);`.
  5. Expose `setPassAndPlayMode(enabled, autoFlip = true)`, `setAutoFlipCamera2P(enabled)`, `createMultiplayerRoom`, `joinMultiplayerRoom`, and include `isPassAndPlay`, `autoFlipCamera2P`, `aiAutoPlay` in `window.wizardChess.getState()`. Also support `?mode=2p` and `?room=CODE` in the startup query string parser (`lines 5510–5520`).
- **Success criteria:** `#btn-ai-difficulty` cycles through `Novice -> Tactical -> Grandmaster -> 2 Players`, `#btn-side-toggle` toggles `Auto-Flip: On/Off` in 2P mode, `?room=CODE` joins null-safely, and `window.wizardChess` exposes the new 2P methods and state fields.
- **Verify:** `npm run lint && npm run build` exits 0.

### Task 2.2 — Add 2-Player Mode & Cross-Tab Sync verification tests in `test/applet.test.mjs`
- **Goal:** Add automated tests in `test/applet.test.mjs` verifying the 2-Player Pass & Play contract, capture duel `returnCamPos` auto-flip without snap-back, 1-ply `undoLastMove`, and null-safe Cross-Tab `?room=CODE` room synchronization.
- **Target files and symbols:** `test/applet.test.mjs`.
- **Steps:**
  1. Add a test in `test/applet.test.mjs` verifying that `src/wizardChessEngine.js` declares `isPassAndPlay` and `autoFlipCamera2P`, cycles `'2p'` in `#btn-ai-difficulty`, computes `returnCamPos` / `returnTarget` for seamless capture duel auto-flip while restoring `orbitControls.enabled = true`, pops 1 ply in `undoLastMove` when `isPassAndPlay` is active, and passes `promotion: nextMove.promotion || 'queen'` in `applyRemoteRoomState`.
  2. Run `node --test test/applet.test.mjs`, `npm run lint`, and `npm run build`.
- **Success criteria:** All tests in `test/applet.test.mjs` pass (13/13), `npm run lint` exits 0, and `npm run build` succeeds.
- **Verify:** `node --test test/applet.test.mjs && npm run lint && npm run build` exits 0.

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
