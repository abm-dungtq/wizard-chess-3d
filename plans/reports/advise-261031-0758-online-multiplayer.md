# Báo Cáo Đánh Giá & Quyết Định Kiến Trúc (`/ak:advise`) — Chế Độ Chơi 2 Người Online (`?room=ABCD`)

- **Model Đánh Giá:** `kongming` (`fable` / Opus High Advisory Model)
- **Ngày:** 2026-10-31
- **Dự án:** `/Volumes/2/wizard-chess-3d`

---

## 0. Định Hình Bài Toán Đã Xác Nhận (Confirmed Reframing)

- **Problem (Reframed):** [`src/wizardChessEngine.js`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L4360-L4722) đã có sẵn ~85% giao thức client gọi `/api/rooms/*` và tham gia phòng qua URL `?room=ABCD`, nhưng dự án đang thiếu 15% quyết định: (1) Backend xử lý `/api/rooms/*` cho Cloudflare Workers ([`wrangler.jsonc`](file:///Volumes/2/wizard-chess-3d/wrangler.jsonc)) và Vite Dev Server ([`vite.config.ts`](file:///Volumes/2/wizard-chess-3d/vite.config.ts)), (2) thao tác 1-click tạo phòng Online & copy link mời trên nút [`#btn-ai-difficulty`](file:///Volumes/2/wizard-chess-3d/src/App.tsx#L140-L145) mà không vi phạm 12 Forbidden IDs, và (3) vá 4 lỗi ngầm ở phía client khi chạy qua HTTP/SSE thật.
- **Exact Requirements:**
  1. Mở rộng vòng xoay nút `#btn-ai-difficulty` thành 5 bước: `Novice -> Tactical -> Grandmaster -> 2P Local -> Online Room` (tự động tạo mã phòng `?room=ABCD` và copy link mời vào clipboard).
  2. Hiển thị rõ trạng thái kết nối trên `#mode-badge` (`Room ABCD • White (Waiting)` $\rightarrow$ `Room ABCD • White (2/2)`) và hỗ trợ rời phòng qua `#btn-side-toggle` (`Leave Room`).
  3. Triển khai backend `/api/rooms/create`, `/api/rooms/join`, `/api/rooms/:code/move`, `/api/rooms/:code/reset`, `/api/rooms/:code/state`, và `/api/rooms/:code/events` (SSE) dùng chung cho cả Cloudflare Worker + Durable Object (`src/worker.ts`) và Vite Dev Server (`vite.config.ts`).
- **Goals:** Cho phép 2 người chơi trên 2 thiết bị / 2 mạng Internet khác nhau đấu cờ 3D trực tuyến theo thời gian thực chỉ bằng thao tác bấm tạo phòng và gửi link `?room=ABCD`.
- **Done Means:**
  1. `src/roomStore.ts`, `src/worker.ts`, `wrangler.jsonc` và `vite.config.ts` phục vụ đầy đủ 6 endpoint `/api/rooms/*` với kiểm tra lượt đi, mã định danh người chơi (`playerToken`), phong cấp tốt (`promotion`), và phát sự kiện SSE.
  2. Bấm `#btn-ai-difficulty` sang bước `Online Room` tự động tạo phòng `?room=ABCD`, copy link vào clipboard, và đồng bộ nước đi giữa 2 trình duyệt độc lập trong `< 1.5s`.
  3. Toàn bộ kiểm thử `node --test test/applet.test.mjs`, `npm run lint`, và `npm run build` đều PASS với 0 lỗi.
- **Non-Goals:** Không làm hệ thống đăng nhập tài khoản, bảng xếp hạng Elo, chat văn bản, ghép trận ngẫu nhiên (Quick Match) hay thêm các DOM ID bị cấm (`#lobby-modal`, `#btn-lobby`, `#room-pill`).
- **Constraints:** Giữ nguyên 14 Required HUD IDs, 0 Forbidden IDs trong [`src/App.tsx`](file:///Volumes/2/wizard-chess-3d/src/App.tsx), và 0 lỗi `TS2304`/`TS2552` trong [`src/wizardChessEngine.js`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js).

---

## 1. Verdict (Kết Luận & Quyết Định Chiến Lược)

**Quyết định: Chọn kiến trúc Same-Origin Cloudflare Worker + SQLite Durable Object (`RoomDurableObject`) kết hợp Vite Dev Middleware (`/api/rooms/*`), kích hoạt trực tiếp ở bước thứ 5 của nút `#btn-ai-difficulty` (`Online Room`).**

Lý do: **85% giao thức Multiplayer Online đã nằm sẵn trong [`src/wizardChessEngine.js`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L4360-L4722)** (`mpApiRequest`, `EventSource('/api/rooms/:code/events')`, `roomPollTimer`, `createMultiplayerRoom`, `joinMultiplayerRoom`). Việc viết lại WebRTC P2P hay cài thêm Firebase/Supabase là dư thừa và tốn kém. Tuy nhiên, khi phân tích sâu mã nguồn [`src/wizardChessEngine.js`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js), có **4 lỗi ngầm ở client** (chưa tăng `appliedMoveSeq` khi tự đi quân, xung đột `playerToken` trong `localStorage`, thiếu hiển thị `2/2 Connected` trên `#mode-badge`, và chưa khóa `#btn-undo` khi đánh online) bắt buộc phải được sửa đồng thời với việc bổ sung backend `/api/rooms/*`.

---

## 2. Phân Tích Chuyên Sâu 4 Lỗi Ngầm Trong `src/wizardChessEngine.js` Khi Chạy Online

1. **Bug 1 — `appliedMoveSeq` không tăng ở máy người vừa đi quân ([`lines 2498–2506`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L2498-L2506) & [`4517–4541`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L4517-L4541)):**
   - Khi Máy 1 đi một nước trong `gameMode === 'multi'`, `executeChessMove()` gọi `sendMultiplayerMove()` nhưng không tăng `appliedMoveSeq`.
   - Khi SSE `/api/rooms/:code/events` hoặc `roomPollTimer` (`1500ms`) trả về `room.moves` (`length === appliedMoveSeq + 1`), `applyRemoteRoomState()` thấy `room.moves.length > appliedMoveSeq` và cố chạy lại nước đi đó!
   - **Giải pháp:** Tăng `appliedMoveSeq += 1` ngay trong `executeChessMove()` khi `gameMode === 'multi' && roomCode && !options.fromRemote`, đồng thời kiểm tra `nextMove.color === currentTurn` trong `applyRemoteRoomState()`.

2. **Bug 2 — Xung đột `playerToken` trong `localStorage` khi mở 2 tab cùng máy vs F5 Reconnect ([`lines 1652`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1652) & [`4407–4415`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L4407-L4415)):**
   - `playerToken` đang lấy từ `localStorage.getItem('wizard_chess_token')` (dùng chung cho mọi tab cùng trình duyệt). Nếu tạo phòng ở Tab 1 rồi mở `?room=ABCD` ở Tab 2 để test, cả 2 tab gửi cùng 1 `playerToken` lên `/api/rooms/join`, khiến server tưởng Tab 2 là Tab 1 reconnect và gán cả 2 tab cùng cầm quân Trắng (`'w'`).
   - **Giải pháp:** Ưu tiên lưu `playerToken` trong `sessionStorage` (riêng biệt cho từng tab nhưng vẫn giữ nguyên khi F5 refresh lại tab đó).

3. **Bug 3 — Không hiển thị trạng thái đối thủ đã vào phòng (`2/2 Connected`) trên HUD hiện có ([`lines 4474–4484`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L4474-L4484)):**
   - `applyRemoteRoomState()` đang ghi vào `#hud-room-status` và `#mp-status-msg` (đã bị lược bỏ khỏi `src/App.tsx`).
   - **Giải pháp:** Lưu biến `roomBothReady = Boolean(room.whiteJoined && room.blackJoined)` và hiển thị trực tiếp trên `#mode-badge`: `Room ABCD • White (Waiting)` khi chờ và `Room ABCD • White (2/2)` khi đủ 2 người.

4. **Bug 4 — Chưa khóa `#btn-undo` và chưa chặn `#btn-ai-move` trái lượt khi chơi Online ([`lines 3184`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L3184) & [`4137–4148`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L4137-L4148)):**
   - Trong `gameMode === 'multi'`, nếu 1 người bấm `#btn-undo` thì chỉ bàn cờ máy đó lùi lại, gây lệch trạng thái với máy đối phương.
   - **Giải pháp:** Vô hiệu hóa `#btn-undo` khi `gameMode === 'multi'` và chỉ cho phép bấm `#btn-ai-move` khi `currentTurn === playerColor`.

---

## 3. What You Should Do (Các Việc Cần Làm Theo Thứ Tự)

1. **Tạo lõi quản lý phòng `src/roomStore.ts` dùng chung cho Cloudflare Worker và Vite Dev Server:**
   - Xử lý đầy đủ 6 API: `POST /api/rooms/create`, `POST /api/rooms/join`, `GET /api/rooms/:code/state`, `POST /api/rooms/:code/move`, `POST /api/rooms/:code/reset`, và `GET /api/rooms/:code/events` (SSE).
   - Hỗ trợ đầy đủ: reconnect theo `playerToken`, kiểm tra đúng lượt đi (`room.turn === move.color`), lưu quân phong cấp (`promotion`), và tự động dọn phòng không hoạt động sau 2 giờ (TTL).
2. **Tạo `src/worker.ts` (kèm `RoomDurableObject`) và gắn Vite Middleware vào `vite.config.ts`:**
   - Cập nhật [`wrangler.jsonc`](file:///Volumes/2/wizard-chess-3d/wrangler.jsonc) trỏ `"main": "src/worker.ts"` kèm cấu hình SQLite Durable Object (`RoomDurableObject`) và fallback sang `env.ASSETS` cho các route giao diện tĩnh.
   - Cập nhật [`vite.config.ts`](file:///Volumes/2/wizard-chess-3d/vite.config.ts) thêm plugin middleware định tuyến `/api/rooms/*` vào `roomStore` để chạy `npm run dev` hoạt động ngay lập tức.
3. **Nâng cấp `#btn-ai-difficulty` lên 5 chế độ & sửa 4 lỗi đồng bộ trong `src/wizardChessEngine.js`:**
   - Vòng xoay `#btn-ai-difficulty`: `['novice', 'tactical', 'grandmaster', '2p', 'online']`. Khi chuyển sang `'online'`, gọi `createMultiplayerRoom('w')` và tự copy link `?room=ABCD` vào clipboard.
   - Sửa cả 4 lỗi ngầm ở Mục 2 và bổ sung kiểm thử tự động trong [`test/applet.test.mjs`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs).

---

## 4. What You Shouldn't Do (Những Bẫy Cần Tránh)

- **Không thêm `#btn-lobby`, `#lobby-modal`, hay `#room-pill` vào `src/App.tsx`:** Sẽ làm fail ngay bài test đầu tiên trong [`test/applet.test.mjs`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L50-L65).
- **Không chỉ dùng biến `Map` toàn cục trên Cloudflare Worker mà thiếu Durable Object:** Trên môi trường Cloudflare thực tế, 2 người chơi ở 2 mạng khác nhau có thể chạm vào 2 Worker isolate khác nhau; định tuyến qua `RoomDurableObject` theo mã phòng `code` đảm bảo cả 2 người luôn kết nối vào đúng 1 bộ nhớ phòng duy nhất.
- **Không tích hợp WebRTC P2P hay thư viện ngoài (Socket.io / PeerJS / Firebase):** Giao thức `/api/rooms/*` bằng `fetch` + `EventSource` đã được viết sẵn trong [`src/wizardChessEngine.js`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L4417-L4722).

---

## 5. What Could Be Better / More Efficient (Tối Ưu Effort / Impact)

1. **Tự động Copy Link `?room=ABCD` khi tạo phòng + hiển thị `(Link Copied!)` trên `#mode-badge`** (Effort: Rất thấp | Impact: Rất cao) — Người chơi không cần gõ lại mã phòng bằng tay.
2. **Idempotent Reconnect & Late-Join Replay** (Effort: Thấp | Impact: Cao) — Nếu người chơi lỡ tay F5 trình duyệt giữa ván cờ, `sessionStorage` giữ nguyên `playerToken` giúp vào lại đúng phe và tự động tua lại các nước đã đi.

---

## 6. My Take and How to Get There (Lộ Trình Thực Thi)

1. **Phase 1 — Backend `/api/rooms/*` (`src/roomStore.ts`, `src/worker.ts`, `wrangler.jsonc`, `vite.config.ts`):** Xây dựng bộ xử lý phòng cờ chuẩn HTTP + SSE cho cả local dev và Cloudflare Worker.
2. **Phase 2 — Client Online Mode & Bug Fixes (`src/wizardChessEngine.js`, `src/App.tsx`, `test/applet.test.mjs`):** Gắn bước `'online'` vào `#btn-ai-difficulty`, sửa 4 lỗi đồng bộ client, và viết bộ unit/integration test kiểm chứng toàn trình.

---

## 7. Benefits & Trade-offs

### Benefits
- **Tương thích 100% với code sẵn có:** Khai thác trọn vẹn 350+ dòng code Multiplayer đã có trong [`src/wizardChessEngine.js`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L4360-L4722).
- **Độ trễ thấp (`50–150ms` qua SSE) & Tự động dự phòng (`1.5s` HTTP Polling):** Chạy mượt qua mọi tường lửa và mạng 4G/5G mà WebRTC P2P thường bị chặn.
- **An toàn tuyệt đối với bộ test hiện tại:** Giữ nguyên 14 Required IDs và 0 Forbidden IDs.

### Trade-offs & Điều Kiện Đảo Chiều
- **Đánh đổi:** Cần chạy qua `npm run dev` (local) hoặc `npm run deploy:cf` (Cloudflare Workers) để có endpoint `/api/rooms/*`.
- **Khi nào cần đổi hướng:** Nếu bạn đem bản build tĩnh (`dist/`) đi host trên một dịch vụ chỉ phục vụ file tĩnh thuần túy (như GitHub Pages) mà không dùng Cloudflare Workers, bạn sẽ cần điền URL Worker vào hằng số `CLOUD_MP_API_BASE` tại [`src/wizardChessEngine.js:4360`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L4360).

---

## 8. Unverified
- Việc deploy thực tế lên tài khoản Cloudflare cá nhân của bạn (`npm run deploy:cf`) sẽ cần phiên đăng nhập `wrangler login` hợp lệ trên máy khi đẩy lên production.

---

## 9. Work Checklist, Success Metrics & Handoff Brief

### Work Checklist
- [ ] Tạo `src/roomStore.ts` cài đặt đầy đủ state machine `/api/rooms/create`, `/join`, `/state`, `/move`, `/reset`, `/events` (SSE).
- [ ] Tạo `src/worker.ts` (export `RoomDurableObject` + Worker `fetch` handler) và cập nhật `wrangler.jsonc` + `vite.config.ts`.
- [ ] Cập nhật `src/wizardChessEngine.js`: thêm bước `'online'` vào `#btn-ai-difficulty` (tự tạo phòng & copy URL `?room=ABCD`), sửa 4 lỗi đồng bộ (`appliedMoveSeq`, `sessionStorage` token, `#mode-badge` `2/2`, khóa `#btn-undo` khi `multi`).
- [ ] Thêm bài kiểm thử tự động cho `/api/rooms/*` và chế độ `Online Room` vào `test/applet.test.mjs`, chạy pass `node --test test/applet.test.mjs && npm run lint && npm run build`.

### Success Metrics
- `node --test test/applet.test.mjs` pass 100% (14/14 tests pass, 0 lỗi `TS2304`/`TS2552`).
- `POST /api/rooms/create` $\rightarrow$ `POST /api/rooms/join` $\rightarrow$ `POST /api/rooms/:code/move` (kèm `promotion`) $\rightarrow$ `GET /api/rooms/:code/state` trả về đúng trạng thái phòng, lượt đi, màu quân và danh sách nước đi.
- `npm run lint` và `npm run build` hoàn tất với `0` lỗi.

### Handoff Brief
```text
Objective: Implement real-time Cross-Device Online 2-Player Room Mode (?room=ABCD) via /api/rooms/* on Cloudflare Workers + Vite Dev and wire "Online Room" into #btn-ai-difficulty in Wizard Chess 3D.
Done means: (1) src/roomStore.ts, src/worker.ts, wrangler.jsonc, and vite.config.ts serve /api/rooms/{create,join,state,move,reset,events}; (2) #btn-ai-difficulty cycles ['novice','tactical','grandmaster','2p','online'], creates a room, updates ?room=ABCD, copies the invite link, and fixes appliedMoveSeq, sessionStorage playerToken, #mode-badge 2/2 status, and #btn-undo lock in src/wizardChessEngine.js; (3) node --test test/applet.test.mjs, npm run lint, and npm run build all exit 0.
Out of scope: Public matchmaking queues, user accounts, ELO ratings, text chat, or adding forbidden lobby DOM elements (#lobby-modal, #btn-lobby, #room-pill).
Constraints: Strictly preserve all 14 Required HUD IDs and 0 Forbidden IDs in src/App.tsx, and keep 0 TS2304/TS2552 undeclared identifier errors in src/wizardChessEngine.js.
Stop and ask only if: A verification gate fails for a reason that cannot be resolved within the scoped files, or a destructive action outside the repository is required.
```
