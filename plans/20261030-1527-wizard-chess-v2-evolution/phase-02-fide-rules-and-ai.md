# Phase 2: Complete FIDE Rules & 3-Tier Minimax AI (`src/chessAI.ts`)

## Goal
Create the pure, WebGL-independent TypeScript module `src/chessAI.ts` implementing complete FIDE rule helpers (En Passant, Castling metadata preservation, Promotion, 50-Move Rule, Threefold Repetition hash, Insufficient Material draw detection) and a 3-Tier Minimax + Alpha-Beta + Piece-Square Tables (PST) + Quiescence Search AI engine (`novice`, `tactical`, `grandmaster`) operating strictly on pure board snapshots without mutating Three.js meshes.

## Files to Create or Modify
- `src/chessAI.ts` (create)

## Tasks & Steps

### Task 2.1 — Implement pure FIDE rules, draw detection, and 3-tier Minimax AI in `src/chessAI.ts`
- **Goal:** Provide pure functions for legal move generation (including En Passant, Castling, Promotion), draw evaluation (`checkDrawCondition`), position hashing (`computePositionHash`), and `chooseBestMove(snapshot, difficulty)` supporting `'novice'` (depth 1 + jitter), `'tactical'` (depth 2 + PST), and `'grandmaster'` (depth 3 + Alpha-Beta + MVV-LVA move ordering + Quiescence capture search).
- **Target files and symbols:** `src/chessAI.ts` (`computePositionHash`, `checkInsufficientMaterial`, `evaluateDrawState`, `getPureLegalMoves`, `chooseBestAIMove`).
- **Steps:**
  1. Define pure types `PieceType`, `PieceColor`, `PureCell`, `BoardSnapshotState`, `ChessMove`, and `AIDifficulty` (`'novice' | 'tactical' | 'grandmaster'`).
  2. Implement `getPureLegalMoves(cells, turn, enPassantTarget)` that clones only lightweight 8x8 cell objects (never touching Three.js `mesh` references) and supports standard moves, Castling (`O-O`, `O-O-O`), and En Passant (`isEnPassant: true, captureR, captureC`).
  3. Implement `evaluateDrawState(cells, turn, halfMoveClock, positionCounts)` detecting `50-move`, `threefold-repetition`, and `insufficient-material` (K vs K, K+B vs K, K+N vs K, K+B vs K+B same color).
  4. Implement Piece-Square Tables (PST) for all 6 piece types, MVV-LVA move ordering, Quiescence capture search (up to 3 capture plies), and Alpha-Beta Minimax in `chooseBestAIMove`.
- **Success criteria:** `src/chessAI.ts` compiles cleanly under `npm run lint` and accurately solves tactical captures, Mate-in-1/Mate-in-2, En Passant, and draw states.
- **Verify:** `npm run lint` exits 0.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.
