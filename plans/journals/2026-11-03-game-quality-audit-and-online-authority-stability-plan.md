---
title: Game quality audit and online-authority stability plan
date: 2026-11-03
summary: Offline play is solid; online rooms are insecure and non-persistent; 6-phase handover plan written and supervisor-approved.
---

# Game quality audit and online-authority stability plan

## What happened
- Audited Wizard Chess 3D: tsc, build and 22/22 node tests pass. Perft matches reference values at depth 4 for chess and depth 3 for xiangqi.
- Desktop runtime: 100 fps idle; max frame 20 ms while a move and the AI reply run.
- Stress and leak checks: rapid undo/reset/AI input caused no errors. Chess/xiangqi switching and skin cycling leaked no geometry and showed no heap growth.
- Online rooms (`src/roomStore.ts`):
  - an empty `playerToken` bypasses the seat check
  - the server never validates move legality
  - an explicit room code can overwrite an existing room
  - rooms live in a per-isolate in-memory Map with no Durable Object
- Client (`src/wizardChessEngine.js`): the remote replay timer chain is never cancelled and silently skips mismatched moves, which desyncs the two boards.

## Decision
- Option 2: Playwright harness first; PR 1 fixes auth, replay reconcile and render-loop robustness; PR 2 adds server legality and a Durable Object per room.
- Plan: `plans/261103-0804-game-stability-online-authority/`. kongming verdict: GO-WITH-FIXES; all 10 fixes applied.
- Key catch: `moveHistory` is capped at 60 entries, so the desync invariant uses a separate uncapped `multiPlyCount`.
- Staging deploys need `routes: []`, because routes are inherited by named environments.

## Next steps
- Execute with `/ak:cook plans/261103-0804-game-stability-online-authority/plan.md --advice`.
- Real-device mobile performance and load time are still unmeasured.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
