---
title: "Wizard Chess 3D v2.0 — FIDE Completeness, 3-Tier Minimax AI, Procedural Web Audio & Tactical 3D UX"
status: completed
mode: advice
created: 2026-10-30T15:27:30+07:00
completed: 2026-10-30T15:48:45+07:00
---

# Plan: Wizard Chess 3D v2.0 Evolution (`--advice` Handover Plan)

## Contract Summary (Reused from Accepted `--ultra` Brainstorm)
- **Outcome:** Upgrade Wizard Chess 3D with 100% green `npm run lint` (`tsc --noEmit`), full FIDE chess rules (En Passant, Pawn Promotion picker, 50-move / Threefold repetition / Insufficient material draws), a standalone 3-tier Minimax + Alpha-Beta + PST + Quiescence AI module (`src/chessAI.ts`), a standalone Procedural Web Audio synthesizer (`src/soundEngine.ts`), and 3D tactical readability + HUD controls (Last Move 3D highlight, King-in-Check crimson ring, Undo/Takeback `#btn-undo`, AI Difficulty selector `#btn-ai-difficulty`, Audio Mute toggle `#btn-audio-toggle`).
- **Constraints:**
  - Preserve all 10 required HUD IDs in `src/App.tsx` (`btn-side-toggle`, `btn-ai-move`, `btn-reset`, `btn-cam-player`, `btn-cam-top`, `btn-cam-side`, `btn-cam-wide`, `btn-hide-ui`, `controls-hint`, `captured-tray`).
  - Never introduce any of the 12 forbidden IDs in `src/App.tsx` (`cam-speed-wrap`, `input-cam-speed`, `rot-speed-wrap`, `input-rot-speed`, `script-bar`, `btn-script-modal`, `btn-script-prev`, `btn-script-next`, `btn-lobby`, `lobby-modal`, `room-pill`, `btn-checkmate-stepback`).
  - Preserve all 7 `.glb.gz.b64` assets in `public/assets/glb/`.
  - Preserve backward compatibility on `window.wizardChess` while adding new programmatic inspection helpers.
  - Never mutate live `boardState` Three.js mesh references during recursive Minimax search (`kongming` advisory guardrail).
- **Non-goals:** No multiplayer lobby restoration, no external audio binary files, no Blender mesh re-authoring.

## Phases
- [x] 1. [Phase 1: Build Fix & Dead-Code Hygiene](./phase-01-build-and-hygiene.md)
- [x] 2. [Phase 2: Complete FIDE Rules & 3-Tier Minimax AI (`src/chessAI.ts`)](./phase-02-fide-rules-and-ai.md)
- [x] 3. [Phase 3: Procedural Web Audio Synthesizer (`src/soundEngine.ts`)](./phase-03-procedural-web-audio.md)
- [x] 4. [Phase 4: Tactical 3D Readability, Promotion UI, HUD Controls & Verification Suite](./phase-04-tactical-ux-and-hud.md)
