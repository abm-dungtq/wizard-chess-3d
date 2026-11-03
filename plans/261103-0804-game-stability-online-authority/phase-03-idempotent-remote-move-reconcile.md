---
phase: 3
title: "Idempotent remote move reconcile"
status: pending
effort: 2h
pr: PR 1
---

# Phase 3: Idempotent remote move reconcile

## Goal

Replace the timer chain that replays opponent moves with one cancellable drain loop. The loop always reads the **latest** room snapshot. When the local board disagrees with the server move list, it rebuilds the board from that list.

## Verified defect

`applyRemoteRoomState` in `src/wizardChessEngine.js` (move section, around lines 8982-9003) defines `tryApplyNext`. Its problems:

- It closes over the `room` snapshot from the call that created it.
- It reschedules itself with `setTimeout(120 | 250)` and has no cancel handle.
- It advances `appliedMoveSeq` **before** it knows the move applied.
- It silently skips a move whose `from` piece is not of `currentTurn`.
- Every caller starts a new chain: SSE (`startMultiplayerSync`), the 1.5 s poll, the `storage` event, and `BroadcastChannel`.
- Nothing stops the chains. `stopMultiplayerSync` (around line 8904) clears only the EventSource and the poll.

## Design

Module-level state, declared next to `appliedMoveSeq`:

```js
let remoteSyncSession = 0;      // bump to cancel any in-flight drain
let latestRemoteRoom = null;    // newest snapshot from any source
let remoteDrainActive = false;  // only one drain loop at a time
let multiPlyCount = 0;          // plies on the board since the last reset; uncapped
```

Do **not** use `moveHistory.length` as the counter. `moveHistory` is capped at 60 entries (`moveHistory.shift()` around line 6242), so the count breaks at ply 61.

`multiPlyCount` bookkeeping:

- `+= 1` on the line right after `moveHistory.push({` finishes (around line 6227).
- `= 0` at both `moveHistory = [];` sites (around lines 5058 and 10161).

Invariant: in `gameMode === 'multi'`, `multiPlyCount === appliedMoveSeq` whenever no remote move is mid-animation.

Drain loop (pseudocode):

```js
function drainRemoteMoves(session) {
  if (remoteDrainActive) return;
  remoteDrainActive = true;
  const step = () => {
    if (session !== remoteSyncSession || gameMode !== 'multi') { remoteDrainActive = false; return; }
    // variant switch is async (ensureXiangqiModelsLoaded().then(reset)), so wait for it like an animation
    if (isAnimatingMove || (latestRemoteRoom?.gameVariant && latestRemoteRoom.gameVariant !== gameVariant)) { setTimeout(step, 120); return; }
    const moves = latestRemoteRoom?.moves || [];
    if (appliedMoveSeq >= moves.length) { remoteDrainActive = false; return; }
    const next = moves[appliedMoveSeq];
    const piece = boardState[next.from.r]?.[next.from.c];
    const inSync = multiPlyCount === appliedMoveSeq && piece && piece.color === currentTurn && piece.color === next.color;
    if (!inSync) { remoteDrainActive = false; resyncFromRoomMoves(latestRemoteRoom); return; }
    executeChessMove(next.from.r, next.from.c, next.to.r, next.to.c, { fromRemote: true, promotion: next.promotion || 'queen' });
    appliedMoveSeq = next.seq;
    setTimeout(step, 250);
  };
  step();
}
```

`resyncFromRoomMoves(room)` does the following:

1. `remoteSyncSession += 1`
2. `resetChessBoard(false)` and `appliedMoveSeq = 0`
3. For each move: `executeChessMove(..., { fromRemote: true, promotion })`, then `completeCurrentMoveImmediately()` (existing function, around line 7644), then `appliedMoveSeq = move.seq`
4. `console.warn('Room resynced from server move list', room.code, room.moves.length)`

## Files

| Action | Path | Change |
|---|---|---|
| modify | `src/wizardChessEngine.js` | Add the drain loop and resync. Cancel on stop, reset, and leave. |
| modify | `e2e/online-room.spec.ts` | Add tests for leave mid-replay and for desync recovery. |
| modify | `test/applet.test.mjs` | Update any source-string assertion that names `tryApplyNext`. |

## Tasks

### Task 3.1: Write failing e2e tests

- **Target files:** `e2e/online-room.spec.ts`.
- **Steps:**
  1. **Test "leave room mid-replay applies nothing":**
     - A creates a room and B joins.
     - A plays e2-e4.
     - Right after A's call resolves, B calls `window.wizardChess.setPassAndPlayMode(true)`. This leaves the room. If it needs other arguments, check the function in the engine (around line 9432).
     - Record B's `moveHistoryCount` immediately after the leave call as `before`. `setPassAndPlayMode` does not reset the board, so the value may be 0 or 1.
     - Wait 3 s.
     - Expect B's `getState().gameMode !== 'multi'` and `moveHistoryCount === before`. No remote move may land after leaving.
  2. **Test "desync heals from server list":**
     - A and B play e2-e4 and e7-e5, and both reach `moveHistoryCount === 2`.
     - On B only, call `window.wizardChess.resetChessBoard(true, false)`. B's board is now fresh but its `appliedMoveSeq` is still 2.
     - A plays g1-f3: `executeChessMove(7,6,5,5)`.
     - Wait until B's `moveHistoryCount === 3` (timeout 15 s).
     - Expect the piece at B's square (5,5) to be a white knight. Read it through `inspectSquare(5,5)` or `getState()`, whichever exposes it. Check the engine API.
- **Success criteria:** At least one of the two tests fails on the current code.
- **Verify:** `npx playwright test e2e/online-room.spec.ts --reporter=line` exits non-zero. A pass here is a failure of this task. If both tests pass on the old code, STOP and use the Failure Protocol, because the test does not reproduce the bug.

### Task 3.2: Implement the drain loop and resync

- **Target files:** `src/wizardChessEngine.js`. Functions: `applyRemoteRoomState`, `stopMultiplayerSync`, the reset branch inside `applyRemoteRoomState`, and every place that sets `gameMode` away from `'multi'` or sets `roomCode = null`. Find those places with `grep -n "roomCode = null\|gameMode = 'single'\|gameMode = 'pass'" src/wizardChessEngine.js`.
- **Steps:**
  1. Add the three state variables from the design, next to `let appliedMoveSeq`.
  2. Add `drainRemoteMoves` and `resyncFromRoomMoves` from the design. Put them directly above `function applyRemoteRoomState`.
  3. In `applyRemoteRoomState`:
     - Set `latestRemoteRoom = room` at the top. Ignore rooms whose `code !== roomCode`.
     - In the reset branch, add `remoteSyncSession += 1` and `remoteDrainActive = false` before `resetChessBoard(false)`.
     - Delete the whole `if (Array.isArray(room.moves) && room.moves.length > appliedMoveSeq) { const tryApplyNext = ... }` block. In its place, call `drainRemoteMoves(remoteSyncSession)` when `room.moves.length > appliedMoveSeq`.
  4. In `stopMultiplayerSync`, add `remoteSyncSession += 1`, `remoteDrainActive = false`, and `latestRemoteRoom = null`.
  5. At every place found by the grep in this task's target files, make sure `stopMultiplayerSync()` is called. Add the call where it is missing.
  6. In the local-move broadcast inside `executeChessMove` (around line 6279), `appliedMoveSeq += 1` stays as it is. It keeps the invariant for the mover.
  7. Add `multiPlyCount` and its bookkeeping exactly as described in the Design section.
  8. In `sendMultiplayerMove` (around line 8877):
     - Capture the result: `const data = await mpApiRequest(...)`.
     - If `data && !data.ok && data.room`, call `resyncFromRoomMoves(data.room)`.
     - Without this, a move the server rejected leaves the mover's `appliedMoveSeq` one ahead forever.
     - Do nothing when `data === null` (offline). The static fallback handles that case.
  7. Update any assertion in `test/applet.test.mjs` that searches for the string `tryApplyNext`. Make it search for `drainRemoteMoves` instead.
- **Success criteria:** The two new e2e tests and all old tests pass.
- **Verify:**
  - `npx playwright test --reporter=line` exits 0.
  - `node --test test/applet.test.mjs` exits 0.
  - `npm run lint` exits 0.

### Task 3.3: Commit

- **Steps:** Commit `fix(online): reconcile remote moves idempotently and resync on drift`.
- **Verify:** no verification needed.

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
