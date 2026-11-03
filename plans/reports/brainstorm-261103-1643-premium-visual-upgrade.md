# Brainstorm: nâng cấp giao diện, nhân vật, đòn kết liễu và bước di chuyển

Ngày 2026-11-03. Chế độ `--advice`, đã qua thẩm định của kongming.

## Kết luận

Giữ nền web (Three.js WebGL) và nâng cấp theo 3 đợt:

1. **Nền tảng và giao diện:** tải asset nhẹ hơn, hậu kỳ hình ảnh, giao diện kiểu Liquid Glass, góc camera mới.
2. **Đòn kết liễu khi chiếu hết:** an toàn với chế độ online.
3. **Một bộ skin "hero" vẽ lại cao cấp**, kèm bước di chuyển riêng cho từng loại quân, áp dụng cho mọi skin.

Mac nhận chất lượng cao nhất qua một "bậc chất lượng" tự nhận diện máy. Game vẫn chạy trên Windows và điện thoại.

WebGPU (chạy trên Metal) để sau, làm một bản thử có giới hạn thời gian. Bản đóng gói thành app macOS gốc chỉ làm khi có lý do phát hành, như App Store hoặc Game Center.

## Hiện trạng (đã kiểm chứng)

- **Renderer:** `src/wizardChessEngine.js` (11.135 dòng) dùng `WebGLRenderer` với ACES tone mapping, bóng PCF mềm và môi trường PMREM tự dựng. Chưa có hậu kỳ (bloom, AO, DOF). Có 4 chỗ dùng shader GLSL tùy biến.
- **Quân cờ:** có 8 bộ skin cờ vua (bộ mặc định cùng abyssal_lich, bauhaus_imperial, dong_son, mecha_ronin, pharaoh_anubis, shogun_yokai, valhalla_valkyrie) và 1 bộ cờ tướng.
  - Mỗi bộ nặng khoảng 2,9–3,3 MB.
  - Mỗi quân khoảng 24 nghìn tam giác, một mesh có xương, **không có texture**, 4 hoạt ảnh: Idle, Move, Attack, Shatter.
- **Asset:** cảnh cathedral nặng 8,8 MB. Asset được lưu dạng `.glb.gz.b64`; base64 làm file nặng thêm khoảng 33%.
- **Hoạt ảnh có sẵn:**
  - `LOCOMOTION_GAIT_PROFILES`: dáng đi của từng loại quân.
  - `ATTACK_SYNC_PROFILES`: đòn tấn công đặc trưng có tên riêng cho từng quân.
  - Chuỗi chiếu hết `stagger → topple → impact → fallen`.
- **Thiếu:** chưa hỗ trợ `prefers-reduced-motion`.
- **Giao diện:** camera mặc định nhìn từ trên xuống nên quân nhỏ. Nhãn tên quân (Xe, Mã, Tượng…) chồng lên nhau, thanh HUD trên và dưới dày đặc.
- **Online:** máy khách chờ `isAnimatingMove` rồi mới áp dụng nước của đối thủ. Hoạt ảnh dài làm chậm việc hiện nước đi của đối thủ, nhưng không gây lệch bàn cờ.

## Công nghệ macOS áp dụng được và không áp dụng được

| Công nghệ | Dùng từ web được không | Cách áp dụng |
|---|---|---|
| Metal qua WebGPU | Có. Chrome trên Mac đã hỗ trợ; Safari 26 chỉ có trên macOS Tahoe | Để sau. Three r170 vẫn ghi WebGPURenderer là thử nghiệm và không hỗ trợ `ShaderMaterial`, `onBeforeCompile`, `EffectComposer`, nên chuyển sang là viết lại renderer |
| Ngôn ngữ thiết kế Liquid Glass (macOS 26) | Có, bằng CSS | Kính mờ nhiều lớp, viền phản quang, hiệu ứng khúc xạ (khúc xạ SVG chỉ chạy trên Chromium; Safari dùng bản mờ thường) |
| Màu Display P3 | Có | Dùng `color(display-p3 …)` cho màu vàng kim để màn hình Mac hiện dải màu rộng hơn |
| Âm thanh không gian | Có. Web Audio `PannerNode` với chế độ HRTF | Tiếng va chạm và vỡ quân phát ra từ đúng ô cờ. Tính năng theo dõi chuyển động đầu của AirPods không truy cập được từ web |
| ProMotion 120 Hz | Một phần. Chrome chạy 120 Hz; Safari vẫn giới hạn 60 Hz | Thiết kế cho 60 Hz, mọi chuyển động tính theo thời gian thực |
| Haptics, Game Center, MetalFX, thanh menu | Không | Chỉ dùng được qua app gốc (WKWebView hoặc Tauri) |
| Viết lại bằng RealityKit hoặc SceneKit | Không nên | Phải duy trì codebase thứ hai và mất đồng bộ với bản web và online |

## Hợp đồng brainstorm

- **Kết quả mong muốn:**
  - Người chơi thấy game "cao cấp" ngay ở góc nhìn mặc định.
  - Chiếu hết có màn kết liễu điện ảnh.
  - Mỗi loại quân di chuyển có dấu ấn riêng.
  - Ít nhất một bộ skin được vẽ lại có texture PBR.
  - Mac nhận chất lượng cao nhất.
- **Ràng buộc:**
  - Không làm hỏng chơi online.
  - Windows và điện thoại vẫn chạy được.
  - Có ngân sách khung hình và ngân sách dung lượng tải.
  - Mọi hoạt ảnh dài đều bỏ qua được.
- **Không làm trong đợt này:**
  - Chuyển sang WebGPU.
  - App macOS gốc.
  - Vẽ lại cả 8 bộ skin trước khi bộ hero chứng minh được quy trình.
  - Mô phỏng vải thật.
- **Tiêu chí nghiệm thu:**
  - **Máy tính bậc `ultra`:** 95% khung hình ≤ 12 ms khi đang chạy đòn kết liễu, không khung nào > 33 ms.
  - **Điện thoại bậc `base`:** 95% khung hình ≤ 16,6 ms.
  - **Dung lượng:** lần chơi đầu tải ≤ 10 MB; mỗi skin thêm ≤ 3,5 MB; skin hero có texture ≤ 4 MB.
  - **Đòn kết liễu:** dài tối đa 4 giây, bỏ qua bằng một lần bấm. Đối thủ online vẫn thấy nước đi trong vòng 300 ms kể cả khi màn kết liễu đang chạy.
  - **Giao diện:** không có nhãn chồng nhau ở góc nhìn mặc định trên MacBook Air 13" (1470×956 px CSS); HUD chiếm ≤ 12% chiều cao màn hình.
  - **Duyệt bằng mắt:** người dùng xem ảnh trước và sau, xác nhận skin hero đạt mức "cao cấp" trước khi làm các skin khác.

## Ba hướng đã so sánh

| Hướng | Giả định chịu lực nhất | Hỏng đầu tiên khi |
|---|---|---|
| **A. Web, tinh chỉnh cho Mac (đề xuất)** | Hậu kỳ WebGL và texture PBR đủ để trông "cao cấp" | Ngân sách khung hình trên máy yếu. Xử lý bằng bậc chất lượng |
| B. Chuyển sang WebGPU trước | WebGPURenderer đủ ổn định cho mesh có xương, bóng đổ và PMREM | Phải viết lại renderer cho engine 11 nghìn dòng; Safari chỉ có trên Tahoe; mọi cải tiến nhìn thấy được bị chậm nhiều tuần |
| C. App macOS gốc | Có nhu cầu phát hành qua App Store hoặc Game Center | Là quyết định phát hành, không cải thiện chất lượng hình ảnh. Bản RealityKit đầy đủ thì quá lớn |

**Có hướng tốt hơn không:** không có hướng nào tốt hơn cách làm A, nhưng nên làm A theo thứ tự "một skin hero trước", vì làm lại cả khoảng 100 model là rủi ro tiến độ lớn nhất. Nếu thiếu thời gian, mức sàn là "cao cấp bằng thủ tục": chỉ thêm hậu kỳ, chất liệu (clearcoat, emissive, sheen) và bước di chuyển trên model cũ. Cách này đạt khoảng 60–70% hiệu quả hình ảnh với khoảng 20% chi phí vẽ.

## Ý tưởng cụ thể

### Giao diện (đợt 1)

- **Camera:** đổi mặc định sang góc 3/4 "khán giả", có nút một chạm để về góc nhìn từ trên. Quân trông lớn hơn 2–3 lần.
- **HUD:** gộp thanh HUD trên và dưới thành một thanh "dock" kính nổi kiểu Liquid Glass, dùng màu vàng P3.
- **Nhãn tên quân:** chỉ hiện khi rê chuột vào hoặc khi chọn quân, có nút bật chú giải.
- **Hậu kỳ:**
  - Bloom cho chất liệu phát sáng.
  - Ambient occlusion (GTAO) ở nửa độ phân giải.
  - DOF chỉ khi máy quay cận cảnh kết liễu (kill-cam).
- **Cài đặt "Hoạt cảnh":** đầy đủ / nhanh / tắt, và tôn trọng `prefers-reduced-motion`.
- **Tải asset:** chuyển sang `.glb` thô có nén meshopt và KTX2, để Cloudflare tự nén khi truyền. Giảm cathedral 8,8 MB trước tiên.
- **Âm thanh:** sửa lỗi khựng ở nước đi đầu tiên do khởi tạo AudioContext, và thêm kênh âm thanh không gian HRTF.

### Đòn kết liễu (đợt 2)

Một `FinisherDirector` bọc quanh chuỗi chiếu hết có sẵn. Ở pha `stagger`, nó lần lượt:
- giành quyền điều khiển camera và bay vào cận cảnh;
- chạy chậm (slow-motion);
- chạy hoạt ảnh tấn công của quân ra đòn;
- phun hạt theo bảng màu của skin;
- tăng bloom đột ngột;
- phát tiếng va chạm có định vị không gian.

Đòn kết liễu riêng cho từng skin:

| Skin | Đòn kết liễu chiếu hết |
|---|---|
| Mặc định (Đại Thánh Đường) | Cột ánh sáng thánh đường giáng xuống, vua hóa đá rồi vỡ thành kính màu |
| abyssal_lich | Rút linh hồn: vua bị kéo hồn thành khói xanh lam, thân xác rã thành tro |
| mecha_ronin | Lưỡi kiếm plasma chém ngang, màn hình khựng lại, vua tách làm đôi kèm tia lửa |
| pharaoh_anubis | Bão cát nuốt vua, cân linh hồn nghiêng hẳn, vua chìm xuống cát |
| valhalla_valkyrie | Sét Odin giáng xuống, quạ bay quanh, vua quỳ xuống |
| shogun_yokai | Đường chém iaido trong một khung hình, cánh hoa anh đào rơi, vua đổ chậm |
| dong_son | Tiếng trống đồng rung, vòng sóng hoa văn mặt trời lan ra, vua đổ theo nhịp trống |
| bauhaus_imperial | Vua bị "tháo rời" thành khối hình học cơ bản rồi xếp gọn xuống bàn |
| Cờ tướng | Pháo hoa rồng hoặc kiếm khí, tướng ngã trong cung |

Đòn ăn quân nhỏ: chỉ thêm một cú cắt cảnh cận 0,4 giây khi ăn xe hoặc hậu. Các trường hợp khác giữ đòn đặc trưng có sẵn.

**Quy tắc an toàn online:** đòn kết liễu chạy sau khi nước đi đã được ghi vào bàn cờ. Nó dùng cờ riêng `cinematicActive`, chỉ khóa thao tác và camera, **không bao giờ** giữ `isAnimatingMove`. Dài tối đa 4 giây; bấm, chạm hoặc Esc là bỏ qua.

### Bước di chuyển sáng tạo (đợt 3, áp dụng cho mọi skin)

Đây là các lớp chuyển động thủ tục đặt trên `LOCOMOTION_GAIT_PROFILES` cộng hiệu ứng vệt và hạt, không cần làm khoảng 100 hoạt ảnh mới.

**Cờ vua:**

| Quân | Bước di chuyển |
|---|---|
| Tốt | Bước hành quân nhanh, gót chân dậm tạo bụi nhỏ |
| Mã | Nhảy vòng cung, xoay giữa không trung, tiếp đất có vòng bụi |
| Tượng | Lướt chéo, để lại bóng mờ (afterimage) |
| Xe | Bước nặng, rung camera nhẹ, nứt sàn mờ dần |
| Hậu | Bay lơ lửng, để lại dải lụa ánh sáng |
| Vua | Bước chậm uy nghi, áo choàng lắc lư (chuỗi 3 xương, không mô phỏng vải) |

**Cờ tướng:**

| Quân | Bước di chuyển |
|---|---|
| Tốt / Binh | Bước tiến đều theo đội hình |
| Mã | Bước "chân mã" qua điểm gãy góc, tiếng vó ngựa |
| Tượng | Dậm hai nhịp nặng, sóng nước ở sông |
| Sĩ | Bước chéo trong cung, tà áo bay |
| Pháo | Nảy bật qua quân làm ngòi, khói súng |
| Xe | Lao thẳng có vệt bánh xe |
| Tướng | Bước trong cung, cờ hiệu phấp phới |

### Vẽ lại nhân vật (đợt 3)

- **Skin hero:** chọn **một** bộ trước, đề xuất `mecha_ronin` hoặc `abyssal_lich` vì kim loại và chất phát sáng ăn hiệu ứng bloom nhất.
- **Cách làm:** vẽ lại trong Blender bằng quy trình và MCP có sẵn.
  - Thêm texture PBR 2k: albedo, normal, ORM, nén KTX2.
  - Thêm mặt nạ phát sáng (emissive) cho bloom.
  - Giữ 15–25 nghìn tam giác mỗi quân.
- **Không dùng AI để tạo quân có xương:** công cụ tạo 3D bằng AI chỉ cho ra mesh không có xương, cấu trúc lưới và tỷ lệ không đồng nhất. Chỉ dùng AI để phác ý tưởng hoặc làm đạo cụ tĩnh.
- **Các skin còn lại:** chỉ quyết định làm sau khi bộ hero đạt các chỉ số nghiệm thu và người dùng duyệt bằng mắt.

## Rủi ro

- **Khối lượng vẽ:** khoảng 100 model là rủi ro tiến độ lớn nhất. Giảm bằng cách làm skin hero trước.
- **Dung lượng tải:** sẽ tăng vì có texture. Giảm bằng meshopt, KTX2 và bỏ lớp base64.
- **Khung hình trên máy yếu:** giảm bằng bậc chất lượng và lần đo FPS 2 giây khi khởi động.
- **Đồng bộ online:** chỉ hỏng nếu đòn kết liễu giữ `isAnimatingMove`. Quy tắc ở trên chặn điều này.

## Bàn giao

Hướng được chọn là A, chia 3 đợt. Bước tiếp theo là lập plan chi tiết cho đợt 1 bằng `/ak:plan --advice`, giữ nguyên các tiêu chí nghiệm thu ở trên.

## Câu hỏi chưa giải quyết

1. Ưu tiên Mac nhưng vẫn giữ điện thoại và Windows, hay chấp nhận bỏ điện thoại?
2. Skin hero chọn `mecha_ronin`, `abyssal_lich`, hay bộ mặc định?
3. Có cần đóng gói thành app macOS (App Store, Game Center) không, hay chỉ cần bản web?
