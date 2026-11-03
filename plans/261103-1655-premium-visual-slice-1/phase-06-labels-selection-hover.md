---
phase: 6
title: "Labels on selection and hover"
status: pending
effort: 2h
pr: PR B
---

# Phase 6: Labels on selection and hover

## Goal

- By default, a piece name badge shows only for the selected piece, its capture targets, the inspected piece, and the piece under the mouse.
- The legend toggle still cycles to "all labels" and "smart" (today's default).
- Hover only runs on devices with a real hover pointer. Phones keep tap behavior.
- No per-frame raycast. A raycast runs at most once per animation frame, and only after the pointer moved.

## Facts verified before planning

- In `src/wizardChessEngine.js`:
  - `let pieceLabelMode = 'smart'` at line 4648. Modes: `smart` (all non-pawns in chess, all pieces in xiangqi), `all`, `tap` (selected/inspected/capture targets only).
  - `updatePieceLabelUI` (line 4680) writes button text for `#btn-piece-labels` and `#btn-quick-labels`. `setPieceLabelMode` at line 4704, `cyclePieceLabelMode` at line 4713 (order `smart → all → tap`).
  - `updatePieceOverheadOverlay` (line 4720) decides `shouldShow` per piece from `isSelected`, `isInspected`, `isCaptureTarget` and the mode.
  - Click picking: `raycaster` near line 8573, `extractBoardCoordsFromHit(hitObj)` at line 8586 walks up to `userData.piece` or `userData.isSquare`. Canvas `pointerdown` at line 8626, `pointerup` right after.
- `getState()` already exposes `pieceLabelMode` and `visibleOverheadBadgeCount`.

## Precondition

- Run `grep -n "let cinematicActive" src/wizardChessEngine.js`. It must print one line. If it prints nothing, phase 5 is not merged yet: STOP and run phase 5 first.

## Files

- `src/wizardChessEngine.js`, `src/styles.css` (badge fade only), `e2e/game-smoke.spec.ts`.

## Tasks

### Task 6.1 — Make `tap` the default and reorder the cycle

- **Steps:**
  1. Change line 4648 to `let pieceLabelMode = 'tap';`.
  2. Change `cyclePieceLabelMode` order to `['tap', 'smart', 'all']`.
  3. In `updatePieceLabelUI`, rename the visible text of `tap` to `Khi Chọn` (button) and `Chọn` (quick button). Keep the mode id `tap` so the test API does not change.
  4. No existing e2e test asserts the default `pieceLabelMode` or the start-up `visibleOverheadBadgeCount` (checked). If a run shows otherwise, record it in "Execution notes".
- **Verify:** no verification needed; Task 6.4 covers it.

### Task 6.2 — Track the hovered square

- **Steps:**
  1. Add `let hoveredSquare = null; let hoverPending = null;` next to `inspectedSquare` (line 4649).
  2. Add `const hoverCapable = window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches === true;`.
  3. If `hoverCapable`, add a `pointermove` listener on `renderer.domElement` (`{ passive: true }`) that only stores `hoverPending = { x: e.clientX, y: e.clientY }`. Add a `pointerleave` listener that sets `hoveredSquare = null`, `hoverPending = null`, and calls `updatePieceOverheadOverlay()`.
  4. In `stepScene`, before `renderFrame`, if `hoverPending` is set: take it, clear it, and if `!isAnimatingMove && !cinematicActive`, raycast with the existing `raycaster` against the board **square tiles only** (the objects with `userData.isSquare`; collect them once into an array when the board is built and rebuild it on variant change). Do not raycast piece meshes: they are `SkinnedMesh`es, and raycasting them applies bone transforms to every vertex on every move. Use `extractBoardCoordsFromHit` on the first hit to get `{ r, c }`, then set `hoveredSquare = boardState[r]?.[c] ? { r, c } : null`. If the value changed (compare `r`/`c`), call `updatePieceOverheadOverlay()`.
  5. Reuse one module-level `THREE.Vector2` for the pointer NDC. No allocation per move event.
- **Verify:** no verification needed; Task 6.4 covers it.

### Task 6.3 — Show the hovered piece's badge

- **Steps:**
  1. In `updatePieceOverheadOverlay`, add `const isHovered = Boolean(hoveredSquare && hoveredSquare.r === r && hoveredSquare.c === c);` and include it in the first `if` (`isSelected || isInspected || isCaptureTarget || isHovered`).
  2. Add `' is-hovered'` to the badge class when hovered and not selected/inspected/capture target.
  3. In `src/styles.css` near `.piece-overhead-badge` (line 1596), give `.piece-overhead-badge` an `opacity` transition of 120 ms if it has none, so hover badges do not flicker. Do not change badge size or layout.
  4. Add `hoveredSquare` to `getState()`.
- **Verify:** covered by Task 6.4.

### Task 6.4 — E2E

- **Target:** `e2e/game-smoke.spec.ts`, new test `'labels show only for selection and hover by default'`.
- **Steps:**
  1. Viewport 1470x956. Open the game. Move the mouse to (5, 5) (over the HUD edge, not the board). Expect `pieceLabelMode === 'tap'` and `visibleOverheadBadgeCount === 0`.
  2. Select a white knight using the same helper or click path existing tests use to select a piece. Expect `visibleOverheadBadgeCount === 1`.
  3. Deselect (press Escape or click the same square again, whichever the existing code supports). Hover the white king: compute its screen position in the page with `page.evaluate` (project the king mesh position; expose a tiny `getPieceScreenPoint(r, c)` on `window.wizardChess` if none exists), `page.mouse.move` there, wait two animation frames, and expect `hoveredSquare` to equal the king's square and `visibleOverheadBadgeCount === 1`.
  4. Move the mouse off the canvas. Expect `visibleOverheadBadgeCount === 0`.
  5. Click `#btn-piece-labels` twice. Expect `pieceLabelMode === 'all'` and `visibleOverheadBadgeCount` ≥ 30.
- **Verify:** `npx playwright test e2e/game-smoke.spec.ts -g "labels show only" 2>&1 | tail -5` shows `1 passed`.

## Phase exit check

- **Verify:** `npm run lint && npx playwright test 2>&1 | tail -5` exits 0 with all tests passed.

## Execution notes

(fill in during execution)

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
