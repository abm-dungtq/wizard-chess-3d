# Advise State — Online Multiplayer (`?room=ABCD`) for Wizard Chess 3D

## Original Input
- Prompt: `/ak:advise chơi online thì sao` + `sử dụng advisor opus 5.5 high trên antigravity để đánh giá phân tích và đưa ra quyết định`
- Workspace: `/Volumes/2/wizard-chess-3d`

## Codebase Scout Evidence
1. **`src/wizardChessEngine.js` (`lines 4360–4722`):**
   - Already implements full client-side HTTP + SSE room sync (`mpApiRequest`, `sendMultiplayerMove`, `startMultiplayerSync`, `applyRemoteRoomState`, `createMultiplayerRoom`, `joinMultiplayerRoom`) targeting:
     - `POST /api/rooms/create` (`{ preferredColor, playerToken }`)
     - `POST /api/rooms/join` (`{ code, playerToken }`)
     - `POST /api/rooms/:code/move` (`{ playerToken, color, from, to, promotion }`)
     - `POST /api/rooms/:code/reset`
     - `GET /api/rooms/:code/state?playerToken=...` (polled every 1500ms)
     - `GET /api/rooms/:code/events` (`EventSource` SSE stream)
   - Also includes a static fallback via `BroadcastChannel('wizard_chess_mp_channel')` + `localStorage`.
   - Note on `isStaticHost` (`lines 4361–4364`): Currently checks `window.location.hostname.includes('zipline') || window.location.hostname.includes('github.io') || window.location.protocol === 'file:'`.
2. **Cloudflare & Vite Infrastructure (`package.json`, `vite.config.ts`, `wrangler.jsonc`):**
   - `@cloudflare/vite-plugin@^1.66.0` and `wrangler@^4.156.0` are installed.
   - `wrangler.jsonc` currently only has `"assets": { "not_found_handling": "single-page-application" }` and no `"main"` worker entrypoint yet.
3. **Strict HUD Contract (`test/applet.test.mjs` lines 26–66):**
   - Must preserve all 14 Required IDs (`btn-side-toggle`, `btn-ai-difficulty`, `btn-ai-move`, `btn-undo`, `btn-reset`, `btn-audio-toggle`, `btn-cam-player`, `btn-cam-top`, `btn-cam-side`, `btn-cam-wide`, `btn-hide-ui`, `controls-hint`, `captured-tray`, `promotion-overlay`).
   - Must NEVER introduce any of the 12 Forbidden IDs (`cam-speed-wrap`, `input-cam-speed`, `rot-speed-wrap`, `input-rot-speed`, `script-bar`, `btn-script-modal`, `btn-script-prev`, `btn-script-next`, `btn-lobby`, `lobby-modal`, `room-pill`, `btn-checkmate-stepback`).

## Completed Interview Q&A
- **Q1:** Khi 2 người chơi Online trên 2 thiết bị khác nhau, bạn hình dung cách họ bắt đầu ván cờ như thế nào?
  - **A1:** `(Recommended) Tạo phòng & gửi link (?room=ABCD) cho bạn bè mở trên máy khác là vào đánh ngay`
- **Q2:** Bạn muốn hạ tầng đồng bộ phòng Online (?room=ABCD) hoạt động theo hướng nào?
  - **A2:** `(Recommended) Triển khai trên Cloudflare Workers (tận dụng sẵn wrangler.jsonc & /api/rooms/* trong dự án, đồng thời hỗ trợ cả local vite dev)`
- **Q3:** Bạn muốn người chơi bấm tạo phòng Online & lấy link mời bạn bè bằng thao tác nào trên thanh điều khiển?
  - **A3:** `(Recommended) Thêm bước "Online Room" vào nút #btn-ai-difficulty (Novice → Tactical → Grandmaster → 2P Local → Online Room): bấm tới Online Room là tự tạo mã ?room=ABCD & tự copy link mời vào bộ nhớ tạm`
- **Q4 (Preview Confirmation):** User ended the interview and instructed: `sử dụng advisor opus 5.5 high trên antigravity để đánh giá phân tích và đưa ra quyết định` (proceed directly to full technical evaluation, architectural decision, and `ADVICE_READY` report).

## Confirmed Reframing
- **Problem (reframed):** `src/wizardChessEngine.js` already has the complete client-side protocol for `/api/rooms/*` and `?room=ABCD` URL joining, but the project lacks the server-side `/api/rooms/*` implementation for Cloudflare Workers (`wrangler.jsonc`) and local Vite dev (`vite.config.ts`), as well as a 1-click HUD trigger on `#btn-ai-difficulty` to create an online room and copy the shareable `?room=ABCD` link without adding forbidden lobby DOM IDs.
- **Exact requirements:**
  1. Extend `#btn-ai-difficulty` mode cycle to 5 steps: `Novice -> Tactical -> Grandmaster -> 2P Local -> Online Room` (calling `createMultiplayerRoom('w')`, updating the URL to `?room=ABCD`, and copying `window.location.href` to the clipboard).
  2. Show clear connection status on `#mode-badge` (`Room ABCD • Waiting (Copied!)` -> `Room ABCD • White (2/2)`) and allow leaving via `#btn-side-toggle` (`Leave Room`).
  3. Implement `/api/rooms/create`, `/api/rooms/join`, `/api/rooms/:code/move`, `/api/rooms/:code/reset`, `/api/rooms/:code/state`, and `/api/rooms/:code/events` in a Cloudflare Worker (`src/worker.ts` + `wrangler.jsonc` / Durable Object or isolate-safe store) and Vite dev server middleware so both `npm run dev` and `npm run deploy:cf` work out of the box.
- **Goals:** Enable two players on different devices/networks to play Wizard Chess 3D online via a shared `?room=ABCD` link with real-time move, promotion, and 3D capture duel synchronization.
- **Done means:**
  1. `wrangler.jsonc` and `src/worker.ts` (plus Vite dev middleware) serve `/api/rooms/*` with move history, promotion piece type, player token seat assignment (`w`/`b`), and reset count.
  2. Clicking `#btn-ai-difficulty` to `Online Room` creates a 4-character room `?room=ABCD`, copies the invite URL, and syncs moves across two separate browser instances in `< 1.5s`.
  3. `node --test test/applet.test.mjs`, `npm run lint`, and `npm run build` pass with 0 errors and 0 forbidden HUD IDs.
- **Non-goals:** Public matchmaking queues, user accounts/authentication, ELO ratings, in-game chat, or adding `#lobby-modal`/`#btn-lobby`/`#room-pill`.
- **Constraints:** Preserve all 14 Required HUD IDs, 0 Forbidden HUD IDs in `src/App.tsx`, and 0 `TS2304`/`TS2552` errors in `src/wizardChessEngine.js`.
