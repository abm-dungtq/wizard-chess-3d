---
phase: 6
title: "Durable Object room storage"
status: pending
effort: 4h
pr: PR 2
---

# Phase 6: Durable Object room storage

## Goal

Each room code maps to exactly one Durable Object (DO) instance. That instance:

- holds the room in memory
- persists the room to DO storage after every mutation
- serves the SSE stream
- deletes itself 2 hours after the last activity

This makes rooms survive deploys and isolate eviction, and puts every player of a room on the same state.

## Context

- Today `src/worker.ts` calls `handleRoomApiRequest(request, defaultRoomStore)`. `defaultRoomStore` is a per-isolate `Map`, and `wrangler.jsonc` has no DO binding.
- `src/roomStore.ts` must stay free of `cloudflare:*` imports, because Node tests import it.
- Local dev keeps using the Vite middleware in `vite.config.ts` (`attachRoomApiMiddleware` with `defaultRoomStore`). Do not remove it. The DO path is tested with `wrangler dev` on the built output (Task 6.5).
- The Cloudflare Vite plugin writes the deployable config to `dist/wizard_chess_3d/wrangler.json` on `npm run build`.
- Every deploy is outward-facing. Ask the user in chat before each `wrangler deploy` and wait for an explicit yes.

## Design

```
client ──HTTP/SSE──▶ Worker (src/worker.ts)
                         │ code = from path, or body.code, or generated (create)
                         ▼
                 env.ROOMS.idFromName(code) ──▶ RoomDurableObject (src/roomDurableObject.ts)
                                                   ├─ RoomStore (in memory, single room)
                                                   ├─ ctx.storage 'room' snapshot (persisted)
                                                   └─ alarm: delete after 2h idle
```

- `ROOMS_BACKEND` var: `"durable"` by default. Setting it to `"memory"` routes to `defaultRoomStore` as an emergency fallback that needs no code change.
- Create without a code: the Worker generates a 4-character code with `crypto.getRandomValues` and forwards to that DO. On HTTP 409 it retries with a new code, up to 5 times.

## Files

| Action | Path | Change |
|---|---|---|
| modify | `src/roomStore.ts` | `exportRoom(code)`, `importRoom(snapshot)`, `hasListeners(code)`, `generateRoomCode()` (exported). |
| create | `src/roomDurableObject.ts` | DO class. |
| modify | `src/worker.ts` | Route to the DO, export the class, keep the memory fallback. |
| modify | `wrangler.jsonc` | DO binding, migration, `ROOMS_BACKEND` var, `env.staging`. |
| modify | `playwright.config.ts` | Honor `E2E_BASE_URL` (no `webServer` when it is set). |
| modify | `test/applet.test.mjs` | Export/import round trip and worker routing tests. |

## Tasks

### Task 6.1: Snapshot API on `RoomStore` (test first)

- **Steps:**
  1. Add the test `'RoomStore exportRoom/importRoom round-trips a room and rebuilds rules'`:
     - Create a room, join, play e2-e4, then `snap = store.exportRoom(code)`.
     - Assert `JSON.parse(JSON.stringify(snap))` deep-equals `snap`, so the snapshot is serializable.
     - Make a new store and `importRoom(snap)`.
     - Black e7-e5 with `T_B` must be accepted. White's token on black's turn must be rejected.
  2. Run it and confirm it fails.
  3. Implement in `RoomStore`:
     - `exportRoom(code)` returns every `InternalRoomEntry` field except `listeners` and `rules`, or null.
     - `importRoom(snapshot)` sets `rooms.set(code, { ...snapshot, listeners: new Set(), rules: undefined })`.
     - `hasListeners(code): boolean`.
  4. Export `generateRoomCode()`, the crypto-based generator from phase 2, as a standalone function. `generateUniqueCode` must use it.
- **Verify:** `node --test test/applet.test.mjs` exits 0.

### Task 6.2: The Durable Object class

- **Target files:** `src/roomDurableObject.ts`.
- **Steps:**
  1. Do not import `cloudflare:workers`. Declare minimal local interfaces:
     ```ts
     interface DOStorage {
       get<T>(key: string): Promise<T | undefined>;
       put(key: string, value: unknown): Promise<void>;
       deleteAll(): Promise<void>;
       setAlarm(ms: number): Promise<void>;
     }
     interface DOState {
       storage: DOStorage;
       blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
     }
     ```
  2. Write `export class RoomDurableObject`:
     - `constructor(state: DOState, env: unknown)` creates `this.store = new RoomStore()`. Inside `state.blockConcurrencyWhile`, load `await state.storage.get('room')` and pass it to `importRoom` when it exists.
     - `async fetch(request: Request)`:
       - Run `res = await handleRoomApiRequest(request, this.store)`.
       - If `request.method === 'POST'`, find the code: the only room in the store, or read `this.store.exportRoom(...)` after a create or join. Then `await state.storage.put('room', snapshot)` and `await state.storage.setAlarm(Date.now() + 2 * 60 * 60 * 1000)`.
       - Return `res`. If it is null, return a 404 JSON response.
     - `async alarm()`:
       - If `hasListeners(code)` is true, re-arm 30 minutes later.
       - Otherwise run `await state.storage.deleteAll()` and replace the store with a new empty `RoomStore`.
  3. A DO instance serves one code. Track that code in a field `this.code`, set on the first request from its path or body. Then `exportRoom(this.code)` has a fixed key.
  4. `RoomStore.pruneExpiredRooms` (around `src/roomStore.ts:95`) can drop the room from memory before the alarm fires. After any request, if `exportRoom(this.code)` returns null, call `await state.storage.deleteAll()` instead of `put`.
  5. Node 24 runs `.ts` files with type stripping, and `test/applet.test.mjs` imports `worker.ts`, which imports this file. So this file must not use TypeScript-only runtime syntax:
     - no constructor parameter properties (`constructor(private state: DOState)`); declare fields and assign them in the body
     - no `enum`
     - no `namespace`
- **Verify:** `npm run lint` exits 0.

### Task 6.3: Worker routing

- **Target files:** `src/worker.ts`.
- **Steps:**
  1. Add `ROOMS?: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } }` and `ROOMS_BACKEND?: string` to `WorkerEnv`.
  2. Add `export { RoomDurableObject } from './roomDurableObject.ts';`.
  3. For `/api/rooms*`:
     - If `env.ROOMS_BACKEND === 'memory'` or `!env.ROOMS`, keep the current behavior.
     - `OPTIONS` requests: answer with the existing CORS response through `handleRoomApiRequest`.
     - `/api/rooms/create`:
       - Parse the JSON body once.
       - Use `body.code` if it is a non-empty string. Otherwise use `generateRoomCode()`.
       - Forward `new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify({ ...body, code }) })` to `env.ROOMS.get(env.ROOMS.idFromName(code))`.
       - If the response is 409 and the code was generated, retry with a new code, up to 5 attempts.
     - `/api/rooms/join`: parse the body, uppercase and trim `code`, and forward a rebuilt request the same way. An empty code goes to `handleRoomApiRequest` with `defaultRoomStore`, which returns the existing 400 error.
     - `/api/rooms/:code/*`: forward the original `request` to the DO named by the uppercased code.
  4. Add a Node test `'worker routes rooms to the Durable Object by code'`:
     - Import the default export from `../src/worker.ts`.
     - Pass a fake `env.ROOMS` whose `get(id).fetch` records the id name and returns `new Response('{"ok":true}')`.
     - Assert that `/api/rooms/ABCD/state` routes to `ABCD`.
     - Assert that a create without a code routes to a 4-character code.
     - Assert that `ROOMS_BACKEND: 'memory'` does not call the fake.
- **Verify:**
  - `node --test test/applet.test.mjs` exits 0.
  - `npm run lint` exits 0.

### Task 6.4: Wrangler config

- **Target files:** `wrangler.jsonc`.
- **Steps:**
  1. Add to the top level:
     ```jsonc
     "durable_objects": { "bindings": [{ "name": "ROOMS", "class_name": "RoomDurableObject" }] },
     "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RoomDurableObject"] }],
     "vars": { "ROOMS_BACKEND": "durable" },
     ```
  2. Add a staging environment that has no custom domain. In wrangler, `durable_objects` and `vars` are not inherited by named environments, so repeat them as shown. `npm run build` in step 3 validates the config, and an unknown field fails the build.
     ```jsonc
     "env": {
       "staging": {
         "name": "wizard-chess-3d-staging",
         "workers_dev": true,
         "routes": [],
         "durable_objects": { "bindings": [{ "name": "ROOMS", "class_name": "RoomDurableObject" }] },
         "vars": { "ROOMS_BACKEND": "durable" }
       }
     }
     ```
  3. Run `npm run build`.
  4. Run `CLOUDFLARE_ENV=staging npm run build`. Then run `ls dist` and note the staging output folder. It follows the worker name, likely `dist/wizard_chess_3d_staging`. Call this path `<staging-dir>` below.
- **Verify:**
  - Both builds exit 0.
  - `grep -c RoomDurableObject dist/wizard_chess_3d/wrangler.json` prints a number ≥ 1.
  - `grep -c "class RoomDurableObject" dist/wizard_chess_3d/index.js` prints ≥ 1.
  - `grep -c chess.tqd.io.vn <staging-dir>/wrangler.json` prints `0`. `routes` is inherited by environments, so the `"routes": []` in staging is load-bearing. Without it, a staging deploy would claim the production domain.

### Task 6.5: Local Durable Object end-to-end

- **Steps:**
  1. In `playwright.config.ts`:
     - When `process.env.E2E_BASE_URL` is set, use it as `baseURL` and omit `webServer`.
     - Otherwise keep the current behavior.
  2. Start `npx wrangler dev -c dist/wizard_chess_3d/wrangler.json --port 8787` in the background. Record its PID.
  3. Run `E2E_BASE_URL=http://localhost:8787 npx playwright test e2e/online-room.spec.ts --reporter=line`.
  4. Persistence check:
     - Create a room with `curl -s -X POST localhost:8787/api/rooms/create -H 'content-type: application/json' -d '{"playerToken":"tok_persist_check1"}'` and note the code.
     - Stop wrangler dev and start it again with the same command. Local DO storage persists in `.wrangler/state`.
     - `curl -s localhost:8787/api/rooms/<code>/state` must return `"ok":true`.
  5. Stop the wrangler dev process you started.
- **Verify:**
  - The Playwright command exits 0.
  - The final curl output contains `"ok":true`.

### Task 6.6: Commit, staging deploy, and production deploy (each deploy needs user approval)

- **Steps:**
  1. Run `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e`. All must exit 0.
  2. Commit `feat(rooms): persist rooms in a Durable Object per room code`.
  3. **Ask the user in chat** for approval to deploy staging. Wait for an explicit yes.
  4. Deploy staging with `CLOUDFLARE_ENV=staging npm run build`, then `npx wrangler deploy -c <staging-dir>/wrangler.json`. Note the printed `workers.dev` URL. Before deploying, re-run the `grep -c chess.tqd.io.vn` check from Task 6.4 and require `0`.
  5. Run `E2E_BASE_URL=<staging url> npx playwright test e2e/online-room.spec.ts --reporter=line`.
  6. Redeploy staging with the same command. Then `curl -s <staging url>/api/rooms/<code from step 5>/state` must contain `"ok":true`. To have the code available, the test should print it with `console.log('ROOM_CODE', code)`.
  7. Report the staging results to the user. **Ask in chat** for approval to deploy production. Only after a yes:
     - run `npm run build` (without `CLOUDFLARE_ENV`)
     - then run `npx wrangler deploy -c dist/wizard_chess_3d/wrangler.json`
     Do not use `npm run deploy`, because it deploys the root `wrangler.jsonc`, which has no built asset directory.
  8. After the production deploy, run `E2E_BASE_URL=https://chess.tqd.io.vn npx playwright test e2e/online-room.spec.ts --reporter=line`.
- **Verify:**
  - Step 5 exits 0.
  - Step 6 output contains `"ok":true`.
  - Step 8 exits 0.

### Rollback

- **Fast, no code change:** set `ROOMS_BACKEND` to `memory` in the Cloudflare dashboard (Worker → Settings → Variables). Alternatively, change it in `wrangler.jsonc`, run `npm run build`, and then `npx wrangler deploy -c dist/wizard_chess_3d/wrangler.json`. Online play returns to the old in-memory behavior.
- **Do not delete the `migrations` entry** to roll back. Removing a DO class requires a `deleted_classes` migration, and that destroys stored rooms.

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

A failed deploy, an authentication prompt from `wrangler`, or a production smoke failure also triggers this protocol. Never retry a deploy more than once without the user's approval.

## Adjustments from the phase-5 checkpoint

- `recordMove` returns the JSON error `Room history is not replayable` instead of throwing when stored moves no longer replay. A thrown error became a non-JSON 500, which the client reads as "no room server" and silently switches to the offline static room. `reset` recovers such a room.
- The DO constructor only imports the snapshot. Rules are rebuilt lazily on the next move, so a bad history cannot block the DO from loading.
- The Worker wraps Durable Object calls in `try/catch` and answers `{ ok: false, error: 'Room service error' }` with status 500 as JSON, for the same reason.
- Deploy commands: `npm run deploy` is correct for production. Its build rewrites `.wrangler/deploy/config.json` to point at `dist/wizard_chess_3d/wrangler.json`. A staging build writes to the same folder, so staging is always deployed with an explicit `-c`, and production is always rebuilt without `CLOUDFLARE_ENV` before deploying.
- Rollback note: `ROOMS_BACKEND=memory` returns production to the per-isolate store, which is the broken state measured before this phase (create succeeds, the next request returns 404). It stops the Durable Object path; it is not a working fallback.

## Execution notes

- The staging build writes to `dist/wizard_chess_3d` too, not a separate folder. Its `wrangler.json` has name `wizard-chess-3d-staging`, `routes: []`, the DO binding, the migration and `assets.directory`.
- Port 8787 was held by another local process, so the local Durable Object run used port 8797.
- Local run: `E2E_BASE_URL=http://localhost:8797` online-room suite passed 7/7. A room created before a `wrangler dev` restart still returned `"ok":true` afterwards.
- The legacy unit assertion that forbade `new_sqlite_classes` in `wrangler.jsonc` now requires the DO binding and migration.
- Gates before commit: lint clean, unit 28/28, build OK, e2e 15 passed and 1 skipped.
