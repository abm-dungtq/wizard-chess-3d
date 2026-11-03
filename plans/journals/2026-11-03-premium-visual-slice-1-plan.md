---
title: Premium visual slice 1 plan
date: 2026-11-03
summary: "Handover plan for 3/4 camera, glass dock, hover labels, tiered post-FX, Motion setting, meshopt assets, audio unlock; kongming GO-WITH-FIXES applied"
---

# Premium visual slice 1 plan

## What happened
Wrote plans/261103-1655-premium-visual-slice-1 (8 phases, PR A = settings/assets/audio, PR B = post-FX/camera/labels/dock/budgets) from the premium-visual brainstorm. kongming reviewed: GO-WITH-FIXES, 12 fixes, all applied.

## Key catches
- Cloudflare does not compress model/gltf-binary, and the 26 MB-raw cathedral loads at start-up, so the wire budget must count uncompressed meshopt bytes; .glb.gz + DecompressionStream is the planned fallback.
- The start-up camera is set by resetChessBoard's orientCamera block (forces btn-cam-top), not the camera constructor.
- smoothCameraTo clamps duration >= 0.05, so Motion "off" needs the immediate path.
- `'gpu' in navigator && DPR>=2` would give ultra to iPads and 200% Windows laptops; use unmasked Apple GPU + no touch.
- gltf-transform meshopt() already reorders and quantizes.
- Hover must raycast square tiles, not SkinnedMesh pieces.

## Next steps
/ak:cook plans/261103-1655-premium-visual-slice-1/plan.md --advice (needs user go-ahead).

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
