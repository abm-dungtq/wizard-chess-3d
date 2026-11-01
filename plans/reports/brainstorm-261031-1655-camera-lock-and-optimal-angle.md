# Brainstorm Report — Optimal Fixed Camera Angle & Camera Lock / Free 3D Toggle

- **Date:** 2026-10-31
- **Supervisor (`--advice`):** `kongming` (`9b3c88a2-d2fe-4659-ae23-129d728cc774`) — **APPROVED (Approach A)**

---

## 1. Root-Cause Diagnosis ("Tại sao người dùng thấy cam xoay quá loạn?")

Qua kiểm tra trực tiếp mã nguồn [`src/wizardChessEngine.js`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js), có **4 nguyên nhân cơ học** khiến góc nhìn bị xoay loạn ngoài ý muốn:

1. **Chuột trái / Chạm 1 ngón luôn xoay `OrbitControls` (`lines 173–181, 4325`):**
   - `OrbitControls` luôn bật trên chuột trái (`LEFT: ROTATE`) và cảm ứng 1 ngón (`ONE: ROTATE`). Chỉ cần người chơi bấm chọn quân cờ hoặc có thói quen kéo-thả quân cờ lệch tay `> 2px`, cả căn phòng 3D lập tức xoay vòng quanh bàn cờ (đồng thời `moveDist > 6` tại dòng `4326` hủy luôn thao tác chọn ô cờ!).
   - Giới hạn góc dọc hiện tại `maxPolarAngle = Math.PI * 0.88` (`158°`) cho phép kéo camera chui xuống dưới mặt sàn bàn cờ (`y = 0.34`), còn `maxDistance = 36.0` làm lăn chuột văng xa tới sát tường nhà thờ.
2. **Bấm nút `Player Cam` để cứu góc nhìn lại bị lật ngược 180° sang sân đối phương (`lines 4807–4815`):**
   - Khi người dùng lỡ kéo chuột làm lệch góc nhìn, class `.active` trên `#btn-cam-player` **không hề bị xóa** (chỉ khi bấm phím `WASD` ở dòng `5651` mới xóa `.active`).
   - Do hàm `setCameraPreset('player')` kiểm tra `wasPlayerActive` và đảo `playerCamSide = playerCamSide === 'w' ? 'b' : 'w'`, khi người chơi bấm vào `Player Cam` với ý định "đưa cam về lại chỗ ngồi của mình", camera lại **quay ngoắt 180° sang phía quân địch**!
3. **Camera tự động lao xuống cận cảnh mỗi khi ăn quân (`evalQuadraticBezier` tại `lines 2785–2824, 3009–3147`):**
   - Mỗi nước bắt quân (`isCapture`), camera tự động khóa điều khiển và bay theo đường cong Bezier xuống sát mặt bàn (`y = BOARD_SURFACE_Y + 0.74`) từ góc ngang (`chosenPerp` có thể đảo `+90°` hoặc `-90°` tùy quân đứng cạnh), rung lắc rồi mất `~1.3s–1.6s` mới bay về. Khi đôi công đổi 3–4 quân liên tiếp, camera đảo trái-phải liên tục gây chóng mặt.
4. **Chế độ 2 Người Cùng Máy tự động xoay 180° sau mỗi nước đi (`lines 2721–2733, 2963–2966`):**
   - Biến `autoFlipCamera2P` mặc định bật khiến mỗi nước đi lại quay 180° dọc bàn cờ.

---

## 2. Brainstorm Contract

- **Outcome:**
  - Mặc định vào game ở chế độ **Khóa Cam Cố Định (`🔒 Khóa Cam` / `isCameraLocked = true`)** với **Góc Cam Chiến Thuật 3/4 Trên Cao tối ưu** (`pos: [0, 3.18, ±2.82]`, `target: [0, 0.78, ∓0.06]`, góc nhìn xuống `~49°`): nhìn rõ toàn bộ 64 ô và quân cờ 3D mà không bị quân Vua/Hậu che khuất hàng sau, kéo chuột trái hay chạm màn hình **tuyệt đối không làm xoay bàn cờ**.
  - Khi ở chế độ `🔒 Khóa Cam`, các pha ăn quân vẫn diễn ra hoạt ảnh đập vỡ tượng đá 3D ngay trên bàn cờ nhưng **giữ nguyên góc nhìn cố định**, không tự ý lao camera xuống xoay ngang dọc.
  - Có nút chuyển đổi trực quan **`🔒 Khóa Cam`** $\leftrightarrow$ **`🎥 Cam 3D Tự Do`** (`#btn-cam-lock`) ngay trên thanh camera dưới cùng (`#hud-bottom`) để người chơi thích khám phá không gian 3D vẫn có thể bật xoay tự do (đã giới hạn góc chống chui xuống sàn).
- **Constraints:**
  - Giữ nguyên toàn bộ **14 Required IDs** và không vi phạm **12 Forbidden IDs** trong [`src/App.tsx`](file:///Volumes/2/wizard-chess-3d/src/App.tsx) theo [`test/applet.test.mjs`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs).
  - Giữ tương thích 100% với các kiểm thử raycast và chuỗi interpolation trong `test/applet.test.mjs`.
- **Non-goals:**
  - Không thay đổi luật cờ FIDE, AI Minimax hay giao thức phòng đấu `/api/rooms/*`.
- **Acceptance Criteria:**
  1. Mặc định `isCameraLocked = true` (`orbitControls.enabled = false`): kéo chuột trái hoặc vuốt trên bàn cờ không làm lệch góc camera; độ nhạy click chọn quân tăng từ `6px` lên `22px` để thao tác chọn/đi quân mượt mà.
  2. Góc cam cố định mặc định (`[0, 3.18, ±2.82]` nhìn vào `[0, 0.78, ∓0.06]`) hiển thị rõ toàn bộ 64 ô cờ, 32 quân cờ 3D và hiệu ứng đập vỡ tượng đá khi bắt quân mà không giật/xoay camera.
  3. Nút `#btn-cam-lock` chuyển đổi tức thì giữa `🔒 Khóa Cam` (cố định hoàn toàn, chỉ đổi góc khi bấm 4 nút góc chuẩn `Góc Người Chơi`, `Nhìn Từ Trên`, `Góc Ngang`, `Toàn Cảnh`) và `🎥 Cam 3D Tự Do` (cho phép xoay chuột/WASD nhưng khóa trần/sàn `maxPolarAngle = 0.46π`, `maxDistance = 12.0` và bật lại camera cận cảnh khi ăn quân).
  4. Sửa lỗi nút `Player Cam` (`#btn-cam-player`): nếu camera đang bị lệch khỏi vị trí ghế ngồi của người chơi (`distance > 0.25m`), bấm `Player Cam` luôn đưa camera về đúng ghế của phe mình (`playerColor`) trước, thay vì lật nhầm sang sân đối phương.

---

## 3. Option Exploration & Trade-offs

| Phương án | Cơ chế hoạt động | Giả định phụ thuộc lớn nhất (Load-bearing assumption) | Điều kiện thất bại đầu tiên (Fails first when...) |
| :--- | :--- | :--- | :--- |
| **Phương án A (Khuyên dùng — Approved by Advisor): Góc Chiến Thuật 3/4 Cố Định + Nút `[🔒 Khóa Cam / 🎥 Cam 3D Tự Do]`** | Mặc định **Khóa Cam (`isCameraLocked = true`)** ở góc 3/4 cao (`[0, 3.18, ±2.82]`, pitch `~49°`). Tắt xoay chuột trái ngẫu nhiên và tắt pha lao cam cận cảnh khi ăn quân ở chế độ khóa. Người chơi vẫn đổi được 4 góc cố định (`Player`, `Overhead`, `Side`, `Wide`) hoặc bấm nút `🎥 Cam 3D Tự Do` nếu muốn tự xoay 3D. | Người chơi cờ ưu tiên sự ổn định tuyệt đối của bàn cờ khi suy nghĩ và bấm chọn quân, chỉ xoay 3D khi chủ động bật. | Người dùng muốn vừa khóa góc khi bấm quân vừa xoay bằng chuột phải (có thể hỗ trợ thêm chuột phải trong chế độ 3D). |
| **Phương án B: Chỉ xoay bằng Chuột Phải + Giữ nguyên Cam Cận Cảnh khi ăn quân** | Đổi `OrbitControls` sang chuột phải (`LEFT: null, RIGHT: ROTATE`), nhưng vẫn giữ hiệu ứng camera tự động lao xuống xoay ngang mỗi khi ăn quân. | Chỉ có thao tác kéo chuột trái mới gây chóng mặt, còn cam tự động bay khi ăn quân không gây rối. | Thất bại ngay trên điện thoại/iPad (không có chuột phải) và vẫn gây chóng mặt khi 2 bên đổi quân liên tiếp ở trung tâm bàn cờ. |
| **Phương án C: Khóa cứng góc nhìn thẳng đứng 90° (2D Top-Down thuần túy)** | Đưa camera lên đỉnh đầu (`[0, 6.85, 0]`, nhìn thẳng 90° xuống bàn cờ) làm góc mặc định. | Người chơi chỉ cần nhìn đỉnh đầu quân cờ như bàn cờ 2D phẳng. | Làm mất hoàn toàn chiều sâu 3D của các bức tượng đá (nhìn từ đỉnh đầu rất khó phân biệt Vua, Hậu và Tượng cùng màu). |

- **Better approaches:** `none — recommended direction is the requested one (Approach A combines the optimal 49° 3/4 fixed tactical angle with an explicit Lock / Free 3D camera toggle, verified against src/wizardChessEngine.js and test/applet.test.mjs)`.
