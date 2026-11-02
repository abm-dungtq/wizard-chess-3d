import { useEffect, useRef, useState } from 'react';
import { initWizardChess } from './wizardChessEngine.js';

export default function App() {
  const initializedRef = useRef(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    initWizardChess();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileSheetOpen(false);
      }
    };
    const handleResize = () => {
      if (window.innerWidth > 768 && window.innerHeight > 520) {
        setMobileSheetOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleRestoreUI = () => {
    const win = window as unknown as { wizardChess?: { toggleUI?: (force?: boolean) => void } };
    if (win.wizardChess?.toggleUI) {
      win.wizardChess.toggleUI(false);
    } else {
      document.body.classList.remove('cinematic-ui-hidden');
      const btnHide = document.getElementById('btn-hide-ui');
      if (btnHide) btnHide.textContent = 'Hide UI [H]';
    }
  };

  return (
    <>
      <div id="loading-overlay">
        <div className="loader-title">Wizard Chess</div>
        <div className="loader-bar-wrap">
          <div className="loader-bar" id="loader-bar"></div>
        </div>
        <div id="loader-text">Summoning Sanctum Architecture &amp; Sculpted Pieces...</div>
      </div>

      <div id="canvas-container"></div>

      <div
        id="piece-overhead-layer"
        className="piece-overhead-layer"
        aria-hidden="true"
      ></div>

      <div
        id="piece-inspect-card"
        className="piece-inspect-card"
        role="status"
        aria-live="polite"
      ></div>

      <div
        id="trainer-logo-watermark"
        className="trainer-logo-watermark"
        title="DũngTQ - AI Trainner"
        aria-label="DũngTQ - AI Trainner Logo"
      >
        <img src="/assets/logo-dungtq.png" alt="DũngTQ - AI Trainner" draggable={false} />
      </div>

      <button
        type="button"
        className="hud-btn mobile-only-restore-ui"
        id="btn-mobile-show-ui"
        onClick={handleRestoreUI}
        title="Show HUD Controls"
      >
        Hiện UI
      </button>

      <div id="hud-top">
        <div className="hud-group" id="hud-left">
          <div className="brand-pill">
            <span className="brand-title">Wizard Chess</span>
          </div>
          <div className="status-pill" id="status-pill">
            <span className="turn-dot" id="turn-dot"></span>
            <span id="turn-text">White to Move</span>
            <span className="mode-badge" id="mode-badge">Playing as White</span>
          </div>

          <button
            type="button"
            className="hud-btn top-primary-btn active"
            id="btn-ai-difficulty"
            title="Chọn Độ Khó AI riêng: Dễ (Novice) • Vừa (Tactical) • Khó (Grandmaster)"
          >
            🤖 Độ khó: Vừa
          </button>

          <button
            type="button"
            className="hud-btn top-primary-btn"
            id="btn-duel-room"
            title="Chế độ Chơi 2 Người riêng: Đánh 2 Người Cùng Máy (2 Players Pass & Play) hoặc Phòng Online"
            onClick={() => setMobileSheetOpen(false)}
          >
            ⚔️ Chơi 2 Người
          </button>

          <button
            type="button"
            className="hud-btn top-primary-btn skin-shop-trigger desktop-only-top-btn"
            id="btn-skin-shop"
            title="Mở Cửa Hàng Bộ Sưu Tập Quân Cờ 3D (8 Phong Cách Độc Bản &amp; Bàn Đấu Thánh Đường)"
            onClick={() => setMobileSheetOpen(false)}
          >
            👑 Skin 3D
          </button>

          <button
            type="button"
            className={`hud-btn menu-toggle-trigger ${mobileSheetOpen ? 'active' : ''}`}
            id="btn-mobile-controls"
            aria-expanded={mobileSheetOpen}
            aria-controls="hud-right"
            onClick={() => setMobileSheetOpen((prev) => !prev)}
            title="Gom gọn toàn bộ tùy chỉnh Bàn Cờ, Độ Khó, Camera và Âm Thanh"
          >
            {mobileSheetOpen ? '✕ Đóng' : '⚙️ Menu'}
          </button>
        </div>

        <div
          className={`mobile-sheet-backdrop ${mobileSheetOpen ? 'open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setMobileSheetOpen(false);
          }}
          aria-hidden="true"
        ></div>

        <div
          className={`hud-group consolidated-menu-panel ${mobileSheetOpen ? 'mobile-sheet-open' : ''}`}
          id="hud-right"
        >
          <div
            className="mobile-sheet-handle-wrap"
            onClick={(e) => {
              e.stopPropagation();
              setMobileSheetOpen(false);
            }}
            aria-hidden="true"
          >
            <div className="mobile-sheet-handle"></div>
          </div>

          <div className="mobile-sheet-header">
            <span className="mobile-sheet-title">⚙️ Bảng Điều Khiển Gọn</span>
            <button
              type="button"
              className="mobile-sheet-close"
              id="btn-mobile-sheet-close"
              onClick={(e) => {
                e.stopPropagation();
                setMobileSheetOpen(false);
              }}
              aria-label="Close Controls"
            >
              Đóng ✕
            </button>
          </div>

          <div className="mobile-sheet-section-label">
            <span>1. Độ Khó AI (Đấu Với Máy)</span>
            <span className="mobile-sheet-section-sub">Tách riêng 3 cấp độ</span>
          </div>

          <button
            type="button"
            className="hud-btn ai-diff-tier-btn"
            data-ai-diff="novice"
            title="Chế độ Đấu Máy — Độ khó: Dễ (Novice)"
          >
            🌱 Dễ
          </button>
          <button
            type="button"
            className="hud-btn ai-diff-tier-btn active"
            data-ai-diff="tactical"
            title="Chế độ Đấu Máy — Độ khó: Vừa (Tactical)"
          >
            ⚔️ Vừa
          </button>
          <button
            type="button"
            className="hud-btn ai-diff-tier-btn"
            data-ai-diff="grandmaster"
            title="Chế độ Đấu Máy — Độ khó: Khó (Grandmaster)"
          >
            👑 Khó
          </button>

          <button
            className="hud-btn"
            id="btn-side-toggle"
            title="Đổi bên cầm quân Trắng/Đen (1P) hoặc Bật/Tắt Tự Xoay Camera (2P)"
            onClick={() => setMobileSheetOpen(false)}
          >
            Đổi Quân: Đen
          </button>
          <button
            className="hud-btn"
            id="btn-ai-move"
            title="Yêu cầu Máy đi ngay nước tiếp theo"
            onClick={() => setMobileSheetOpen(false)}
          >
            🤖 Máy Đi Ngay
          </button>

          <div className="hud-divider" aria-hidden="true"></div>
          <div className="mobile-sheet-section-label">
            <span>2. Chơi 2 Người &amp; Ván Đấu</span>
            <span className="mobile-sheet-section-sub">Cùng máy hoặc Phòng Online</span>
          </div>

          <button
            type="button"
            className="hud-btn"
            id="btn-menu-2p-pass"
            title="Đánh 2 Người Trên Cùng Màn Hình (2 Players Pass & Play)"
            onClick={() => setMobileSheetOpen(false)}
          >
            ⚔️ 2 Người Cùng Máy
          </button>
          <button
            type="button"
            className="hud-btn"
            id="btn-menu-2p-online"
            title="Mở Phòng Đấu 2 Người Online (Tạo mã phòng hoặc nhập mã phòng)"
            onClick={() => setMobileSheetOpen(false)}
          >
            🌐 Phòng 2 Người Online
          </button>
          <button
            className="hud-btn"
            id="btn-undo"
            title="Đi lại nước vừa đi (Undo)"
            onClick={() => setMobileSheetOpen(false)}
          >
            ↩ Đi Lại
          </button>
          <button
            className="hud-btn"
            id="btn-reset"
            title="Bắt đầu ván cờ mới"
            onClick={() => setMobileSheetOpen(false)}
          >
            🆕 Ván Mới
          </button>

          <div className="hud-divider" aria-hidden="true"></div>
          <div className="mobile-sheet-section-label">
            <span>3. Góc Nhìn Camera &amp; Giao Diện</span>
            <span className="mobile-sheet-section-sub">Khóa cố định hoặc xoay 3D</span>
          </div>

          <button
            className="hud-btn active"
            id="btn-cam-lock"
            title="Chuyển đổi giữa Khóa Camera Cố Định (chống xoay loạn) và Camera 3D Tự Do"
          >
            🔒 Khóa Cam
          </button>
          <button
            type="button"
            className="hud-btn active"
            id="btn-piece-labels"
            title="Chuyển chế độ hiển thị Tên Quân Cờ trên đầu: Thông Minh (Vua, Hậu, Xe, Tượng, Mã) • Tất Cả (32 Quân) • Khi Chạm"
          >
            🏷️ Tên Quân: Thông Minh
          </button>
          <button
            className="hud-btn"
            id="btn-piece-skin"
            title="Đổi nhanh bộ cờ 3D (Đông Sơn, Shogun, Mecha 2099, Cửu U Lich, Valhalla, Pharaoh, Bauhaus, Cẩm Thạch)"
          >
            🎨 Skin: Cẩm Thạch
          </button>
          <button
            className="hud-btn active"
            id="btn-cam-player"
            title="Góc nhìn Người Chơi (Bấm lần nữa để lật Trắng / Đen)"
          >
            Góc 3D Chính
          </button>
          <button
            className="hud-btn"
            id="btn-cam-top"
            title="Góc nhìn Từ Trên Xuống (Bấm lần nữa để lật Trắng / Đen)"
          >
            Từ Trên Xuống
          </button>
          <button
            className="hud-btn"
            id="btn-cam-side"
            title="Góc nhìn Ngang Bàn Cờ (Đông / Tây)"
          >
            Góc Ngang
          </button>
          <button
            className="hud-btn"
            id="btn-cam-wide"
            title="Góc nhìn Toàn Cảnh Đại Thánh Đường"
          >
            Toàn Cảnh
          </button>
          <button
            className="hud-btn"
            id="btn-audio-toggle"
            title="Bật / Tắt âm thanh hiệu ứng"
          >
            🔊 Âm Thanh: Bật
          </button>
          <button
            className="hud-btn"
            id="btn-hide-ui"
            title="Ẩn thanh điều khiển (Phím tắt: H)"
            onClick={() => setMobileSheetOpen(false)}
          >
            👁 Ẩn UI [H]
          </button>

          <div className="mobile-sheet-hint">
            <strong>Mẹo:</strong> Chạm Quân &amp; Ô để đi &nbsp;•&nbsp; Kéo 1 ngón: Xoay 3D &nbsp;•&nbsp; 2 ngón: Phóng to / Thu nhỏ
          </div>
        </div>
      </div>

      <div id="hud-bottom">
        <div className="hint-pill" id="controls-hint">
          <strong>Điều khiển:</strong> Click chọn quân &amp; ô để đi &nbsp;•&nbsp; <strong>🔒 Đang Khóa Cam cố định</strong> (Mở &ldquo;⚙️ Menu&rdquo; để đổi Góc Cam / Ván Mới)
        </div>
        <div className="captured-pill" id="captured-tray"></div>
        <div className="mobile-quick-dock" id="mobile-quick-dock" aria-label="Mobile Quick Actions">
          <button
            type="button"
            className="hud-btn mobile-dock-btn active"
            id="btn-quick-cam"
            title="Chuyển nhanh giữa Góc nhìn 3D (Player Cam) và Góc nhìn Từ Trên Xuống (Overhead)"
          >
            📐 Góc: 3D
          </button>
          <button
            type="button"
            className="hud-btn mobile-dock-btn active"
            id="btn-quick-lock"
            title="Khóa Camera Cố Định hoặc Mở Xoay 3D Tự Do"
          >
            🔒 Khóa
          </button>
          <button
            type="button"
            className="hud-btn mobile-dock-btn active"
            id="btn-quick-labels"
            title="Chuyển chế độ hiển thị Tên Quân Cờ trên đầu: Thông Minh (Hiện Vua, Hậu, Xe, Tượng, Mã) • Tất Cả (32 Quân) • Khi Chạm"
          >
            🏷️ Tên: Cờ Lớn
          </button>
          <button
            type="button"
            className="hud-btn mobile-dock-btn"
            id="btn-quick-undo"
            title="Đi lại nước vừa đi (Undo)"
          >
            ↩ Đi Lại
          </button>
          <button
            type="button"
            className="hud-btn mobile-dock-btn"
            id="btn-quick-duel"
            title="Mở Phòng Đấu 2 Người hoặc Đánh 2 Người Cùng Máy"
          >
            ⚔️ 2 Người
          </button>
          <button
            type="button"
            className="hud-btn mobile-dock-btn skin-shop-trigger"
            id="btn-quick-skin"
            title="Mở Cửa Hàng Bộ Sưu Tập Quân Cờ 3D"
          >
            👑 Skin 3D
          </button>
        </div>
      </div>

      <div id="promotion-overlay" role="dialog" aria-modal="true" aria-labelledby="promotion-title">
        <div className="promotion-modal">
          <div className="checkmate-ornament">✦ &nbsp; Sanctum Ascension &nbsp; ✦</div>
          <div className="promotion-title" id="promotion-title">Choose Promotion Piece</div>
          <div className="checkmate-rule"></div>
          <div className="promotion-grid">
            <button type="button" className="promotion-choice-btn" data-promotion-piece="queen">
              <span className="promotion-glyph">♕</span>
              <span className="promotion-label">Queen</span>
            </button>
            <button type="button" className="promotion-choice-btn" data-promotion-piece="rook">
              <span className="promotion-glyph">♖</span>
              <span className="promotion-label">Rook</span>
            </button>
            <button type="button" className="promotion-choice-btn" data-promotion-piece="bishop">
              <span className="promotion-glyph">♗</span>
              <span className="promotion-label">Bishop</span>
            </button>
            <button type="button" className="promotion-choice-btn" data-promotion-piece="knight">
              <span className="promotion-glyph">♘</span>
              <span className="promotion-label">Knight</span>
            </button>
          </div>
          <div className="checkmate-actions" style={{ marginTop: '14px' }}>
            <button type="button" className="checkmate-btn secondary" id="btn-promotion-cancel">
              Cancel
            </button>
          </div>
        </div>
      </div>

      <div id="duel-room-overlay" role="dialog" aria-modal="true" aria-labelledby="duel-room-title">
        <div className="promotion-modal duel-room-card">
          <div className="checkmate-ornament">✦ &nbsp; Sanctum 2-Player Chamber &nbsp; ✦</div>
          <div className="promotion-title" id="duel-room-title">Phòng Đấu 2 Người</div>
          <div className="checkmate-rule"></div>

          <div className="duel-section">
            <div className="duel-section-label">1. Tạo Phòng Online (Gửi Mã / Link Cho Bạn Bè)</div>
            <div className="duel-row">
              <button type="button" className="checkmate-btn" id="btn-duel-create-white">
                ♔ Tạo Phòng (Cầm Trắng)
              </button>
              <button type="button" className="checkmate-btn" id="btn-duel-create-black">
                ♚ Tạo Phòng (Cầm Đen)
              </button>
            </div>
            <div className="duel-active-box" id="duel-active-room-box" style={{ display: 'none' }}>
              <div className="duel-code-caption">Mã Phòng Của Bạn (4 ký tự):</div>
              <div className="duel-code-value" id="duel-room-code">----</div>
              <div className="duel-row" style={{ marginTop: '8px' }}>
                <button type="button" className="checkmate-btn" id="btn-duel-copy-link">
                  Sao Chép Link Mời
                </button>
              </div>
            </div>
          </div>

          <div className="duel-section">
            <div className="duel-section-label">2. Vào Phòng Bằng Mã 4 Ký Tự</div>
            <div className="duel-row">
              <input
                type="text"
                id="input-duel-code"
                className="duel-code-input"
                maxLength={6}
                placeholder="Nhập mã (VD: WIZ9)"
                autoComplete="off"
              />
              <button type="button" className="checkmate-btn" id="btn-duel-join">
                Vào Phòng
              </button>
            </div>
          </div>

          <div className="duel-section">
            <div className="duel-section-label">3. Chơi 2 Người Trên Cùng Màn Hình</div>
            <div className="duel-row">
              <button type="button" className="checkmate-btn" id="btn-duel-passplay">
                ⚔ Đánh 2 Người Cùng Máy (Tự Xoay Camera 3D)
              </button>
            </div>
          </div>

          <div className="duel-status-msg" id="duel-status-msg">
            Chọn Tạo Phòng Online, Nhập Mã Phòng của bạn bè, hoặc Đánh 2 Người Cùng Máy.
          </div>

          <div className="checkmate-actions" style={{ marginTop: '12px' }}>
            <button type="button" className="checkmate-btn secondary" id="btn-duel-close">
              Đóng / Vào Bàn Cờ
            </button>
          </div>
        </div>
      </div>

      <div id="skin-shop-overlay" role="dialog" aria-modal="true" aria-labelledby="skin-shop-title">
        <div className="promotion-modal skin-shop-card">
          <div className="checkmate-ornament">✦ &nbsp; Sanctum Royal Armory &amp; 3D Skin Boutique &nbsp; ✦</div>
          <div className="promotion-title" id="skin-shop-title">Bộ Sưu Tập Quân Cờ &amp; Đại Điện 3D</div>
          <div className="skin-shop-subtitle">
            Chọn bộ cờ để ngắm trực tiếp trên Đại Bàn Cờ 3.52m • Mỗi bộ đi kèm Phụ Kiện Vũ Khí 3D, Màu Đá Bàn Đấu &amp; Hiệu Ứng Nổ Vỡ riêng
          </div>
          <div className="checkmate-rule"></div>

          <div className="skin-grid" id="skin-catalog-grid">
            <button type="button" className="skin-item-card selected" data-skin-id="dong_son">
              <div className="skin-tier-badge mythic">THẦN THOẠI VIỆT</div>
              <div className="skin-swatch-row">
                <span className="skin-swatch" style={{ background: '#e6c687' }}></span>
                <span className="skin-swatch" style={{ background: '#12352a' }}></span>
                <span className="skin-swatch" style={{ background: '#fbbf24' }}></span>
              </div>
              <div className="skin-card-name">Hào Khí Đông Sơn</div>
              <div className="skin-card-desc">Trống Đồng Lạc Việt • Mũ Lông Công &amp; Rìu Chiến</div>
              <div className="skin-card-status">199.000đ</div>
            </button>

            <button type="button" className="skin-item-card" data-skin-id="shogun_yokai">
              <div className="skin-tier-badge mythic">THẦN THOẠI</div>
              <div className="skin-swatch-row">
                <span className="skin-swatch" style={{ background: '#f5ebe1' }}></span>
                <span className="skin-swatch" style={{ background: '#220910' }}></span>
                <span className="skin-swatch" style={{ background: '#ef4444' }}></span>
              </div>
              <div className="skin-card-name">Đại Mạc Phủ Shogun</div>
              <div className="skin-card-desc">Giáp Sơn Mài • Sừng Kabuto &amp; Cờ Lệnh Samurai</div>
              <div className="skin-card-status">199.000đ</div>
            </button>

            <button type="button" className="skin-item-card" data-skin-id="mecha_ronin">
              <div className="skin-tier-badge mythic">CYBER MYTHIC</div>
              <div className="skin-swatch-row">
                <span className="skin-swatch" style={{ background: '#eef4fa' }}></span>
                <span className="skin-swatch" style={{ background: '#0f172a' }}></span>
                <span className="skin-swatch" style={{ background: '#00f5d4' }}></span>
              </div>
              <div className="skin-card-name">Cyberpunk Mecha 2099</div>
              <div className="skin-card-desc">Cánh Phản Lực Titanium • Kính Visor &amp; Lõi Neon</div>
              <div className="skin-card-status">199.000đ</div>
            </button>

            <button type="button" className="skin-item-card" data-skin-id="abyssal_lich">
              <div className="skin-tier-badge epic">SỬ THI</div>
              <div className="skin-swatch-row">
                <span className="skin-swatch" style={{ background: '#dad4c8' }}></span>
                <span className="skin-swatch" style={{ background: '#0b0914' }}></span>
                <span className="skin-swatch" style={{ background: '#10b981' }}></span>
              </div>
              <div className="skin-card-name">Cửu U Minh Giới</div>
              <div className="skin-card-desc">Vương Miện Gai Tử Thần • Lõi Linh Hồn &amp; Lưỡi Hái</div>
              <div className="skin-card-status">129.000đ</div>
            </button>

            <button type="button" className="skin-item-card" data-skin-id="valhalla_valkyrie">
              <div className="skin-tier-badge epic">SỬ THI</div>
              <div className="skin-swatch-row">
                <span className="skin-swatch" style={{ background: '#e2ecf5' }}></span>
                <span className="skin-swatch" style={{ background: '#131c2b' }}></span>
                <span className="skin-swatch" style={{ background: '#38bdf8' }}></span>
              </div>
              <div className="skin-card-name">Thánh Điện Valhalla</div>
              <div className="skin-card-desc">Cánh Thiên Thần Valkyrie • Búa Thần &amp; Băng Tinh</div>
              <div className="skin-card-status">129.000đ</div>
            </button>

            <button type="button" className="skin-item-card" data-skin-id="pharaoh_anubis">
              <div className="skin-tier-badge epic">SỬ THI</div>
              <div className="skin-swatch-row">
                <span className="skin-swatch" style={{ background: '#f5e8c7' }}></span>
                <span className="skin-swatch" style={{ background: '#141b33' }}></span>
                <span className="skin-swatch" style={{ background: '#fbbf24' }}></span>
              </div>
              <div className="skin-card-name">Vương Triều Pharaoh</div>
              <div className="skin-card-desc">Đĩa Mặt Trời Thần Ra • Tai Anubis &amp; Kim Tự Tháp</div>
              <div className="skin-card-status">129.000đ</div>
            </button>

            <button type="button" className="skin-item-card" data-skin-id="bauhaus_imperial">
              <div className="skin-tier-badge rare">HIẾM</div>
              <div className="skin-swatch-row">
                <span className="skin-swatch" style={{ background: '#f8fafc' }}></span>
                <span className="skin-swatch" style={{ background: '#111318' }}></span>
                <span className="skin-swatch" style={{ background: '#e11d48' }}></span>
              </div>
              <div className="skin-card-name">Bauhaus Đế Vương</div>
              <div className="skin-card-desc">Sứ Trắng Minh Triều • Vòng Hào Quang Art Deco</div>
              <div className="skin-card-status">69.000đ</div>
            </button>

            <button type="button" className="skin-item-card equipped" data-skin-id="hogwarts">
              <div className="skin-tier-badge free">MẶC ĐỊNH</div>
              <div className="skin-swatch-row">
                <span className="skin-swatch" style={{ background: '#f2ece0' }}></span>
                <span className="skin-swatch" style={{ background: '#181c26' }}></span>
                <span className="skin-swatch" style={{ background: '#d4af37' }}></span>
              </div>
              <div className="skin-card-name">Thánh Đường Cổ Điển</div>
              <div className="skin-card-desc">Cẩm Thạch Trắng &amp; Hắc Diện Thạch Mạ Vàng</div>
              <div className="skin-card-status">✓ Đang Trang Bị</div>
            </button>
          </div>

          <div className="skin-detail-panel">
            <div className="skin-detail-info">
              <div className="skin-detail-title" id="skin-detail-title">Hào Khí Đông Sơn</div>
              <div className="skin-detail-subtitle" id="skin-detail-subtitle">
                Trống Đồng Lạc Việt • Mũ Lông Công &amp; Rìu Chiến Cổ Loa
              </div>
              <div className="skin-detail-price" id="skin-detail-price">
                Giá mở khóa: 199.000đ (Kèm bàn cờ &amp; hiệu ứng vỡ 3D riêng)
              </div>
            </div>
            <div className="skin-detail-actions">
              <button type="button" className="checkmate-btn" id="btn-skin-equip">
                🔓 Mở Khóa Ngay (199.000đ)
              </button>
              <button type="button" className="checkmate-btn secondary" id="btn-skin-trial">
                ⚡ Dùng Thử 1 Ván
              </button>
              <button type="button" className="checkmate-btn secondary" id="btn-skin-shatter">
                💥 Xem Hiệu Ứng Nổ Vỡ
              </button>
            </div>
          </div>

          <div className="skin-unlock-banner" id="skin-unlock-box">
            <span>🎁 <strong>Royal Collector Pass:</strong> Mở khóa trọn bộ 8 Phong Cách 3D Độc Bản + Đấu Trường Cổ Ngữ</span>
            <button type="button" className="checkmate-btn" id="btn-skin-unlock-all">
              👑 Mở Khóa Tất Cả (VIP Pass)
            </button>
          </div>

          <div className="duel-status-msg" id="skin-shop-status-msg">
            Mẹo: Khi đánh Phòng 2 Người Online, bộ Skin bạn trang bị sẽ hiển thị trực tiếp cho đối thủ chiêm ngưỡng!
          </div>

          <div className="checkmate-actions" style={{ marginTop: '10px' }}>
            <button type="button" className="checkmate-btn secondary" id="btn-skin-shop-close">
              Đóng Cửa Hàng &amp; Vào Trận
            </button>
          </div>
        </div>
      </div>

      <div id="checkmate-overlay" role="status" aria-live="polite">
        <div className="checkmate-banner">
          <div className="checkmate-ornament">✦ &nbsp; Sanctum Judgment &nbsp; ✦</div>
          <div className="checkmate-crown" id="checkmate-crown">♔</div>
          <div className="checkmate-title" id="checkmate-title">Checkmate</div>
          <div className="checkmate-rule"></div>
          <div className="checkmate-subtitle" id="checkmate-subtitle">
            White Triumphs • The Black King Has Fallen
          </div>
          <div className="checkmate-actions">
            <button className="checkmate-btn" id="btn-checkmate-replay">
              Replay King Fall
            </button>
            <button className="checkmate-btn" id="btn-checkmate-newgame">
              New Game
            </button>
            <button className="checkmate-btn secondary" id="btn-checkmate-dismiss">
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
