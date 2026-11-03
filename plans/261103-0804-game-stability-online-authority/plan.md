---
title: "Game stability hardening and authoritative online rooms"
description: "Add a real-browser test harness, fix online-room security and desync bugs, harden the render loop, then move rooms into a Durable Object with server-side move validation."
status: pending
priority: P1
effort: 17h
branch: claude/game-quality-audit-577bc6
tags: [bugfix, backend, frontend, api, critical]
blockedBy: []
blocks: []
created: 2026-11-03
---

# Game stability hardening and authoritative online rooms

Source decision: [brainstorm report](../reports/brainstorm-261102-1743-game-quality-stability-audit.md) (option 2, approved by `kongming` with "harness first" ordering).

## Outcome

- Only the seat owner can move, reset, or change skin in an online room. Only legal moves are accepted.
- Rooms survive deploys and work across Cloudflare edge locations.
- A remote-move replay can never apply a stale move to a fresh board. A detected desync triggers a full resync.
- One throwing animation can never freeze rendering or input.
- A Playwright test drives the real game in a browser and guards the main flows.

## Constraints

- Keep the `/api/rooms/*` URL shapes and JSON field names the client already uses. New error responses are allowed.
- Do not change chess or xiangqi rules or AI. Perft already matches reference values.
- Cloudflare Workers Free plan. Use a SQLite-backed Durable Object.
- Deploy to `workers.dev` and verify there before the custom domain `chess.tqd.io.vn`. Every deploy needs explicit user approval in chat.
- `src/roomStore.ts` must stay importable by Node (`node --test`). No `cloudflare:*` imports in it.

## Non-goals

- Bundle code-splitting, lazy GLB loading, base64-to-binary asset conversion.
- Real-device mobile performance tuning.
- Xiangqi perpetual-check rule, AI quiescence mate detection, en-passant hash refinement.
- UI or UX redesign.

## Phases

| # | Phase | PR | Effort | Status | Depends on |
|---|---|---|---|---|---|
| 1 | [Playwright smoke harness](phase-01-playwright-smoke-harness.md) | PR 1 | 3h | completed | none |
| 2 | [Room API auth and anti-hijack](phase-02-room-api-auth-and-anti-hijack.md) | PR 1 | 3h | completed | 1 |
| 3 | [Idempotent remote move reconcile](phase-03-idempotent-remote-move-reconcile.md) | PR 1 | 2h | completed | 2 |
| 4 | [Render loop robustness and smoothness](phase-04-render-loop-robustness.md) | PR 1 | 3h | completed | 3 |
| 5 | [Server-side move legality](phase-05-server-side-move-legality.md) | PR 2 | 2h | completed | 2 |
| 6 | [Durable Object room storage](phase-06-durable-object-room-storage.md) | PR 2 | 4h | pending | 5 |

PR 1 contains phases 1 to 4 and changes no deploy configuration. PR 2 contains phases 5 and 6 and is branched from PR 1.

## Acceptance criteria (whole plan)

1. `npm run test:e2e` passes. It covers:
   - move and AI reply
   - undo and reset
   - chess/xiangqi switch and skin switch
   - an injected faulty tween
   - two-browser online play, including leave mid-replay and desync recovery
   - zero unexpected console errors

   The brainstorm's "no frame > 50 ms on desktop" target is checked **manually** in phase 4, Task 4.6. Headless Chromium timing is not reliable enough to assert it.
2. A move with an empty or wrong token gets HTTP 403. An illegal move gets HTTP 400. Creating a room with an existing code from a stranger gets HTTP 409.
3. Reset or leave-room during an in-flight remote replay does not apply any old move. A mismatch triggers a resync from the server move list.
4. A tween that throws is removed and logged. Rendering and input continue.
5. Two browsers finish an online game on `workers.dev`. The room still exists after a redeploy.
6. `npm run lint`, `npm run build`, and `node --test test/applet.test.mjs` pass. `src/roomStore.ts` line coverage is at least 80%.

## Global verification commands

```bash
npm run lint
```

```bash
npm run build
```

```bash
node --test --experimental-test-coverage test/applet.test.mjs
```

```bash
npm run test:e2e
```

## Execution notes for the executor

- Every phase file has its own Failure Protocol. Stopping on a failed Verify step is intended behavior.
- Run the executor from the worktree root `/Volumes/2/wizard-chess-3d/.claude/worktrees/game-quality-audit-577bc6`.
- Port 3000 may be used by another session. The harness uses port 3107 with `--strictPort`. If 3107 is busy, find the owner with `lsof -i :3107`. Stop it only if this session started it; otherwise STOP and ask the user.
- Commit messages: conventional commits, no plan or phase IDs.

## Risks

- Headless Chromium may use software WebGL, so frame-time numbers in the harness are coarse. The harness asserts correctness and only very loose timing. Smoothness is measured manually in phase 4.
- The first Durable Object deploy changes the Worker topology. Rollback is described in phase 6.
- A Durable Object keeps running while an SSE stream is open, which uses duration quota. Rooms are small and expire after 2 hours, so this is acceptable on the Free plan. Watch the Cloudflare dashboard after launch.
