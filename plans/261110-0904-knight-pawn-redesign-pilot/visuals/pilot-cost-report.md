# Pilot cost report: knight + pawn redesign (2026-11-10)

## Generation
- 3D provider: Hyper3D (Rodin Gen-2.5-Medium) through its MCP server, Creator plan at $30 per month.
- 3D generations used: 2 of the 6 allowed (one per piece; both first candidates passed all four checks). Credits spent per generation: not measured.
- G-Labs images kept: 5 (one concept sheet, four single-figure references). Regenerated images: not logged.

## Time
Taken from file timestamps, so waiting for the user is included. Per-piece time was not measured separately.

| Step | Elapsed |
|---|---|
| Baseline and tooling (phase 1) | not measured |
| Concept sheet to approved references (phase 2) | about 25 min |
| Hand-modelling attempt in Blender, later dropped | about 35 min |
| Generation, download, import (phase 3) | about 12 min |
| Cleanup, zones, weights, export, in-game check, both pieces (phase 4) | about 12 min |
| Bake and engine wiring (phase 5) | about 10 min |
| Comparison and report (phase 6) | about 15 min |

## Budgets
| | Pawn before | Pawn after | Knight before | Knight after |
|---|---|---|---|---|
| Vertices | 21,875 | 20,453 | 13,623 | 13,068 |
| Triangles | 40,648 | 20,298 | 24,053 | 11,096 |
| `.glb.gz` bytes | 215,492 | 300,511 | 180,254 | 223,391 |
| Total with maps (limit 400,000) | 215,492 | 390,413 | 180,254 | 324,121 |

Frame time (`medianMean`, ultra tier): baseline 14.17 ms (larger of two runs, 13.09 and 14.17), after 11.9 ms. Within the limit of baseline plus 5%; the run-to-run noise is about 8%.

## Clips
Maximum edge ratio per clip (limit 1.6 for Idle, Move and Attack; Shatter is recorded only).

| | Idle | Move | Attack | Shatter |
|---|---|---|---|---|
| Pawn | 1.212 | 1.367 | 1.588 | 3.113 |
| Knight, first build | 1.362 | 2.119 (over) | 2.853 (over) | 12.504 |
| Knight, reworked weights | 1.200 | 1.983 (over) | 2.795 (over) | 11.887 |

Shatter needed no fallback: the game spawns stone fragments right after the clip and no stretch shows in the capture frames.

## Estimate for the four remaining pieces
Assumption: rook like the pawn; bishop, queen and king between pawn and knight.

- Generations: 4 if every first candidate passes as in the pilot, up to 8 with a second candidate each.
- G-Labs images: 8 references (two per piece); the concept sheet already covers all six.
- Working time: about 20 min per simple figure and 30 to 40 min per complex one with the scripts as they are, so roughly 2 hours, plus the user's review at each gate. A piece with a second body (like the horse) needs its own weight rule.
- Download size: about 110 to 175 kB more per piece than today if maps are kept.

## Known issues
- `kongming` was consulted for none of the failed checks; each was diagnosed in the session and is listed here.
- Knight stretch limit still exceeded after the weight rework: Move on 6 edges, Attack on 132 of 15,956 edges (0.8%), all 1 to 2 cm long, where rider, mane and neck meet. The old rig moves these bones 20 to 40 cm against each other there. Not visible at board distance.
- Fixed in the rework: the rider (body, arms, legs, lance) now takes the team colour and only the horse takes the steed colour. A short zigzag remains where the rider's skirt meets the croup.
- The horse lifts off and sinks into the plinth during Attack (the old rig moves the whole horse).
- Detail maps add almost nothing visible at play distance (`compare-maps-closeup.jpg`); kept by user decision. The pawn is 9,587 bytes under the size limit.
- Gems come out as trim instead of glow. Much sculpted detail is lost in the reduction from 500,000 triangles.
- The Blender add-on route (`generate_3d`) does not work with the Creator plan; generation runs through the Hyper3D MCP server and files are imported by hand.

## Acceptance criteria
1 silhouette gate: met (phase 2). 2 user preference: open, this verdict. 3 clips without stretch: pawn met, knight not met (table above). 4 tests: met (`pass 32`, `fail 0`). 5 budgets and frame time: met. 6 this report: met.

User verdict (2026-11-10): revise the knight first (done, see Clips), then continue with rook, bishop, queen and king.
