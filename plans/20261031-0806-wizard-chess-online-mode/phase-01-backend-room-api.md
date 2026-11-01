# Phase 1: Shared `/api/rooms/*` Store, Cloudflare Worker & Vite Dev Middleware

## Goal
Implement the `/api/rooms/*` backend (`create`, `join`, `state`, `move`, `reset`, `events` SSE) in `src/roomStore.ts`, wire it into a Cloudflare Worker + Durable Object (`src/worker.ts` & `wrangler.jsonc`) and Vite Dev Server middleware (`vite.config.ts`) so both `npm run dev` and `npm run build` / `npm run deploy:cf` support online multiplayer rooms out of the box.

## Files to Create or Modify
- `src/roomStore.ts` (create)
- `src/worker.ts` (create)
- `wrangler.jsonc` (modify)
- `vite.config.ts` (modify)

## Tasks & Steps

### Task 1.1 — Create `src/roomStore.ts` with HTTP + SSE room state machine
- **Goal:** Provide a zero-dependency TypeScript room state manager and Web Fetch API handler (`handleRoomApiRequest`) that works identically inside a Cloudflare Worker/Durable Object, Vite Dev Server, and Node unit tests.
- **Target files and symbols:** `src/roomStore.ts` (`RoomStore`, `defaultRoomStore`, `handleRoomApiRequest`).
- **Steps:**
  1. Define `RoomMove` (`seq`, `color`, `from`, `to`, `promotion`, `ts`) and `RoomRecord` (`code`, `status`, `whiteJoined`, `blackJoined`, `whiteToken`, `blackToken`, `turn`, `moves`, `resetCount`, `updatedAt`).
  2. Implement `createRoom(preferredColor, playerToken)`, `joinRoom(code, playerToken)` (with idempotent reconnect when `playerToken` matches `whiteToken` or `blackToken`), `getRoomState(code)`, `recordMove(code, payload)` (validating turn & seat token and preserving `promotion`), `resetRoom(code)`, and SSE stream subscription for `/api/rooms/:code/events`.
  3. Export `handleRoomApiRequest(request: Request, store = defaultRoomStore): Promise<Response | null>` handling all 6 `/api/rooms/*` endpoints plus CORS/JSON headers.
- **Success criteria:** All 6 `/api/rooms/*` endpoints return valid JSON or `text/event-stream` responses matching the exact contract expected by `src/wizardChessEngine.js`.
- **Verify:** `npm run lint` exits 0.

### Task 1.2 — Create `src/worker.ts` and wire `wrangler.jsonc` & `vite.config.ts`
- **Goal:** Expose `/api/rooms/*` on Cloudflare Workers (`src/worker.ts` + `wrangler.jsonc`) and in local Vite dev (`vite.config.ts`).
- **Target files and symbols:** `src/worker.ts` (`RoomDurableObject`, default worker export), `wrangler.jsonc`, `vite.config.ts`.
- **Steps:**
  1. Create `src/worker.ts` exporting `RoomDurableObject` (which delegates per-room `/api/rooms/*` requests to an instance-scoped `RoomStore`) and a default Worker `fetch(request, env)` handler that routes `/api/rooms/*` to `env.ROOMS` (if bound) or `handleRoomApiRequest(request)`, and falls back to `env.ASSETS.fetch(request)`.
  2. Update `wrangler.jsonc` to set `"main": "src/worker.ts"` while preserving `"assets": { "not_found_handling": "single-page-application" }`.
  3. Update `vite.config.ts` to add a light Vite plugin `wizardChessRoomApiPlugin()` that intercepts `/api/rooms/*` in `configureServer` and `configurePreviewServer` using `handleRoomApiRequest`.
- **Success criteria:** `npm run lint && npm run build` succeeds with 0 errors and produces the client + worker bundle cleanly.
- **Verify:** `npm run lint && npm run build` exits 0.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Message the `kongming` subagent (`9b3c88a2-d2fe-4659-ae23-129d728cc774`) for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
