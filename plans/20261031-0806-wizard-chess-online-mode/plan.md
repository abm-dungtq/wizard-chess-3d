---
title: "Wizard Chess 3D — Online 2-Player Room Mode (/api/rooms/* + Cloudflare Worker + 5-Mode HUD)"
status: completed
mode: advice
created: 2026-10-31T08:06:10+07:00
---

# Plan: Wizard Chess 3D — Online 2-Player Room Mode (`--advice` Handover Plan)

## Contract Summary (From Confirmed `/ak:advise` Report)
- **Outcome:** Enable real-time Cross-Device Online 2-Player gameplay (`?room=ABCD`) in Wizard Chess 3D:
  1. **Shared `/api/rooms/*` Backend (`src/roomStore.ts` + `src/worker.ts` + `wrangler.jsonc` + `vite.config.ts`):** Implements `POST /api/rooms/create`, `POST /api/rooms/join`, `GET /api/rooms/:code/state`, `POST /api/rooms/:code/move`, `POST /api/rooms/:code/reset`, and `GET /api/rooms/:code/events` (SSE) across both Cloudflare Workers (`RoomDurableObject` + in-memory fallback) and Vite Dev Server middleware.
  2. **5-Step HUD Mode Cycle & Client Sync Fixes (`src/wizardChessEngine.js` & `src/App.tsx`):** Extends `#btn-ai-difficulty` to `['novice', 'tactical', 'grandmaster', '2p', 'online']` with automatic `?room=ABCD` URL update and clipboard invite link copy, while fixing the 4 client sync bugs (`appliedMoveSeq` increment on local move, `sessionStorage` `playerToken` isolation, live `2/2` status on `#mode-badge`, and `#btn-undo` / `#btn-ai-move` turn guards in `gameMode === 'multi'`).
- **Constraints:**
  - Preserve all 14 Required HUD IDs and 0 Forbidden IDs in `src/App.tsx`.
  - Maintain 0 `TS2304`/`TS2552` undeclared identifier errors in `src/wizardChessEngine.js`.
  - Pass `node --test test/applet.test.mjs`, `npm run lint`, and `npm run build`.

## Phases
- [x] 1. [Phase 1: Shared `/api/rooms/*` Store, Cloudflare Worker & Vite Dev Middleware](./phase-01-backend-room-api.md)
- [x] 2. [Phase 2: 5-Mode HUD Online Room Trigger, 4 Client Sync Fixes & Automated Tests](./phase-02-client-online-sync-and-tests.md)
