---
title: "Knight + pawn redesign pilot (AI-assisted sculpted pieces)"
description: "Replace the base-set knight and pawn with sculpted statue figures made from a concept sheet, image-to-3D and Blender, and judge them in game before paying for the other four pieces."
status: pending
priority: P1
effort: 15h
branch: claude/redesign-3d-chess-pieces-bf8f22
tags: [feature, frontend, assets, rendering, experimental]
blockedBy: []
blocks: []
created: 2026-11-10
---

# Knight + pawn redesign pilot

Source decision: [brainstorm report](../reports/brainstorm-261110-1542-ai-assisted-piece-redesign.md), approach C (hybrid). User decisions on 2026-11-10: living-statue animation (spine binding only), Hogwarts wizard style kept, at most 6 `generate_3d` calls, concept images from G-Labs (ChatGPT image).

This plan is written for a downstream executor model. Every phase lists tasks with exact targets and mechanical Verify conditions, and carries its own Failure Protocol. Stopping on a failed Verify is intended behavior, not a stall.

## Overview

The base ("hogwarts") knight and pawn become sculpted statue figures with silhouettes that read at the default camera. They keep team and theme tinting, the existing armature and the four clips. The pilot ends with a side-by-side comparison and a cost report, and the user decides whether to continue with the other four pieces.

## Facts verified before planning

- Models: `public/assets/glb/pawn_white.glb.gz` (21,875 vertices, 40,648 triangles, 215 kB) and `knight_white.glb.gz` (13,623 vertices, 24,053 triangles, 180 kB). One mesh each, four primitives, no textures, `TEXCOORD_0` present.
- Material names decide the look. The engine replaces every GLB material by name keyword:
  - contains `Glow` → accent material; contains `Gold`, `Trim` or `Bronze` → trim; contains `Steel` → steel; anything else → body (`bank.primary`).
  - Sites: `src/wizardChessEngine.js` near lines 2016-2070 and 4556-4580.
- Current names: `pawn_WhiteMarble.002`, `HogwartsTrim_AntiqueGold.012`, `HogwartsSteel_Silver.012`, `HogwartsGlow_Gold.012` (knight: same with other suffixes).
- Pawn joints: `Root Base Pelvis Torso Head Shoulder.L Arm.L Shield_Bone Shoulder.R Arm.R Sword_Bone`.
- Knight joints: `Root Base Horse_Rear BackLeg.L BackLeg.R Horse_Chest FrontLeg.L FrontHoof.L FrontLeg.R FrontHoof.R Horse_Neck Horse_Head Rider_Torso Rider_Arm.L Shield_Bone Rider_Arm.R Lance_Bone Rider_Head`.
- Clips on both: `Idle`, `Move`, `Attack`, `Shatter`, 1.875 s each, every joint keyed (translation, rotation, scale).
- The knight's horse gets its own "steed" material at load: triangles whose dominant bone matches `Horse_|BackLeg|FrontLeg|FrontHoof` are split off (`src/wizardChessEngine.js` near lines 3880-3965).
- `test/applet.test.mjs` parses `pawn_white` in Node with a loader that cannot decode images. It asserts exactly 2 meshes whose material name contains `Gold`, `Trim` or `Glow`, and 3 meshes after the gold merge. So the pawn must keep exactly four primitives and the GLB must contain no textures.
- `npm test` passes today: 32 tests.
- Themes that use the base meshes: `hogwarts`, `jade`, `royal`, `astral`, `slytherin`.
- Encoder: `node scripts/encode-glb-assets.mjs <sourceDir>` writes `<name>.glb.gz` into `public/assets/glb`. `/assets/*` is cached for a year, so `ASSET_CACHE_VER` (`src/wizardChessEngine.js` line 3735, now `'v=meshopt_v1'`) must change after re-encoding.
- G-Labs webhook answers at `http://127.0.0.1:8765` (`GET /api/health` returned `ok`). ChatGPT images come from `POST /api/openai/generate`.
- Blender MCP was not connected at planning time. The user must open Blender with the MCP add-on.

## Constraints

- Keep three.js r170, the `.glb.gz` format, the armature, the joint names and the four clip names.
- Do not weaken or delete any assertion in `test/applet.test.mjs`.
- No textures inside the piece GLBs. Detail maps ship as separate files.
- Per piece: vertex count no higher than today, and `.glb.gz` plus detail maps at most 400 kB.
- At most 6 `generate_3d` calls in total. Each call spends the user's credits.
- The G-Labs API key is a secret. Read it from the `GLABS_API_KEY` environment variable only. Never write it to a file, a commit, a log or a report.
- Work in this worktree. Scratch files go in `.tools/piece-redesign/` (ignored by git). Evidence images for the user go in `visuals/` inside this plan folder.
- Do not change chess rules, AI or room protocol code. No deploy, no push and no PR without the user's approval in chat.
- Stop any dev server you start when its task ends. Playwright uses port 3107.
- When a Failure Protocol tells you to spawn `kongming`, pass the model `fable` explicitly. The installed agent definition's default model id is rejected by the API (seen on 2026-11-10).

## Non-goals

- Rook, bishop, queen and king. They follow only if the user approves after phase 6.
- The seven sculpted sets in `public/assets/glb/sets/` and the xiangqi set.
- Limb, weapon or leg animation. Unweighted bones stay in the armature and are simply not used.
- New clips, a Godot export, or changes to the old `.tools/sculpt_*_via_mcp.py` scripts.

## Phases

| # | Phase | Effort | Status | Depends on |
|---|-------|--------|--------|------------|
| 1 | [Baseline, tooling and workspace](./phase-01-start.md) | 2h | Done | none |
| 2 | [Concept sheet and silhouette gate](./phase-02-concept-sheet-silhouette-gate.md) | 2h | Done | 1 |
| 3 | [Mesh generation](./phase-03-mesh-generation.md) | 1.5h | Done | 2 |
| 4 | [Blender build, rig and export](./phase-04-blender-build-rig-export.md) | 5h | Done, knight stretch limit open | 3 |
| 5 | [Body detail maps](./phase-05-body-detail-maps.md) | 3h | Done, maps kept by user decision (little visible gain at play distance) | 4 |
| 6 | [In-game comparison and verdict](./phase-06-ingame-comparison-verdict.md) | 1.5h | Done, verdict: continue. Rook, bishop, queen and king built the same way, see [four-piece follow-up](./four-piece-followup.md) | 4, 5 |

Phases 2, 3 and 6 each end at a user gate. Wait for the user's answer in chat before starting the next phase.

## Acceptance criteria (whole plan)

1. The user names all six pieces correctly from the shuffled silhouette strip (phase 2).
2. In same-camera before/after screenshots, the user prefers the new knight and pawn for both teams in at least two themes (phase 6).
3. `Idle`, `Move`, `Attack` and `Shatter` play on both pieces with no torn or stretched mesh (phases 4 and 6).
4. `npm test` prints `pass 32` and `fail 0`, with `test/applet.test.mjs` unchanged.
5. Vertex and size budgets hold, and the frame-time check in phase 6 is no worse than baseline plus 5%.
6. `visuals/pilot-cost-report.md` records credits used, hours per piece and the estimate for six pieces.

## Risks

- **Shatter on spine-only weights is untested.** If the mesh stretches, phase 4 stops at its Failure Protocol. The fallback to propose is a fragment effect for that clip.
- **Generated meshes may ignore the colour zones.** Phase 4 guarantees all four material slots through the shared plinth, so tests pass even if a figure ends up body-only.
- **Normal maps without tangents may show seams.** Phase 5 checks close-up screenshots. Phase 5 is optional for the verdict: phase 6 can run with phase 4 output alone.

<!-- slug: knight-pawn-redesign-pilot -->
