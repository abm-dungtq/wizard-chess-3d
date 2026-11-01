# Phase 1: Build Fix & Dead-Code Hygiene

## Goal
Fix the TypeScript 7.0.2 `TS2882` side-effect CSS import error in `src/main.tsx` so `npm run lint` (`tsc --noEmit`) exits `0`, and remove unused legacy DOM event listeners in `src/wizardChessEngine.js` while keeping all `window.wizardChess` API methods intact.

## Files to Create or Modify
- `src/vite-env.d.ts` (create)
- `src/wizardChessEngine.js` (modify)

## Tasks & Steps

### Task 1.1 — Add CSS side-effect ambient declaration in `src/vite-env.d.ts`
- **Goal:** `tsc --noEmit` resolves `import './styles.css'` in `src/main.tsx` with 0 errors.
- **Target files and symbols:** `src/vite-env.d.ts`, `tsconfig.json`.
- **Steps:**
  1. Create `src/vite-env.d.ts` declaring `declare module '*.css' {}`.
  2. Run `npm run lint` to verify TypeScript 7.0.2 passes with 0 errors.
- **Success criteria:** `tsc --noEmit` exits with code 0 and prints no `TS2882` error.
- **Verify:** `npm run lint` exits 0 with empty error output.

### Task 1.2 — Clean up dead DOM event listeners in `src/wizardChessEngine.js`
- **Goal:** Remove dead DOM event bindings (`#btn-lobby`, `#tab-single`, `#tab-multi`, `#tab-script`, `#btn-create-room`, `#btn-join-room`, `#btn-checkmate-stepback`, etc.) that reference forbidden UI elements while keeping `window.wizardChess` programmatic methods backward-compatible.
- **Target files and symbols:** `src/wizardChessEngine.js` (`lines 4264-4395`).
- **Steps:**
  1. Replace the dead DOM listener block (`lines 4264-4395`) in `src/wizardChessEngine.js` with minimal safe no-op helpers (`openLobbyModal`, `closeLobbyModal`) so `window.wizardChess` retains its API contract without dead DOM lookups.
- **Success criteria:** `node --test test/applet.test.mjs` and `npm run lint` both exit 0.
- **Verify:** `node --test test/applet.test.mjs && npm run lint` exits 0.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.
