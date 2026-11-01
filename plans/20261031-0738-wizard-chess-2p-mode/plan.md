---
title: "Wizard Chess 3D — 2-Player Mode (Pass & Play Hotseat, 3D Auto-Flip Camera & Cross-Tab Room Sync)"
status: completed
mode: advice
created: 2026-10-31T07:38:30+07:00
---

# Plan: Wizard Chess 3D — 2-Player Mode (`--advice` Handover Plan)

## Contract Summary (Reused from Accepted `--ultra` + `--advice` Brainstorm)
- **Outcome:** Enable 2-Player gameplay in Wizard Chess 3D supporting:
  1. **Local 2-Player Pass & Play (Hotseat):** Toggleable directly from `#btn-ai-difficulty` (`Novice -> Tactical -> Grandmaster -> 2 Players`), disabling automatic AI replies (`aiAutoPlay = false`), allowing human control of both White (`w`) and Black (`b`) turns, smoothly auto-flipping the 3D camera (`0.8s`) to the active player's side after normal moves and directly from the close-up duel pose (`duelCamClose`) after capture moves without a 1-frame snap-back (`autoFlipCamera2P` toggleable via `#btn-side-toggle`), and stepping back 1 ply on `#btn-undo`.
  2. **Cross-Tab / Multi-Window 2-Player Room Sync (`?room=CODE`):** Null-safe `createMultiplayerRoom` / `joinMultiplayerRoom` + `BroadcastChannel('wizard_chess_mp_channel')` + `localStorage` sync with pawn promotion parity and startup `?room=CODE` / `?mode=2p` support.
- **Constraints:**
  - Preserve all 14 required HUD IDs in `src/App.tsx` (`btn-side-toggle`, `btn-ai-difficulty`, `btn-ai-move`, `btn-undo`, `btn-reset`, `btn-audio-toggle`, `btn-cam-player`, `btn-cam-top`, `btn-cam-side`, `btn-cam-wide`, `btn-hide-ui`, `controls-hint`, `captured-tray`, `promotion-overlay`).
  - Never introduce any of the 12 forbidden IDs in `src/App.tsx` (`cam-speed-wrap`, `input-cam-speed`, `rot-speed-wrap`, `input-rot-speed`, `script-bar`, `btn-script-modal`, `btn-script-prev`, `btn-script-next`, `btn-lobby`, `lobby-modal`, `room-pill`, `btn-checkmate-stepback`).
  - Pass `npx tsc -p tsconfig.json --allowJs --checkJs --noEmit` with 0 `TS2304`/`TS2552` undeclared identifier errors in `src/wizardChessEngine.js`.
  - Always restore `activeDuelSavedCam = null; orbitControls.enabled = true; orbitControls.update();` in `finishMove()` after capture duels.
- **Non-goals:** No user accounts/ELO, no forbidden `#lobby-modal`/`#room-pill` DOM elements, no external WebRTC dependencies.

## Phases
- [x] 1. [Phase 1: 2-Player Pass & Play State, Seamless Capture-Duel Auto-Flip Camera & 1-Ply Undo](./phase-01-engine-2p-and-camera.md)
- [x] 2. [Phase 2: HUD Mode Cycling, Null-Safe Cross-Tab `?room=CODE` Sync & Verification Suite](./phase-02-hud-room-sync-and-tests.md)
