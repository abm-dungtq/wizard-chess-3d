---
title: Six base chess pieces rebuilt as sculpted statues
date: 2026-11-10
summary: "Pilot verdict was continue; rook, bishop, queen and king now follow the knight and pawn. All within budgets, nothing committed."
---

# Six base chess pieces rebuilt as sculpted statues

## What happened
- The knight and pawn pilot (plans/261110-0904-knight-pawn-redesign-pilot) got the user's verdict: fix the knight's rider and horse weights, then continue with the other four pieces.
- Rook, bishop, queen and king were built by the same route: G-Labs reference image, one Hyper3D generation each, Blender build on the shared plinth, spine binding to the old armature and clips, normal and AO maps as separate webp files.
- Six generations were used in total, which is the plan's limit. One bishop upload was rejected before any generation started.

## What was learned
- A generated figure must not be blended into the Base bone. The rook stretched to 3.32 in Attack that way, because Base and Tower_Lower move 25 cm against each other; starting the figure on the first body bone brought it to 1.24.
- The size limit of 400,000 bytes per piece (glb.gz plus maps) allows about 20,000 exported vertices. The rook needed a second reduction to fit.
- Detail maps add little at play distance; the user chose to keep them.

## State
- npm test pass 32, lint clean, frame time 10.35 ms against a baseline of 14.17 ms.
- Open: the knight still exceeds the stretch limit in Move and Attack (no tearing visible in game); only the bishop was watched through a capture in game among the four new pieces.
- Nothing is committed or deployed. Record: plans/261110-0904-knight-pawn-redesign-pilot/four-piece-followup.md.

## Next steps
- User review of the comparison images, then commit and staging if accepted.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
