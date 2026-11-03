---
phase: 5
title: "Server-side move legality"
status: pending
effort: 2h
pr: PR 2
---

# Phase 5: Server-side move legality

## Goal

`RoomStore.recordMove` rejects any move that is not legal in the current position. It uses the existing pure rule engines, which already pass perft:

- chess: `src/chessAI.ts`
- xiangqi: `src/xiangqiAI.ts`

## Context

- Chess pure API (`src/chessAI.ts`):
  - `getAllPureLegalMoves(cells, color, enPassantTarget)` returns `PureChessMove[]`. A promotion appears as four moves with `promotion` set to `queen`, `rook`, `bishop`, or `knight`.
  - `applyPureMove(cells, move)` returns `{ nextCells, nextEnPassant }`.
  - `PureCell` is `{ type, color, hasMoved }`.
- Chess initial board, matching the engine's `createInitialVirtualBoard` in `src/wizardChessEngine.js` around line 7379:
  - Back row order: `['rook','knight','bishop','queen','king','bishop','knight','rook']`
  - Row 7: white back row. Row 6: white pawns.
  - Row 1: black pawns. Row 0: black back row.
  - Every piece has `hasMoved: false`.
- Xiangqi pure API (`src/xiangqiAI.ts`):
  - `createInitialXiangqiBoard()`
  - `getAllXiangqiLegalMoves(cells, color)`
  - `applyXiangqiMove(cells, move)` returns `{ nextCells }`
- The room move list is the source of truth. Do **not** persist the board. Cache it in memory and rebuild it by replay when the cache is missing, for example after a Durable Object wakes up in phase 6.
- `src/roomStore.ts` must not import anything from `cloudflare:*` or `three`. Check first that `chessAI.ts` and `xiangqiAI.ts` do not import `three`. Run `grep -n "from 'three'" src/chessAI.ts src/xiangqiAI.ts`. It must print nothing.

## Files

| Action | Path | Change |
|---|---|---|
| create | `src/roomRules.ts` | `createRulesState`, `tryApplyRoomMove`. These are pure functions. |
| modify | `src/roomStore.ts` | Hold the cached rules state per room and validate in `recordMove`. Reset it on reset. |
| modify | `test/applet.test.mjs` | Legality tests. |

## Tasks

### Task 5.1: Failing legality tests

- **Target files:** `test/applet.test.mjs`. Add the test `'Room API rejects illegal moves for chess and xiangqi'`.
- **Steps:**
  1. Chess room with seats `T_W` and `T_B`:
     - White e2 to a8 (`from {r:6,c:4}`, `to {r:0,c:0}`) returns 400 with error `Illegal move`.
     - White e2 to e4 (`{r:6,c:4}` to `{r:4,c:4}`) returns 200.
     - Black moving from an empty square (`{r:4,c:0}` to `{r:3,c:0}`) returns 400 `Illegal move`.
  2. Play Scholar's mate as 7 alternating legal moves:
     - e4: `6,4`→`4,4`
     - e5: `1,4`→`3,4`
     - Bc4: `7,5`→`4,2`
     - Nc6: `0,1`→`2,2`
     - Qh5: `7,3`→`3,7`
     - Nf6: `0,6`→`2,5`
     - Qxf7#: `3,7`→`1,5`
     All return 200. After that, any black move returns 400 with error `Game is over`.
  3. Promotion: build a position by legal play only. If that is too long, use an exported test helper. Assert that a promotion move with `promotion: 'knight'` is recorded with `promotion === 'knight'`. If building the position takes more than 20 moves, skip this sub-case and note it in the test name. Do not add a backdoor to production code.
  4. Xiangqi room, starting from the initial position:
     - Red (white) horse `(9,1)→(7,2)` returns 200.
     - In a fresh room, horse `(9,1)→(8,3)` returns 400 `Illegal move`, because the horse leg at `(9,2)` is blocked by the elephant.
  5. After `/reset` by a seat holder, e2-e4 is accepted again.
- **Verify:** `node --test test/applet.test.mjs` exits non-zero, and the output names this test as failing. A pass is a failure of this task.

### Task 5.2: Implement `src/roomRules.ts`

- **Goal:** Pure rules state for a room.
- **Steps:**
  1. Write:
     ```ts
     import { getAllPureLegalMoves, applyPureMove, type PureCell, type EnPassantTarget } from './chessAI.ts';
     import { createInitialXiangqiBoard, getAllXiangqiLegalMoves, applyXiangqiMove, type XiangqiCell } from './xiangqiAI.ts';
     import type { GameVariant, RoomMove, PromotionPieceType } from './roomStore.ts';

     export type RulesState =
       | { variant: 'chess'; cells: (PureCell | null)[][]; ep: EnPassantTarget | null; over: boolean }
       | { variant: 'xiangqi'; cells: (XiangqiCell | null)[][]; over: boolean };

     export function createRulesState(variant: GameVariant): RulesState { /* initial boards as described in Context */ }

     export function tryApplyRoomMove(
       state: RulesState,
       move: { color: 'w' | 'b'; from: { r: number; c: number }; to: { r: number; c: number }; promotion?: PromotionPieceType }
     ): { ok: true; state: RulesState; promotion?: PromotionPieceType } | { ok: false; error: 'Illegal move' | 'Game is over' } {
       // 1. if state.over -> Game is over
       // 2. list legal moves for move.color; find one with same from/to.
       //    Compare promotion ONLY when the candidate has one (pawn reaching the last rank); then match move.promotion || 'queen'.
       //    The client sends promotion: 'queen' on every move, so never require it on non-promotion moves.
       // 3. none -> Illegal move
       // 4. apply; compute over = opponent has zero legal moves (checkmate or stalemate; xiangqi stalemate is a loss, still "over")
     }

     export function replayRoomMoves(variant: GameVariant, moves: RoomMove[]): RulesState { /* createRulesState then tryApplyRoomMove for each; throw on failure */ }
     ```
  2. Watch the type-only import from `roomStore.ts`. It is `import type`, so it creates no runtime cycle.
- **Verify:** `npm run lint` exits 0.

### Task 5.3: Wire into `RoomStore`

- **Target files:** `src/roomStore.ts`. Code: `InternalRoomEntry`, `recordMove`, `resetRoom`, `createRoom`, `joinRoom`.
- **Steps:**
  1. Add the optional, non-public field `rules?: RulesState` to `InternalRoomEntry`. `toPublicRoom` must not copy it.
  2. Add a private `getRules(entry)`. It returns `entry.rules ??= replayRoomMoves(entry.gameVariant || 'chess', entry.moves)`.
  3. In `recordMove`, after the token and turn checks and the move-limit check:
     - Call `tryApplyRoomMove(this.getRules(entry), { color: seat, from, to, promotion: normalizePromotion(payload.promotion) })`.
     - On failure, return `{ ok: false, error: result.error }`.
     - On success, set `entry.rules = result.state` and push the move.
  4. In `resetRoom`, and wherever `gameVariant` changes while moves are empty, set `entry.rules = undefined`.
  5. `statusForError` already maps unknown errors to 400, so `Illegal move` and `Game is over` become 400. Leave it unchanged.
  6. Fix existing tests that now submit illegal moves:
     - The phase 2 test that records 600 moves must use a legal shuffle. Repeat this 4-move knight cycle 150 times: `(7,6)→(5,5)`, `(0,6)→(2,5)`, `(5,5)→(7,6)`, `(2,5)→(0,6)`. The server does not check repetition draws, so all 600 moves are accepted.
     - In other tests, change only the move coordinates to legal ones. Keep every assertion.
- **Success criteria:** All tests pass.
- **Verify:**
  - `node --test --experimental-test-coverage test/applet.test.mjs` exits 0, and the coverage row for `roomStore.ts` shows line % ≥ 80.
  - `npx playwright test e2e/online-room.spec.ts --reporter=line` exits 0. This proves that real client coordinates match the server rules for chess.

### Task 5.4: Xiangqi coordinate parity in e2e, then commit

- **Steps:**
  1. Add a Playwright test. A creates a room after `setGameVariant('xiangqi')`, and B joins. A plays the first legal move from the engine's own legal move list. Find how the engine exposes legal moves for a square: `inspectSquare` or `getXiangqiBlockedPointsForPiece`. Read the engine API and use whichever returns legal targets. Expect B's `moveHistoryCount === 1`.
  2. If the server rejects a move that the client considers legal, the row or column orientation differs between engine and `xiangqiAI.ts`. STOP and use the Failure Protocol. Do not flip coordinates by guessing.
  3. Run `npm run lint`, `npm test`, and `npm run test:e2e`.
  4. Commit `feat(rooms): validate move legality on the server`.
- **Verify:** All three commands exit 0.

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
