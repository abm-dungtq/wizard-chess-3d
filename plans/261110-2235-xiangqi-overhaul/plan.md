---
title: "Xiangqi overhaul: new characters and a wooden board"
description: "Replace the seven xiangqi pieces with newly sculpted figures made the same way as the chess set, and rebuild the board in wood to match them."
status: in-progress
priority: P1
branch: claude/board-arena-readability
created: 2026-11-10
---

# Xiangqi overhaul

User decisions on 2026-11-10: (1) entirely new figures, made the way the chess set was made; (2) a wooden board in the style of the new figures; (3) movement, attack, shatter and check effects follow the chess work.

## Contract

- Outcome: the seven xiangqi pieces are new sculpted figures that can be told apart at the default camera, both sides read as one colour family each, and the board is a wooden board that suits them.
- Constraints: the route of `plans/261110-0904-knight-pawn-redesign-pilot` (one reference image per piece, one image-to-3D generation, Blender build on the shared plinth, spine binding to the existing armature and four clips). Piece GLBs stay texture-free, 4 primitives, under 400,000 bytes; `ASSET_CACHE_VER` changes after re-encoding. `test/applet.test.mjs` stays unchanged (test 20 pins the seven files, the four clips and the `Base` bone). No 3D credits are spent before the user approves the concept.
- Non-goals: rules, AI, room protocol, new clips, limb animation, the arena around the table.
- Acceptance criteria:
  1. The user approves the concept sheet and names the seven silhouettes.
  2. All seven pieces are in the game for both sides with the four clips and no torn mesh.
  3. Each side reads as one colour family (no green elephants on the red side, no orange and cyan mix on the black side).
  4. The board is wood, with the river and palaces readable, and both sides' pieces readable on it.
  5. `npm test` 32 pass, lint clean, build succeeds, smoke passes, frame budget tests no worse than before.

## Facts verified

- The seven xiangqi models reuse the chess armatures: king (king rig), advisor (queen rig), elephant and cannon (bishop rig), rook (rook rig), knight (knight rig), pawn (pawn rig). `build_generated.py` in `.tools/piece-redesign/` therefore applies unchanged.
- The effect layer (`src/pieceEffects.js`) already runs in xiangqi: ribbon, landing, shatter chunks, check line and ring, king flinch.
- Tooling on 2026-11-10: G-Labs webhook answers; Blender MCP is connected (Blender 5.2.3) with every generator switched off; the Hyper3D MCP server needs to be authorised again by the user.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Concept sheet, silhouette strip, one reference image per piece | Done, waiting for the user's approval |
| 2 | Wooden board | First pass done (`visuals/wood-board-first-pass.jpg`) |
| 3 | Mesh generation, 7 generations | Blocked: Hyper3D authorisation and approval to spend credits |
| 4 | Blender build, rig, export, detail maps | Not started |
| 5 | Side colours and readability on the wood, measured | Not started; `e2e/board-readability.spec.ts` samples 8x8 squares and needs a xiangqi mode |
| 6 | In-game check of move, capture, shatter and check per piece | Not started |

## Design brief

Seven statues of an ancient eastern army: bodies of cinnabar-red lacquered wood, bronze-gold trim, dark iron, small jade gems, on a low round wooden plinth. The engine recolours the body per side, so the sheet shows one colour only. Cues: soldier (conical hat, round shield, spear), cannon (tilted barrel on a two-wheeled carriage), advisor (hat with two horizontal wings, scroll), chariot (square canopy, two large wheels), elephant (fan ears, curled trunk, howdah), horse (arched neck, rider with a glaive), general (tall crest plume, cape, sword point-down). The full prompt is in `.tools/xiangqi-redesign/concept/sheet-prompt.txt` (scratch, ignored by git).

Evidence: `visuals/concept-sheet.png`, `visuals/silhouette-strip-120.png` (order not stated here on purpose), `visuals/<piece>-ref-a.png`.

## Board, first pass

`buildXiangqiBoardGrid` in `src/wizardChessEngine.js`: the grey slab is honey-coloured planks from a seeded canvas texture (`makeXiangqiWoodTexture`), the frame is dark rosewood with a thin bronze inlay and a narrow bronze rim outside it, every line is a burnt-brown groove with a thin bronze inlay along its centre (the rim and the lines keep `boardGoldTrimMat`, which `test/applet.test.mjs` pins), the intersection studs are burnt-brown, and the river is a walnut stain with bronze characters instead of a teal banner. The fourteen position marks stay bronze.

## Risks

- The elephant, cannon and chariot are not upright figures; spine binding moves them as one body. The chess knight has the same limit.
- Red lacquer on honey wood is closer in hue than white on grey; phase 5 measures it and may darken the wood or the body.
