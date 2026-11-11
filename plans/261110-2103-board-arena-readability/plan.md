# Board and arena readability (option B)

Date: 2026-11-10. Branch: `claude/board-arena-readability`. Source: `plans/reports/brainstorm-261110-2050-board-arena-readability.md` (contract and acceptance criteria live there). Status: implemented in the working tree, not committed. Later the same day the user removed every theme except `hogwarts`; see `handoff.md` for the current state and open problems.

## Scope decisions

- Option B chosen by the user, delivered as the tuning pass first, then the table and arena.
- Defaults taken where the user gave no answer: one luminance rule for all themes plus per-theme values where needed; camera pose and piece size ratio may change; the xiangqi board is not touched.

## What changed (all in `src/wizardChessEngine.js`)

| Area | Change |
|------|--------|
| Squares | Matte, and set by luminance rather than by theme hex: light 0.175, dark 0.066, with part of the hue removed (`setSquareColorAtLuminance`). A theme may override with `boardLightLuminance` / `boardDarkLuminance`. |
| Glare | Cause was bloom on a specular streak of the glossy table frame. Table, frame and coordinate plate are now matte; bloom threshold 0.88 to 1.0. |
| Gold | Board frame and arena lines keep the theme colour at half value with low emissive; gold stays bright only on pieces and interaction marks. |
| Light | Hemisphere 0.62 to 0.85, south fill 0.52 to 0.80, rim 0.72 to 0.80, brazier point lights reach 18 to 1.4 (they no longer light the board). |
| Rings | Thin team-coloured ring under each piece (black ring dark, white ring pale) instead of a wide gold one. |
| Pieces | Pawn 0.85 to 0.94, queen 1.08 to 1.05, king 1.15 to 1.10; the old code-built crowns are no longer added on the base set's king, queen and bishop. Black body is charcoal and mostly diffuse. |
| Camera | Spectator pose closer and steeper. |
| API | `getSquareScreenPoint(r, c)` for measurement. |

## Measurement

`READABILITY=1 READ_LABEL=<label> READ_OUT=<dir> npx playwright test e2e/board-readability.spec.ts` prints one `READABILITY` line per theme and writes screenshots and a `.jsonl` file. Results are in `visuals/readability-before.jsonl` and `visuals/readability-after.jsonl`.

## Not done

- No separate light rig for board and hall: three.js has no per-object light linking, so the separation is done with matte materials, brazier reach and the bloom threshold.
- The cathedral backdrop was not dimmed.
- No new board geometry; the existing code-built table was re-materialled.
- Paid sculpted sets and xiangqi were not re-checked visually.

## Second pass (same day)

Details and numbers are in `handoff.md`. In short: the measurement now samples whole piece bodies through a mask frame (`setPieceMaskView`); knight steeds were recoloured into their side's value band; light squares went to 0.162; the table gained a matte apron, thinner gold rails and a lower gold metalness; the arena floor became matte with quieter lines; the cathedral backdrop is held at 0.55 value. All four piece-on-square pairs now measure at least 2.0 at their minimum. Results: `visuals/readability-final.jsonl`.

The first two items under "Not done" still stand in part: there is no separate light rig and no new board model. The backdrop is now dimmed, and xiangqi was re-checked by eye.
