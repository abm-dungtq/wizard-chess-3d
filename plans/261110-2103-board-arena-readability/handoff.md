# Hand-off: one default set, readable board, next steps

Date: 2026-11-10 (updated after a second session the same day). For a fresh session that has none of the earlier conversation.

## Where things are

- Worktree: `/Volumes/2/wizard-chess-3d/.claude/worktrees/redesign-3d-chess-pieces-bf8f22`
- Branch: `claude/board-arena-readability`, cut from `main` at `87af901`. **Nothing is committed.** The deletion of `public/assets/glb/sets/` is staged (`git rm`); everything else is unstaged or untracked.
- Production (`chess.tqd.me`, `chess.tqd.io.vn`) still runs `main`: 12 themes and the skin shop. Nothing from this branch is deployed.
- Deploy warning: `npm run deploy` goes to production. `wrangler deploy --env staging` after a build also deployed production once; do not rely on that flag.

## The product decision (user, 2026-11-10)

1. Remove the four recolour themes (jade, royal, astral, slytherin) and the seven old paid skin sets. Keep one default set (`hogwarts`).
2. Make that one set look as good as possible before building anything else.
3. Later, each new skin is a full package: its own characters, its own board and its own arena. It is no longer a recolour of shared pieces.

## What is done on this branch

All checks at the end of this work: `npm test` 32 pass, `npm run lint` clean, `npm run build` succeeds, `npx playwright test e2e/game-smoke.spec.ts` 15 pass and 1 skipped.

### Theme and skin removal

- `src/wizardChessEngine.js`: `PIECE_THEMES` holds only `hogwarts`; `PIECE_THEME_ORDER = ['hogwarts']`. Removed: the skin shop logic, unlock and trial state, `cyclePieceTheme`, the seven extra arena monument archetypes, their brazier flame palettes, and the API members `cyclePieceTheme`, `openSkinShopModal`, `closeSkinShopModal`, `unlockSkinPermanently`, `isSkinUnlocked`, `previewSkinShatterDemo`. The file went from about 11,790 to about 11,110 lines.
- `src/App.tsx` and `src/styles.css`: the three skin buttons, the shop overlay and its styles are gone. The class `.skin-shop-subtitle` stays because two other dialogs use it.
- `public/assets/glb/sets/` deleted (42 files, 6.4 MB). `public/assets/glb` is now 7.9 MB.
- `test/applet.test.mjs`: the assertions that required the removed sets, the shop and the eight archetypes now assert the single-theme state; the model count is 14 instead of 56. `e2e/perf-budget.spec.ts` lost the per-set transfer test.

Kept on purpose, as the seam for future skin packages:

- `SCULPTED_SET_IDS` (now empty), `ensureSkinSetLoaded`, `evictUnusedMobileSkinSets` and the per-piece set swap. A new package adds its id there, a `PIECE_THEMES` entry, and models under `assets/glb/sets/<id>/`. Xiangqi uses the same loader.
- `applyPieceTheme(themeId, side)` falls back to `hogwarts` for unknown ids, so old saved choices and old room data are harmless.
- The room API still carries `whiteSkin` / `blackSkin` and the `/api/rooms/:code/skin` endpoint; the server was not touched.

### Board readability (see `plan.md` in this folder for the table of changes)

Measured on screenshots at the default camera, theme `hogwarts`. The method changed in the second session: a piece is now sampled over all of its body pixels (found with a mask frame), not one 7x7 patch, so the "Now" column is not comparable with the first session's piece numbers. Each cell is median / minimum over the 8 pieces.

| Pair | First session (patch sample) | Now (body sample) |
|------|------------------------------|-------------------|
| White piece on light square | 2.08 / 1.67 | 2.22 / 2.00 |
| White piece on dark square | 4.92 / 3.02 | 4.91 / 4.15 |
| Black piece on light square | 2.21 / 1.24 | 5.23 / 5.04 |
| Black piece on dark square | 2.09 / 1.09 | 2.28 / 2.07 |
| Light square against dark square | 2.34 | 2.23 |
| Dark-square spread across the board | 1.06x | 1.01x |

Frame time on this branch: p95 17.3 to 17.6 ms (`ultra checkmate p95`, three runs). `main` could not be measured in the same sitting because the main checkout has no installed dependencies.

### Second session (2026-11-10, late): measurement, knights, table and arena

- **Measurement.** `wizardChess.setPieceMaskView(on)` draws only the piece bodies white on black. `e2e/board-readability.spec.ts` takes that frame as a mask and reports the median luminance of each piece's body pixels (gold trim excluded by colour), plus `whiteBody`, `blackBody` and the trim share. `READ_GRID=1` also prints a `PIECES` line per piece.
- **What the new measurement showed.** The black body was never the problem: it samples at 0.014, far below the dark square (0.097). The old low numbers came from patches landing on gold trim, and from the knights: the black knight rode a pale silver horse (body 0.42, reads as a white piece) and the white knight a red one.
- **Knights.** Steed coats now stay inside their side's value band: white `0xecd8ba`, black `0x2c3850` (`whiteSteedMat`, `blackSteedMat`, `CHESS_DEFAULT_ROLE_MATERIALS`). This is a visible design change to an earlier deliberate "contrasting steed" look; xiangqi steeds are untouched.
- **Light squares** 0.175 to 0.162 luminance, to bring the weakest white piece on a light square to 2.0.
- **Table.** A plain matte apron (5.0 m square, `TABLE_APRON_HALF`) around the deck; corner pylons moved out to the apron corners; the two gold rails around the board are 0.03 wide instead of 0.055 and 0.065; board gold metalness capped at 0.3 (was 0.55), which removes most of the frame glare seen from the black side; the lips of the table base are near-black (`TABLE_BASE_LIP_VALUE_SHARE`).
- **Arena floor.** The moat basin and the outer terrace are matte. Their polish mirrored the key light: that was the bright patch at the upper left, from both sides. Floor lines and outer ornaments sit at 0.3 of the theme gold with emissive 0.05.
- **Backdrop.** Cathedral walls, columns and floor keep their baked texture at 0.55 value (`HALL_BACKDROP_VALUE`).
- **Third pass, black pieces (user request).** Dark squares went from 0.066 to 0.085 luminance (0.097 to 0.133 on screen). Black on dark rose to 2.83 / 2.54, white on dark fell to 3.96 / 3.36, light against dark fell to 1.80, below the 2.0 the brainstorm set; the user asked for black readability first. The table above predates this pass; current numbers are in `visuals/readability-final.jsonl`. Tried and rejected: a cool Fresnel edge glow on the black body material. At 40 px piece height it does not outline anything; it greys the whole body (0.014 to 0.034) and dropped black on dark to 1.76.
- **Fourth pass, uneven glare (user request).** One corner of the table was brighter than the others: the lower left from White's seat (old rim light) and the lower left from Black's seat (key light). Cause: each directional light has a mirror point on the table top, at `camera_xz + (camera_y - 0.75) * light_xz / light_y`; when that point lands on the table, the gold rails and piece tops around it shine and bloom. The three lights were moved so the point is off the 5 m apron for both seats: key `(5.0, 8.5, 1.5)`, rim `(0.6, 3.2, -8.5)`, south fill `(4.2, 4.4, 7.5)`. Rim and fill went from 0.80 to 1.10 to keep the fronts of the pieces lit, and the squares to 0.152 / 0.08. Shadows now fall sideways (toward the A file) instead of back-left. Current numbers (median / min): white on light 2.28 / 1.93, white on dark 3.99 / 3.37, black on light 5.11 / 4.85, black on dark 2.87 / 2.39, light against dark 1.76. Evidence: `visuals/final-even-light-white-and-black-side.jpg`. Keep the mirror-point rule in mind before moving any light or the spectator camera.
- Checked by eye: black-side camera, xiangqi, portrait 390x844, landscape 844x390, tablet 1024x1366 (`visuals/final-portrait-tablet-blackside.jpg`, `visuals/readability-final-hogwarts.png`).
- Checks: `npm test` 32 pass, lint clean, build succeeds, `ultra checkmate p95` passes, `e2e/game-smoke.spec.ts` 15 pass and 1 skipped, all on the final state.

## How to measure

- Contrast: `READABILITY=1 READ_LABEL=<label> READ_OUT=<dir> npx playwright test e2e/board-readability.spec.ts`. Prints one `READABILITY {json}` line and writes a screenshot and a `.jsonl` file. `READ_GRID=1` prints per-square and per-piece values.
- Frame time: `PERF=1 npx playwright test e2e/perf-budget.spec.ts -g "ultra checkmate p95"`. Numbers drift with machine load, so compare against `main` in the same sitting.
- Close-ups of every piece: `SHOTS=1 SHOT_LABEL=<label> npx playwright test e2e/piece-pilot-shots.spec.ts`.
- Playwright uses port 3107; `lsof -i :3107` must be empty afterwards.

## Open problems, most important first

1. **Black pieces show little form.** They read clearly as black with gold trim, but the body is a near-silhouette (0.014). Lifting the body costs contrast directly: 0.025 is the ceiling for a 2.0 ratio on dark squares. Tried and rejected: a cool rim light at 1.6 (no visible form, squares brightened, white on light fell to 1.88, dark spread 1.30); lighter charcoal (first session). Not tried: normal-map or sheen detail on the black material, a lighter dark square paired with a darker light square.
2. **Black pawns are 46 to 53% gold trim** by screen area, against about 26% for white pawns. The shield emblem is the loudest thing on the far ranks.
3. **Table and arena are re-materialled and extended, not rebuilt.** The apron is one box; there is no engraved frame model and no separate light rig (three.js has no per-object light linking).
4. **Seen from the black side** a thin bright line remains on the near gold rail, and the black rook's flat top shows a pale highlight.
5. **The brazier plinths** (baked into the cathedral model) are the brightest warm objects beside the board in the default view.
6. **Dead code:** `src/soundEngine.ts` has no per-skin code. `attachSkinKitbashToPiece` is still called on every piece; its inner branches were not audited for ones only the removed sets used.
7. **Server and stored data:** purchases were only ever stored in `localStorage` (`wizard_chess_unlocked_skins_v1`); that key is now ignored. If any real payment record exists outside the client, it was not looked for.

## Constraints to keep

- Reply to the user in Vietnamese. Markdown only under `plans/` or `docs/`.
- No commit, push, PR or deploy unless the user asks. Conventional commit messages, no AI attribution lines.
- `test/applet.test.mjs` pins source strings. `const BOARD_GOLD_MIN_ROUGHNESS = 0.3x` is one of them, which is why that constant is 0.39. Change a pinned test only when the user changes the feature it describes.
- Piece GLBs: texture-free, 4 primitives, under 400,000 bytes each; after re-encoding bump `ASSET_CACHE_VER`.
- Never print or enter credentials. The G-Labs key is read only through `security find-generic-password -s glabs -w`.

## Suggested next steps

1. Decide with the user whether to commit this branch as it stands (three commits read well: theme removal, readability and knights, table and arena).
2. Ask the user to judge the new knights and the calmer arena by eye; both are taste calls that the numbers do not settle.
3. Define with the user what a "skin package" contains (pieces, board, arena, sounds, effects) and how it registers through the kept seam. This needs product decisions and was not started.
