---
title: Knight and pawn redesign pilot planned
date: 2026-11-10
summary: "Six-phase pilot plan for AI-assisted knight + pawn redesign written, reviewed and validated; no code changed"
---

# Knight and pawn redesign pilot planned

## What happened
- Brainstorm concluded the current pieces have a silhouette problem, not a material problem. Chosen direction: concept sheet (G-Labs image API) -> 2D shuffled silhouette gate -> `generate_3d` through Blender MCP -> Blender cleanup -> existing export pipeline -> separate normal/AO maps -> in-game comparison.
- Wrote `plans/261110-0904-knight-pawn-redesign-pilot/` (plan.md + six phase files) for handover to a weaker executor: per-task success criteria, mechanical Verify commands, a Failure Protocol per phase.
- Baseline measured: pawn 21,875 verts / 215 kB, knight 13,623 verts / 180 kB, four primitives each, no textures, clips Idle/Move/Attack/Shatter at 1.875 s, `npm test` pass 32.

## Decisions
- "Living statue": new mesh bound to the spine bones only, existing clips reused. User choice.
- Hogwarts wizard style kept; at most 6 `generate_3d` calls. User choices.
- GLB stays texture-free with exactly four primitives, because `test/applet.test.mjs` parses `pawn_white` in Node without an image decoder. Detail maps ship as WebP files in `public/assets/glb/detail/` and attach in the engine through a mirror material.
- A shared procedural plinth carries all four material slots, so slot names never depend on what the generator returns.
- The G-Labs key is read only from the macOS Keychain into `GLABS_API_KEY` per command; it is never written to a file or typed into a command.

## Review
- `kongming` must be spawned with model `fable`; its default model id returned 404.
- Review verdict go-with-fixes, all applied: `read_homefile` instead of `read_factory_settings` (the latter can drop the MCP add-on), lower decimate targets (UV seams split vertices on export), a non-zero vertex-movement check so the stretch test cannot pass vacuously, clip durations in the stats script, island rule for colour-zone classification, two perf baseline runs.

## Open risks
- Blender MCP parameter names and the G-Labs `21:9` aspect are unverified (fallback `16:9` is in the plan).
- Shatter on spine-only weights is untested; the plan records the stretch numbers instead of failing on them.

## Next steps
- User decides whether to implement. Blender must be open with the MCP add-on, and the key stored in Keychain under service `glabs`.
- Nothing is committed; plan and brainstorm report are untracked files on `claude/redesign-3d-chess-pieces-bf8f22`.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
