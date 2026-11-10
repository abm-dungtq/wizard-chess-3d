# Four-piece follow-up: rook, bishop, queen, king

Date: 2026-11-10. Trigger: the user's verdict after phase 6 ("continue with the four other pieces"). Same route as the pilot: one G-Labs reference image per piece, one Hyper3D generation, Blender build on the shared plinth, spine binding to the old armature and clips, normal and AO maps as separate files.

## Result

All four pieces are in the game for the base set, both teams, with the old armatures, joint names and four clips. Nothing is committed.

| Piece | Vertices (old) | `.glb.gz` + maps, bytes | Idle max / min | Move max / min | Attack max / min | Shatter max / min |
|-------|----------------|-------------------------|----------------|----------------|------------------|-------------------|
| Rook | 20,301 (25,889) | 383,173 | 1.177 / 0.851 | 1.110 / 0.885 | 1.240 / 0.737 | 2.639 / 0.043 |
| Bishop | 15,356 (18,341) | 308,943 | 1.153 / 0.804 | 1.112 / 0.907 | 1.249 / 0.807 | 5.061 / 0.591 |
| Queen | 18,208 (34,002) | 346,616 | 1.120 / 0.841 | 1.115 / 0.854 | 1.344 / 0.656 | 1.503 / 0.540 |
| King | 19,390 (36,152) | 368,269 | 1.056 / 0.932 | 1.080 / 0.923 | 1.118 / 0.846 | 1.375 / 0.451 |

The stretch columns are edge-length ratios against the rest pose; the limit is 1.6 / 0.5 for Idle, Move and Attack, and all four pieces are inside it. Shatter is recorded only, as in the pilot.

## Checks

- `npm test`: `pass 32`, `fail 0`; `test/` unchanged. `npm run lint`: exit 0.
- Every GLB: 4 primitives, 0 textures, clips `Attack Idle Move Shatter`. `encode-glb-assets.mjs --check`: `CHECK OK 6`.
- Size limit 400,000 bytes per piece and vertex count no higher than the old piece: met for all four.
- Frame time (`ultra checkmate p95`): baseline 14.17 ms, now 10.35 ms, `PERF_OK` (`visuals/after4-perf.txt`).
- Port 3107 free after every run.

## How it was built

- Spine knots (z, bone): rook 0.25 Tower_Lower, 0.62 to 0.80 Tower_Upper, 1.15 Battlement_Crown; bishop 0.35 Robe_Lower, 0.80 to 1.05 Torso, 1.25 Head_Mitre; queen 0.35 Skirt_Lower, 0.85 to 1.15 Torso, 1.35 Head_Crown; king 0.35 Robe_Lower, 0.85 to 1.12 Torso, 1.32 Head_Crown.
- The figure is not tied to the `Base` bone. The rook's first binding blended `Base` into `Tower_Lower` and stretched to 3.32 in Attack, because those two bones move 25 cm against each other; with the figure starting on `Tower_Lower` the ratio is 1.24. The plinth alone follows `Base`.
- `build_generated.py` has a new option `MAX_STRETCH`; 1.0 keeps the plinth round (used for all four). Rook plinth radius `FOOT_R=0.46`, king `CENTRE=(0, 0)` and `FOOT_R=0.426`.
- The rook was reduced twice: 9,000 figure vertices gave 411,370 bytes (over the limit), 8,000 gives 383,173.
- Engine: four entries added to `BASE_PIECE_DETAIL_MAPS`, `ASSET_CACHE_VER` is `v=statue_pilot_v4`.
- `e2e/piece-pilot-shots.spec.ts` now also takes close-ups of rook, bishop, queen and king, and has a `bishop clip frames` test.

## Evidence in `visuals/`

- `montage-four-{hogwarts,jade,royal}.png`: old (top row) against new (bottom row), white then black, rook, bishop, queen, king.
- `montage-four-board-hogwarts.png`: whole board, old above new.
- `montage-four-bishop-capture.jpg`: six frames of a bishop capture in game.
- `before4-*` and `after4-*`: the single shots.

## Known issues

- Limbs, staffs and swords are part of the statue and do not move on their own; only the spine bones are used, as decided for the pilot.
- From the default camera the white pieces are seen from behind, so the new white rook, bishop and king show less gold than the old ones; the detail is on the side facing the opponent.
- The queen's gown and the rook's base band are slightly wider than the plinth top.
- Only the bishop was watched through a capture in game. The other three were checked by the stretch numbers and still shots.
- The knight's open stretch limit in Move and Attack from the pilot is unchanged.
- Cost: 4 generations (6 in total, the plan's limit), roughly one hour of work for the four pieces (not timed precisely).
