---
phase: 2
title: "Room API auth and anti-hijack"
status: completed
effort: 3h
pr: PR 1
---

# Phase 2: Room API auth and anti-hijack

## Goal

Every mutating room request must prove seat ownership, and room codes cannot be overwritten. The client must send tokens on every mutation and tell "server said no" apart from "server unreachable".

## Verified defects this phase fixes

All are in `src/roomStore.ts`.

- `recordMove` (around lines 317-328):
  - The token check is `if (entry.whiteToken && token && entry.whiteToken !== token)`, so an empty token skips it.
  - If the seat token is null, any token adopts the seat.
  - `payload.color` is trusted.
- `recordMove` (around lines 297-311): a coordinate of 8 or more flips the room to xiangqi permanently.
- `createRoom` (around lines 139-163): an explicit existing `code` makes `rooms.set` overwrite the room.
- `joinRoom`:
  - A third client joining a full room gets `ok: true, color: 'b'`.
  - The variant can change mid-game.
- `resetRoom` and `setPlayerSkin` take no token. Skin id length is unbounded.
- `ensureToken` and `generateUniqueCode` use `Math.random`.
- The `moves` array has no cap.

Verified client defects in `src/wizardChessEngine.js`:

- `mpApiRequest` (around line 8862) returns `null` for any non-2xx response. So `joinMultiplayerRoom` (around line 9149) falls back to a fake localStorage room even when the server answered "room full".
- `handleGameResetAction` (around line 9574) and the skin sync (around line 9802) do not send `playerToken`.
- `ensurePlayerToken` (around line 8853) uses `Math.random`.

## Files

| Action | Path | Change |
|---|---|---|
| modify | `src/roomStore.ts` | Auth, anti-hijack, caps, crypto randomness, HTTP status mapping. |
| modify | `src/wizardChessEngine.js` | Send tokens, distinguish error from unreachable, crypto token. |
| modify | `test/applet.test.mjs` | New room security tests. |

## Tasks

### Task 2.1: Write failing security tests first

- **Goal:** Tests that describe the secure behavior. They must fail on the current code.
- **Target files:** `test/applet.test.mjs`. Add a new `test('Room API security: seat tokens, anti-hijack, caps', ...)` block that uses `new RoomStore()` and `handleRoomApiRequest`.
- **Steps:** Assert each of these. Build `Request` objects like the existing room API test in the same file does.
  1. Create a room (white, token `T_W`) and join it (token `T_B`). Then:
     - a POST `/move` with no `playerToken` returns HTTP 403
     - a POST `/move` with `playerToken: 'wrong'` returns 403
  2. A move with `T_B` while it is white's turn returns 400 with error `Not your turn`.
  3. A move with `T_W` and `color: 'b'` in the body is recorded as color `w`. The server derives the color from the token.
  4. Create with `code: 'ABCD'`, then create again with `code: 'ABCD'` and a different token. The second call returns 409. The first room's moves are unchanged.
  5. A third token joining a full room returns 409 with error `Room is full`.
  6. POST `/reset` without a seat token returns 403. With `T_W` it returns 200.
  7. POST `/skin` with `T_B` and `skinId: 'x'.repeat(100)` returns 400. With `skinId: 'jade'` it returns 200 and sets `blackSkin` to `jade`.
  8. A chess room move with `from: {r: 8, c: 0}` returns 400. `gameVariant` stays `chess`.
  9. A join with `gameVariant: 'xiangqi'` on a chess room that already has moves leaves `gameVariant === 'chess'`.
  10. Generated tokens match `/^[0-9a-f-]{36}$/`, which is the `crypto.randomUUID()` format.
  11. After 600 accepted moves, the next move returns 400 with error `Move limit reached`. Build these 600 moves by alternating tokens. Legality is not enforced until phase 5.
- **Success criteria:** The new test fails on the current code.
- **Verify:** `node --test test/applet.test.mjs` exits non-zero, and the output names the new test as failing. A pass here is a failure of this task.

### Task 2.2: Harden `RoomStore`

- **Goal:** Make Task 2.1 pass without breaking existing tests.
- **Target files:** `src/roomStore.ts`. Classes and functions: `RoomStore.createRoom`, `joinRoom`, `setPlayerSkin`, `recordMove`, `resetRoom`, `ensureToken`, `generateUniqueCode`, and `handleRoomApiRequest`.
- **Steps:**
  1. Add a private helper `seatForToken(entry, token): 'w' | 'b' | null`. It returns the seat whose token equals the non-empty `token`, otherwise null.
  2. Change `ensureToken`:
     - Keep a client-provided token if it is 8 to 64 characters of `[A-Za-z0-9_-]`.
     - Otherwise return `crypto.randomUUID()`. `globalThis.crypto` exists in Node 20+ and in Workers.
  3. Change `generateUniqueCode` to draw characters with `crypto.getRandomValues`. Keep 4 characters and the same alphabet, because the UI input allows up to 6 and existing links use 4.
  4. In `createRoom`, when `explicitCode` names an existing room:
     - If `seatForToken(existing, token)` is not null, return `ok: true` with that seat (an idempotent refresh).
     - Otherwise return `{ ok: false, error: 'Room code already in use' }`.
  5. In `joinRoom`:
     - Replace the final `else { assignedColor = 'b'; }` with `return { ok: false as const, error: 'Room is full' }`.
     - Only change `gameVariant` when `entry.moves.length === 0`.
  6. In `recordMove`:
     - Require `seat = seatForToken(entry, token)`. If it is null, return `{ ok: false, error: 'Unauthorized player token' }`.
     - Use `seat` as the move color. Ignore `payload.color`.
     - Keep the turn check, comparing against `seat`.
     - Delete the coordinate-based xiangqi inference. Validate coordinates with `isValidCoord(coord, entry.gameVariant || 'chess')`.
     - Delete the line that sets `entry.gameVariant` from the payload.
     - If `entry.moves.length >= 600`, return `{ ok: false, error: 'Move limit reached' }`.
  7. Add a `playerToken` parameter to `resetRoom(code, gameVariant, playerToken)` and to `setPlayerSkin(code, { color, skinId, playerToken })`.
     - Require a seat. Otherwise return `Unauthorized player token`.
     - In `setPlayerSkin`, use the seat instead of `payload.color`.
     - Reject a `skinId` that does not match `/^[a-z0-9_]{1,40}$/` with `Invalid skin id`.
  8. In `handleRoomApiRequest`, pass `body.playerToken` to reset and skin. Map errors to statuses with one helper `statusForError(error)`:
     - `Room not found` → 404
     - `Unauthorized player token` → 403
     - `Room code already in use` and `Room is full` → 409
     - anything else → 400
     Use it for create, join, move, reset, and skin.
  9. Update the existing tests in `test/applet.test.mjs` that relied on old behavior, such as tokenless moves or skin without a token. Change them only by adding the correct token. Never delete an assertion. Record each changed test name in the commit body.
- **Success criteria:** All room tests pass.
- **Verify:** `node --test --experimental-test-coverage test/applet.test.mjs` exits 0. The coverage row for `roomStore.ts` shows line % ≥ 80.

### Task 2.3: Client sends tokens and handles server errors

- **Goal:** The client authenticates every mutation and never fakes a local room when the server refuses.
- **Target files:** `src/wizardChessEngine.js`. Functions: `mpApiRequest`, `ensurePlayerToken`, `handleGameResetAction`, the skin sync function containing `/api/rooms/${roomCode}/skin`, `createMultiplayerRoom`, and `joinMultiplayerRoom`.
- **Steps:**
  1. `mpApiRequest`:
     - When `fetch` resolves with a JSON content type, return the parsed body whatever the status.
     - Return `null` only when `fetch` throws or the response is not JSON.
     - Callers already check `data.ok`.
  2. `ensurePlayerToken`: generate with `crypto.randomUUID()` when available, with the old expression as a fallback.
  3. `handleGameResetAction`: send `headers: { 'Content-Type': 'application/json' }` and `body: JSON.stringify({ playerToken })`.
  4. Skin sync: add `headers: { 'Content-Type': 'application/json' }` and add `playerToken` to the JSON body.
  5. `joinMultiplayerRoom` and `createMultiplayerRoom`:
     - Use the static localStorage fallback only when `data === null`.
     - When `data && !data.ok`, write `data.error` into `#duel-status-msg` and `#mp-status-msg` and return `false`.
- **Success criteria:** Online play still works and refusals are visible.
- **Verify:** `npm run lint` exits 0, and `npx playwright test e2e/online-room.spec.ts --reporter=line` exits 0.

### Task 2.4: Add a refusal case to the e2e test, then commit

- **Steps:**
  1. In `e2e/online-room.spec.ts`, add a third context `C` that calls `joinMultiplayerRoom(code)` on the full room.
  2. Expect it to return `false` and `#duel-status-msg` to contain `Room is full`.
  3. Run `npm run lint`, `npm test`, and `npm run test:e2e`.
  4. Commit `fix(rooms): require seat tokens and block room hijacking`.
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

## Execution notes

- `#mp-status-msg` does not exist in the current UI; only `#duel-status-msg` is rendered (`src/App.tsx`). The client writes to both, and the e2e test asserts on `#duel-status-msg`.
- Per the phase-1 advisory checkpoint, `sendMultiplayerMove` and the reset action also surface `data.error` when the server rejects them.
- The "Room is full" e2e test closes player A before opening player C so that at most two 3D scenes are live. It relies on seats persisting after disconnect; a future leave-on-unload feature must revisit it.
- `roomStore.ts` line coverage rose to 84.95% after adding feedback API tests.
- Pre-existing flake, not caused by this phase: the AI test `yields < 14ms slices` fails about 1 in 3 full coverage runs under load and passes alone. `chessAI.ts` is untouched.
