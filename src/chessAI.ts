export type PieceType = 'pawn' | 'rook' | 'knight' | 'bishop' | 'queen' | 'king';
export type PieceColor = 'w' | 'b';
export type AIDifficulty = 'novice' | 'tactical' | 'grandmaster';

export interface PureCell {
  type: PieceType;
  color: PieceColor;
  hasMoved?: boolean;
}

export interface EnPassantTarget {
  r: number;
  c: number;
  pawnR: number;
  pawnC: number;
  color: PieceColor;
}

export interface PureChessMove {
  fromR: number;
  fromC: number;
  toR: number;
  toC: number;
  capture: boolean;
  enPassant?: boolean;
  captureR?: number;
  captureC?: number;
  castle?: 'k' | 'q';
  rookFromC?: number;
  rookToC?: number;
  promotion?: PieceType;
}

export interface DrawEvaluation {
  isDraw: boolean;
  reason: '50-Move Rule' | 'Threefold Repetition' | 'Insufficient Material' | null;
}

export const PIECE_VALUES: Record<PieceType, number> = {
  pawn: 100,
  knight: 320,
  bishop: 330,
  rook: 500,
  queen: 900,
  king: 20000
};

// Piece-Square Tables from White's perspective (row 0 = top/rank 8, row 7 = bottom/rank 1)
const PAWN_PST = [
  [  0,  0,  0,  0,  0,  0,  0,  0],
  [ 50, 50, 50, 50, 50, 50, 50, 50],
  [ 12, 12, 22, 32, 32, 22, 12, 12],
  [  6,  6, 12, 26, 26, 12,  6,  6],
  [  0,  0,  4, 22, 22,  4,  0,  0],
  [  4, -4, -8,  0,  0, -8, -4,  4],
  [  4, 10, 10,-20,-20, 10, 10,  4],
  [  0,  0,  0,  0,  0,  0,  0,  0]
];

const KNIGHT_PST = [
  [-50,-40,-30,-30,-30,-30,-40,-50],
  [-40,-20,  0,  0,  0,  0,-20,-40],
  [-30,  0, 12, 16, 16, 12,  0,-30],
  [-30,  6, 16, 22, 22, 16,  6,-30],
  [-30,  0, 16, 22, 22, 16,  0,-30],
  [-30,  6, 12, 16, 16, 12,  6,-30],
  [-40,-20,  0,  6,  6,  0,-20,-40],
  [-50,-40,-30,-30,-30,-30,-40,-50]
];

const BISHOP_PST = [
  [-20,-10,-10,-10,-10,-10,-10,-20],
  [-10,  0,  0,  0,  0,  0,  0,-10],
  [-10,  0,  8, 12, 12,  8,  0,-10],
  [-10,  6,  6, 12, 12,  6,  6,-10],
  [-10,  0, 12, 12, 12, 12,  0,-10],
  [-10, 10, 10, 12, 12, 10, 10,-10],
  [-10,  6,  0,  0,  0,  0,  6,-10],
  [-20,-10,-10,-10,-10,-10,-10,-20]
];

const ROOK_PST = [
  [  0,  0,  0,  2,  2,  0,  0,  0],
  [  6, 12, 12, 12, 12, 12, 12,  6],
  [ -4,  0,  0,  0,  0,  0,  0, -4],
  [ -4,  0,  0,  0,  0,  0,  0, -4],
  [ -4,  0,  0,  0,  0,  0,  0, -4],
  [ -4,  0,  0,  0,  0,  0,  0, -4],
  [ -4,  0,  0,  0,  0,  0,  0, -4],
  [  0,  0,  2,  8,  8,  2,  0,  0]
];

const QUEEN_PST = [
  [-20,-10,-10, -5, -5,-10,-10,-20],
  [-10,  0,  0,  0,  0,  0,  0,-10],
  [-10,  0,  6,  6,  6,  6,  0,-10],
  [ -5,  0,  6,  8,  8,  6,  0, -5],
  [  0,  0,  6,  8,  8,  6,  0, -5],
  [-10,  6,  6,  6,  6,  6,  0,-10],
  [-10,  0,  6,  0,  0,  0,  0,-10],
  [-20,-10,-10, -5, -5,-10,-10,-20]
];

const KING_PST = [
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-20,-30,-30,-40,-40,-30,-30,-20],
  [-10,-20,-20,-20,-20,-20,-20,-10],
  [ 18, 18,  0,  0,  0,  0, 18, 18],
  [ 20, 30, 12,  0,  0, 12, 30, 20]
];

const PST_MAP: Record<PieceType, number[][]> = {
  pawn: PAWN_PST,
  knight: KNIGHT_PST,
  bishop: BISHOP_PST,
  rook: ROOK_PST,
  queen: QUEEN_PST,
  king: KING_PST
};

export function extractPureBoard(boardState: any[][]): (PureCell | null)[][] {
  const pure: (PureCell | null)[][] = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 8; r++) {
    const row = boardState[r];
    if (!row) continue;
    for (let c = 0; c < 8; c++) {
      const p = row[c];
      if (p) {
        pure[r][c] = {
          type: p.type,
          color: p.color,
          hasMoved: Boolean(p.hasMoved)
        };
      }
    }
  }
  return pure;
}

export function clonePureBoard(cells: (PureCell | null)[][]): (PureCell | null)[][] {
  const copy: (PureCell | null)[][] = new Array(8);
  for (let r = 0; r < 8; r++) {
    const srcRow = cells[r];
    const dstRow: (PureCell | null)[] = new Array(8);
    for (let c = 0; c < 8; c++) {
      const cell = srcRow[c];
      dstRow[c] = cell ? { type: cell.type, color: cell.color, hasMoved: cell.hasMoved } : null;
    }
    copy[r] = dstRow;
  }
  return copy;
}

function cloneBoardRows(cells: (PureCell | null)[][]): (PureCell | null)[][] {
  return [
    cells[0].slice(),
    cells[1].slice(),
    cells[2].slice(),
    cells[3].slice(),
    cells[4].slice(),
    cells[5].slice(),
    cells[6].slice(),
    cells[7].slice()
  ];
}

function findKingCoords(cells: (PureCell | null)[][], color: PieceColor): [number, number] {
  for (let r = 0; r < 8; r++) {
    const row = cells[r];
    for (let c = 0; c < 8; c++) {
      const p = row[c];
      if (p && p.color === color && p.type === 'king') {
        return [r, c];
      }
    }
  }
  return [-1, -1];
}

export function getPurePseudoMovesForPiece(
  cells: (PureCell | null)[][],
  r: number,
  c: number,
  enPassantTarget: EnPassantTarget | null = null
): Array<{
  r: number;
  c: number;
  capture: boolean;
  enPassant?: boolean;
  captureR?: number;
  captureC?: number;
}> {
  const piece = cells[r]?.[c];
  if (!piece) return [];
  const moves: Array<{
    r: number;
    c: number;
    capture: boolean;
    enPassant?: boolean;
    captureR?: number;
    captureC?: number;
  }> = [];
  const { type, color } = piece;
  const dir = color === 'w' ? -1 : 1;

  const inBounds = (nr: number, nc: number) => nr >= 0 && nr < 8 && nc >= 0 && nc < 8;
  const addMove = (nr: number, nc: number) => {
    if (!inBounds(nr, nc)) return false;
    const target = cells[nr][nc];
    if (!target) {
      moves.push({ r: nr, c: nc, capture: false });
      return true;
    } else if (target.color !== color) {
      moves.push({ r: nr, c: nc, capture: true, captureR: nr, captureC: nc });
      return false;
    }
    return false;
  };

  if (type === 'pawn') {
    if (inBounds(r + dir, c) && !cells[r + dir][c]) {
      moves.push({ r: r + dir, c, capture: false });
      const startRow = color === 'w' ? 6 : 1;
      if (r === startRow && inBounds(r + dir * 2, c) && !cells[r + dir * 2][c]) {
        moves.push({ r: r + dir * 2, c, capture: false });
      }
    }
    for (const dc of [-1, 1]) {
      if (inBounds(r + dir, c + dc)) {
        const target = cells[r + dir][c + dc];
        if (target && target.color !== color) {
          moves.push({ r: r + dir, c: c + dc, capture: true, captureR: r + dir, captureC: c + dc });
        } else if (
          !target &&
          enPassantTarget &&
          enPassantTarget.color !== color &&
          enPassantTarget.r === r + dir &&
          enPassantTarget.c === c + dc &&
          enPassantTarget.pawnR === r &&
          enPassantTarget.pawnC === c + dc
        ) {
          const epPawn = cells[enPassantTarget.pawnR]?.[enPassantTarget.pawnC];
          if (epPawn && epPawn.type === 'pawn' && epPawn.color !== color) {
            moves.push({
              r: r + dir,
              c: c + dc,
              capture: true,
              enPassant: true,
              captureR: enPassantTarget.pawnR,
              captureC: enPassantTarget.pawnC
            });
          }
        }
      }
    }
  } else if (type === 'knight') {
    const jumps = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];
    for (const [dr, dc] of jumps) addMove(r + dr, c + dc);
  } else if (type === 'king') {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr !== 0 || dc !== 0) addMove(r + dr, c + dc);
      }
    }
  } else {
    const dirs: number[][] = [];
    if (type === 'rook' || type === 'queen') dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
    if (type === 'bishop' || type === 'queen') dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
    for (const [dr, dc] of dirs) {
      for (let step = 1; step < 8; step++) {
        if (!addMove(r + dr * step, c + dc * step)) break;
      }
    }
  }
  return moves;
}

export function isSquareAttackedBy(
  cells: (PureCell | null)[][],
  targetR: number,
  targetC: number,
  attackerColor: PieceColor
): boolean {
  // 1. Pawn attacks: an attacker pawn at (pawnR, targetC ± 1) moves in dir = (attackerColor === 'w' ? -1 : 1) to reach targetR
  const pawnDir = attackerColor === 'w' ? -1 : 1;
  const pawnR = targetR - pawnDir;
  if (pawnR >= 0 && pawnR < 8) {
    if (targetC - 1 >= 0) {
      const pL = cells[pawnR][targetC - 1];
      if (pL && pL.color === attackerColor && pL.type === 'pawn') return true;
    }
    if (targetC + 1 < 8) {
      const pR = cells[pawnR][targetC + 1];
      if (pR && pR.color === attackerColor && pR.type === 'pawn') return true;
    }
  }

  // 2. Knight attacks
  const knightJumps = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1]
  ];
  for (let i = 0; i < 8; i++) {
    const nr = targetR + knightJumps[i][0];
    const nc = targetC + knightJumps[i][1];
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = cells[nr][nc];
      if (p && p.color === attackerColor && p.type === 'knight') return true;
    }
  }

  // 3. King attacks
  for (let dr = -1; dr <= 1; dr++) {
    const nr = targetR + dr;
    if (nr < 0 || nr >= 8) continue;
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nc = targetC + dc;
      if (nc >= 0 && nc < 8) {
        const p = cells[nr][nc];
        if (p && p.color === attackerColor && p.type === 'king') return true;
      }
    }
  }

  // 4. Orthogonal sliding attacks (Rook / Queen)
  const orthoDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let i = 0; i < 4; i++) {
    const dr = orthoDirs[i][0];
    const dc = orthoDirs[i][1];
    for (let step = 1; step < 8; step++) {
      const nr = targetR + dr * step;
      const nc = targetC + dc * step;
      if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
      const p = cells[nr][nc];
      if (p) {
        if (p.color === attackerColor && (p.type === 'rook' || p.type === 'queen')) return true;
        break;
      }
    }
  }

  // 5. Diagonal sliding attacks (Bishop / Queen)
  const diagDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (let i = 0; i < 4; i++) {
    const dr = diagDirs[i][0];
    const dc = diagDirs[i][1];
    for (let step = 1; step < 8; step++) {
      const nr = targetR + dr * step;
      const nc = targetC + dc * step;
      if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
      const p = cells[nr][nc];
      if (p) {
        if (p.color === attackerColor && (p.type === 'bishop' || p.type === 'queen')) return true;
        break;
      }
    }
  }

  return false;
}

export function isPureKingInCheck(cells: (PureCell | null)[][], color: PieceColor): boolean {
  const [kingR, kingC] = findKingCoords(cells, color);
  if (kingR === -1) return true;
  const oppColor: PieceColor = color === 'w' ? 'b' : 'w';
  return isSquareAttackedBy(cells, kingR, kingC, oppColor);
}

export function getPureLegalMovesForPiece(
  cells: (PureCell | null)[][],
  r: number,
  c: number,
  enPassantTarget: EnPassantTarget | null = null,
  tacticalOnly = false,
  knownKingR?: number,
  knownKingC?: number
): Array<{
  r: number;
  c: number;
  capture: boolean;
  enPassant?: boolean;
  captureR?: number;
  captureC?: number;
  castle?: 'k' | 'q';
  rookFromC?: number;
  rookToC?: number;
}> {
  const piece = cells[r]?.[c];
  if (!piece) return [];
  const pseudo = getPurePseudoMovesForPiece(cells, r, c, enPassantTarget);
  const legal: Array<{
    r: number;
    c: number;
    capture: boolean;
    enPassant?: boolean;
    captureR?: number;
    captureC?: number;
    castle?: 'k' | 'q';
    rookFromC?: number;
    rookToC?: number;
  }> = [];

  const oppColor: PieceColor = piece.color === 'w' ? 'b' : 'w';
  const isKingPiece = piece.type === 'king';
  let baseKingR = knownKingR ?? -1;
  let baseKingC = knownKingC ?? -1;
  if (!isKingPiece && baseKingR === -1) {
    [baseKingR, baseKingC] = findKingCoords(cells, piece.color);
  }

  for (const m of pseudo) {
    if (tacticalOnly) {
      const isPromo = piece.type === 'pawn' && (m.r === 0 || m.r === 7);
      if (!m.capture && !isPromo) continue;
    }
    const savedDest = cells[m.r][m.c];
    const hasEp = Boolean(m.enPassant && typeof m.captureR === 'number' && typeof m.captureC === 'number');
    const epR = hasEp ? (m.captureR as number) : -1;
    const epC = hasEp ? (m.captureC as number) : -1;
    const savedEp = hasEp ? cells[epR][epC] : null;

    if (hasEp) {
      cells[epR][epC] = null;
    }
    cells[m.r][m.c] = piece;
    cells[r][c] = null;
    const checkR = isKingPiece ? m.r : baseKingR;
    const checkC = isKingPiece ? m.c : baseKingC;
    const inCheck = checkR === -1 ? true : isSquareAttackedBy(cells, checkR, checkC, oppColor);
    cells[r][c] = piece;
    cells[m.r][m.c] = savedDest;
    if (hasEp) {
      cells[epR][epC] = savedEp;
    }

    if (!inCheck) {
      legal.push(m);
    }
  }

  if (tacticalOnly) {
    return legal;
  }

  // Castling (Kingside O-O to c=6, Queenside O-O-O to c=2)
  const homeRow = piece.color === 'w' ? 7 : 0;
  if (
    isKingPiece &&
    !piece.hasMoved &&
    r === homeRow &&
    c === 4 &&
    !isSquareAttackedBy(cells, homeRow, 4, oppColor)
  ) {
    const kRook = cells[homeRow][7];
    if (
      kRook &&
      kRook.type === 'rook' &&
      kRook.color === piece.color &&
      !kRook.hasMoved &&
      !cells[homeRow][5] &&
      !cells[homeRow][6]
    ) {
      cells[homeRow][5] = piece;
      cells[homeRow][4] = null;
      const checkF = isSquareAttackedBy(cells, homeRow, 5, oppColor);
      cells[homeRow][5] = null;
      cells[homeRow][6] = piece;
      const checkG = isSquareAttackedBy(cells, homeRow, 6, oppColor);
      cells[homeRow][6] = null;
      cells[homeRow][4] = piece;

      if (!checkF && !checkG) {
        legal.push({ r: homeRow, c: 6, capture: false, castle: 'k', rookFromC: 7, rookToC: 5 });
      }
    }

    const qRook = cells[homeRow][0];
    if (
      qRook &&
      qRook.type === 'rook' &&
      qRook.color === piece.color &&
      !qRook.hasMoved &&
      !cells[homeRow][1] &&
      !cells[homeRow][2] &&
      !cells[homeRow][3]
    ) {
      cells[homeRow][3] = piece;
      cells[homeRow][4] = null;
      const checkD = isSquareAttackedBy(cells, homeRow, 3, oppColor);
      cells[homeRow][3] = null;
      cells[homeRow][2] = piece;
      const checkC = isSquareAttackedBy(cells, homeRow, 2, oppColor);
      cells[homeRow][2] = null;
      cells[homeRow][4] = piece;

      if (!checkD && !checkC) {
        legal.push({ r: homeRow, c: 2, capture: false, castle: 'q', rookFromC: 0, rookToC: 3 });
      }
    }
  }

  return legal;
}

export function getAllPureLegalMoves(
  cells: (PureCell | null)[][],
  color: PieceColor,
  enPassantTarget: EnPassantTarget | null = null,
  tacticalOnly = false
): PureChessMove[] {
  const all: PureChessMove[] = [];
  const [kingR, kingC] = findKingCoords(cells, color);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = cells[r]?.[c];
      if (p && p.color === color) {
        const moves = getPureLegalMovesForPiece(cells, r, c, enPassantTarget, tacticalOnly, kingR, kingC);
        for (const m of moves) {
          const isPromo = p.type === 'pawn' && (m.r === 0 || m.r === 7);
          if (isPromo) {
            for (const promo of ['queen', 'rook', 'bishop', 'knight'] as PieceType[]) {
              all.push({
                fromR: r,
                fromC: c,
                toR: m.r,
                toC: m.c,
                capture: m.capture,
                enPassant: m.enPassant,
                captureR: m.captureR,
                captureC: m.captureC,
                castle: m.castle,
                rookFromC: m.rookFromC,
                rookToC: m.rookToC,
                promotion: promo
              });
            }
          } else {
            all.push({
              fromR: r,
              fromC: c,
              toR: m.r,
              toC: m.c,
              capture: m.capture,
              enPassant: m.enPassant,
              captureR: m.captureR,
              captureC: m.captureC,
              castle: m.castle,
              rookFromC: m.rookFromC,
              rookToC: m.rookToC
            });
          }
        }
      }
    }
  }
  return all;
}

export function applyPureMove(
  cells: (PureCell | null)[][],
  move: PureChessMove
): { nextCells: (PureCell | null)[][]; nextEnPassant: EnPassantTarget | null } {
  const nextCells = cloneBoardRows(cells);
  const moving = nextCells[move.fromR]?.[move.fromC];
  if (!moving) {
    return { nextCells, nextEnPassant: null };
  }

  if (move.enPassant && typeof move.captureR === 'number' && typeof move.captureC === 'number') {
    nextCells[move.captureR][move.captureC] = null;
  }

  nextCells[move.fromR][move.fromC] = null;
  const finalType: PieceType =
    moving.type === 'pawn' && (move.toR === 0 || move.toR === 7)
      ? move.promotion || 'queen'
      : moving.type;
  nextCells[move.toR][move.toC] = {
    type: finalType,
    color: moving.color,
    hasMoved: true
  };

  // Castling rook transfer
  if (moving.type === 'king' && move.fromR === move.toR && Math.abs(move.toC - move.fromC) === 2) {
    const rFromC = move.toC > move.fromC ? 7 : 0;
    const rToC = move.toC > move.fromC ? 5 : 3;
    const rook = nextCells[move.fromR][rFromC];
    if (rook) {
      nextCells[move.fromR][rFromC] = null;
      nextCells[move.fromR][rToC] = { ...rook, hasMoved: true };
    }
  }

  let nextEnPassant: EnPassantTarget | null = null;
  if (moving.type === 'pawn' && Math.abs(move.toR - move.fromR) === 2) {
    nextEnPassant = {
      r: (move.fromR + move.toR) / 2,
      c: move.fromC,
      pawnR: move.toR,
      pawnC: move.toC,
      color: moving.color
    };
  }

  return { nextCells, nextEnPassant };
}

export function computePositionHash(
  cells: (PureCell | null)[][],
  turn: PieceColor,
  enPassantTarget: EnPassantTarget | null = null
): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let rowStr = '';
    let emptyCount = 0;
    for (let c = 0; c < 8; c++) {
      const p = cells[r]?.[c];
      if (!p) {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          rowStr += String(emptyCount);
          emptyCount = 0;
        }
        const chMap: Record<PieceType, string> = {
          pawn: 'p',
          rook: 'r',
          knight: 'n',
          bishop: 'b',
          queen: 'q',
          king: 'k'
        };
        const ch = chMap[p.type] || 'p';
        rowStr += p.color === 'w' ? ch.toUpperCase() : ch;
      }
    }
    if (emptyCount > 0) rowStr += String(emptyCount);
    rows.push(rowStr);
  }

  const wKing = cells[7]?.[4];
  const wKR = cells[7]?.[7];
  const wQR = cells[7]?.[0];
  const bKing = cells[0]?.[4];
  const bKR = cells[0]?.[7];
  const bQR = cells[0]?.[0];
  let castleRights = '';
  if (wKing?.type === 'king' && wKing.color === 'w' && !wKing.hasMoved) {
    if (wKR?.type === 'rook' && wKR.color === 'w' && !wKR.hasMoved) castleRights += 'K';
    if (wQR?.type === 'rook' && wQR.color === 'w' && !wQR.hasMoved) castleRights += 'Q';
  }
  if (bKing?.type === 'king' && bKing.color === 'b' && !bKing.hasMoved) {
    if (bKR?.type === 'rook' && bKR.color === 'b' && !bKR.hasMoved) castleRights += 'k';
    if (bQR?.type === 'rook' && bQR.color === 'b' && !bQR.hasMoved) castleRights += 'q';
  }
  if (!castleRights) castleRights = '-';

  const epStr = enPassantTarget ? `${enPassantTarget.r},${enPassantTarget.c}` : '-';
  return `${rows.join('/')} ${turn} ${castleRights} ${epStr}`;
}

export function checkInsufficientMaterial(cells: (PureCell | null)[][]): boolean {
  const pieces: Array<{ type: PieceType; color: PieceColor; r: number; c: number }> = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = cells[r]?.[c];
      if (p) pieces.push({ type: p.type, color: p.color, r, c });
    }
  }

  const nonKings = pieces.filter((p) => p.type !== 'king');
  if (nonKings.length === 0) return true; // K vs K
  if (nonKings.length === 1) {
    const only = nonKings[0].type;
    if (only === 'bishop' || only === 'knight') return true; // K+B vs K or K+N vs K
  }
  if (nonKings.length === 2) {
    const [a, b] = nonKings;
    if (a.type === 'bishop' && b.type === 'bishop' && a.color !== b.color) {
      const colorA = (a.r + a.c) % 2;
      const colorB = (b.r + b.c) % 2;
      if (colorA === colorB) return true; // K+B vs K+B on same square color
    }
  }
  return false;
}

export function evaluateDrawState(
  cells: (PureCell | null)[][],
  turn: PieceColor,
  halfMoveClock: number,
  positionHistory: string[],
  enPassantTarget: EnPassantTarget | null = null
): DrawEvaluation {
  if (halfMoveClock >= 100) {
    return { isDraw: true, reason: '50-Move Rule' };
  }
  if (checkInsufficientMaterial(cells)) {
    return { isDraw: true, reason: 'Insufficient Material' };
  }
  const currentHash = computePositionHash(cells, turn, enPassantTarget);
  let matches = 0;
  for (const h of positionHistory) {
    if (h === currentHash) matches++;
  }
  if (matches >= 3) {
    return { isDraw: true, reason: 'Threefold Repetition' };
  }
  return { isDraw: false, reason: null };
}

export function evaluateBoardStatic(cells: (PureCell | null)[][], perspectiveColor: PieceColor): number {
  let whiteScore = 0;
  let blackScore = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = cells[r]?.[c];
      if (!p) continue;
      const baseVal = PIECE_VALUES[p.type] || 0;
      const pstTable = PST_MAP[p.type];
      const pstRow = p.color === 'w' ? r : 7 - r;
      const pstBonus = pstTable ? pstTable[pstRow][c] : 0;
      if (p.color === 'w') {
        whiteScore += baseVal + pstBonus;
      } else {
        blackScore += baseVal + pstBonus;
      }
    }
  }

  const diff = whiteScore - blackScore;
  return perspectiveColor === 'w' ? diff : -diff;
}

function scoreMoveForOrdering(
  cells: (PureCell | null)[][],
  move: PureChessMove,
  oppKingR: number,
  oppKingC: number
): number {
  let score = 0;
  const attacker = cells[move.fromR]?.[move.fromC];
  const victim =
    move.enPassant && typeof move.captureR === 'number' && typeof move.captureC === 'number'
      ? cells[move.captureR]?.[move.captureC]
      : cells[move.toR]?.[move.toC];

  if (move.promotion) {
    score += PIECE_VALUES[move.promotion] || 900;
  }
  if (move.capture && victim && attacker) {
    // MVV-LVA (Most Valuable Victim - Least Valuable Attacker)
    score += 1000 + PIECE_VALUES[victim.type] * 10 - PIECE_VALUES[attacker.type];
  }
  if (move.castle) {
    score += 120;
  }
  const centerDist = Math.abs(3.5 - move.toR) + Math.abs(3.5 - move.toC);
  score += (7 - centerDist) * 4;

  if (attacker && oppKingR !== -1) {
    const kingDist = Math.abs(oppKingR - move.toR) + Math.abs(oppKingC - move.toC);
    score += (14 - kingDist) * 2;
  }
  return score;
}

function sortMovesForOrdering(
  cells: (PureCell | null)[][],
  moves: PureChessMove[],
  oppColor: PieceColor
): PureChessMove[] {
  if (moves.length <= 1) return moves;
  const [oppKingR, oppKingC] = findKingCoords(cells, oppColor);
  return moves.sort(
    (a, b) =>
      scoreMoveForOrdering(cells, b, oppKingR, oppKingC) -
      scoreMoveForOrdering(cells, a, oppKingR, oppKingC)
  );
}

function quiescenceSearch(
  cells: (PureCell | null)[][],
  alpha: number,
  beta: number,
  turn: PieceColor,
  enPassantTarget: EnPassantTarget | null,
  qDepth: number
): number {
  const standPat = evaluateBoardStatic(cells, turn);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  if (qDepth <= 0) return alpha;

  const oppColor: PieceColor = turn === 'w' ? 'b' : 'w';
  const tacticalMoves = sortMovesForOrdering(
    cells,
    getAllPureLegalMoves(cells, turn, enPassantTarget, true),
    oppColor
  );

  for (const m of tacticalMoves) {
    const { nextCells, nextEnPassant } = applyPureMove(cells, m);
    const score = -quiescenceSearch(nextCells, -beta, -alpha, oppColor, nextEnPassant, qDepth - 1);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function alphaBetaNegamax(
  cells: (PureCell | null)[][],
  depth: number,
  plyFromRoot: number,
  alpha: number,
  beta: number,
  turn: PieceColor,
  enPassantTarget: EnPassantTarget | null,
  maxQuiescenceDepth: number
): number {
  const legalMoves = getAllPureLegalMoves(cells, turn, enPassantTarget);
  if (legalMoves.length === 0) {
    if (isPureKingInCheck(cells, turn)) {
      return -19000 + plyFromRoot * 20; // Prefer fastest checkmate
    }
    return 0; // Stalemate draw
  }

  if (depth <= 0) {
    if (maxQuiescenceDepth > 0) {
      return quiescenceSearch(cells, alpha, beta, turn, enPassantTarget, maxQuiescenceDepth);
    }
    return evaluateBoardStatic(cells, turn);
  }

  const oppColor: PieceColor = turn === 'w' ? 'b' : 'w';
  sortMovesForOrdering(cells, legalMoves, oppColor);
  let best = -Infinity;

  for (const m of legalMoves) {
    const { nextCells, nextEnPassant } = applyPureMove(cells, m);
    const val = -alphaBetaNegamax(
      nextCells,
      depth - 1,
      plyFromRoot + 1,
      -beta,
      -alpha,
      oppColor,
      nextEnPassant,
      maxQuiescenceDepth
    );
    if (val > best) best = val;
    if (val > alpha) alpha = val;
    if (alpha >= beta) break;
  }
  return best;
}

export function chooseBestAIMove(
  cells: (PureCell | null)[][],
  color: PieceColor,
  difficulty: AIDifficulty = 'tactical',
  enPassantTarget: EnPassantTarget | null = null
): PureChessMove | null {
  const legalMoves = getAllPureLegalMoves(cells, color, enPassantTarget);
  if (legalMoves.length === 0) return null;
  if (legalMoves.length === 1) return legalMoves[0];

  const searchDepth = difficulty === 'grandmaster' ? 3 : difficulty === 'tactical' ? 2 : 1;
  const quiescenceDepth = difficulty === 'grandmaster' ? 2 : difficulty === 'tactical' ? 1 : 0;
  const jitterAmp = difficulty === 'novice' ? 28 : difficulty === 'tactical' ? 3 : 0;

  const oppColor: PieceColor = color === 'w' ? 'b' : 'w';
  sortMovesForOrdering(cells, legalMoves, oppColor);

  let bestScore = -Infinity;
  let bestCandidates: PureChessMove[] = [];

  for (const m of legalMoves) {
    const { nextCells, nextEnPassant } = applyPureMove(cells, m);
    const rootAlpha = Number.isFinite(bestScore) ? bestScore - jitterAmp - 1 : -Infinity;
    let score = -alphaBetaNegamax(
      nextCells,
      searchDepth - 1,
      1,
      -Infinity,
      -rootAlpha,
      oppColor,
      nextEnPassant,
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

export interface AsyncAISearchOptions {
  shouldCancel?: () => boolean;
  timeSliceMs?: number;
  timeBudgetMs?: number;
}

interface AsyncSearchContext {
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

async function maybeYieldSearch(ctx: AsyncSearchContext, forceYield = false): Promise<boolean> {
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

async function quiescenceSearchAsync(
  cells: (PureCell | null)[][],
  alpha: number,
  beta: number,
  turn: PieceColor,
  enPassantTarget: EnPassantTarget | null,
  qDepth: number,
  ctx: AsyncSearchContext
): Promise<number> {
  if (await maybeYieldSearch(ctx)) return alpha;
  const standPat = evaluateBoardStatic(cells, turn);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  if (qDepth <= 0) return alpha;

  const oppColor: PieceColor = turn === 'w' ? 'b' : 'w';
  const tacticalMoves = sortMovesForOrdering(
    cells,
    getAllPureLegalMoves(cells, turn, enPassantTarget, true),
    oppColor
  );
  if (getNowMs() - ctx.lastYieldTime >= ctx.timeBudgetMs && (await maybeYieldSearch(ctx))) {
    return alpha;
  }

  for (const m of tacticalMoves) {
    if (ctx.cancelled) return alpha;
    const { nextCells, nextEnPassant } = applyPureMove(cells, m);
    const score = -(await quiescenceSearchAsync(
      nextCells,
      -beta,
      -alpha,
      oppColor,
      nextEnPassant,
      qDepth - 1,
      ctx
    ));
    if (ctx.cancelled) return alpha;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

async function alphaBetaNegamaxAsync(
  cells: (PureCell | null)[][],
  depth: number,
  plyFromRoot: number,
  alpha: number,
  beta: number,
  turn: PieceColor,
  enPassantTarget: EnPassantTarget | null,
  maxQuiescenceDepth: number,
  ctx: AsyncSearchContext
): Promise<number> {
  if (await maybeYieldSearch(ctx)) return alpha;
  const legalMoves = getAllPureLegalMoves(cells, turn, enPassantTarget);
  if (legalMoves.length === 0) {
    if (isPureKingInCheck(cells, turn)) {
      return -19000 + plyFromRoot * 20;
    }
    return 0;
  }

  if (depth <= 0) {
    if (maxQuiescenceDepth > 0) {
      return quiescenceSearchAsync(cells, alpha, beta, turn, enPassantTarget, maxQuiescenceDepth, ctx);
    }
    return evaluateBoardStatic(cells, turn);
  }

  const oppColor: PieceColor = turn === 'w' ? 'b' : 'w';
  sortMovesForOrdering(cells, legalMoves, oppColor);
  if (getNowMs() - ctx.lastYieldTime >= ctx.timeBudgetMs && (await maybeYieldSearch(ctx))) {
    return alpha;
  }
  let best = -Infinity;

  for (const m of legalMoves) {
    if (ctx.cancelled) return best;
    const { nextCells, nextEnPassant } = applyPureMove(cells, m);
    const val = -(await alphaBetaNegamaxAsync(
      nextCells,
      depth - 1,
      plyFromRoot + 1,
      -beta,
      -alpha,
      oppColor,
      nextEnPassant,
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

export async function chooseBestAIMoveAsync(
  cells: (PureCell | null)[][],
  color: PieceColor,
  difficulty: AIDifficulty = 'tactical',
  enPassantTarget: EnPassantTarget | null = null,
  options: AsyncAISearchOptions = {}
): Promise<PureChessMove | null> {
  const startMs = getNowMs();
  if (options.shouldCancel?.()) return null;
  const legalMoves = getAllPureLegalMoves(cells, color, enPassantTarget);
  if (legalMoves.length === 0) return null;
  if (legalMoves.length === 1) return legalMoves[0];

  const searchDepth = difficulty === 'grandmaster' ? 3 : difficulty === 'tactical' ? 2 : 1;
  const quiescenceDepth = difficulty === 'grandmaster' ? 2 : difficulty === 'tactical' ? 1 : 0;
  const jitterAmp = difficulty === 'novice' ? 28 : difficulty === 'tactical' ? 3 : 0;

  const oppColor: PieceColor = color === 'w' ? 'b' : 'w';
  sortMovesForOrdering(cells, legalMoves, oppColor);

  const timeBudgetMs = Math.max(1, options.timeSliceMs ?? options.timeBudgetMs ?? 4);
  const ctx: AsyncSearchContext = {
    nodes: 0,
    nodesSinceYield: 0,
    yieldCount: 0,
    lastYieldTime: startMs,
    timeBudgetMs,
    maxNodesPerSlice: Math.max(32, Math.floor(timeBudgetMs * 64)),
    shouldCancel: options.shouldCancel,
    cancelled: false
  };

  // Yield right after root move generation and ordering before starting the deep search loop
  if (await maybeYieldSearch(ctx, true)) return null;

  let bestScore = -Infinity;
  let bestCandidates: PureChessMove[] = [];

  for (const m of legalMoves) {
    if (await maybeYieldSearch(ctx)) return null;
    const { nextCells, nextEnPassant } = applyPureMove(cells, m);
    const rootAlpha = Number.isFinite(bestScore) ? bestScore - jitterAmp - 1 : -Infinity;
    let score = -(await alphaBetaNegamaxAsync(
      nextCells,
      searchDepth - 1,
      1,
      -Infinity,
      -rootAlpha,
      oppColor,
      nextEnPassant,
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


