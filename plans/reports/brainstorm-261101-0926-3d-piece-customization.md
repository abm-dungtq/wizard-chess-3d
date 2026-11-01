# Bản Hợp Đồng Tư Vấn Kiến Trúc (Brainstorm Contract): Thiết Kế Lại & Tùy Biến Giao Diện Quân Cờ 3D (`wizard-chess-3d`)

> **Lưu ý vận hành (`--ultra`):** Lượt chạy này thực hiện theo cơ chế **same-tier best-of-5** (5 mẫu độc lập chạy song song cùng tầng mô hình + chấm điểm/lựa chọn theo rubric bởi Verifier `kongming`), không phải kiểm định bất đối xứng khác tầng.

> [!IMPORTANT]
> **Thách thức giả định cốt lõi (CTO Challenge — Interrogate the First Idea):**
> Khi đặt câu hỏi *"sửa lại giao diện các quân cờ 3D"*, đa số lập trình viên mặc định rằng phải mở phần mềm 3D (Blender/Maya), dựng lại mesh mới, rig lại bộ xương (`Skeleton`) và xuất lại 6 file `.glb.gz.b64`.
> **Giả định này sai ở 2 điểm kỹ thuật quan trọng trong codebase hiện tại:**
> 1. **90% diện mạo thị giác hiện tại đang bị khóa cứng (hardcode) ở tầng Runtime JS chứ không nằm ở file `.glb`**: Trong [`instantiatePiece`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1760-L1874), engine **ghi đè toàn bộ vật liệu gốc của GLB** bằng 4 instance `THREE.MeshStandardMaterial` dùng chung ([`whitePieceMat`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L914-L918), [`blackPieceMat`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L920-L926), [`goldTrimMat`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L928-L932), [`forgedSteelMat`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L934-L940)) dựa trên từ khóa tên material (`Gold`/`Trim`/`Bronze`/`Glow` vs `Steel` vs phần thân chính tại [`wizardChessEngine.js:1804-1817`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1804-L1817)). Nếu bạn chỉ sửa màu/texture trong Blender mà không sửa logic gán material ở [`wizardChessEngine.js`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1804-L1817), vào game quân cờ vẫn bị ghi đè về màu đá trắng/đen cũ!
> 2. **Ràng buộc kiểm thử tự động cực gắt trên file `pawn_white.glb.gz.b64`**: Bộ test [`test/applet.test.mjs`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L639-L670) kiểm tra trực tiếp file `pawn_white.glb.gz.b64` phải có **đúng 2 sub-mesh vàng trước khi gộp** (`assert.equal(goldSubMeshes.length, 2)`) và **đúng 3 SkinnedMesh sau khi gộp** (`assert.equal(clonedMeshCount, 3)`). Nếu xuất đè file GLB từ Blender/AI mà làm thay đổi số lượng material primitive của `pawn_white`, CI/test sẽ gãy ngay lập tức.

---

## 1. Phân Loại 3 Cấp Độ Thực Thi "Sửa Giao Diện Quân Cờ 3D"

Tùy thuộc vào mục tiêu thẩm mỹ và ngân sách thời gian, việc tùy biến quân cờ 3D trong [`wizard-chess-3d`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js) chia thành **3 cấp độ độc lập**:

### Cấp độ 1 (Level 1 — Nhanh nhất): In-Game Skin / Material & Shader Theme Studio (Không đụng file 3D)
- **Bản chất:** Giữ nguyên hình khối điêu khắc chiến binh Hogwarts (`SkinnedMesh` + 12–20 xương + 4 animation `Idle`, `Move`, `Attack`, `Shatter`), nhưng mở rộng hệ thống PBR Material & GLSL Shader (`onBeforeCompile`) tại [`wizardChessEngine.js:914-940`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L914-L940) — tương tự cách [`applyCathedralStoneRealismShader`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1128-L1200) và [`stoneMicroGrainTex`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1080-L1122) đang làm cho kiến trúc đại sảnh.
- **Các chủ đề (Skins/Themes) có thể đổi tức thì (< 0.1ms, 0 re-clone):**
  1. **Đá Cẩm Thạch & Hắc Diện Cổ Điển (Hogwarts Classic Stone):** Bộ màu gốc hiện tại.
  2. **Ngọc Bích Hoàng Gia (Imperial Jade & Blood Ruby):** Thân ngọc bích bán trong suốt giả lập subsurface scattering qua Fresnel/Cavity shader (`roughness: 0.16`, `metalness: 0.08`, viền vàng cổ).
  3. **Vàng Hoàng Gia & Bạch Kim (Royal Gold & Platinum):** Quân Trắng mạ bạch kim sáng, quân Đen vàng đen/đồng đen bóng gương.
  4. **Pha Lê Pháp Thuật (Arcane Crystal / Patronus Glow):** Rim-lighting phát sáng xanh phép thuật (`emissive` theo góc nhìn Fresnel `dot(N, V)`), mạch năng lượng chạy dọc thân tượng.
  5. **Đá Hắc Diện Dung Nham (Obsidian Lava & Frostforged Ice):** Khe nứt đá phát sáng cam dung nham (dựa trên `stoneCavityAO` từ [`wizardChessEngine.js:1164-1180`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1164-L1180)) đối đầu băng vĩnh cửu.
  6. **Đồng Cổ Phong Hóa (Ancient Verdigris Bronze):** Lớp patina xanh đồng cổ trong hốc lõm (`stoneCavityAO`) + lưỡi vũ khí rực lửa khi chém.
- **Tùy biến phụ trợ:** Thay đổi màu mảnh vỡ trong [`spawnStoneShatter`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L2428-L2460), ánh sáng chớp đòn đánh [`impactFlashLight`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L907-L909), và tỉ lệ kích thước (`PIECE_SCALE_FACTOR` tại [`wizardChessEngine.js:1835`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1835)).

### Cấp độ 2 (Level 2 — Trung bình): Procedural / Parametric 3D Sculpted Sets & Kitbashing Phụ Kiện 3D
- **Bản chất:** Can thiệp vào cấu trúc `THREE.Group` / `THREE.Mesh` trong [`instantiatePiece`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1760-L1874) theo 2 hướng kết hợp:
  1. **Kitbashing / Gắn phụ kiện 3D (Socket Attachments):** Gắn thêm hào quang pháp thuật (Arcane Halo rings), vương miện phát sáng, khiên năng lượng, bệ đá rune dưới chân (`root.add(...)`), hoặc gắn vũ khí/hiệu ứng hạt trực tiếp vào xương (`bone.add(attachment)` trên các bone `Weapon`/`Head`/`Hand` của `sharedPieceSkeleton` tại [`wizardChessEngine.js:1792-1802`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1792-L1802)).
  2. **Chuyển đổi Bộ Quân Cờ 3D (Multi-Set Switcher):** Tận dụng việc [`instantiatePiece`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1825-L1831) và [`executeChessMove`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L2465-L2850) hỗ trợ hoàn toàn các `THREE.Group`/`THREE.Mesh` không cần xương (non-skinned), cho phép dựng các bộ quân cờ bằng `THREE.LatheGeometry` / `ExtrudeGeometry` / CSG ngay trong code (ví dụ: **Bộ Cờ Staunton Hoàng Gia tiện tròn**, **Bộ Cờ Tháp Phù Thủy Tối Giản / Bauhaus Arcane**, hoặc **Bộ Tượng Chiến Binh Hogwarts**), chuyển qua lại trực tiếp trên HUD.

### Cấp độ 3 (Level 3 — Chuyên sâu): Pipeline Blender / AI 3D (`.glb.gz.b64`) Toàn Diện
- **Bản chất:** Giải mã 6 file `public/assets/glb/<type>_white.glb.gz.b64` ra `.glb` nhị phân, đưa vào **Blender** (hoặc dùng **Meshy / Tripo3D / Hyper3D Rodin** tạo mesh mới rồi gắn vào Armature sẵn có trong Blender), chỉnh sửa hình dáng giáp trụ, vũ khí, biểu cảm tượng, giữ nguyên hoặc re-target 4 clip animation (`Attack`, `Idle`, `Move`, `Shatter` ở tốc độ 24 fps đồng bộ với [`ATTACK_SYNC_PROFILES`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1879-L1886)), và đóng gói ngược lại thành `.glb.gz.b64` (hoặc thêm bộ file `public/assets/glb/<theme>_<type>.glb.gz.b64` mới để không chạm vào 6 file gốc).

---

## 2. Brainstorm Contract (Các Trường Bắt Buộc)

### Outcome (Kết quả đầu ra mục tiêu)
Cung cấp kiến trúc và quy trình kỹ thuật rõ ràng, an toàn tuyệt đối với bộ test hiện hữu để người dùng có thể **thay đổi diện mạo chất liệu/shader (Level 1)**, **gắn phụ kiện/đổi kiểu dáng hình học 3D (Level 2)**, hoặc **thay thế/chỉnh sửa mô hình 3D có xương trong Blender/AI (Level 3)** mà vẫn duy trì tốc độ khởi động nhanh, 60 FPS ổn định, và 100% tương thích với cơ chế chiến đấu & vỡ vụn của [`wizardChessEngine.js`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js).

### Constraints (Ràng buộc kỹ thuật & Kiểm thử bất biến)
1. **Ràng buộc HUD DOM IDs ([`test/applet.test.mjs:27-67`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L27-L67)):**
   - Phải giữ nguyên 14 ID bắt buộc trong [`src/App.tsx`](file:///Volumes/2/wizard-chess-3d/src/App.tsx#L131-L360) (`btn-side-toggle`, `btn-ai-difficulty`, `btn-ai-move`, `btn-undo`, `btn-reset`, `btn-audio-toggle`, `btn-cam-player`, `btn-cam-top`, `btn-cam-side`, `btn-cam-wide`, `btn-hide-ui`, `controls-hint`, `captured-tray`, `promotion-overlay`).
   - Tuyệt đối không đưa lại 12 ID bị cấm (`cam-speed-wrap`, `input-cam-speed`, `rot-speed-wrap`, `input-rot-speed`, `script-bar`, `btn-script-modal`, `btn-script-prev`, `btn-script-next`, `btn-lobby`, `lobby-modal`, `room-pill`, `btn-checkmate-stepback`).
2. **Ràng buộc tài nguyên `.glb.gz.b64` & Cấu trúc Mesh ([`test/applet.test.mjs:69-96`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L69-L96), [`639-670`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L639-L670), [`725-765`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L725-L765)):**
   - Cả 7 file trong `public/assets/glb/*.glb.gz.b64` phải tồn tại, có kích thước `> 1000` ký tự Base64, giải nén gzip ra đúng header `glTF` version `2` và khớp `totalLen`.
   - Riêng `public/assets/glb/pawn_white.glb.gz.b64` được kiểm tra cứng tại [`test/applet.test.mjs:655-669`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L655-L669): phải chứa **đúng 2 sub-mesh có tên material chứa `Gold`/`Trim`/`Glow`** trước khi gộp, và **tổng cộng đúng 3 `SkinnedMesh` sau khi gộp**.
3. **Ràng buộc Raycasting Hitbox O(1) ([`test/applet.test.mjs:590-638`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L590-L638) & [`wizardChessEngine.js:942-955`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L942-L955)):**
   - Mọi mesh hiển thị của quân cờ phải gán `child.raycast = () => {}` ([`wizardChessEngine.js:1779`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1779)). Việc chọn quân cờ bằng chuột/cảm ứng phải đi qua `PieceHitboxProxy` (`CylinderGeometry` ẩn) với thời gian raycast trung bình `< 2.0ms` (thực tế `< 0.1ms`).
4. **Ràng buộc Chống Giật Lag Khởi Động & Culling ([`test/applet.test.mjs:672-765`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L672-L765)):**
   - Mọi `SkinnedMesh` phải được tính trước `boundingBox` và `boundingSphere` tĩnh ([`wizardChessEngine.js:1601-1621`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1601-L1621), [`1780-1791`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1780-L1791)) để `Frustum.intersectsObject` không bao giờ gọi `SkinnedMesh.prototype.applyBoneTransform` trên CPU (`boneTransformCalls === 0`).
   - Phải biên dịch sẵn shader qua `await renderer.compileAsync(scene, camera)` và không bao giờ tạo/hủy đèn `PointLight` hay biên dịch lại shader giữa đòn đánh.
5. **Ràng buộc TypeScript Static Check ([`test/applet.test.mjs:325-370`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L325-L370)):**
   - 0 lỗi `TS2304` / `TS2552` (biến chưa khai báo) trong [`src/wizardChessEngine.js`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js).

### Non-goals (Những việc không làm)
- Không thay đổi luật cờ vua FIDE, thuật toán AI (`src/chessAI.ts`), hoặc logic phòng chơi (`src/roomStore.ts`).
- Không bật raycast trực tiếp lên `SkinnedMesh` của quân cờ (sẽ làm treo trình duyệt do 1.15M–1.73M đỉnh).
- Không xóa hoặc làm hỏng cấu trúc 7 file `.glb.gz.b64` gốc đang được bộ test kiểm tra.
- Không thêm lại các thanh trượt tốc độ camera hay thanh script notation đã bị cấm trong [`test/applet.test.mjs:50-66`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L50-L66).

### Acceptance Criteria (Tiêu chí nghiệm thu)
1. **Đổi giao diện tức thì (Live Visual Update):** Người chơi hoặc nhà phát triển có thể chuyển đổi giữa ít nhất **5–6 bộ Skin/Chất liệu (Level 1)** và/hoặc **Bộ kiểu dáng/Phụ kiện (Level 2)** ngay trong lúc ván cờ đang diễn ra mà không làm mất trạng thái bàn cờ (`boardState`) và không gây giật khung hình (`< 1ms` khi đổi skin).
2. **Đồng bộ hiệu ứng chiến đấu:** Khi quân cờ tấn công và đập vỡ đối phương, mảnh vỡ trong [`spawnStoneShatter`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L2428-L2460) và ánh sáng va chạm [`impactFlashLight`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L907-L909) tự động phản ánh đúng chất liệu/chủ đề đang chọn (ví dụ: mảnh vỡ ngọc bích, pha lê phát sáng, hoặc đá dung nham).
3. **Công cụ CLI đóng/mở gói 3D hai chiều (cho Level 3):** Có script tiện ích (ví dụ `scripts/glb-codec.mjs`) giải nén `.glb.gz.b64` sang `.glb` để sửa trong Blender và nén ngược `.glb` sang `.glb.gz.b64` kèm kiểm tra tự động cấu trúc sub-mesh và animation.
4. **Vượt qua 100% bộ kiểm thử:** Chạy `npm test` (`node --test test/applet.test.mjs`) đạt 100% pass (0 lỗi HUD ID, 0 lỗi GLB header/sub-mesh consolidation, 0 lỗi `TS2304`/`TS2552`, 0 lần gọi `applyBoneTransform` khi frustum culling).

---

## 3. Phân Tích Đánh Đổi Định Lượng & Giả Định Chịu Tải (Trade-offs & Load-Bearing Assumptions)

### Bảng So Sánh Định Lượng 3 Phương Án

| Tiêu chí | Level 1: Material & GLSL Shader Studio | Level 2: Procedural Sets & Kitbashing 3D | Level 3: Blender / AI 3D `.glb.gz.b64` Pipeline |
| :--- | :--- | :--- | :--- |
| **Độ phức tạp triển khai** | **Thấp** (~80–150 dòng JS/GLSL trong `wizardChessEngine.js` + 1 nút HUD) | **Trung bình** (~250–400 dòng JS tạo geometry/attachments + quản lý lifecycle) | **Cao** (Đòi hỏi kỹ năng Blender rigging, weight painting, NLA animation export) |
| **Chi phí tài nguyên (Bundle / RAM)** | **+0 KB tải mạng** (dùng lại `stoneMicroGrainTex` & uniform PBR) | **+5 KB – 15 KB mã nguồn** (sinh hình học bằng code, 0 file ngoài) | **+2.5 MB – 4.5 MB mỗi bộ 6 quân cờ mới** nếu nạp thêm `.glb.gz.b64` |
| **Độ trễ Runtime (Latency)** | **< 0.05 ms** khi đổi skin (chỉ cập nhật uniform / material properties tại chỗ) | **~2 ms – 8 ms** khi khởi tạo lại 32 quân cờ trên bàn | **~150 ms – 450 ms** tải mạng, giải mã Base64, gunzip & parse `GLTFLoader` |
| **Khả năng bảo trì (Maintainability)** | **Rất cao** (100% nằm trong code, dễ chỉnh thông số, 0 rủi ro gãy test GLB) | **Cao** (Code-driven, kiểm soát bằng Git diff rõ ràng) | **Thấp – Trung bình** (File nhị phân `.glb.gz.b64` khó review diff, dễ lệch xương/tên material) |
| **Biên độ thay đổi thị giác** | Đổi toàn bộ chất liệu, màu sắc, độ trong suốt, phát sáng, vân đá/kim loại, tỉ lệ | Thêm vương miện/hào quang/khiên 3D hoặc đổi hẳn sang bộ cờ cổ điển Staunton | Thay đổi hoàn toàn hình khối nhân vật 3D (Rồng, Yêu tinh, Kỵ sĩ giáp mới) |

---

### Phân Tích Chuyên Sâu Từng Phương Án (Giả định chịu tải, Điểm gãy đầu tiên & Hệ quả bậc 2)

#### Phương án 1 (Level 1): In-Game Skin / Material & Shader Theme Studio
- **Giả định chịu tải lớn nhất (Load-bearing assumption):** Giả định rằng người dùng hài lòng với **khung hình học (silhouette) tượng chiến binh Hogwarts hiện tại** và sự "lột xác" về giao diện đến từ chất liệu bề mặt (Ngọc bích, Pha lê phép thuật, Đá dung nham, Vàng hoàng gia, Đồng cổ), ánh sáng viền (Fresnel rim glow), và hiệu ứng vỡ vụn.
- **Điều kiện gãy đầu tiên & Kịch bản tệ nhất (Fails first / Worst plausible case):**
  - *Điểm gãy đầu tiên:* Khi người dùng muốn thay đổi **hình dáng cơ học của quân cờ** (ví dụ: biến quân Mã từ kỵ sĩ cưỡi ngựa thành con rồng có cánh, hoặc đổi sang quân cờ tiện tròn truyền thống). Level 1 không thể biến đổi topology đỉnh (ngoài vertex displacement nhẹ).
  - *Kịch bản tệ nhất về hiệu năng:* Nếu mỗi lần người dùng bấm đổi Skin, code tạo mới `new THREE.ShaderMaterial()` hoặc thay đổi hàm `mat.onBeforeCompile` mà không dùng chung shader program (`customProgramCacheKey`), Three.js sẽ buộc GPU biên dịch lại (re-compile) shader cho 32 `SkinnedMesh` có bóng đổ, gây **đứng hình (shader compilation stall) 300ms–800ms** ngay giữa ván đấu. *Cách phòng tránh:* Giữ nguyên 4 instance material gốc (`whitePieceMat`, `blackPieceMat`, `goldTrimMat`, `forgedSteelMat`) và chỉ cập nhật `color`, `roughness`, `metalness`, `emissive`, cùng các `uniforms` đã gắn sẵn khi khởi tạo!
- **Hệ quả bậc 2 (Second-order effects):**
  - Mảnh vỡ trong [`spawnStoneShatter`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L2428-L2460) đang dùng trực tiếp `whitePieceMat` và `blackPieceMat` (`const mat = color === 'w' ? whitePieceMat : blackPieceMat;`). Do đó, khi cập nhật in-place các material này ở Level 1, **hiệu ứng nổ mảnh vỡ khi ăn quân sẽ tự động đổi sang chất liệu mới (mảnh ngọc, mảnh pha lê, mảnh dung nham) hoàn toàn miễn phí** mà không cần viết thêm hệ thống hạt mới!

#### Phương án 2 (Level 2): Procedural / Parametric 3D Sculpted Sets & Kitbashing Phụ Kiện 3D
- **Giả định chịu tải lớn nhất (Load-bearing assumption):**
  - *Với Kitbashing phụ kiện:* Giả định rằng các xương (`THREE.Bone`) trong `tpl.scene` có tên và hệ trục tọa độ cục bộ (local transform) nhất quán giữa 6 loại quân cờ, hoặc phụ kiện gắn vào gốc `piece.mesh` (`root`) không bị xuyên thủng (clipping) qua thân tượng khi quân cờ vung kiếm chém trong clip `Attack`.
  - *Với Bộ cờ Procedural (Staunton / Arcane Obelisk):* Giả định rằng chuyển động lướt, nhảy vòm của Mã (`applyConcreteTrajectory` tại [`wizardChessEngine.js:2661-2734`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L2661-L2734)), lao tới đâm (`maxLunge`), và nổ tung thành 18 mảnh đá (`spawnStoneShatter`) là đủ sống động mà không cần cử động tay chân bằng xương.
- **Điều kiện gãy đầu tiên & Kịch bản tệ nhất (Fails first / Worst plausible case):**
  - *Điểm gãy đầu tiên:* Khi gắn phụ kiện cứng (như áo choàng tĩnh hoặc khiên lớn) vào `root` thay vì vào đúng `Bone` ngực/tay: khi quân cờ chạy animation `Attack` (cúi người vung vũ khí ở giây `0.35s–0.60s`), thân tượng nghiêng đi nhưng phụ kiện đứng yên trên `root`, gây **xuyên mẫu hình học (mesh clipping) trông rất giả**.
  - *Kịch bản tệ nhất:* Nếu tạo mới `BufferGeometry` cho từng quân cờ trong cả 32 ô thay vì dùng chung (cache geometry theo `type`) hoặc quên gán `child.raycast = () => {}` trên các mesh phụ kiện, raycaster sẽ quét qua hàng chục nghìn tam giác phụ kiện khiến Test 11 ([`test/applet.test.mjs:627`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L627)) vượt ngưỡng `2.0ms` và rò rỉ bộ nhớ GPU (VRAM leak) sau nhiều lần `Reset` bàn cờ.
- **Hệ quả bậc 2 (Second-order effects):**
  - Khi đổi sang bộ cờ có chiều cao khác với tượng gốc, hệ thống tính đường nhảy của quân Mã qua đầu quân cản (`PIECE_HEIGHTS` tại [`wizardChessEngine.js:2605`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L2605)) và chiều cao vùng bấm chuột (`PIECE_HITBOX_HEIGHTS` tại [`wizardChessEngine.js:945-952`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L945-L952)) cần được giữ đồng bộ để quân Mã không nhảy xuyên đầu quân mới và chuột vẫn bấm chính xác.

#### Phương án 3 (Level 3): Pipeline Blender / AI 3D (`.glb.gz.b64`) Toàn Diện
- **Giả định chịu tải lớn nhất (Load-bearing assumption):** Giả định rằng file `.glb` xuất ra từ Blender hoặc công cụ AI 3D tuân thủ **chính xác hợp đồng cấu trúc ẩn (implicit asset contract)** của [`wizardChessEngine.js`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js):
  1. Tên vật liệu phải chứa từ khóa `Gold`/`Trim`/`Bronze`/`Glow` (cho viền vàng) và `Steel` (cho vũ khí) để [`instantiatePiece`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1804-L1817) nhận diện được (hoặc phải thêm cờ để giữ texture gốc của GLB).
  2. Tên 4 animation clip phải chứa từ khóa `Idle`, `Move`, `Attack`, `Shatter` (không phân biệt hoa thường, khớp với [`playPieceClip`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1888-L1895)).
  3. Thời điểm va chạm vũ khí trong clip `Attack` phải khớp với [`ATTACK_SYNC_PROFILES`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1879-L1886) (`contactClip: 0.56s–0.60s`, `blowClip: 0.75s–0.78s`).
- **Điều kiện gãy đầu tiên & Kịch bản tệ nhất (Fails first / Worst plausible case):**
  - *Điểm gãy đầu tiên (Gãy CI/Test ngay lập tức):* Khi xuất đè `pawn_white.glb.gz.b64` từ Blender, nếu Blender gộp sẵn material hoặc tách khác số lượng primitive khiến `goldSubMeshes.length !== 2` hoặc `clonedMeshCount !== 3`, bài test tại [`test/applet.test.mjs:655-669`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L655-L669) sẽ **FAIL ngay lập tức**.
  - *Kịch bản tệ nhất ở Runtime:* Mô hình AI 3D mới có số đỉnh quá nặng hoặc xuất từ Blender với hệ trục/scale lệch (`Armature` có `scale !== 1.0` hoặc tâm `origin` nằm ở giữa bụng thay vì dưới đáy bệ). Hậu quả: quân cờ chìm nửa người dưới mặt bàn (`BOARD_SURFACE_Y`), hoặc `boundingSphere` tĩnh bị tính sai tỉ lệ khiến quân cờ **biến mất đột ngột (popping out) khi xoay camera** do Frustum Culling loại nhầm.
- **Hệ quả bậc 2 (Second-order effects):**
  - Các công cụ AI 3D (Meshy, Tripo, Rodin) thường tạo ra 1 texture atlas màu (BaseColor Map) duy nhất thay vì tách 4 material slot (`Marble`, `Gold`, `Steel`, `Glow`). Nếu dùng mô hình có texture atlas, bạn bắt buộc phải bổ sung chế độ `preserveOriginalMaterials` trong [`instantiatePiece`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1804-L1817) (như cách nhân đôi và dịch sắc độ màu cho quân Đen), nếu không [`instantiatePiece`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1814) sẽ xóa sạch texture của bạn và tô đè màu trắng/đen trơn!

---

## 4. Better Approaches (Phương Án Lai Tối Ưu Hóa)

**Better approaches: Kiến Trúc Lai 2 Tầng "Live Piece Appearance Studio + Non-Destructive Custom GLB Loader" (Kết hợp Level 1 + Level 2 ngay lập tức, kèm cổng mở an toàn cho Level 3)**

- **Bằng chứng cụ thể trong codebase (Concrete Evidence):**
  1. Engine đã có sẵn kiến trúc đổi giao diện trực tiếp cho Đại Sảnh (`setWallStoneLook` / `setFloorStoneLook` + `stoneMicroGrainTex` + `onBeforeCompile` tại [`wizardChessEngine.js:1080-1280`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1080-L1280)), nhưng các quân cờ tại [`wizardChessEngine.js:914-940`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L914-L940) mới chỉ dùng 4 `MeshStandardMaterial` tĩnh chưa có bộ chuyển đổi (Preset Switcher).
  2. Hàm [`loadGltfModel(baseName)`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1288-L1326) đã hỗ trợ sẵn cơ chế **tự động fallback sang file `.glb` thường** (`./assets/glb/${baseName}.glb` tại dòng [`1317-1321`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1317-L1321)) nếu không tìm thấy bản `.glb.gz.b64`! Điều này có nghĩa là khi thiết kế mô hình 3D mới (Level 3), ta có thể nạp theo namespace riêng (ví dụ `custom_pawn.glb`) mà **không bao giờ phải chạm vào hay ghi đè 6 file `*_white.glb.gz.b64` gốc**, giữ an toàn tuyệt đối 100% cho [`test/applet.test.mjs`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L69-L96).
- **Khác biệt vận hành (Operational Delta):**
  - Thay vì bắt người dùng phải cài Blender và giải mã `.glb.gz.b64` mới thấy được sự thay đổi, **Tầng 1 (In-Game Skin & Geometry Style Switcher)** cho phép bấm nút trên HUD (hoặc phím tắt `[V]`) để đổi ngay giữa **6 Chất liệu Pháp thuật (Level 1)** và **3 Kiểu dáng Hình học / Phụ kiện (Level 2: Tượng Chiến Binh Hogwarts, Tượng Chiến Binh Hào Quang Cổ Ngữ, Bộ Cờ Staunton Hoàng Gia)**.
  - Đồng thời, **Tầng 2 (Non-Destructive GLB Codec & Texture-Preserving Loader)** cung cấp script `scripts/glb-codec.mjs` và chế độ giữ nguyên Texture gốc (`preserveGltfTextures`) trong [`instantiatePiece`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1804-L1817) cho bất kỳ mô hình Blender/AI nào người dùng bỏ thêm vào thư mục `public/assets/glb/`.
- **Chi phí chuyển đổi (Cost of Switching):**
  - Chỉ tốn ~150–220 dòng code mở rộng sạch sẽ trong [`src/wizardChessEngine.js`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js) và 1 nút bấm tùy chọn trong [`src/App.tsx`](file:///Volumes/2/wizard-chess-3d/src/App.tsx) (vẫn bảo toàn toàn bộ 14 ID bắt buộc và tránh 12 ID bị cấm).

---

## 5. Lộ Trình Triển Khai Khuyến Nghị (Recommended Direction & Actionable Workflow)

### Bước 1: Triển khai ngay Level 1 — Bộ Chuyển Đổi 6 Chủ Đề Chất Liệu & Shader (`PIECE_MATERIAL_THEMES`)
Tại [`src/wizardChessEngine.js:914-940`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L914-L940), giữ nguyên 4 đối tượng material (`whitePieceMat`, `blackPieceMat`, `goldTrimMat`, `forgedSteelMat`) nhưng gắn thêm `onBeforeCompile` dùng chung `stoneMicroGrainTex` (tương tự [`applyCathedralStoneRealismShader`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1128-L1200)) với uniform `uRimStrength`, `uRimColor`, `uVeinStrength` và định nghĩa danh sách chủ đề:
1. **`classic_marble`** *(Cẩm Thạch Trắng & Đá Hắc Diện Hogwarts)* — Mặc định hiện tại.
2. **`imperial_jade`** *(Ngọc Bích Hoàng Gia & Huyết Ngọc)* — Quân Trắng xanh ngọc bích bóng mượt (`0x2e8b68`, rim glow lục bảo), quân Đen đỏ huyết ngọc (`0x4a0e17`, viền vàng hồng).
3. **`arcane_crystal`** *(Pha Lê Pháp Thuật Patronus & Hắc Ám)* — Phát sáng Fresnel xanh băng (`0x7ce8ff`) và tím hắc ám (`0x9d4edd`) dọc theo các cạnh tượng và khe giáp.
4. **`obsidian_lava`** *(Băng Vĩnh Cửu & Dung Nham Núi Lửa)* — Khe nứt (`1.0 - stoneCavityAO`) của quân cờ phát sáng rực lửa cam (`0xff5500`) hoặc băng lam, đồng bộ với lửa từ hai chậu than đại sảnh.
5. **`royal_gold_silver`** *(Bạch Kim Hoàng Gia & Vàng Đen Cổ Điển)* — Toàn thân kim loại quý phản chiếu ánh lửa (`metalness: 0.85, roughness: 0.18`).
6. **`ancient_bronze`** *(Đồng Cổ Phong Hóa & Sắt Rèn)* — Hiệu ứng đồng xanh patina cổ kính trong các rãnh chạm khắc.

> [!TIP]
> Vì cả 32 quân cờ trên bàn và hàm [`spawnStoneShatter`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L2428-L2460) đều trỏ chung vào 4 biến material này, hàm `cyclePieceTheme()` chỉ cần đổi thuộc tính `.color`, `.roughness`, `.metalness`, `.emissive` và uniform trên 4 material đó là **toàn bộ 32 quân cờ trên bàn đổi giao diện ngay lập tức trong `< 0.05ms`** mà không cần tạo lại mesh hay biên dịch lại shader!

### Bước 2: Mở rộng Level 2 — Gắn Phụ Kiện 3D Pháp Thuật (Arcane Pedestal Runes & Crown Halos) hoặc Bộ Cờ Cổ Điển
Trong [`instantiatePiece`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1760-L1874):
- Thêm vòng cổ ngữ phát sáng dưới chân đế (`RingGeometry` đặt sát mặt đế) hoặc vương miện/hào quang cho Vua & Hậu, nhớ gán `attachment.raycast = () => {}` để bảo vệ hiệu năng raycast của `PieceHitboxProxy`.
- Hoặc thêm tùy chọn đổi giữa **Tượng Chiến Binh Hogwarts (`SkinnedMesh`)** và **Bộ Cờ Hoàng Gia Staunton (`LatheGeometry` tiện tròn mượt mà)** bằng cách hoán đổi hàm tạo `root` trong [`instantiatePiece`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1766-L1831).

### Bước 3: Quy trình Level 3 (Khi muốn chỉnh sửa Mesh 3D trong Blender hoặc AI 3D)
Nếu bạn muốn tự điêu khắc lại hình khối trong Blender, hãy dùng quy trình **3 bước không phá hủy (non-destructive)** sau:
1. **Giải nén file `.glb.gz.b64` sang `.glb` để mở trong Blender:**
   ```bash
   node -e '
     const fs = require("fs"), zlib = require("zlib");
     for (const p of ["pawn","rook","knight","bishop","queen","king"]) {
       const b64 = fs.readFileSync(`public/assets/glb/${p}_white.glb.gz.b64`, "utf8").trim();
       fs.writeFileSync(`/tmp/${p}_white.glb`, zlib.gunzipSync(Buffer.from(b64, "base64")));
     }
   '
   ```
2. **Chỉnh sửa trong Blender (`File -> Import -> glTF 2.0`):**
   - Giữ nguyên `Armature` (12–20 xương) và 4 NLA Track / Action: `Attack`, `Idle`, `Move`, `Shatter`.
   - Nếu sửa mesh `pawn_white`, bảo đảm giữ đúng 4 material slot gốc (`pawn_WhiteMarble`, `HogwartsTrim_AntiqueGold`, `HogwartsSteel_Silver`, `HogwartsGlow_Gold`) để vượt qua kiểm tra gộp sub-mesh tại [`test/applet.test.mjs:655-669`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L655-L669).
   - Nếu muốn dùng texture màu riêng từ Blender/AI 3D mà không bị code ghi đè, đặt tên material có hậu tố `_CustomTex` và thêm nhánh giữ nguyên `child.material` trong [`instantiatePiece`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1804-L1817).
3. **Đóng gói ngược lại `.glb.gz.b64` và chạy kiểm thử:**
   ```bash
   node -e '
     const fs = require("fs"), zlib = require("zlib");
     const glb = fs.readFileSync("/tmp/pawn_white.glb");
     fs.writeFileSync("public/assets/glb/pawn_white.glb.gz.b64", zlib.gzipSync(glb, { level: 9 }).toString("base64"));
   ' && npm test
   ```

---

## Phụ Lục Xếp Hạng Ultra Verifier (`kongming` — `9b3c88a2-d2fe-4659-ae23-129d728cc774`)

| Ứng viên ẩn danh (Subagent gốc) | 1. Bám sát yêu cầu (/20) | 2. Bằng chứng Code & Test (/20) | 3. Tiêu chí nghiệm thu (/20) | 4. Phân tích điểm gãy (/20) | 5. Trường điều kiện & Khả thi (/20) | **Tổng điểm (/100)** |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Candidate B** (`Candidate 5` — **Winner**) | **20** | **20** | **20** | **20** | **20** | **100 / 100** |
| **Candidate A** (`Candidate 3`) | 19 | 18 | 19 | 19 | 19 | **94 / 100** |
| **Candidate D** (`Candidate 4`) | 19 | 18 | 18 | 19 | 19 | **93 / 100** |
| **Candidate E** (`Candidate 2`) | 19 | 18 | 18 | 18 | 19 | **92 / 100** |
| **Candidate C** (`Candidate 1`) | 18 | 17 | 18 | 17 | 18 | **88 / 100** |

- **Lý do Candidate B (`Candidate 5`) chiến thắng tuyệt đối (`100/100`):** Là ứng viên duy nhất phát hiện chính xác bài kiểm thử cứng trên cấu trúc sub-mesh của `pawn_white.glb.gz.b64` tại [`test/applet.test.mjs:639-670`](file:///Volumes/2/wizard-chess-3d/test/applet.test.mjs#L639-L670) (`goldSubMeshes.length === 2` và `clonedMeshCount === 3`), đồng thời chỉ rõ nguyên nhân mô hình AI 3D (Meshy/Tripo/Rodin) bị mất texture atlas tại [`src/wizardChessEngine.js:1814`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1814) và cách dùng cơ chế fallback `.glb` không phá hủy tại [`src/wizardChessEngine.js:1317-1321`](file:///Volumes/2/wizard-chess-3d/src/wizardChessEngine.js#L1317-L1321).

ultra: picked=5/5 margin=high unanimous=yes rejected_all=no
