# Brainstorm: movement, capture attacks, shatter and check effects

Date: 2026-11-10. Branch: `claude/board-arena-readability`. Request: ideas to upgrade how pieces move, how they strike when capturing, how a struck piece breaks, and what happens on check. Status: option B chosen and built for chess; see "Decisions and outcome" at the end.

## What the code does today

Evidence: `src/wizardChessEngine.js`, `src/soundEngine.ts`.

| Area | Today | Weak point |
|------|-------|------------|
| Movement | `LOCOMOTION_GAIT_PROFILES` gives each type a step bob, a hover, a lean and a sway; the knight vaults in an arc. | No anticipation before the move and no settle after it. No trace on the board: no dust, no trail, no contact mark on landing. Every piece arrives the same way. |
| Capture attack | `ATTACK_SYNC_PROFILES` has one signature attack per type, synced to animation clips, with code-built effect meshes (`addCombatVfxMesh`), a duel camera swoop, and a hit-stop of 45 to 65 ms on three types only. | Five of the nine profiles (pawn, advisor, knight, bishop, queen) have no hit-stop, so those hits have no weight. Correction, found during implementation: the victim does already react per attacker type (shove, crush, lift, roll); the first version of this report wrongly said it stands still. |
| Shatter | `spawnStoneShatter` throws 20 to 24 copies of one shared shard shape, coloured body or trim, with a velocity pattern per attacker type, plus one flash light. | The shards do not look like the piece that broke; the piece vanishes and generic chips appear. Nothing stays on the board: no dust, no rubble, no mark. Debris ignores the table. |
| Check | A red ring under the king, `playCheckWarning`, and "(Check!)" in the HUD. | It is a marker, not an event. Nothing shows who gives check or along which line, and the king does not react. |

Constraints found in the code: three motion levels (`full`, `quick`, `off`) that every effect must respect; three quality tiers; bloom threshold 1.0, so only emissive effects glow; the frame budget test (`ultra checkmate p95`) and the phone budget test; piece models are texture-free GLBs under 400 KB with no fracture data.

## Contract

- Outcome: a move, a capture and a check each read as a short event with a beginning, a hit and an aftermath, and a player can tell what happened without reading the HUD. The effects make the board easier to follow, not harder.
- Constraints: the readability work stays intact (no effect may leave bright light on the squares after it ends, and none may hide a piece for longer than its own animation); motion levels and quality tiers are honoured; frame time stays within the existing budget tests; total move time does not grow by more than about 15% at `full` and not at all at `quick`; no new piece models or clips; `npm test` stays green with pinned strings unchanged.
- Non-goals: checkmate sequence and kill-cam, xiangqi-specific choreography, sound redesign beyond cues for new events, skin-package effect variants (the seam should allow them, they are not built now), the AI and the rules.
- Acceptance criteria:
  1. Movement: every type shows anticipation and settle; a landing leaves a visible contact effect; the travelled path is readable for at least 300 ms after a long move.
  2. Capture: the victim reacts before it breaks, and every type has a hit-stop.
  3. Shatter: the fragments are recognisably the struck piece, and some rubble or mark remains on the square for a few seconds, then fades.
  4. Check: the checking line from attacker to king is shown, the king reacts, and the cue is distinct from a normal move. With motion `off`, the line and the ring still show without animation.
  5. `ultra checkmate p95` and the phone budget test pass; the readability spec numbers on the start position do not change.

## Ideas by area

### Movement

1. **Anticipation and settle.** A short crouch or lean back before the move (about 80 ms) and an overshoot with a damped settle on arrival, scaled per type: heavy for rook and king, light for bishop and queen. This costs almost nothing and changes the feel of every move.
2. **Contact effects.** A dust puff and a brief dark contact ring on landing; the knight's landing sends a low ring; the rook grinds a short spark line along its path.
3. **Path trace.** A faint team-coloured ribbon along the travelled path that fades in about half a second. It doubles as a last-move aid, which helps readability.
4. **Role identity in motion.** Bishop glides with a faint wake, queen leaves a short comet tail, pawn marches with a small shield bump, king's steps shake nearby dust.

### Capture attacks

5. **Victim reaction.** On the first contact the victim flinches and is pushed a few centimetres along the strike direction, tilts, and flashes pale for two frames, then breaks on the final blow.
6. **Hit-stop for every type**, 30 to 70 ms scaled by attacker weight, with a small camera kick along the strike direction.
7. **Anticipation flash.** A brief gleam on the weapon just before the swing, so the eye is on the attacker when the hit lands.
8. **Impact frame.** One frame of strong rim light on both pieces at contact (the black-body edge-glow shader that was rejected for the idle state suits a two-frame flash).

### Shatter

9. **The piece itself breaks.** Instead of generic shards, cut the victim's own mesh into chunks at the moment of impact. Two routes: (a) slice the geometry by a few planes at load time into 6 to 10 chunks per type and cache them; (b) keep the mesh whole and discard pixels along a 3D noise crack pattern in the shader while the existing shards fly, which shows the piece cracking apart for free.
10. **Layered break.** Crack lines glow first (80 ms), then large chunks fall with the strike direction, then small chips and a dust cloud, in that order.
11. **Debris meets the table.** Chunks bounce once on the board plane, roll, and come to rest; they fade after about three seconds.
12. **Aftermath on the square.** A dust haze and a faint scorch or crack decal that fades over a few seconds. It tells the player where the capture happened.
13. **Captured-piece tray.** Rubble drifts to the side of the table and re-forms as a small trophy. This is a larger feature and sits next to the material-advantage display.

### Check

14. **Threat line.** A red line or beam from the checking piece to the king, drawn once and then held as a thin pulse while the check lasts. A double check shows two lines.
15. **King reaction.** The king flinches or raises its guard; its ring switches from a static ring to a slow radial pulse.
16. **Stage response.** A short red vignette pulse at the screen edge, the braziers flare for half a second, and a low bell. No change to the light on the squares.
17. **Escape hint.** While in check, legal moves that answer it are marked more strongly than usual. This is a gameplay aid and needs a product decision.

## Options

### A. Timing and reaction pass (about 2 to 3 days)

Ideas 1, 5, 6, 7 and 14 to 16. No new geometry: only curves, hit-stop, the victim's reaction, and the check line, ring pulse and vignette.

- Depends most on: weight and reaction being what is missing, more than spectacle.
- Fails first if: the generic shards still spoil the capture after the hit feels right, which is likely.

### B. A plus real shatter and traces (recommended, about 5 to 7 days)

Everything in A, then ideas 2, 3, 9 (route b first, route a for the six base types if route b is not convincing), 10, 11 and 12. Built as one small effect layer with a per-type table, the same shape as `ATTACK_SYNC_PROFILES`, so a future skin package can supply its own values.

- Depends most on: pre-cut chunks or the crack shader staying inside the frame budget on phones; chunk count is the dial.
- Fails first if: slicing texture-free sculpted meshes gives ugly open faces. The fallback is the crack-discard shader plus the existing shards, which needs no cut geometry.

### C. Cinematic layer on top of B (about 2 weeks or more)

B plus ideas 4, 8, 13, 17, per-type finishing moves, slow motion on important captures, and screen-space distortion on heavy hits.

- Depends most on: players wanting a show on every capture.
- Fails first if: it slows play. In a long game the tenth slow-motion capture is a cost, so it would need a frequency rule (for example only for queen captures and checks) from the start.

## Trade-offs

- A is cheap to abandon and proves the feel in days, but leaves the weakest picture in the game (generic shards) in place.
- B touches the shatter path and adds a decal and chunk pool that must be cleaned up on undo, reset and room sync; that cleanup is where bugs are most likely. It is still the smallest option that covers all four areas the request names.
- C has the highest ceiling and the highest risk to game pace and to the readability work just finished.
- Second case traced through each option: a future skin package with its own pieces. Under A nothing changes for it. Under B it reuses the layer and supplies a table of values plus, if route (a) is used, its own cut chunks; route (b) works on any mesh without extra assets, which is the stronger reason to try (b) first. Under C each package would also need finishing moves, which multiplies the cost of every skin.

Better approaches: none beyond the requested direction. The recommendation is B, delivered as A first, with the frame-budget tests and the readability spec as the gate after each step.

## Decisions and outcome (user, 2026-11-10)

1. Scope: option B. 2. A capture may take up to about 15% longer at motion `full`. 3. The path ribbon fades completely. 4. No escape hint during check. 5. Chess first; after it, the same overhaul for xiangqi (characters, board, movement, attack, shatter, check).

Built for chess, uncommitted on `claude/board-arena-readability`:

- `src/pieceEffects.js` (new): dust, landing ring, path ribbon, scorch mark, and shatter chunks. A chunk is a copy of the struck piece drawn through four clipping planes (route a without pre-cut geometry: 4 chunks for a pawn-sized piece, 6 otherwise), so the fragments are the piece itself. Chunks bounce once on the table and fade after 2.4 s; the scorch fades over 4 s.
- `src/wizardChessEngine.js`: anticipation and settle in `applyConcreteTrajectory`, ribbon at move start, landing effect in `finishMove`, chunks at the shatter, generic shards cut from 24/20 to 14/12, a hit-stop of 30 to 40 ms for the five types that had none, a red line from each checking piece to the king, a king flinch, a brazier flare and a red screen-edge pulse (`#check-vignette` in `src/App.tsx` and `src/styles.css`).
- Not built from option B: idea 5 (already present, see the correction above), idea 7 (weapon gleam) and the crack-glow first stage of idea 10.
- With motion `off`: no ribbon, dust, chunks, flinch, flare or vignette; the check line and ring show without animation.
- Evidence: `plans/261110-2103-board-arena-readability/visuals/effects-move-capture-check.jpg`; frame strips with `FX=1 FX_OUT=<dir> npx playwright test e2e/piece-effects-shots.spec.ts` (`FX_MOTION=off` for the reduced level).
- Checks: `npm test` 32 pass, lint clean, build succeeds, smoke 15 pass and 1 skipped, `ultra checkmate p95` 17.7 to 18.2 ms and `base phone p95` pass, readability numbers on the start position unchanged. `ultra checkmate vsync p95` fails at 17.9 to 18.1 ms against a 17 ms limit, and fails the same way without this work (17.8 to 18.3 ms). The first move of a session has one long frame of about 100 ms; that is also present without this work.

## Unresolved questions

1. Idea 7 (weapon gleam before the swing) and the crack-glow stage of idea 10 were left out; are they wanted before the xiangqi pass?
2. The `ultra checkmate vsync p95` limit of 17 ms fails on this machine with and without this work. Is the limit or the machine the reference?
