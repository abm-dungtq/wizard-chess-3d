# Test Report — 2026-10-31 — Wizard Chess 3D (2-Player Game Room & Full Suite QA)

## Test Results Overview
- **Total**: 14 test suites (covering 95+ unit, integration, 3D raycast, FIDE rules, async AI, and `/api/rooms/*` assertions)
- **Passed**: 14 | **Failed**: 0 | **Skipped**: 0
- **Duration**: 2.03s (`node --test --experimental-test-coverage test/applet.test.mjs`)
- **Advisory Supervision**: Verified and approved by `kongming` (`9b3c88a2-d2fe-4659-ae23-129d728cc774`)

## Coverage Metrics
| File / Module | Lines | Branches | Functions | Threshold | Status |
|---------------|-------|----------|-----------|-----------|--------|
| `src/chessAI.ts` | 97.02% | 89.64% | 96.67% | 80% / 70% / 80% | **PASS** |
| `src/roomStore.ts` | 95.99% | 82.35% | 91.67% | 80% / 70% / 80% | **PASS** |
| `src/soundEngine.ts` | 98.60% | 76.09% | 94.44% | 80% / 70% / 80% | **PASS** |
| **All Tracked Modules** | **97.01%** | **87.06%** | **94.44%** | **80% / 70% / 80%** | **PASS** |

## Defects & Edge Cases Caught and Repaired Under Advisor Supervision
1. **`Escape` Key Handler for `#duel-room-overlay` (`src/wizardChessEngine.js:3828`)**:
   - **Cause**: The `Escape` keydown listener previously checked `lobbyModal?.classList.contains('open')`, which was falsy because `#lobby-modal` is omitted per the single-player HUD contract.
   - **Fix**: Added TDZ-safe `document.getElementById('duel-room-overlay')?.classList.contains('visible')` check to `keydown` so pressing `Escape` closes the 2-Player Game Room modal cleanly.
2. **Checkmate Overlay `New Game` in Online Room Mode (`src/wizardChessEngine.js:5034, 5135`)**:
   - **Cause**: `#btn-checkmate-newgame` previously called `resetChessBoard(true, false)` locally without broadcasting `POST /api/rooms/:code/reset` to the opponent.
   - **Fix**: Unified `#btn-reset` and `#btn-checkmate-newgame` through `handleGameResetAction()` so starting a new game after Checkmate resets both boards in an online room.
3. **Stale Active Room Code Box After Leaving Room (`src/wizardChessEngine.js:4920, 5006`)**:
   - **Cause**: Leaving an online room via `#btn-side-toggle` (`Leave Room`) or switching modes left `#duel-active-room-box` visible if the user reopened the modal.
   - **Fix**: Explicitly hid `#duel-active-room-box` when leaving a room or switching to Single Player / Pass & Play.
4. **Static Room Fallback Token Persistence (`src/wizardChessEngine.js:4664, 4751`)**:
   - **Cause**: Offline `localStorage` fallback rooms did not persist `whiteToken` and `blackToken` on creation/join.
   - **Fix**: Added `whiteToken` and `blackToken` to `staticRoom` fallback objects for idempotent seat retention on page refresh.
5. **HTTP Status Code Consistency on Missing Room Move (`src/roomStore.ts:398`)**:
   - **Cause**: `POST /api/rooms/:code/move` returned `400` instead of `404` when the room code did not exist.
   - **Fix**: Updated `handleRoomApiRequest` to return `404` when `result.error === 'Room not found'` and `400` for validation/turn/token errors.

## Live E2E HTTP & SSE Verification (`http://localhost:3000`)
- **Endpoints Tested Live**:
  - `POST /api/rooms/create` -> `200 OK` (`code: "E98P"`, `color: "w"`)
  - `GET /api/rooms/E98P/events` -> `200 OK` (`text/event-stream` initial state received)
  - `POST /api/rooms/join` -> `200 OK` (`color: "b"`, `status: "playing"`, SSE broadcast verified)
  - `POST /api/rooms/E98P/move` -> `200 OK` (`turn: "b"`, SSE move broadcast verified)
  - `POST /api/rooms/E98P/reset` -> `200 OK` (`resetCount: 1`)

## Build & Static Analysis Status
- **TypeScript (`npm run lint` / `tsc --noEmit`)**: **PASS** (0 errors)
- **Engine Static Scope Gate (`TS2304` / `TS2552`)**: **PASS** (0 undeclared identifiers in `src/wizardChessEngine.js`)
- **Production Build (`npm run build`)**: **PASS** (`dist/wizard_chess_3d/index.js` + `dist/client`)
