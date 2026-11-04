---
title: Premium visual slice 1 shipped to staging
date: 2026-11-04
summary: "Phases 1-8 done: 3/4 camera, glass dock, hover labels, tiered post-FX, meshopt glb.gz; ultra met 12 ms only after bloom quarter-res and DPR 1.25"
---

# Premium visual slice 1 shipped to staging

## What happened
Executed plans/261103-1655-premium-visual-slice-1 end to end under kongming checkpoints. Phases 6-8 this stretch: labels only on selection/hover, one Liquid Glass desktop dock, frame and wire budgets, staging deploy, and removal of the old .glb.gz.b64 format.

## Key findings
- The ultra checkmate budget (median mean <= 12 ms) failed at DPR 1.35 (12.65 ms). preserveDrawingBuffer was not the cause. The plan's reduction ladder fixed it: bloom at quarter resolution (12.93 ms, still failing), then an ultra desktop DPR cap of 1.25 (median 11.44 ms).
- The vsync-on p95 <= 17 ms criterion cannot be judged on this Mac: both monitors run at 100 Hz, so a 12.6 ms frame lands on every second 10 ms vsync. The test hard-asserts and fails here.
- The Playwright perf contexts must set deviceScaleFactor 2; the default 1.0 silently measured the wrong DPR.
- A temporary phone config without the GPU launch flags fell back to software rendering; the flags must stay.
- Staging: first playable 8.88 MB (cathedral 5.0 MB), each skin set under 1 MB, .glb.gz served as application/gzip with no content-encoding. cache-control is duplicated in the headers config.

## Decisions
- ultra desktop DPR capped at 1.25; other tiers 1.35.
- Models ship only as meshopt .glb.gz. The encoder reads plain .glb sources; glb:unpack strips meshopt and quantization for Blender. ASSET_CACHE_VER unchanged because shipped bytes did not change.
- Kongming recommends one PR for the whole branch, since only HEAD was measured on staging.

## Next steps
- User decision: open the PR, deploy production.
- Vsync check on a 60 Hz display; KTX2 for the cathedral after installing KTX-Software (then bump ASSET_CACHE_VER).
- Follow-ups: first-checkmate shader stall 80-115 ms, sheet backdrop over the close button, 3/4 view not auto-flipping in pass-and-play, Bokeh aspect not updated on resize, duplicated cache-control.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
