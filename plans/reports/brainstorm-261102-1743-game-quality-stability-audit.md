# Brainstorm: audit chất lượng, độ ổn định và độ mượt của game (2026-11-02)

Chế độ: `--advice`. Kongming đã duyệt và đồng ý (GO) với phương án 2, kèm điều kiện dựng bộ test trình duyệt trước.

## Kết luận nhanh

- Phần chơi offline (Cờ Vua, Cờ Tướng, AI) ổn định và mượt trên desktop.
- Luật đi quân đúng tuyệt đối. Perft khớp chuẩn ở 7 thế cờ kiểm tra.
- Phần **chơi online** có lỗi nghiêm trọng:
  - Ai cũng có thể đi quân thay người khác.
  - Server không kiểm tra nước đi có hợp lệ không.
  - Phòng chơi nằm trong RAM của từng isolate Worker, nên trên production phòng có thể biến mất hoặc hai người thấy hai bàn cờ khác nhau.
- Rủi ro lớn nhất khi sửa là `src/wizardChessEngine.js` (10.954 dòng). File này chưa có test nào chạy thật.

## Bằng chứng

| Hạng mục | Kết quả |
|---|---|
| `tsc --noEmit` | PASS |
| `vite build` | PASS. Có một chunk JS 1,22 MB (335 KB gzip) và 37 MB asset GLB dạng base64. |
| `node --test` | 22/22 PASS |
| Coverage | chessAI 96,7%, xiangqiAI 92,6%. roomStore 72% (giảm từ 96%), soundEngine 49,5% (giảm từ 98,6%). Engine 3D: 0% runtime. |
| Perft | Đúng ở thế khởi đầu, Kiwipete và CPW pos3–6 (depth 4), Cờ Tướng (depth 3). |
| AI | Mức Grandmaster: cờ vua ≤ 55 ms, cờ tướng ≤ 99 ms. Bản async có nhường luồng (khoảng hở lớn nhất 4 ms). |
| FPS desktop (1024×768, DPR 1) | Lúc đứng yên: 100 fps, p95 10,8 ms. Lúc đi quân và AI đáp: frame lâu nhất 20 ms, không frame nào quá 50 ms. |
| Stress test (bấm dồn undo/reset/AI) | Không có lỗi, trạng thái nhất quán. |
| Rò rỉ bộ nhớ (8 lần đổi chế độ, 24 lần đổi skin) | Geometry dừng ở 320, texture 63, program 20. Heap không tăng dần. |
| Đo trên điện thoại | **Chưa đo được.** Khung trình duyệt bị ẩn nên requestAnimationFrame dừng. |

## Lỗi đã xác nhận

### Nghiêm trọng

**A. Bỏ qua kiểm tra token.** `src/roomStore.ts:317-328`. Nếu client gửi `playerToken` rỗng thì bước kiểm tra bị bỏ qua, nên đi được quân cho cả hai bên.

**B. Server không kiểm tra luật.** `src/roomStore.ts:277-349` chấp nhận mọi nước đi, ví dụ e2 → a8.

**D. Phòng chơi lưu trong RAM.** Phòng nằm trong `Map` của từng isolate. `wrangler.jsonc` chưa khai báo Durable Object. Hậu quả:
- Mỗi lần deploy là mất hết phòng.
- Hai người ở hai vùng edge khác nhau sẽ thấy hai phòng khác nhau.

### Cao

**C. Phòng chơi dễ bị chiếm hoặc phá.**
- Tạo phòng bằng một mã đã có sẽ ghi đè phòng cũ.
- `reset` và đổi skin không cần token.
- Người thứ ba vào phòng đầy vẫn được gán quân đen.
- Danh sách nước đi không giới hạn độ dài.
- Mã phòng chỉ có 4 ký tự. Token sinh bằng `Math.random`.

**E. Chuỗi phát lại nước đi của đối thủ gây lệch bàn cờ.** `src/wizardChessEngine.js:8982-9003`.
- Các `setTimeout` giữ một bản room cũ và không có cách nào huỷ.
- Khi reset hoặc rời phòng, nước cũ vẫn có thể được áp lên bàn cờ mới.
- Nước không khớp bị bỏ qua lặng lẽ, nên hai bên bị lệch nhau.

### Trung bình

Các lỗi về độ mượt và độ ổn định của engine:
- Vòng lặp tween không có try/catch. Chỉ cần một tween ném lỗi là game đứng hình và mất input vĩnh viễn.
- Sự kiện resize của `visualViewport` không có debounce, gây giật trên mobile khi thanh URL ẩn/hiện.
- Code gọi `querySelectorAll` ở mỗi frame khi giữ phím camera, và cấp phát Vector3 mỗi frame.
- Khi tải asset Cờ Tướng lỗi, game tải lại liên tục.

### Thấp

- Bấm Undo khi đang chọn quân phong cấp chỉ đóng hộp thoại, không lùi nước.
- Mã hash thế cờ chứa ô en passant ngay cả khi không bắt được, nên có thể bỏ sót hoà do lặp lại 3 lần.
- AI không phát hiện chiếu hết ở các nút lá của quiescence.
- Cờ Tướng chưa có luật cấm chiếu dai.

### Những phần đã làm tốt (không cần sửa)

- Shadow map được giới hạn khoảng 24 Hz.
- Raycast chỉ chạy khi click.
- Có huỷ tìm kiếm AI theo `aiJobId`.
- Có khoá input trong lúc animation chạy.
- Geometry và skeleton được dùng chung qua pool và được dispose đúng cách.
- `dt` bị giới hạn khi tab quay lại.
- DPR tự điều chỉnh theo thời gian frame.

## Brainstorm contract

**Outcome**
- Chơi online đúng và an toàn: chỉ chủ ghế mới đi được, chỉ nước hợp lệ mới được nhận, phòng tồn tại qua các lần deploy và giữa các vùng edge.
- Engine không thể bị đứng hình vì một lỗi animation.
- Có test trình duyệt thật bảo vệ các luồng chơi chính.

**Constraints**
- Giữ nguyên API `/api/rooms/*` mà client đang dùng.
- Không đổi luật chơi và AI, vì perft đã đúng.
- Cloudflare Workers, gói Free, dùng Durable Object loại SQLite.
- Kiểm tra trên `workers.dev` trước, rồi mới lên `chess.tqd.io.vn`.

**Non-goals**
- Code-split bundle, lazy-load GLB, chuyển base64 sang `.glb` nhị phân.
- Tối ưu hiệu năng trên thiết bị thật.
- Luật chiếu dai của Cờ Tướng.
- Đổi thiết kế hoặc UX.

**Acceptance criteria**
1. Test Playwright chạy được: đi quân, AI đáp, undo, reset, đổi Cờ Vua ↔ Cờ Tướng, đổi skin. Không có lỗi console. Không frame nào quá 50 ms trên desktop.
2. Request đi quân với token rỗng hoặc sai bị trả 401/403. Nước đi phạm luật bị trả 400. Tạo phòng bằng mã đã tồn tại không ghi đè được phòng cũ.
3. Hai trình duyệt ở hai context khác nhau chơi hết một ván online trên `workers.dev`. Phòng vẫn còn sau khi redeploy.
4. Reset hoặc rời phòng giữa lúc đang phát lại nước của đối thủ không áp nước cũ lên bàn mới. Khi phát hiện lệch, client đồng bộ lại toàn bộ danh sách nước đi.
5. Khi một tween ném lỗi, game vẫn render và vẫn nhận input.
6. `tsc`, `build`, `node --test` đều xanh. Coverage của roomStore quay lại ≥ 80%.

## Trade-offs

| Phương án | Giả định chính | Hỏng đầu tiên khi |
|---|---|---|
| 1. Chỉ sửa nóng (A, E, F) | Online ít người dùng, chấp nhận phòng không bền | Có 2 người ở 2 vùng edge khác nhau, hoặc mỗi lần deploy. Lỗi D vẫn còn. |
| **2. Sửa nóng + Durable Object + kiểm tra luật phía server** (khuyến nghị) | Online là tính năng đã phát hành và cần giữ | Lần deploy migration Durable Object đầu tiên (đổi topology). Giảm rủi ro bằng cách thử trên `workers.dev` trước. |
| 3. Phương án 2 + tối ưu tải/bundle + đo trên thiết bị thật | Có thời gian cho một đợt hiệu năng riêng | Phạm vi phình to, khó review. Nên tách ra làm sau. |

**Better approaches**
- E nên làm lại theo kiểu đối chiếu idempotent thay vì vá từng timer: mỗi lần nhận room thì lấy `moves.slice(appliedMoveSeq)`, áp lần lượt dưới một session token có thể huỷ, và khi lệch thì đồng bộ lại.
- Không dùng KV, vì KV chỉ nhất quán dần và không đảm bảo thứ tự.

## Thứ tự thực hiện (theo kongming)

1. Dựng bộ test Playwright trước khi động vào engine.
2. Đợt 1 (PR riêng): sửa A, C, E, F, kèm test.
3. Đợt 2: Durable Object cho mỗi phòng, kiểm tra luật phía server bằng `chessAI.ts`/`xiangqiAI.ts`, kiểm thử trên `workers.dev` trước khi lên domain.
4. Đợt sau (tách riêng): bundle/GLB, đo trên thiết bị thật.

## Chưa đo, không được coi là đã ổn

- Độ trễ từ lúc click đến lúc quân nhấc lên, và thời lượng animation.
- Giật lần đầu do biên dịch shader khi đổi skin. Có thể làm ấm trước bằng `renderer.compileAsync`.
- Thời gian tải trên Android tầm trung. 37 MB base64 nặng hơn khoảng 33% so với file nhị phân.
- Vùng chạm của quân nhỏ trên màn hình cảm ứng, màn 120 Hz.
- `AudioContext` có resume sau thao tác đầu tiên của người dùng không.

## Câu hỏi còn mở

- Chơi online đã có người dùng thật chưa? Nếu mới là thử nghiệm thì có thể hạ D xuống đợt 3.
- Có chấp nhận đổi cấu hình deploy (thêm `migrations` cho Durable Object) không?
