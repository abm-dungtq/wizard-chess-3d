# Brainstorm: thiết kế lại quân cờ bằng công cụ 3D có AI hỗ trợ

Ngày 2026-11-10. Chạy với `--advice`: kongming (model `fable`) đã duyệt một checkpoint, kết luận "go" kèm hai điều chỉnh đã được đưa vào bên dưới. Lần gọi đầu thất bại vì định nghĩa agent trỏ tới model `@advisor` không tồn tại.

## Hiện trạng đã kiểm chứng

- Runtime là three.js 0.170 trong `src/wizardChessEngine.js`. Không có Godot ở đâu trong repo.
- Mỗi loại quân có một file `public/assets/glb/**/{type}_white.glb.gz` (130–270 kB). Quân đen dùng chung mesh, chỉ khác vật liệu.
- Mỗi quân là một SkinnedMesh với bốn primitive đặt tên theo vật liệu (Marble, Trim_AntiqueGold, Steel_Silver, Glow_Gold) và không có texture. Engine gán vật liệu dùng chung theo tên tại `src/wizardChessEngine.js:2033-2055`, nên theme và màu phe đổi được tức thì.
- Quân đã có xương: Tốt 11 khớp, Mã 18 khớp, với bốn clip Idle, Move, Attack, Shatter. `test/applet.test.mjs` kiểm tra tên clip và số sub-mesh của Tốt.
- Pipeline cũ nằm ở `.tools/sculpt_*_via_mcp.py` trong checkout chính (4,2 nghìn dòng bmesh ghép khối từ Poly Haven), đóng gói bằng `scripts/glb-pipeline.mjs pack`.
- Ảnh trong game (`plans/261103-1655-premium-visual-slice-1/visuals/asset-idle.png`) cho thấy quân cờ đọc ra như các khối xếp chồng có vòng vàng. Ở camera mặc định khó phân biệt Tượng với Hậu.
- Blender MCP có `generate_3d` (ảnh hoặc chữ sang mesh có texture, qua tripo, hunyuan3d, hyper3d hoặc meshy, tốn credit). Blender hiện chưa mở. Không tìm thấy client G-Labs trên máy.

## Hợp đồng

**Outcome.** Bộ quân mặc định (sáu loại) được thay bằng tượng nhân vật điêu khắc có hình bóng nhận ra ngay ở camera mặc định, vẫn đổi màu theo phe và theo tám theme, vẫn chạy đủ bốn clip.

**Constraints.**
- Giữ runtime three.js, định dạng `.glb.gz`, tên bốn slot vật liệu, tên clip và bộ xương hiện có.
- Không nới lỏng assertion nào trong `test/applet.test.mjs`.
- Mỗi quân không vượt số đỉnh hiện tại và khoảng 400 kB kể cả texture.
- Mỗi lần `generate_3d` tốn credit, nên chỉ gọi sau khi concept đã qua kiểm tra hình bóng.

**Non-goals.** Bảy bộ theme trong `sets/` và bộ cờ tướng chưa làm ở đợt này. Không chuyển sang Godot. Không viết lại hệ animation.

**Acceptance criteria (cho pilot Mã + Tốt).**
1. Cả sáu quân qua kiểm tra hình bóng 2D: tô đen concept, thu về đúng chiều cao pixel trong game, vẫn gọi đúng tên từng quân.
2. So cạnh nhau cùng camera, người dùng chọn Mã và Tốt mới cho cả hai phe, ở ít nhất hai theme.
3. Bốn clip chạy không rách, không kéo giãn mesh.
4. `npm test` xanh.
5. Ngân sách đỉnh và dung lượng đạt, thời gian khung hình với 16 Tốt không tệ hơn.
6. Ghi lại số credit và số giờ cho mỗi quân để ước lượng cho sáu quân và tám bộ.

## Trade-offs

| Hướng | Giả định chịu lực | Hỏng đầu tiên khi |
|---|---|---|
| A. Ảnh sang 3D thuần, giữ texture màu nướng sẵn | Mesh AI dùng được ngay | Màu nướng sẵn phá cơ chế đổi phe và theme; sáu mesh sinh riêng lệch phong cách |
| B. Tiếp tục bmesh bằng code, chỉ đổi art direction | Code ghép khối đạt được hình điêu khắc | Đã thử: kết quả hiện tại chính là trần của hướng này |
| C. Lai: concept sheet, ảnh sang 3D cho phần tượng, hoàn thiện trong Blender (khuyến nghị) | Hình bóng đọc được ở cỡ trong game | Chi tiết bề mặt AI thành nhiễu ở camera mặc định nếu concept không phóng đại tỉ lệ |

Hướng C rẻ nhất để bỏ giữa chừng: cổng kiểm tra hình bóng 2D diễn ra trước khi tốn credit, và pilot chỉ gồm hai quân.

## Hướng C chi tiết

1. **Concept.** Một style sheet duy nhất cho cả sáu quân, mặt trước và góc 3/4, chất liệu đất sét trung tính, tay và vũ khí tách khỏi thân. Giữ dấu hiệu Staunton (thánh giá, vương miện, vết xẻ mũ giám mục, lỗ châu mai, đầu ngựa) và phóng đại chiều cao cùng tỉ lệ đầu. Nguồn ảnh nào cũng được; G-Labs không phải điều kiện bắt buộc.
2. **Sinh mesh.** Một provider duy nhất, hai đến ba ứng viên mỗi quân, chọn một.
3. **Blender.** Dọn mesh, giảm đỉnh về ngân sách, nướng normal và AO từ bản high-poly cho slot thân. Gán mặt vào đúng bốn slot vật liệu hiện có thay vì vẽ mask, nên engine và test không phải đổi. Đặt tượng lên một bệ dùng chung.
4. **Rig.** Giữ bộ xương và clip, chỉ bind vào Root, Base, Pelvis, Torso, Head. Mesh AI dính liền tay, vũ khí và thân nên bind chi sẽ rách ở clip Attack. Kết quả là tượng sống nghiêng, lao và gật cả thân.
5. **Engine.** Thay đổi nhỏ: mỗi loại quân có một bản clone vật liệu thân mang `normalMap` và `aoMap`; trim, glow và steel vẫn dùng chung.

## Better approaches

So với đề xuất ban đầu (ảnh ChatGPT rồi dựng nhân vật 3D), hai điểm tốt hơn đã có bằng chứng:

- Tô màu lúc chạy thay cho texture màu nướng sẵn. Bằng chứng: engine gán vật liệu theo tên slot và tám theme dựa vào đó. Chi phí chuyển: không có, vì đây là cách hiện tại.
- Kiểm tra hình bóng 2D trước khi dựng 3D. Bằng chứng: lỗi nhìn thấy trong ảnh hiện tại là lỗi hình bóng chứ không phải thiếu chi tiết. Chi phí: một bước xem ảnh.

## Rủi ro chưa giải quyết

- Chưa kiểm tra clip Shatter di chuyển xương thế nào. Nếu mesh bị kéo giãn khi chỉ bind cột sống, thay riêng clip đó bằng hiệu ứng vỡ mảnh.
- Định nghĩa agent `kongming` trỏ tới model `@advisor` không tồn tại; cần sửa để các checkpoint `--advice` sau không phải chỉ định model bằng tay.

## Câu hỏi còn mở

1. Animation kiểu tượng sống (không vung tay riêng) có chấp nhận được không? Nếu cần chi cử động, mỗi quân phải retopo thủ công.
2. G-Labs truy cập bằng cách nào, hay dùng nguồn ảnh khác?
3. Ngân sách credit `generate_3d` cho pilot, và provider nào đang bật trong Blender?
4. Phong cách: giữ hướng pháp sư Hogwarts hay đổi chủ đề cho bộ mặc định?
