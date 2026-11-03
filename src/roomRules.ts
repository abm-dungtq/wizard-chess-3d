import { applyPureMove, getAllPureLegalMoves, type EnPassantTarget, type PureCell } from './chessAI.ts';
import {
  applyXiangqiMove,
  createInitialXiangqiBoard,
  getAllXiangqiLegalMoves,
  type XiangqiCell
} from './xiangqiAI.ts';
import type { GameVariant, PromotionPieceType, RoomCoord, RoomMove } from './roomStore.ts';

export type RulesState =
  | { variant: 'chess'; cells: (PureCell | null)[][]; ep: EnPassantTarget | null; over: boolean }
  | { variant: 'xiangqi'; cells: (XiangqiCell | null)[][]; over: boolean };

export interface RoomMoveInput {
  color: 'w' | 'b';
  from: RoomCoord;
  to: RoomCoord;
  promotion?: PromotionPieceType;
}

export type RoomMoveResult =
  | { ok: true; state: RulesState; promotion?: PromotionPieceType }
  | { ok: false; error: 'Illegal move' | 'Game is over' };

const CHESS_BACK_ROW: PureCell['type'][] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

function createInitialChessBoard(): (PureCell | null)[][] {
  const cells: (PureCell | null)[][] = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let c = 0; c < 8; c++) {
    cells[0][c] = { type: CHESS_BACK_ROW[c], color: 'b', hasMoved: false };
    cells[1][c] = { type: 'pawn', color: 'b', hasMoved: false };
    cells[6][c] = { type: 'pawn', color: 'w', hasMoved: false };
    cells[7][c] = { type: CHESS_BACK_ROW[c], color: 'w', hasMoved: false };
  }
  return cells;
}

export function createRulesState(variant: GameVariant): RulesState {
  return variant === 'xiangqi'
    ? { variant: 'xiangqi', cells: createInitialXiangqiBoard(), over: false }
    : { variant: 'chess', cells: createInitialChessBoard(), ep: null, over: false };
}

const sameSquares = (m: { fromR: number; fromC: number; toR: number; toC: number }, move: RoomMoveInput) =>
  m.fromR === move.from.r && m.fromC === move.from.c && m.toR === move.to.r && m.toC === move.to.c;

/** Applies a move only if it is legal for `move.color`; the game is over once the side to move has no legal reply. */
export function tryApplyRoomMove(state: RulesState, move: RoomMoveInput): RoomMoveResult {
  if (state.over) return { ok: false, error: 'Game is over' };
  const opponent = move.color === 'w' ? 'b' : 'w';

  if (state.variant === 'xiangqi') {
    const legal = getAllXiangqiLegalMoves(state.cells, move.color).find((m) => sameSquares(m, move));
    if (!legal) return { ok: false, error: 'Illegal move' };
    const { nextCells } = applyXiangqiMove(state.cells, legal);
    // A side with no legal move loses in xiangqi, so stalemate also ends the game.
    const over = getAllXiangqiLegalMoves(nextCells, opponent).length === 0;
    return { ok: true, state: { variant: 'xiangqi', cells: nextCells, over } };
  }

  const wanted = move.promotion || 'queen';
  // The client sends a promotion piece on every move, so it only matters when the move actually promotes.
  const legal = getAllPureLegalMoves(state.cells, move.color, state.ep).find(
    (m) => sameSquares(m, move) && (!m.promotion || m.promotion === wanted)
  );
  if (!legal) return { ok: false, error: 'Illegal move' };
  const { nextCells, nextEnPassant } = applyPureMove(state.cells, legal);
  const over = getAllPureLegalMoves(nextCells, opponent, nextEnPassant).length === 0;
  return {
    ok: true,
    state: { variant: 'chess', cells: nextCells, ep: nextEnPassant, over },
    promotion: legal.promotion as PromotionPieceType | undefined
  };
}

/** Rebuilds the rules state from a room's stored move list. */
export function replayRoomMoves(variant: GameVariant, moves: RoomMove[]): RulesState {
  let state = createRulesState(variant);
  for (const move of moves) {
    const result = tryApplyRoomMove(state, move);
    if (!result.ok) throw new Error(`Stored room move ${move.seq} is not playable: ${result.error}`);
    state = result.state;
  }
  return state;
}
