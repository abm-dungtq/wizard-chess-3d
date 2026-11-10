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
- Tooling on 2026-11-10: G-Labs webhook answers; Blender MCP is connected (Blender 5.2.3) with every generator switched off; the Hyper3D MCP server is authorised only in the user's interactive session, not in headless runs.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Concept sheet, silhouette strip, one reference image per piece | Done, approved by the user on 2026-11-10 |
| 2 | Wooden board | First pass done (`visuals/wood-board-first-pass.jpg`) |
| 3 | Mesh generation, 7 generations | Done: 7 generations used, none spare, none failed (Hyper3D Rodin, run from the user's interactive session) |
| 4 | Blender build, rig, export, detail maps | Done: seven GLBs (222 to 325 KB), normal and AO maps under `public/assets/glb/detail/xiangqi/`, cache key `v=statue_pilot_v5` |
| 5 | Side colours and readability on the wood, measured | Palette applied to the new figures (`visuals/new-figures-red-side.jpg`, `visuals/new-figures-black-side.jpg`); not measured: `e2e/board-readability.spec.ts` samples 8x8 squares and needs a xiangqi mode |
| 6 | In-game check of move, capture, shatter and check per piece | Partly: start position from both seats, cannon capture, chariot capture and a horse move checked (`XQ=1 XQ_OUT=<dir> npx playwright test e2e/xiangqi-shots.spec.ts`). Not yet looked at: captures by soldier, advisor, elephant, horse and general, and a check |

## Build record (2026-11-10)

Scripts are the chess ones in `.tools/piece-redesign/` run with `WS_ROOT` set to `.tools/xiangqi-redesign/` (both ignored by git). `build_generated.py` gained `MAX_HALF_W`, which caps the half width so a vehicle or animal is scaled by width instead of height; it is 0.47 for chariot, cannon and elephant and 0.52 for the horseman.

| Piece | Rig | Spine knots (z, bone) | Idle | Move | Attack |
|-------|-----|-----------------------|------|------|--------|
| Soldier | pawn | 0.34 to 0.42 Pelvis, 0.62 to 0.70 Torso, 0.86 Head | 1.21 / 0.82 | 1.41 / 0.73 | 1.57 / 0.55 |
| Advisor | queen | 0.35 Skirt_Lower, 0.85 to 1.15 Torso, 1.35 Head_Crown | 1.10 / 0.89 | 1.11 / 0.87 | 1.28 / 0.74 |
| General | king | 0.35 Robe_Lower, 0.85 to 1.12 Torso, 1.32 Head_Crown | 1.03 / 0.96 | 1.10 / 0.92 | 1.15 / 0.89 |
| Chariot | rook | 0.25 Tower_Lower, 0.52 to 0.70 Tower_Upper, 0.98 Battlement_Crown | 1.19 / 0.84 | 1.16 / 0.85 | 1.35 / 0.71 |
| Cannon | bishop | 0.12 Robe_Lower, 0.85 to 1.2 Torso | 1.07 / 0.93 | 1.14 / 0.86 | 1.33 / 0.73 |
| Elephant | bishop | 0.14 Robe_Lower, 0.85 to 1.05 Torso, 1.38 Head_Mitre | 1.23 / 0.83 | 1.14 / 0.86 | 1.34 / 0.69 |
| Horseman | knight | `.tools/xiangqi-redesign/knight_weights.py`, 120 smoothing rounds | 1.24 / 0.75 | 1.83 / 0.28 | 2.65 / 0.08 |

Each cell is the largest and smallest edge length ratio against the rest pose; the limit is 1.6 / 0.5. The horseman is outside it on 10 of 24,356 edges in Move and 158 in Attack, all short edges where the rider's hands meet the mane; the chess knight has the same limit breach (132 edges) and, like it, shows no tear in the game frames.

Engine changes with the new figures: no floating regalia on xiangqi pieces (sun halo, loose tusks, collar ring; the general keeps its gold ground ring, by user decision), the advisor and elephant use the same bronze trim and jade gem as the rest of their side, and `attachBodyDetailMaps` loads the detail maps for both games.

Known flaws of the generated meshes, kept because no spare generation was approved: the cannon carriage came out with one wheel in front under the muzzle and two behind; the general's plume takes the body colour.

## Design brief

Seven statues of an ancient eastern army: bodies of cinnabar-red lacquered wood, bronze-gold trim, dark iron, small jade gems, on a low round wooden plinth. The engine recolours the body per side, so the sheet shows one colour only. Cues: soldier (conical hat, round shield, spear), cannon (tilted barrel on a two-wheeled carriage), advisor (hat with two horizontal wings, scroll), chariot (square canopy, two large wheels), elephant (fan ears, curled trunk, howdah), horse (arched neck, rider with a glaive), general (tall crest plume, cape, sword point-down). The full prompt is in `.tools/xiangqi-redesign/concept/sheet-prompt.txt` (scratch, ignored by git).

Evidence: `visuals/concept-sheet.png`, `visuals/silhouette-strip-120.png` (order not stated here on purpose), `visuals/<piece>-ref-a.png`.

## Board, first pass

`buildXiangqiBoardGrid` in `src/wizardChessEngine.js`: the grey slab is honey-coloured planks from a seeded canvas texture (`makeXiangqiWoodTexture`), the frame is dark rosewood with a thin bronze inlay and a narrow bronze rim outside it, every line is a burnt-brown groove with a thin bronze inlay along its centre (the rim and the lines keep `boardGoldTrimMat`, which `test/applet.test.mjs` pins), the intersection studs are burnt-brown, and the river is a walnut stain with bronze characters instead of a teal banner. The fourteen position marks stay bronze.

## Risks

- The elephant, cannon and chariot are not upright figures; spine binding moves them as one body. The chess knight has the same limit.
- Red lacquer on honey wood is closer in hue than white on grey; phase 5 measures it and may darken the wood or the body.
