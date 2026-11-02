import type { AIDifficulty, AsyncAISearchOptions, PieceColor } from './chessAI';

export type XiangqiPieceType =
  | 'king'
  | 'advisor'
  | 'elephant'
  | 'rook'
  | 'cannon'
  | 'knight'
  | 'pawn';

export interface XiangqiCell {
  type: XiangqiPieceType;
  color: PieceColor;
  hasMoved?: boolean;
}

export interface PureXiangqiMove {
  fromR: number;
  fromC: number;
  toR: number;
  toC: number;
  capture: boolean;
  captureR?: number;
  captureC?: number;
  /** Screen/mount coordinate when a Cannon captures by vaulting over a piece */
  screenR?: number;
  screenC?: number;
  /** Intermediate orthogonal pivot coordinate for a Horse's L-move */
  legR?: number;
  legC?: number;
}

export const XIANGQI_ROWS = 10;
export const XIANGQI_COLS = 9;

export const XIANGQI_PIECE_VALUES: Record<XiangqiPieceType, number> = {
  king: 20000,
  rook: 900,
  cannon: 450,
  knight: 400,
  elephant: 200,
  advisor: 200,
  pawn: 100
};

export interface XiangqiRoleMetadata {
  hanziRed: string;
  hanziBlack: string;
  titleVi: string;
  titleEn: string;
  moveRuleVi: string;
  viName: string;
  viNameW: string;
  viNameB: string;
  enName: string;
  shortVi: string;
  shortViW: string;
  shortViB: string;
  glyphW: string;
  glyphB: string;
  moveHint: string;
}

export const XIANGQI_ROLE_METADATA: Record<XiangqiPieceType, XiangqiRoleMetadata> = {
  king: {
    hanziRed: '帥',
    hanziBlack: '將',
    titleVi: 'Tướng / Soái',
    titleEn: 'General',
    moveRuleVi: 'Đi từng bước ngang/dọc trong Cửu Cung; cấm Lộ Mặt Tướng trực diện.',
    viName: 'Tướng / Soái',
    viNameW: 'Nguyên Soái (帥)',
    viNameB: 'Chủ Tướng (將)',
    enName: 'General',
    shortVi: 'Tướng',
    shortViW: 'Soái',
    shortViB: 'Tướng',
    glyphW: '帥',
    glyphB: '將',
    moveHint: 'Đi từng bước ngang/dọc trong Cửu Cung; cấm Lộ Mặt Tướng trực diện.'
  },
  advisor: {
    hanziRed: '仕',
    hanziBlack: '士',
    titleVi: 'Sĩ Cấm Vệ',
    titleEn: 'Advisor',
    moveRuleVi: 'Đi chéo 1 bước bảo vệ Tướng trong phạm vi Cửu Cung (3×3).',
    viName: 'Sĩ Cấm Vệ',
    viNameW: 'Sĩ Cấm Vệ (仕)',
    viNameB: 'Sĩ Hộ Vệ (士)',
    enName: 'Advisor',
    shortVi: 'Sĩ',
    shortViW: 'Sĩ',
    shortViB: 'Sĩ',
    glyphW: '仕',
    glyphB: '士',
    moveHint: 'Đi chéo 1 bước bảo vệ Tướng trong phạm vi Cửu Cung (3×3).'
  },
  elephant: {
    hanziRed: '相',
    hanziBlack: '象',
    titleVi: 'Tịnh / Tượng',
    titleEn: 'Elephant',
    moveRuleVi: 'Đi chéo 2 bước (Điền 田), bị cản nếu có quân chặn Mắt Tượng, không qua sông.',
    viName: 'Tịnh / Tượng',
    viNameW: 'Tịnh / Tượng (相)',
    viNameB: 'Tượng Chiến (象)',
    enName: 'Elephant',
    shortVi: 'Tượng',
    shortViW: 'Tịnh',
    shortViB: 'Tượng',
    glyphW: '相',
    glyphB: '象',
    moveHint: 'Đi chéo 2 bước (Điền 田), bị cản nếu có quân chặn Mắt Tượng, không qua sông.'
  },
  rook: {
    hanziRed: '俥',
    hanziBlack: '車',
    titleVi: 'Chiến Xa (Xe)',
    titleEn: 'Chariot',
    moveRuleVi: 'Đi và ăn quân thẳng ngang/dọc không giới hạn số bước khi không bị cản.',
    viName: 'Chiến Xa (Xe)',
    viNameW: 'Chiến Xa (俥)',
    viNameB: 'Chiến Xa (車)',
    enName: 'Chariot',
    shortVi: 'Xe',
    shortViW: 'Xe',
    shortViB: 'Xe',
    glyphW: '俥',
    glyphB: '車',
    moveHint: 'Đi và ăn quân thẳng ngang/dọc không giới hạn số bước khi không bị cản.'
  },
  cannon: {
    hanziRed: '炮',
    hanziBlack: '砲',
    titleVi: 'Hỏa Pháo',
    titleEn: 'Cannon',
    moveRuleVi: 'Di chuyển như Xe; khi ăn quân phải phóng qua đúng 1 quân làm Ngòi Pháo.',
    viName: 'Hỏa Pháo',
    viNameW: 'Hỏa Pháo (炮)',
    viNameB: 'Thạch Pháo (砲)',
    enName: 'Cannon',
    shortVi: 'Pháo',
    shortViW: 'Pháo',
    shortViB: 'Pháo',
    glyphW: '炮',
    glyphB: '砲',
    moveHint: 'Di chuyển như Xe; khi ăn quân phải phóng qua đúng 1 quân làm Ngòi Pháo.'
  },
  knight: {
    hanziRed: '傌',
    hanziBlack: '馬',
    titleVi: 'Chiến Mã',
    titleEn: 'Horse',
    moveRuleVi: 'Đi chữ Nhật (1 bước thẳng + 1 bước chéo); bị Cản Mã nếu có quân đứng sát bên hướng đi.',
    viName: 'Chiến Mã',
    viNameW: 'Chiến Mã (傌)',
    viNameB: 'Chiến Mã (馬)',
    enName: 'Horse',
    shortVi: 'Mã',
    shortViW: 'Mã',
    shortViB: 'Mã',
    glyphW: '傌',
    glyphB: '馬',
    moveHint: 'Đi chữ Nhật (1 bước thẳng + 1 bước chéo); bị Cản Mã nếu có quân đứng sát bên hướng đi.'
  },
  pawn: {
    hanziRed: '兵',
    hanziBlack: '卒',
    titleVi: 'Binh / Tốt',
    titleEn: 'Soldier',
    moveRuleVi: 'Chưa qua sông đi thẳng 1 bước; qua Sở Hà — Hán Giới được đi thẳng hoặc ngang 1 bước.',
    viName: 'Binh / Tốt',
    viNameW: 'Binh Lính (兵)',
    viNameB: 'Tốt Binh (卒)',
    enName: 'Soldier',
    shortVi: 'Tốt',
    shortViW: 'Binh',
    shortViB: 'Tốt',
    glyphW: '兵',
    glyphB: '卒',
    moveHint: 'Chưa qua sông đi thẳng 1 bước; qua Sở Hà — Hán Giới được đi thẳng hoặc ngang 1 bước.'
  }
};

// 10x9 Piece-Square Tables (oriented from Red 'w' perspective: r=0 is enemy back rank, r=9 is home back rank)
const PST_PAWN_XQ: number[][] = [
  [10, 15, 22, 32, 36, 32, 22, 15, 10],
  [25, 36, 48, 62, 70, 62, 48, 36, 25],
  [22, 32, 44, 56, 62, 56, 44, 32, 22],
  [18, 28, 36, 46, 52, 46, 36, 28, 18],
  [12, 18, 26, 34, 40, 34, 26, 18, 12],
  [4, 0, 10, 0, 14, 0, 10, 0, 4],
  [0, 0, 0, 0, 4, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0]
];

const PST_KNIGHT_XQ: number[][] = [
  [4, 10, 16, 12, 6, 12, 16, 10, 4],
  [8, 18, 28, 24, 16, 24, 28, 18, 8],
  [12, 24, 34, 38, 32, 38, 34, 24, 12],
  [10, 22, 30, 36, 34, 36, 30, 22, 10],
  [8, 18, 26, 30, 28, 30, 26, 18, 8],
  [6, 14, 22, 26, 24, 26, 22, 14, 6],
  [4, 12, 18, 20, 18, 20, 18, 12, 4],
  [2, 8, 14, 16, 12, 16, 14, 8, 2],
  [0, 4, 8, 10, 6, 10, 8, 4, 0],
  [-4, 0, 4, 4, 0, 4, 4, 0, -4]
];

const PST_CANNON_XQ: number[][] = [
  [12, 14, 10, 6, 4, 6, 10, 14, 12],
  [10, 14, 14, 14, 16, 14, 14, 14, 10],
  [8, 12, 16, 20, 24, 20, 16, 12, 8],
  [6, 10, 14, 20, 26, 20, 14, 10, 6],
  [4, 8, 12, 18, 24, 18, 12, 8, 4],
  [4, 8, 12, 16, 22, 16, 12, 8, 4],
  [2, 6, 10, 12, 18, 12, 10, 6, 2],
  [4, 12, 8, 10, 20, 10, 8, 12, 4],
  [2, 4, 4, 6, 10, 6, 4, 4, 2],
  [0, 2, 2, 4, 6, 4, 2, 2, 0]
];

const PST_ROOK_XQ: number[][] = [
  [16, 24, 20, 26, 28, 26, 20, 24, 16],
  [18, 28, 26, 32, 36, 32, 26, 28, 18],
  [14, 24, 22, 28, 30, 28, 22, 24, 14],
  [14, 22, 20, 26, 28, 26, 20, 22, 14],
  [12, 20, 18, 24, 26, 24, 18, 20, 12],
  [10, 18, 16, 22, 24, 22, 16, 18, 10],
  [6, 14, 12, 18, 20, 18, 12, 14, 6],
  [6, 12, 10, 16, 18, 16, 10, 12, 6],
  [4, 10, 8, 14, 12, 14, 8, 10, 4],
  [-4, 8, 4, 12, 6, 12, 4, 8, -4]
];

const PST_ADVISOR_XQ: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 6, 0, 6, 0, 0, 0],
  [0, 0, 0, 0, 16, 0, 0, 0, 0],
  [0, 0, 0, 8, 0, 8, 0, 0, 0]
];

const PST_ELEPHANT_XQ: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 8, 0, 0, 0, 8, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [6, 0, 0, 0, 18, 0, 0, 0, 6],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 10, 0, 0, 0, 10, 0, 0]
];

const PST_KING_XQ: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, -6, -4, -6, 0, 0, 0],
  [0, 0, 0, 2, 6, 2, 0, 0, 0],
  [0, 0, 0, 8, 16, 8, 0, 0, 0]
];

const XIANGQI_PST_MAP: Record<XiangqiPieceType, number[][]> = {
  pawn: PST_PAWN_XQ,
  knight: PST_KNIGHT_XQ,
  cannon: PST_CANNON_XQ,
  rook: PST_ROOK_XQ,
  advisor: PST_ADVISOR_XQ,
  elephant: PST_ELEPHANT_XQ,
  king: PST_KING_XQ
};

export function createEmptyXiangqiBoard(): (XiangqiCell | null)[][] {
  return Array.from({ length: XIANGQI_ROWS }, () => Array(XIANGQI_COLS).fill(null));
}

export function createInitialXiangqiBoard(): (XiangqiCell | null)[][] {
  const grid = createEmptyXiangqiBoard();
  const backOrder: XiangqiPieceType[] = [
    'rook',
    'knight',
    'elephant',
    'advisor',
    'king',
    'advisor',
    'elephant',
    'knight',
    'rook'
  ];

  for (let c = 0; c < XIANGQI_COLS; c++) {
    grid[0][c] = { type: backOrder[c], color: 'b', hasMoved: false };
    grid[9][c] = { type: backOrder[c], color: 'w', hasMoved: false };
  }

  // Cannons (Pháo) at row 2 (Black) & row 7 (Red), files 1 & 7
  grid[2][1] = { type: 'cannon', color: 'b', hasMoved: false };
  grid[2][7] = { type: 'cannon', color: 'b', hasMoved: false };
  grid[7][1] = { type: 'cannon', color: 'w', hasMoved: false };
  grid[7][7] = { type: 'cannon', color: 'w', hasMoved: false };

  // Soldiers (Tốt / Binh) at row 3 (Black) & row 6 (Red), files 0, 2, 4, 6, 8
  for (const c of [0, 2, 4, 6, 8]) {
    grid[3][c] = { type: 'pawn', color: 'b', hasMoved: false };
    grid[6][c] = { type: 'pawn', color: 'w', hasMoved: false };
  }

  return grid;
}

export function cloneXiangqiBoardRows(cells: (XiangqiCell | null)[][]): (XiangqiCell | null)[][] {
  return cells.map((row) =>
    row.map((cell) => (cell ? { type: cell.type, color: cell.color, hasMoved: Boolean(cell.hasMoved) } : null))
  );
}

export function extractPureXiangqiBoard(
  rawBoard: Array<Array<{ type: XiangqiPieceType; color: PieceColor; hasMoved?: boolean } | null>>
): (XiangqiCell | null)[][] {
  const grid = createEmptyXiangqiBoard();
  for (let r = 0; r < XIANGQI_ROWS; r++) {
    for (let c = 0; c < XIANGQI_COLS; c++) {
      const cell = rawBoard[r]?.[c];
      if (cell) {
        grid[r][c] = {
          type: cell.type,
          color: cell.color,
          hasMoved: Boolean(cell.hasMoved)
        };
      }
    }
  }
  return grid;
}

export function inXiangqiBounds(r: number, c: number): boolean {
  return r >= 0 && r < XIANGQI_ROWS && c >= 0 && c < XIANGQI_COLS;
}

export function isInsidePalace(r: number, c: number, color: PieceColor): boolean {
  if (c < 3 || c > 5) return false;
  return color === 'w' ? r >= 7 && r <= 9 : r >= 0 && r <= 2;
}

export function isOwnSideOfRiver(r: number, color: PieceColor): boolean {
  return color === 'w' ? r >= 5 && r <= 9 : r >= 0 && r <= 4;
}

export function hasSoldierCrossedRiver(r: number, color: PieceColor): boolean {
  return color === 'w' ? r <= 4 : r >= 5;
}

export function findGeneralCoords(cells: (XiangqiCell | null)[][], color: PieceColor): [number, number] {
  // Fast scan inside the 3x3 palace first
  const rStart = color === 'w' ? 7 : 0;
  const rEnd = color === 'w' ? 9 : 2;
  for (let r = rStart; r <= rEnd; r++) {
    for (let c = 3; c <= 5; c++) {
      const p = cells[r]?.[c];
      if (p && p.type === 'king' && p.color === color) {
        return [r, c];
      }
    }
  }
  // Fallback full scan for custom test boards
  for (let r = 0; r < XIANGQI_ROWS; r++) {
    for (let c = 0; c < XIANGQI_COLS; c++) {
      const p = cells[r]?.[c];
      if (p && p.type === 'king' && p.color === color) {
        return [r, c];
      }
    }
  }
  return [-1, -1];
}

export function isFlyingGeneralExposed(cells: (XiangqiCell | null)[][]): boolean {
  const [wR, wC] = findGeneralCoords(cells, 'w');
  const [bR, bC] = findGeneralCoords(cells, 'b');
  if (wR === -1 || bR === -1 || wC !== bC) return false;
  const minR = Math.min(wR, bR);
  const maxR = Math.max(wR, bR);
  for (let r = minR + 1; r < maxR; r++) {
    if (cells[r]?.[wC]) return false;
  }
  return true;
}

const HORSE_JUMPS: ReadonlyArray<{ dr: number; dc: number; legDr: number; legDc: number }> = [
  { dr: -2, dc: -1, legDr: -1, legDc: 0 },
  { dr: -2, dc: 1, legDr: -1, legDc: 0 },
  { dr: 2, dc: -1, legDr: 1, legDc: 0 },
  { dr: 2, dc: 1, legDr: 1, legDc: 0 },
  { dr: -1, dc: -2, legDr: 0, legDc: -1 },
  { dr: 1, dc: -2, legDr: 0, legDc: -1 },
  { dr: -1, dc: 2, legDr: 0, legDc: 1 },
  { dr: 1, dc: 2, legDr: 0, legDc: 1 }
];

const ELEPHANT_JUMPS: ReadonlyArray<{ dr: number; dc: number; eyeDr: number; eyeDc: number }> = [
  { dr: -2, dc: -2, eyeDr: -1, eyeDc: -1 },
  { dr: -2, dc: 2, eyeDr: -1, eyeDc: 1 },
  { dr: 2, dc: -2, eyeDr: 1, eyeDc: -1 },
  { dr: 2, dc: 2, eyeDr: 1, eyeDc: 1 }
];

export function getXiangqiBlockedPointsForPiece(
  cells: (XiangqiCell | null)[][],
  r: number,
  c: number
): Array<{ r: number; c: number; kind: 'horse_leg' | 'elephant_eye' }> {
  const piece = cells[r]?.[c];
  if (!piece) return [];
  const blocked: Array<{ r: number; c: number; kind: 'horse_leg' | 'elephant_eye' }> = [];

  if (piece.type === 'knight') {
    const seen = new Set<string>();
    for (const j of HORSE_JUMPS) {
      const nr = r + j.dr;
      const nc = c + j.dc;
      if (!inXiangqiBounds(nr, nc)) continue;
      const legR = r + j.legDr;
      const legC = c + j.legDc;
      const key = `${legR},${legC}`;
      if (!seen.has(key) && cells[legR]?.[legC]) {
        seen.add(key);
        blocked.push({ r: legR, c: legC, kind: 'horse_leg' });
      }
    }
  } else if (piece.type === 'elephant') {
    for (const j of ELEPHANT_JUMPS) {
      const nr = r + j.dr;
      const nc = c + j.dc;
      if (!inXiangqiBounds(nr, nc) || !isOwnSideOfRiver(nr, piece.color)) continue;
      const eyeR = r + j.eyeDr;
      const eyeC = c + j.eyeDc;
      if (cells[eyeR]?.[eyeC]) {
        blocked.push({ r: eyeR, c: eyeC, kind: 'elephant_eye' });
      }
    }
  }
  return blocked;
}

export function getXiangqiPseudoMovesForPiece(
  cells: (XiangqiCell | null)[][],
  r: number,
  c: number
): Array<{
  r: number;
  c: number;
  capture: boolean;
  captureR?: number;
  captureC?: number;
  screenR?: number;
  screenC?: number;
  legR?: number;
  legC?: number;
}> {
  const piece = cells[r]?.[c];
  if (!piece) return [];
  const { type, color } = piece;
  const moves: Array<{
    r: number;
    c: number;
    capture: boolean;
    captureR?: number;
    captureC?: number;
    screenR?: number;
    screenC?: number;
    legR?: number;
    legC?: number;
  }> = [];

  const tryAddTarget = (nr: number, nc: number, extra?: { legR?: number; legC?: number }) => {
    if (!inXiangqiBounds(nr, nc)) return;
    const target = cells[nr][nc];
    if (!target) {
      moves.push({ r: nr, c: nc, capture: false, ...extra });
    } else if (target.color !== color) {
      moves.push({ r: nr, c: nc, capture: true, captureR: nr, captureC: nc, ...extra });
    }
  };

  if (type === 'king') {
    const ortho = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1]
    ];
    for (const [dr, dc] of ortho) {
      const nr = r + dr;
      const nc = c + dc;
      if (isInsidePalace(nr, nc, color)) {
        tryAddTarget(nr, nc);
      }
    }
  } else if (type === 'advisor') {
    const diag = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1]
    ];
    for (const [dr, dc] of diag) {
      const nr = r + dr;
      const nc = c + dc;
      if (isInsidePalace(nr, nc, color)) {
        tryAddTarget(nr, nc);
      }
    }
  } else if (type === 'elephant') {
    for (const j of ELEPHANT_JUMPS) {
      const nr = r + j.dr;
      const nc = c + j.dc;
      if (!inXiangqiBounds(nr, nc) || !isOwnSideOfRiver(nr, color)) continue;
      // Check Elephant's Eye (Chặn Mắt Tượng)
      if (cells[r + j.eyeDr]?.[c + j.eyeDc]) continue;
      tryAddTarget(nr, nc);
    }
  } else if (type === 'knight') {
    for (const j of HORSE_JUMPS) {
      const nr = r + j.dr;
      const nc = c + j.dc;
      if (!inXiangqiBounds(nr, nc)) continue;
      const legR = r + j.legDr;
      const legC = c + j.legDc;
      // Check Hobbling the Horse's Leg (Cản Mã)
      if (cells[legR]?.[legC]) continue;
      tryAddTarget(nr, nc, { legR, legC });
    }
  } else if (type === 'rook') {
    const ortho = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1]
    ];
    for (const [dr, dc] of ortho) {
      for (let step = 1; step < 10; step++) {
        const nr = r + dr * step;
        const nc = c + dc * step;
        if (!inXiangqiBounds(nr, nc)) break;
        const target = cells[nr][nc];
        if (!target) {
          moves.push({ r: nr, c: nc, capture: false });
        } else {
          if (target.color !== color) {
            moves.push({ r: nr, c: nc, capture: true, captureR: nr, captureC: nc });
          }
          break;
        }
      }
    }
  } else if (type === 'cannon') {
    const ortho = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1]
    ];
    for (const [dr, dc] of ortho) {
      let screenFound = false;
      let screenR = -1;
      let screenC = -1;
      for (let step = 1; step < 10; step++) {
        const nr = r + dr * step;
        const nc = c + dc * step;
        if (!inXiangqiBounds(nr, nc)) break;
        const target = cells[nr][nc];
        if (!screenFound) {
          if (!target) {
            moves.push({ r: nr, c: nc, capture: false });
          } else {
            screenFound = true;
            screenR = nr;
            screenC = nc;
          }
        } else {
          if (target) {
            if (target.color !== color) {
              moves.push({
                r: nr,
                c: nc,
                capture: true,
                captureR: nr,
                captureC: nc,
                screenR,
                screenC
              });
            }
            break;
          }
        }
      }
    }
  } else if (type === 'pawn') {
    const dir = color === 'w' ? -1 : 1;
    tryAddTarget(r + dir, c);
    if (hasSoldierCrossedRiver(r, color)) {
      tryAddTarget(r, c - 1);
      tryAddTarget(r, c + 1);
    }
  }

  return moves;
}

export function isXiangqiSquareAttackedBy(
  cells: (XiangqiCell | null)[][],
  targetR: number,
  targetC: number,
  attackerColor: PieceColor
): boolean {
  // 1. Soldier (Pawn) attacks:
  // An attacker soldier moves in pawnDir = (attackerColor === 'w' ? -1 : 1)
  const pawnDir = attackerColor === 'w' ? -1 : 1;
  const fromForwardR = targetR - pawnDir;
  if (inXiangqiBounds(fromForwardR, targetC)) {
    const p = cells[fromForwardR][targetC];
    if (p && p.color === attackerColor && p.type === 'pawn') return true;
  }
  // Sideways soldier attack (only if the soldier at (targetR, targetC ± 1) has crossed the river)
  if (hasSoldierCrossedRiver(targetR, attackerColor)) {
    for (const dc of [-1, 1]) {
      const sc = targetC + dc;
      if (inXiangqiBounds(targetR, sc)) {
        const p = cells[targetR][sc];
        if (p && p.color === attackerColor && p.type === 'pawn') return true;
      }
    }
  }

  // 2. Horse (Knight) attacks:
  // Check all 8 potential attacker Horse squares (hr, hc); the blocking leg is adjacent to (hr, hc)!
  for (const j of HORSE_JUMPS) {
    const hr = targetR - j.dr;
    const hc = targetC - j.dc;
    if (!inXiangqiBounds(hr, hc)) continue;
    const p = cells[hr][hc];
    if (p && p.color === attackerColor && p.type === 'knight') {
      const legR = hr + j.legDr;
      const legC = hc + j.legDc;
      if (!cells[legR]?.[legC]) return true;
    }
  }

  // 3. Orthogonal rays: Chariot (Rook), Cannon (exactly 1 screen), and Flying General (King with 0 screens)
  const ortho = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1]
  ];
  for (const [dr, dc] of ortho) {
    let screens = 0;
    for (let step = 1; step < 10; step++) {
      const nr = targetR + dr * step;
      const nc = targetC + dc * step;
      if (!inXiangqiBounds(nr, nc)) break;
      const p = cells[nr][nc];
      if (!p) continue;
      if (screens === 0) {
        if (p.color === attackerColor) {
          if (p.type === 'rook') return true;
          if (p.type === 'king' && (step === 1 || dc === 0)) {
            if (step === 1 && isInsidePalace(targetR, targetC, attackerColor)) return true;
            if (dc === 0) return true; // Flying General along the file
          }
        }
        screens = 1;
      } else if (screens === 1) {
        if (p.color === attackerColor && p.type === 'cannon') return true;
        break;
      }
    }
  }

  // 4. Advisor & Elephant attacks (relevant when non-King squares or unconventional setups are checked)
  const diag = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1]
  ];
  for (const [dr, dc] of diag) {
    const ar = targetR + dr;
    const ac = targetC + dc;
    if (inXiangqiBounds(ar, ac) && isInsidePalace(targetR, targetC, attackerColor)) {
      const p = cells[ar][ac];
      if (p && p.color === attackerColor && p.type === 'advisor') return true;
    }
  }
  for (const j of ELEPHANT_JUMPS) {
    const er = targetR - j.dr;
    const ec = targetC - j.dc;
    if (inXiangqiBounds(er, ec) && isOwnSideOfRiver(targetR, attackerColor)) {
      const p = cells[er][ec];
      if (p && p.color === attackerColor && p.type === 'elephant') {
        if (!cells[er + j.eyeDr]?.[ec + j.eyeDc]) return true;
      }
    }
  }

  return false;
}

export function isXiangqiGeneralInCheck(cells: (XiangqiCell | null)[][], color: PieceColor): boolean {
  const [kingR, kingC] = findGeneralCoords(cells, color);
  if (kingR === -1) return true;
  if (isFlyingGeneralExposed(cells)) return true;
  const oppColor: PieceColor = color === 'w' ? 'b' : 'w';
  return isXiangqiSquareAttackedBy(cells, kingR, kingC, oppColor);
}

export function getXiangqiLegalMovesForPiece(
  cells: (XiangqiCell | null)[][],
  r: number,
  c: number,
  tacticalOnly = false,
  knownKingR?: number,
  knownKingC?: number
): Array<{
  r: number;
  c: number;
  capture: boolean;
  captureR?: number;
  captureC?: number;
  screenR?: number;
  screenC?: number;
  legR?: number;
  legC?: number;
}> {
  const piece = cells[r]?.[c];
  if (!piece) return [];
  const pseudo = getXiangqiPseudoMovesForPiece(cells, r, c);
  const legal: typeof pseudo = [];

  const oppColor: PieceColor = piece.color === 'w' ? 'b' : 'w';
  const isKingPiece = piece.type === 'king';
  let baseKingR = knownKingR ?? -1;
  let baseKingC = knownKingC ?? -1;
  if (!isKingPiece && baseKingR === -1) {
    [baseKingR, baseKingC] = findGeneralCoords(cells, piece.color);
  }

  for (const m of pseudo) {
    if (tacticalOnly && !m.capture) continue;

    const savedDest = cells[m.r][m.c];
    cells[m.r][m.c] = piece;
    cells[r][c] = null;

    const checkR = isKingPiece ? m.r : baseKingR;
    const checkC = isKingPiece ? m.c : baseKingC;
    const inCheck =
      checkR === -1 ||
      isFlyingGeneralExposed(cells) ||
      isXiangqiSquareAttackedBy(cells, checkR, checkC, oppColor);

    cells[r][c] = piece;
    cells[m.r][m.c] = savedDest;

    if (!inCheck) {
      legal.push(m);
    }
  }

  return legal;
}

export function getAllXiangqiLegalMoves(
  cells: (XiangqiCell | null)[][],
  color: PieceColor,
  tacticalOnly = false
): PureXiangqiMove[] {
  const all: PureXiangqiMove[] = [];
  const [kingR, kingC] = findGeneralCoords(cells, color);
  for (let r = 0; r < XIANGQI_ROWS; r++) {
    for (let c = 0; c < XIANGQI_COLS; c++) {
      const p = cells[r]?.[c];
      if (p && p.color === color) {
        const moves = getXiangqiLegalMovesForPiece(cells, r, c, tacticalOnly, kingR, kingC);
        for (const m of moves) {
          all.push({
            fromR: r,
            fromC: c,
            toR: m.r,
            toC: m.c,
            capture: m.capture,
            captureR: m.captureR,
            captureC: m.captureC,
            screenR: m.screenR,
            screenC: m.screenC,
            legR: m.legR,
            legC: m.legC
          });
        }
      }
    }
  }
  return all;
}

export function applyXiangqiMove(
  cells: (XiangqiCell | null)[][],
  move: PureXiangqiMove
): { nextCells: (XiangqiCell | null)[][] } {
  const nextCells = cloneXiangqiBoardRows(cells);
  const moving = nextCells[move.fromR]?.[move.fromC];
  if (!moving) {
    return { nextCells };
  }
  nextCells[move.fromR][move.fromC] = null;
  nextCells[move.toR][move.toC] = {
    type: moving.type,
    color: moving.color,
    hasMoved: true
  };
  return { nextCells };
}

export function computeXiangqiPositionHash(
  cells: (XiangqiCell | null)[][],
  turn: PieceColor
): string {
  const chMap: Record<XiangqiPieceType, string> = {
    king: 'k',
    advisor: 'a',
    elephant: 'e',
    rook: 'r',
    cannon: 'c',
    knight: 'n',
    pawn: 'p'
  };
  const rows: string[] = [];
  for (let r = 0; r < XIANGQI_ROWS; r++) {
    let rowStr = '';
    let empty = 0;
    for (let c = 0; c < XIANGQI_COLS; c++) {
      const p = cells[r]?.[c];
      if (!p) {
        empty++;
      } else {
        if (empty > 0) {
          rowStr += String(empty);
          empty = 0;
        }
        const ch = chMap[p.type] || 'p';
        rowStr += p.color === 'w' ? ch.toUpperCase() : ch;
      }
    }
    if (empty > 0) rowStr += String(empty);
    rows.push(rowStr);
  }
  return `${rows.join('/')} ${turn}`;
}

export function checkXiangqiInsufficientMaterial(cells: (XiangqiCell | null)[][]): boolean {
  for (let r = 0; r < XIANGQI_ROWS; r++) {
    for (let c = 0; c < XIANGQI_COLS; c++) {
      const p = cells[r]?.[c];
      if (!p) continue;
      if (p.type === 'rook' || p.type === 'cannon' || p.type === 'knight' || p.type === 'pawn') {
        return false;
      }
    }
  }
  return true; // Only Kings, Advisors, Elephants remain -> neither side can cross the river to attack
}

export interface XiangqiDrawEvaluation {
  isDraw: boolean;
  reason: '60-Move Rule' | 'Threefold Repetition' | 'Insufficient Material' | null;
}

export function evaluateXiangqiDrawState(
  cells: (XiangqiCell | null)[][],
  turn: PieceColor,
  halfMoveClock: number,
  positionHistory: string[]
): XiangqiDrawEvaluation {
  if (halfMoveClock >= 120) {
    return { isDraw: true, reason: '60-Move Rule' };
  }
  const currentHash = computeXiangqiPositionHash(cells, turn);
  let matches = 0;
  for (const h of positionHistory) {
    if (h === currentHash) matches++;
  }
  if (matches >= 3) {
    return { isDraw: true, reason: 'Threefold Repetition' };
  }
  if (checkXiangqiInsufficientMaterial(cells)) {
    return { isDraw: true, reason: 'Insufficient Material' };
  }
  return { isDraw: false, reason: null };
}

export function evaluateXiangqiBoardStatic(
  cells: (XiangqiCell | null)[][],
  perspectiveColor: PieceColor
): number {
  let redScore = 0;
  let blackScore = 0;

  for (let r = 0; r < XIANGQI_ROWS; r++) {
    for (let c = 0; c < XIANGQI_COLS; c++) {
      const p = cells[r]?.[c];
      if (!p) continue;
      let baseVal = XIANGQI_PIECE_VALUES[p.type] || 0;
      if (p.type === 'pawn' && hasSoldierCrossedRiver(r, p.color)) {
        baseVal += 100; // Soldier doubles in value after crossing Chu River — Han Border
      }
      const pstTable = XIANGQI_PST_MAP[p.type];
      const pstRow = p.color === 'w' ? r : 9 - r;
      const pstBonus = pstTable?.[pstRow]?.[c] ?? 0;
      if (p.color === 'w') {
        redScore += baseVal + pstBonus;
      } else {
        blackScore += baseVal + pstBonus;
      }
    }
  }

  const diff = redScore - blackScore;
  return perspectiveColor === 'w' ? diff : -diff;
}

function scoreXiangqiMoveForOrdering(
  cells: (XiangqiCell | null)[][],
  move: PureXiangqiMove,
  oppKingR: number,
  oppKingC: number
): number {
  let score = 0;
  const attacker = cells[move.fromR]?.[move.fromC];
  const victim = cells[move.toR]?.[move.toC];

  if (move.capture && victim && attacker) {
    score += 1200 + XIANGQI_PIECE_VALUES[victim.type] * 10 - XIANGQI_PIECE_VALUES[attacker.type];
  }
  if (typeof move.screenR === 'number') {
    score += 45; // Prioritize Cannon tactical shots
  }
  const centerDist = Math.abs(4.5 - move.toR) + Math.abs(4.0 - move.toC);
  score += (9 - centerDist) * 3;

  if (attacker && oppKingR !== -1) {
    const kingDist = Math.abs(oppKingR - move.toR) + Math.abs(oppKingC - move.toC);
    score += (16 - kingDist) * 2;
  }
  return score;
}

function sortXiangqiMovesForOrdering(
  cells: (XiangqiCell | null)[][],
  moves: PureXiangqiMove[],
  oppColor: PieceColor
): PureXiangqiMove[] {
  if (moves.length <= 1) return moves;
  const [oppKingR, oppKingC] = findGeneralCoords(cells, oppColor);
  return moves.sort(
    (a, b) =>
      scoreXiangqiMoveForOrdering(cells, b, oppKingR, oppKingC) -
      scoreXiangqiMoveForOrdering(cells, a, oppKingR, oppKingC)
  );
}

function quiescenceXiangqiSearch(
  cells: (XiangqiCell | null)[][],
  alpha: number,
  beta: number,
  turn: PieceColor,
  qDepth: number
): number {
  const standPat = evaluateXiangqiBoardStatic(cells, turn);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  if (qDepth <= 0) return alpha;

  const oppColor: PieceColor = turn === 'w' ? 'b' : 'w';
  const tacticalMoves = sortXiangqiMovesForOrdering(
    cells,
    getAllXiangqiLegalMoves(cells, turn, true),
    oppColor
  );

  for (const m of tacticalMoves) {
    const { nextCells } = applyXiangqiMove(cells, m);
    const score = -quiescenceXiangqiSearch(nextCells, -beta, -alpha, oppColor, qDepth - 1);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function alphaBetaXiangqiNegamax(
  cells: (XiangqiCell | null)[][],
  depth: number,
  plyFromRoot: number,
  alpha: number,
  beta: number,
  turn: PieceColor,
  maxQuiescenceDepth: number
): number {
  const legalMoves = getAllXiangqiLegalMoves(cells, turn);
  // In Xiangqi, having 0 legal moves (whether in Check or Stalemate / Khốn Tướng) is an immediate LOSS!
  if (legalMoves.length === 0) {
    return -19000 + plyFromRoot * 20;
  }

  if (depth <= 0) {
    if (maxQuiescenceDepth > 0) {
      return quiescenceXiangqiSearch(cells, alpha, beta, turn, maxQuiescenceDepth);
    }
    return evaluateXiangqiBoardStatic(cells, turn);
  }

  const oppColor: PieceColor = turn === 'w' ? 'b' : 'w';
  sortXiangqiMovesForOrdering(cells, legalMoves, oppColor);
  let best = -Infinity;

  for (const m of legalMoves) {
    const { nextCells } = applyXiangqiMove(cells, m);
    const val = -alphaBetaXiangqiNegamax(
      nextCells,
      depth - 1,
      plyFromRoot + 1,
      -beta,
      -alpha,
      oppColor,
      maxQuiescenceDepth
    );
    if (val > best) best = val;
    if (val > alpha) alpha = val;
    if (alpha >= beta) break;
  }
  return best;
}

export function chooseBestXiangqiMove(
  cells: (XiangqiCell | null)[][],
  color: PieceColor,
  difficulty: AIDifficulty = 'tactical'
): PureXiangqiMove | null {
  const legalMoves = getAllXiangqiLegalMoves(cells, color);
  if (legalMoves.length === 0) return null;
  if (legalMoves.length === 1) return legalMoves[0];

  const searchDepth = difficulty === 'grandmaster' ? 3 : difficulty === 'tactical' ? 2 : 1;
  const quiescenceDepth = difficulty === 'grandmaster' ? 2 : difficulty === 'tactical' ? 1 : 0;
  const jitterAmp = difficulty === 'novice' ? 28 : difficulty === 'tactical' ? 3 : 0;

  const oppColor: PieceColor = color === 'w' ? 'b' : 'w';
  sortXiangqiMovesForOrdering(cells, legalMoves, oppColor);

  let bestScore = -Infinity;
  let bestCandidates: PureXiangqiMove[] = [];

  for (const m of legalMoves) {
    const { nextCells } = applyXiangqiMove(cells, m);
    const rootAlpha = Number.isFinite(bestScore) ? bestScore - jitterAmp - 1 : -Infinity;
    let score = -alphaBetaXiangqiNegamax(
      nextCells,
      searchDepth - 1,
      1,
      -Infinity,
      -rootAlpha,
      oppColor,
      quiescenceDepth
    );

    if (jitterAmp > 0) {
      score += (Math.random() - 0.5) * jitterAmp;
    }

    if (score > bestScore + 0.5) {
      bestScore = score;
      bestCandidates = [m];
    } else if (Math.abs(score - bestScore) <= 0.5) {
      bestCandidates.push(m);
    }
  }

  if (jitterAmp === 0) {
    return bestCandidates[0] || legalMoves[0];
  }
  return bestCandidates[Math.floor(Math.random() * bestCandidates.length)] || legalMoves[0];
}

interface AsyncXiangqiSearchContext {
  nodes: number;
  nodesSinceYield: number;
  yieldCount: number;
  lastYieldTime: number;
  timeBudgetMs: number;
  maxNodesPerSlice: number;
  shouldCancel?: () => boolean;
  cancelled: boolean;
}

function getNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

async function maybeYieldXiangqiSearch(
  ctx: AsyncXiangqiSearchContext,
  forceYield = false
): Promise<boolean> {
  if (ctx.cancelled) return true;
  if (ctx.shouldCancel && ctx.shouldCancel()) {
    ctx.cancelled = true;
    return true;
  }
  ctx.nodes++;
  ctx.nodesSinceYield++;
  const elapsed = getNowMs() - ctx.lastYieldTime;
  if (forceYield || elapsed >= ctx.timeBudgetMs || ctx.nodesSinceYield >= ctx.maxNodesPerSlice) {
    ctx.yieldCount++;
    ctx.nodesSinceYield = 0;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    ctx.lastYieldTime = getNowMs();
    if (ctx.shouldCancel && ctx.shouldCancel()) {
      ctx.cancelled = true;
      return true;
    }
  }
  return false;
}

async function quiescenceXiangqiSearchAsync(
  cells: (XiangqiCell | null)[][],
  alpha: number,
  beta: number,
  turn: PieceColor,
  qDepth: number,
  ctx: AsyncXiangqiSearchContext
): Promise<number> {
  if (await maybeYieldXiangqiSearch(ctx)) return alpha;
  const standPat = evaluateXiangqiBoardStatic(cells, turn);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  if (qDepth <= 0) return alpha;

  const oppColor: PieceColor = turn === 'w' ? 'b' : 'w';
  const tacticalMoves = sortXiangqiMovesForOrdering(
    cells,
    getAllXiangqiLegalMoves(cells, turn, true),
    oppColor
  );
  if (getNowMs() - ctx.lastYieldTime >= ctx.timeBudgetMs && (await maybeYieldXiangqiSearch(ctx))) {
    return alpha;
  }

  for (const m of tacticalMoves) {
    if (ctx.cancelled) return alpha;
    const { nextCells } = applyXiangqiMove(cells, m);
    const score = -(await quiescenceXiangqiSearchAsync(
      nextCells,
      -beta,
      -alpha,
      oppColor,
      qDepth - 1,
      ctx
    ));
    if (ctx.cancelled) return alpha;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

async function alphaBetaXiangqiNegamaxAsync(
  cells: (XiangqiCell | null)[][],
  depth: number,
  plyFromRoot: number,
  alpha: number,
  beta: number,
  turn: PieceColor,
  maxQuiescenceDepth: number,
  ctx: AsyncXiangqiSearchContext
): Promise<number> {
  if (await maybeYieldXiangqiSearch(ctx)) return alpha;
  const legalMoves = getAllXiangqiLegalMoves(cells, turn);
  if (legalMoves.length === 0) {
    return -19000 + plyFromRoot * 20;
  }

  if (depth <= 0) {
    if (maxQuiescenceDepth > 0) {
      return quiescenceXiangqiSearchAsync(cells, alpha, beta, turn, maxQuiescenceDepth, ctx);
    }
    return evaluateXiangqiBoardStatic(cells, turn);
  }

  const oppColor: PieceColor = turn === 'w' ? 'b' : 'w';
  sortXiangqiMovesForOrdering(cells, legalMoves, oppColor);
  if (getNowMs() - ctx.lastYieldTime >= ctx.timeBudgetMs && (await maybeYieldXiangqiSearch(ctx))) {
    return alpha;
  }
  let best = -Infinity;

  for (const m of legalMoves) {
    if (ctx.cancelled) return best;
    const { nextCells } = applyXiangqiMove(cells, m);
    const val = -(await alphaBetaXiangqiNegamaxAsync(
      nextCells,
      depth - 1,
      plyFromRoot + 1,
      -beta,
      -alpha,
      oppColor,
      maxQuiescenceDepth,
      ctx
    ));
    if (ctx.cancelled) return best;
    if (val > best) best = val;
    if (val > alpha) alpha = val;
    if (alpha >= beta) break;
  }
  return best;
}

export async function chooseBestXiangqiMoveAsync(
  cells: (XiangqiCell | null)[][],
  color: PieceColor,
  difficulty: AIDifficulty = 'tactical',
  options: AsyncAISearchOptions = {}
): Promise<PureXiangqiMove | null> {
  const startMs = getNowMs();
  if (options.shouldCancel?.()) return null;
  const legalMoves = getAllXiangqiLegalMoves(cells, color);
  if (legalMoves.length === 0) return null;
  if (legalMoves.length === 1) return legalMoves[0];

  const searchDepth = difficulty === 'grandmaster' ? 3 : difficulty === 'tactical' ? 2 : 1;
  const quiescenceDepth = difficulty === 'grandmaster' ? 2 : difficulty === 'tactical' ? 1 : 0;
  const jitterAmp = difficulty === 'novice' ? 28 : difficulty === 'tactical' ? 3 : 0;

  const oppColor: PieceColor = color === 'w' ? 'b' : 'w';
  sortXiangqiMovesForOrdering(cells, legalMoves, oppColor);

  const timeBudgetMs = Math.max(1, options.timeSliceMs ?? options.timeBudgetMs ?? 4);
  const ctx: AsyncXiangqiSearchContext = {
    nodes: 0,
    nodesSinceYield: 0,
    yieldCount: 0,
    lastYieldTime: startMs,
    timeBudgetMs,
    maxNodesPerSlice: Math.max(32, Math.floor(timeBudgetMs * 48)),
    shouldCancel: options.shouldCancel,
    cancelled: false
  };

  if (await maybeYieldXiangqiSearch(ctx, true)) return null;

  let bestScore = -Infinity;
  let bestCandidates: PureXiangqiMove[] = [];

  for (const m of legalMoves) {
    if (await maybeYieldXiangqiSearch(ctx)) return null;
    const { nextCells } = applyXiangqiMove(cells, m);
    const rootAlpha = Number.isFinite(bestScore) ? bestScore - jitterAmp - 1 : -Infinity;
    let score = -(await alphaBetaXiangqiNegamaxAsync(
      nextCells,
      searchDepth - 1,
      1,
      -Infinity,
      -rootAlpha,
      oppColor,
      quiescenceDepth,
      ctx
    ));
    if (ctx.cancelled || options.shouldCancel?.()) return null;

    if (jitterAmp > 0) {
      score += (Math.random() - 0.5) * jitterAmp;
    }

    if (score > bestScore + 0.5) {
      bestScore = score;
      bestCandidates = [m];
    } else if (Math.abs(score - bestScore) <= 0.5) {
      bestCandidates.push(m);
    }
  }

  if (ctx.cancelled || options.shouldCancel?.()) return null;
  if (jitterAmp === 0) {
    return bestCandidates[0] || legalMoves[0];
  }
  return bestCandidates[Math.floor(Math.random() * bestCandidates.length)] || legalMoves[0];
}
