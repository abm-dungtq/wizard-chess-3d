# Phase 4: Tactical 3D Readability, Promotion UI, HUD Controls & Verification Suite

## Goal
Wire `src/chessAI.ts` and `src/soundEngine.ts` into `src/wizardChessEngine.js`, add 3D tactical board feedback (Last Move origin/destination square highlight + pulsing King-in-Check crimson ring), add Pawn Promotion piece selection modal (`#promotion-overlay`), add HUD controls (`#btn-undo`, `#btn-ai-difficulty`, `#btn-audio-toggle`) in `src/App.tsx` and `src/styles.css` while strictly respecting `test/applet.test.mjs`, and expand `test/applet.test.mjs` to test FIDE rules, 3-tier Minimax AI, and audio/HUD state.

## Files to Create or Modify
- `src/wizardChessEngine.js` (modify)
- `src/App.tsx` (modify)
- `src/styles.css` (modify)
- `test/applet.test.mjs` (modify)

## Tasks & Steps

### Task 4.1 — Integrate FIDE Rules, 3-Tier AI, Procedural Audio, Last-Move / Check 3D Highlights & Undo in `src/wizardChessEngine.js`
- **Goal:** Connect `src/chessAI.ts` and `src/soundEngine.ts` into `src/wizardChessEngine.js`, support En Passant capture choreography and Promotion modal/parameter, draw detection banner, 3D Last Move & King-in-Check highlights, Undo (`undoLastMove`), AI difficulty cycling, and Audio toggle.
- **Target files and symbols:** `src/wizardChessEngine.js` (`getLegalMovesForPiece`, `executeChessMove`, `chooseSmartAIMove`, `updateTurnUI`, `captureBoardSnapshot`, `restoreBoardSnapshot`, `window.wizardChess`).
- **Steps:**
  1. Track `enPassantTarget`, `halfMoveClock`, `positionHistory`, `lastMoveSquares`, and `aiDifficulty` (`'novice' | 'tactical' | 'grandmaster'`, default `'tactical'`), and persist/restore them in `captureBoardSnapshot` / `restoreBoardSnapshot`.
  2. Update `getLegalMovesForPiece` and ` getAllLegalMoves` to include En Passant moves (`enPassant: true, captureR, captureC`) and preserve Castling metadata (`castle`, `rookFromC`, `rookToC`).
  3. Update `executeChessMove` so En Passant captures target the enemy pawn at `(captureR, captureC)` for melee duel & stone shatter, and player pawn moves to the back rank (`toR === 0 || toR === 7`) open the promotion modal unless `options.promotion` is already provided (or AI is moving).
  4. Trigger `wizardAudio` cues on move start, weapon contact, stone shatter, promotion, check, and checkmate.
  5. Render persistent 3D Last Move square frames (warm gold-amber glow on `from` and `to`) and a pulsing crimson warning ring under the King when `isKingInCheck(currentTurn, boardState)` is true.
  6. Bind `#btn-undo`, `#btn-ai-difficulty`, `#btn-audio-toggle`, and `.promotion-choice-btn` in `src/wizardChessEngine.js` and expose new methods (`setAIDifficulty`, `getAIDifficulty`, `undoLastMove`, `toggleAudioMute`, `getAudioState`) on `window.wizardChess`.
- **Success criteria:** All new mechanics operate cleanly in 3D and via `window.wizardChess`.
- **Verify:** `npm run lint` exits 0.

### Task 4.2 — Update `src/App.tsx` and `src/styles.css` with Undo, AI Difficulty, Audio Mute & Promotion Picker Modal
- **Goal:** Add `#btn-ai-difficulty`, `#btn-undo`, `#btn-audio-toggle`, and `#promotion-overlay` (with Queen, Rook, Bishop, Knight buttons) in `src/App.tsx` and style them for both desktop and mobile bottom-sheet in `src/styles.css` without touching any required or forbidden IDs in `test/applet.test.mjs`.
- **Target files and symbols:** `src/App.tsx`, `src/styles.css`.
- **Steps:**
  1. Add `#btn-ai-difficulty`, `#btn-undo`, and `#btn-audio-toggle` to `#hud-right` in `src/App.tsx`, and add `#promotion-overlay` for selecting `queen`, `rook`, `bishop`, or `knight`.
  2. Style the promotion modal and updated mobile sheet grid in `src/styles.css`.
- **Success criteria:** All 10 required HUD IDs remain present and all 12 forbidden IDs remain absent in `src/App.tsx`.
- **Verify:** `node --test test/applet.test.mjs && npm run lint && npm run build` exits 0.

### Task 4.3 — Expand `test/applet.test.mjs` with unit tests for FIDE rules, 3-Tier Minimax AI, and Sound Engine
- **Goal:** Verify En Passant, Castling metadata, Insufficient Material / 50-Move / Threefold Repetition draws, 3-Tier Minimax tactical captures & checkmate finding, and Web Audio state in `test/applet.test.mjs`.
- **Target files and symbols:** `test/applet.test.mjs`.
- **Steps:**
  1. Add automated tests importing `src/chessAI.ts` and `src/soundEngine.ts` to verify En Passant generation, draw conditions, Minimax tactical capture/Mate-in-1 selection, and audio mute state.
  2. Run `node --test test/applet.test.mjs`, `npm run lint`, and `npm run build`.
- **Success criteria:** All tests in `test/applet.test.mjs` pass, `npm run lint` exits 0, and `npm run build` succeeds.
- **Verify:** `node --test test/applet.test.mjs && npm run lint && npm run build` exits 0.

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
