import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { initWizardChess } from './wizardChessEngine.js';

// Desktop shows one glass dock at the top; phones keep the captured tray in the bottom bar.
const DESKTOP_DOCK_QUERY = '(min-width: 769px) and (min-height: 521px)';

export default function App() {
  const initializedRef = useRef(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [desktopDock, setDesktopDock] = useState(() => window.matchMedia(DESKTOP_DOCK_QUERY).matches);
  const capturedTextRef = useRef('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackVariant, setFeedbackVariant] = useState<'both' | 'chess' | 'xiangqi'>('both');
  const [feedbackCategory, setFeedbackCategory] = useState('Ý tưởng tính năng mới');
  const [feedbackAuthor, setFeedbackAuthor] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const openFeedbackModal = () => {
    const activeVar = document.body?.dataset?.gameVariant;
    if (activeVar === 'xiangqi' || activeVar === 'chess') {
      setFeedbackVariant(activeVar);
    } else {
      setFeedbackVariant('both');
    }
    setFeedbackStatus(null);
    setMobileSheetOpen(false);
    setFeedbackOpen(true);
  };

  const handleFeedbackSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = feedbackMessage.trim();
    if (trimmed.length < 2) {
      setFeedbackStatus({ ok: false, text: '⚠️ Vui lòng nhập nội dung đề xuất của bạn.' });
      return;
    }
    setFeedbackSubmitting(true);
    setFeedbackStatus(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameVariant: feedbackVariant,
          category: feedbackCategory,
          author: feedbackAuthor.trim() || 'Người chơi ẩn danh',
          message: trimmed,
          deviceInfo: `${window.innerWidth}×${window.innerHeight} • ${navigator.userAgent.slice(0, 120)}`
        })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setFeedbackMessage('');
        setFeedbackStatus({
          ok: true,
          text: '✅ Đã lưu đề xuất của bạn vào Google Sheet! Cảm ơn bạn đã đóng góp phát triển game!'
        });
      } else {
        setFeedbackStatus({
          ok: false,
          text: data?.error || '⚠️ Không thể gửi đề xuất lúc này, vui lòng thử lại.'
        });
      }
    } catch {
      setFeedbackStatus({
        ok: false,
        text: '⚠️ Lỗi kết nối mạng, vui lòng thử lại sau giây lát.'
      });
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    initWizardChess();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_DOCK_QUERY);
    const handleChange = () => {
      // The engine writes the tray text directly; carry it over when the tray moves to the other bar.
      capturedTextRef.current = document.getElementById('captured-tray')?.textContent ?? '';
      setDesktopDock(mq.matches);
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  useLayoutEffect(() => {
    const el = document.getElementById('captured-tray');
    if (el && capturedTextRef.current) el.textContent = capturedTextRef.current;
    capturedTextRef.current = '';
  }, [desktopDock]);

  const capturedTray = <div className="captured-pill" id="captured-tray"></div>;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileSheetOpen(false);
        setFeedbackOpen(false);
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
            className="hud-btn top-primary-btn game-variant-btn"
            id="btn-game-variant"
            title="Chuyển đổi nhanh giữa Cờ Vua 3D (8×8) và Cờ Tướng 3D (9×10 Sở Hà Hán Giới)"
            onClick={() => setMobileSheetOpen(false)}
          >
            ♟️ Cờ Vua 3D
          </button>

          <button
            type="button"
            className="hud-btn top-primary-btn active"
            id="btn-ai-difficulty"
            title="Chọn Độ Khó AI riêng: Dễ (Novice) • Vừa (Tactical) • Khó (Grandmaster)"
            onClick={() => setMobileSheetOpen(false)}
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
            className={`hud-btn menu-toggle-trigger ${mobileSheetOpen ? 'active' : ''}`}
            id="btn-mobile-controls"
            aria-expanded={mobileSheetOpen}
            aria-controls="hud-right"
            onClick={() => setMobileSheetOpen((prev) => !prev)}
            title="Gom gọn toàn bộ tùy chỉnh Bàn Cờ, Độ Khó, Camera và Âm Thanh"
          >
            {mobileSheetOpen ? '✕ Đóng' : '⚙️ Menu'}
          </button>

          {desktopDock && (
            <div className="dock-tray" id="dock-tray">
              {capturedTray}
            </div>
          )}
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

          <div
            id="variant-segmented-pill"
            className="variant-segmented-pill"
            role="group"
            aria-label="Chọn Chế Độ Bàn Cờ"
          >
            <button
              type="button"
              id="btn-seg-chess"
              className="variant-seg-btn active"
              data-set-variant="chess"
              title="Chuyển ngay sang Cờ Vua Phù Thủy 3D (8×8)"
              onClick={() => setMobileSheetOpen(false)}
            >
              ♟️ Cờ Vua 3D (8×8)
            </button>
            <button
              type="button"
              id="btn-seg-xiangqi"
              className="variant-seg-btn"
              data-set-variant="xiangqi"
              title="Chuyển ngay sang Cờ Tướng 3D — Sở Hán (9×10)"
              onClick={() => setMobileSheetOpen(false)}
            >
              🀄 Cờ Tướng 3D (9×10)
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
            className="hud-btn active"
            id="btn-cam-spectator"
            title="Góc nhìn 3/4 từ phía người chơi (Bấm lần nữa để lật Trắng / Đen)"
          >
            🎥 Góc 3/4
          </button>
          <button
            className="hud-btn"
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
            id="btn-motion-level"
            type="button"
            aria-label="Motion level"
            title="Hoạt cảnh: Đầy Đủ / Nhanh / Tắt (mặc định theo cài đặt Giảm chuyển động của máy)"
          >
            <span id="motion-level-label">🎬 Hoạt Cảnh: Đầy Đủ</span>
          </button>
          <button
            className="hud-btn"
            id="btn-quality-tier"
            type="button"
            aria-label="Quality tier"
            title="Chất lượng hình ảnh: Tự Động / Ultra / High / Base"
          >
            <span id="quality-tier-label">✨ Chất Lượng: Tự Động</span>
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
        {!desktopDock && capturedTray}
        <div className="mobile-quick-dock" id="mobile-quick-dock" aria-label="Mobile Quick Actions">
          <button
            type="button"
            className="hud-btn mobile-dock-btn game-variant-btn"
            id="btn-quick-variant"
            title="Chuyển đổi nhanh giữa Cờ Vua 3D (8×8) và Cờ Tướng 3D (9×10)"
          >
            ♟️ Vua
          </button>
          <button
            type="button"
            className="hud-btn mobile-dock-btn active"
            id="btn-quick-cam"
            title="Chuyển nhanh giữa Góc nhìn Từ Trên Xuống và Góc nhìn 3/4"
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
            title="Chuyển chế độ hiển thị Tên Quân Cờ trên đầu: Thông Minh • Tất Cả (32) • Khi Chạm"
          >
            🏷️ Tên: Bật
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

      <div
        id="game-selector-overlay"
        className="visible"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-selector-title"
      >
        <div className="promotion-modal game-selector-card">
          <div className="checkmate-ornament">✦ &nbsp; Sanctum 3D Grand Arena • chess.tqd.io.vn &nbsp; ✦</div>
          <div className="promotion-title" id="game-selector-title">Chọn Đấu Trường Cờ 3D</div>
          <div className="skin-shop-subtitle">
            Khám phá 2 tuyệt tác sàn đấu 3D thời gian thực • Bạn có thể đổi môn cờ bất cứ lúc nào trên thanh điều khiển
          </div>
          <div className="checkmate-rule"></div>

          <div className="arena-selector-grid">
            <div
              className="arena-choice-card selected"
              id="card-select-chess"
              data-select-variant="chess"
            >
              <div className="arena-preview-wrap">
                <img
                  src="/assets/demo-chess-arena.jpg?v=20261102_top"
                  alt="Sàn đấu Cờ Vua 3D Đại Thánh Đường"
                  className="arena-demo-img"
                  draggable={false}
                />
                <span className="arena-badge chess-badge">PHƯƠNG TÂY CỔ ĐIỂN • 8×8 Ô ĐÁ</span>
                <span className="arena-active-pill" id="badge-active-chess">✓ Đang Chọn</span>
              </div>
              <div className="arena-card-body">
                <div className="arena-card-title">♟️ Cờ Vua 3D — Đại Thánh Đường</div>
                <div className="arena-card-desc">
                  Bàn cờ 8×8 Cẩm Thạch &amp; Hắc Diện Thạch Mạ Vàng (3.52m) • 32 Tượng Thần Điêu Khắc Nổi • 8 Bộ Skin Thần Thoại • Hiệu Ứng Đập Vỡ Đá 3D
                </div>
                <div className="arena-feature-tags">
                  <span className="arena-tag">♔ Chuẩn FIDE</span>
                  <span className="arena-tag">👑 8 Bộ Skin 3D</span>
                  <span className="arena-tag">🤖 AI 3 Cấp Độ</span>
                  <span className="arena-tag">⚔️ Đấu 2 Người</span>
                </div>
                <button type="button" className="checkmate-btn arena-cta-btn" id="btn-select-chess">
                  ♟️ Vào Sàn Đấu Cờ Vua 3D
                </button>
              </div>
            </div>

            <div
              className="arena-choice-card xiangqi-card"
              id="card-select-xiangqi"
              data-select-variant="xiangqi"
            >
              <div className="arena-preview-wrap">
                <img
                  src="/assets/demo-xiangqi-arena.jpg?v=20261102_top"
                  alt="Sàn đấu Cờ Tướng 3D Sở Hà Hán Giới"
                  className="arena-demo-img"
                  draggable={false}
                />
                <span className="arena-badge xiangqi-badge">ĐÔNG Á CỔ ĐẠI • 9×10 GIAO ĐIỂM</span>
                <span className="arena-active-pill" id="badge-active-xiangqi">MỚI RA MẮT</span>
              </div>
              <div className="arena-card-body">
                <div className="arena-card-title">🀄 Cờ Tướng 3D — Hán Sở Phong Vân</div>
                <div className="arena-card-desc">
                  Bàn cờ 9×10 Ngọc Bích &amp; Đồng Đỏ • Sông <strong>楚河 — 漢界 (Sở Hà — Hán Giới)</strong> &amp; Cửu Cung • 32 Chiến Thần Chu Sa &amp; Hắc Ngọc Điêu Khắc Từ Đầu (Soái/Tướng, Sĩ, Tịnh/Tượng, Xe, Pháo, Mã, Binh/Tốt)
                </div>
                <div className="arena-feature-tags">
                  <span className="arena-tag">🔥 Pháo Kích Cầu Vồng</span>
                  <span className="arena-tag">🐎 Báo Cản Mã / Mắt Tượng</span>
                  <span className="arena-tag">🤖 AI Cờ Tướng</span>
                  <span className="arena-tag">⚔️ Đấu 2 Người</span>
                </div>
                <button type="button" className="checkmate-btn arena-cta-btn xiangqi-cta" id="btn-select-xiangqi">
                  🀄 Vào Sàn Đấu Cờ Tướng 3D
                </button>
              </div>
            </div>
          </div>

          <div className="checkmate-actions" style={{ marginTop: '12px' }}>
            <button
              type="button"
              className="checkmate-btn feedback-cta-btn"
              id="btn-selector-feedback"
              onClick={openFeedbackModal}
            >
              💬 Đề Xuất &amp; Góp Ý Phát Triển Game
            </button>
            <button type="button" className="checkmate-btn secondary" id="btn-selector-close">
              Đóng &amp; Tiếp Tục Ván Hiện Tại
            </button>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="feedback-corner-fab"
        id="btn-feedback-fab"
        onClick={openFeedbackModal}
        title="Gửi đề xuất, ý tưởng hoặc báo lỗi để giúp game phát triển hơn"
        aria-label="Đề Xuất và Góp Ý"
      >
        <span className="feedback-fab-dot" aria-hidden="true"></span>
        <span>💬 Đề Xuất</span>
      </button>

      <div
        id="feedback-modal-overlay"
        className={feedbackOpen ? 'visible' : ''}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-modal-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) setFeedbackOpen(false);
        }}
      >
        <div className="promotion-modal feedback-modal-card">
          <div className="checkmate-ornament">✦ &nbsp; Sanctum 3D Community • Đồng Sáng Tạo &nbsp; ✦</div>
          <div className="promotion-title" id="feedback-modal-title">💬 Đề Xuất &amp; Góp Ý Phát Triển Game</div>
          <div className="skin-shop-subtitle">
            Mọi ý tưởng của bạn đều được lưu trực tiếp vào bảng theo dõi để đội ngũ nâng cấp Cờ Vua 3D &amp; Cờ Tướng 3D
          </div>
          <div className="checkmate-rule"></div>

          <form className="feedback-form" onSubmit={handleFeedbackSubmit}>
            <div className="feedback-row-grid">
              <label className="feedback-field">
                <span className="feedback-label">1. Môn Cờ Góp Ý</span>
                <select
                  id="feedback-variant"
                  className="feedback-select"
                  value={feedbackVariant}
                  onChange={(e) => setFeedbackVariant(e.target.value as 'both' | 'chess' | 'xiangqi')}
                >
                  <option value="both">🌟 Cả 2 Môn (Cờ Vua &amp; Cờ Tướng)</option>
                  <option value="chess">♟️ Cờ Vua 3D (8×8)</option>
                  <option value="xiangqi">🀄 Cờ Tướng 3D (9×10)</option>
                </select>
              </label>

              <label className="feedback-field">
                <span className="feedback-label">2. Hạng Mục Đề Xuất</span>
                <select
                  id="feedback-category"
                  className="feedback-select"
                  value={feedbackCategory}
                  onChange={(e) => setFeedbackCategory(e.target.value)}
                >
                  <option value="Ý tưởng tính năng mới">💡 Ý tưởng tính năng mới</option>
                  <option value="Tạo hình & Màu quân cờ 3D">🎨 Tạo hình &amp; Màu quân cờ 3D</option>
                  <option value="Độ khó AI & Luật cờ">🤖 Độ khó AI &amp; Luật cờ</option>
                  <option value="Giao diện Mobile & PC">📱 Giao diện Mobile &amp; PC</option>
                  <option value="Báo lỗi / Khác">🐞 Báo lỗi / Khác</option>
                </select>
              </label>
            </div>

            <label className="feedback-field">
              <span className="feedback-label">3. Tên hoặc Liên Hệ Của Bạn (Không bắt buộc)</span>
              <input
                id="feedback-author"
                type="text"
                className="feedback-input"
                placeholder="VD: Minh Quân / SĐT hoặc Email..."
                maxLength={100}
                value={feedbackAuthor}
                onChange={(e) => setFeedbackAuthor(e.target.value)}
              />
            </label>

            <label className="feedback-field">
              <span className="feedback-label">4. Nội Dung Đề Xuất / Ý Tưởng Của Bạn *</span>
              <textarea
                id="feedback-message"
                className="feedback-textarea"
                rows={4}
                placeholder="Nhập ý tưởng tính năng, góp ý tạo hình quân cờ, góc camera hoặc trải nghiệm bạn mong muốn..."
                maxLength={1500}
                required
                value={feedbackMessage}
                onChange={(e) => setFeedbackMessage(e.target.value)}
              />
            </label>

            {feedbackStatus && (
              <div
                id="feedback-status-banner"
                className={`feedback-status-banner ${feedbackStatus.ok ? 'ok' : 'err'}`}
                role="status"
              >
                {feedbackStatus.text}
              </div>
            )}

            <div className="checkmate-actions" style={{ marginTop: '8px' }}>
              <button
                type="submit"
                className="checkmate-btn"
                id="btn-feedback-submit"
                disabled={feedbackSubmitting}
              >
                {feedbackSubmitting ? '⏳ Đang Lưu Đề Xuất...' : '🚀 Gửi Đề Xuất Ngay'}
              </button>
              <button
                type="button"
                className="checkmate-btn secondary"
                id="btn-feedback-close"
                onClick={() => setFeedbackOpen(false)}
              >
                Đóng
              </button>
            </div>
          </form>
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

      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <filter id="liquid-glass-refract">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves={1} seed={7} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={14} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
    </>
  );
}
