# Phase 2: 5-Mode HUD Online Room Trigger, 4 Client Sync Fixes & Automated Tests

## Goal
Extend `#btn-ai-difficulty` in `src/wizardChessEngine.js` to 5 modes (`Novice -> Tactical -> Grandmaster -> 2P Local -> Online Room`) with automatic `?room=ABCD` URL update and clipboard invite link copy, fix the 4 client sync bugs identified by `kongming`, and add end-to-end automated tests in `test/applet.test.mjs`.

## Files to Create or Modify
- `src/wizardChessEngine.js` (modify)
- `src/App.tsx` (modify tooltip only; preserve all 14 Required IDs and 0 Forbidden IDs)
- `test/applet.test.mjs` (modify)

## Tasks & Steps

### Task 2.1 — Fix the 4 client sync bugs and wire 5-mode `#btn-ai-difficulty` (`Online Room`) in `src/wizardChessEngine.js` & `src/App.tsx`
- **Goal:** Make Online Room creation 1-click from `#btn-ai-difficulty` and ensure rock-solid synchronization across tabs and devices.
- **Target files and symbols:** `src/wizardChessEngine.js` (`ensurePlayerToken`, `executeChessMove`, `applyRemoteRoomState`, `createMultiplayerRoom`, `joinMultiplayerRoom`, `syncActionButtonsUI`, `updateTurnUI`, `#btn-ai-difficulty`, `window.wizardChess`), `src/App.tsx`.
- **Steps:**
  1. Declare `let roomBothReady = false;` and `let roomInviteCopied = false;` at module state scope (`lines 1652–1655`), and update `playerToken` initialization + `ensurePlayerToken()` to use `sessionStorage` first (with `localStorage` fallback).
  2. In `executeChessMove()` (`around line 2498`), when `gameMode === 'multi' && roomCode && !options.fromRemote`, increment `appliedMoveSeq += 1` before calling `sendMultiplayerMove(...)`.
  3. In `applyRemoteRoomState()` (`around line 4474`), update `roomBothReady = Boolean(room.whiteJoined && room.blackJoined);`, call `updateTurnUI()`, and in `tryApplyNext()` guard `if (pieceAtFrom && pieceAtFrom.color === currentTurn)` before calling `executeChessMove`.
  4. In `syncActionButtonsUI()`, `triggerAIMoveNow()`, and `triggerAIMoveAsync()`, disable `#btn-undo` when `gameMode === 'multi'` and block `#btn-ai-move` when `gameMode === 'multi' && currentTurn !== playerColor`.
  5. In `createMultiplayerRoom()`, copy the shareable `?room=ABCD` URL to clipboard (`navigator.clipboard?.writeText?.(window.location.href)`), set `roomInviteCopied = true`, and update `updateTurnUI()` so `#btn-ai-difficulty` displays `Online: ${roomCode}` and `#mode-badge` displays `Room ${roomCode} • ${sideLabel} (${statusSuffix})` (`2/2`, `Copied!`, or `Waiting`).
  6. Update `#btn-ai-difficulty` click listener to cycle `['novice', 'tactical', 'grandmaster', '2p', 'online']` (calling `createMultiplayerRoom('w')` when `'online'` is reached, and cleanly leaving `gameMode === 'multi'` via `setPassAndPlayMode(false)` when cycling back to `'novice'`).
- **Success criteria:** `npm run lint && npm run build` exits 0 with 0 `TS2304`/`TS2552` errors.
- **Verify:** `npm run lint && npm run build` exits 0.

### Task 2.2 — Add Online Room API & Client Sync verification tests in `test/applet.test.mjs`
- **Goal:** Verify the entire `/api/rooms/*` lifecycle (`create`, `join`, reconnect, `move` with `promotion`, turn enforcement, `state`, `reset`, SSE `events`) and the 5-mode HUD + client sync invariants in `test/applet.test.mjs`.
- **Target files and symbols:** `test/applet.test.mjs`.
- **Steps:**
  1. Import `RoomStore` and `handleRoomApiRequest` from `../src/roomStore.ts` in `test/applet.test.mjs`.
  2. Add a test verifying `POST /api/rooms/create`, `POST /api/rooms/join` (Guest assigned `'b'`, Host reconnect with same `playerToken` keeps `'w'`), `POST /api/rooms/:code/move` (including `promotion: 'knight'` and rejection of out-of-turn moves), `GET /api/rooms/:code/state`, `GET /api/rooms/:code/events` SSE stream, and `POST /api/rooms/:code/reset`, plus the 5-mode `#btn-ai-difficulty` cycle and 4 client sync fixes in `src/wizardChessEngine.js`.
  3. Run `node --test test/applet.test.mjs && npm run lint && npm run build`.
- **Success criteria:** All 14 tests in `test/applet.test.mjs` pass, `npm run lint` exits 0, and `npm run build` exits 0.
- **Verify:** `node --test test/applet.test.mjs && npm run lint && npm run build` exits 0.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Message the `kongming` subagent (`9b3c88a2-d2fe-4659-ae23-129d728cc774`) for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
