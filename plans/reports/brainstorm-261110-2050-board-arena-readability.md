# Brainstorm: rebuild the board and the arena around it for readability

Date: 2026-11-10. Request: the light makes the board glare, pieces and squares are hard to tell apart, and the layout needs to suit the player better. Status: options only, nothing changed in the code.

## What the code and a screenshot show today

Evidence: `src/wizardChessEngine.js` and `plans/261110-0904-knight-pawn-redesign-pilot/visuals/after4-hogwarts-board.png` (base theme, default camera).

1. Pieces have almost the same value as the squares they stand on. White piece `0xf2ece0` on light square `0xe6decb` is a contrast ratio of 1.14; black piece `0x181c26` on dark square `0x232a3a` is 1.19. Light square against dark square is 10.7. On screen the white king's body samples at (216, 204, 182) on a light square of (230, 223, 206). The board pattern is the loudest thing in the picture and the pieces are the quietest.
2. The light is built for drama, not for play: a key light of 2.55, exposure 1.24 with ACES, two orange brazier point lights of 4.35 at x = ±3.65 on the board's own level with a reach of 18, and bloom with a threshold of 0.88. The light squares (albedo about 0.9) sit at the bloom threshold, and the braziers put a sheen across files A and B where dark squares turn grey and the pattern fades.
3. Gold is used for everything: board frame, arena floor lines, coordinate letters, piece trim, the ring under every piece. It no longer points at anything.
4. Layout: the camera has a 40 degree lens and a low three-quarter pose. The board fills roughly half of the frame, back-rank pieces overlap the pawns in front of them, the king is about three times as tall as a pawn, and far pawns are a few pixels wide.

## Contract

- Outcome: at the default camera a player reads every piece, its side and its square at a glance, on every square of the board, in the base themes. The arena still feels like a wizard duel, but it frames the board and does not compete with it.
- Constraints: three.js r170, the current piece models and clips, the theme system (`lightSqHex`, `darkSqHex`, team materials), frame time no worse than the baseline plus 5%, first playable weight not higher, `npm test` 32 passing with `test/applet.test.mjs` unchanged, no chess rule, AI or room protocol changes.
- Non-goals: new piece models, new clips, the xiangqi board (unless asked), the paid sculpted sets beyond inheriting the new light and board.
- Acceptance criteria (measured on screenshots, not judged by feel):
  1. For white piece on light square, black piece on dark square, and light square against dark square, the sampled contrast ratio is at least 2.0, on files A to H and ranks 1 to 8.
  2. The same square colour sampled in the four corners and the centre of the board differs by at most 25% in luminance (no glare band).
  3. No board square pixel is bright enough to bloom; bloom shows only on glow parts and effects.
  4. The board spans at least 70% of the viewport height on desktop and the full width in portrait; every pawn is at least 28 px tall at 1280 x 720.
  5. Tests, lint and the frame-time check pass; the user prefers the new view in before and after pairs for at least three themes.

## Design principle for all options: a four-step value ladder

Darkest to lightest: black pieces, dark squares, light squares, white pieces, each step about 2.3 times the luminance of the one below (for example dark square near `0x5d6470`, light square near `0x9c9484`; final values are tuned on screen). The arena sits below the whole ladder and is less saturated. Gold is reserved for piece trim and for interactive marks (selection, legal moves, last move, check).

## Options

### A. Readability pass (tuning only, about 1 to 2 days)

- Squares move to mid-tones on the value ladder and become matte (higher roughness, low environment reflection).
- Light: lower exposure and key, braziers stop lighting the board and pieces (shorter reach or their own layer), bloom threshold above the brightest square.
- Rings under pieces removed or reduced to a thin dark contact shadow; arena gold lines dimmed.
- Camera default raised and moved closer; pawns scaled up and king and queen scaled down slightly.
- Depends most on: the problem being value and light, not shape. Fails first if the board model itself (bright gold frame, thin slab) still pulls the eye after tuning.

### B. New duel table inside the current hall (recommended, about 4 to 6 days, A is its first phase)

- Everything in A, shipped first as its own step.
- A new board built in code or Blender: thick matte stone slab, inlaid squares with a fine dark joint, a dark bevel frame with engraved coordinates, a thin gold inlay line only.
- A dark, plain apron around the board (a sunken dais or cloth-like stone ring) so pieces on the edge files stand against a calm surface, not against floor ornaments.
- A separate play light rig: one soft high key and a cool fill that light only board and pieces, while braziers, candles and windows light only the hall. Braziers move back and up so they read as rim light.
- The cathedral model stays as a dimmer, slightly foggier backdrop.
- Depends most on: light separation by layers being cheap enough in the current renderer. Fails first if the frame-time budget does not hold on mobile, in which case the fallback is A plus the new board without the second rig.

### C. New arena from scratch (about 2 weeks or more, generation credits)

- Replace the cathedral with a purpose-built duel arena made by the same route as the pieces (concept images, image-to-3D, Blender).
- Depends most on: a generated environment staying within the 5 MB and frame budgets. Fails first on weight and on style consistency; it also does not fix readability by itself, so A's work is still needed.

## Trade-offs

- A is the cheapest to abandon and proves the value ladder in a day, but keeps a board that was designed as decoration.
- B costs more and touches theme data (every theme's two square colours need a pass), but it is the smallest option that addresses all three complaints: glare, piece against square, layout.
- C gives the biggest visual change and the largest risk, and its benefit to play is the smallest.

Better approaches: none found beyond the requested direction. The recommendation is B, delivered as A first, then the table and the light rig, with the screenshot measurements above as the gate after each step.

## Unresolved questions

1. Which scope: A only, B (recommended), or C?
2. Themes: tune the five themes that use the base pieces first, or all themes in the same delivery?
3. May the default camera pose and the pawn to king size ratio change?
4. Is the xiangqi board in scope?
