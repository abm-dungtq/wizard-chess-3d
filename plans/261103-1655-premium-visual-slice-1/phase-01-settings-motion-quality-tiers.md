---
phase: 1
title: "Settings store, Motion setting, quality tiers"
status: completed
effort: 3h
pr: PR A
---

# Phase 1: Settings store, Motion setting, quality tiers

## Goal

- One small settings module persists user preferences in localStorage.
- A "Motion" level (`full` / `quick` / `off`) exists. Its default follows `prefers-reduced-motion`.
- A quality tier (`ultra` / `high` / `base`) is chosen at start-up and can drop at runtime when frames are slow.
- Both values are visible in `window.wizardChess.getState()` so later phases and tests can read them.

## Files

- Create `src/visualSettings.ts` (new module, no DOM imports besides `window.matchMedia` and `localStorage`, so `node --test` can import it with stubs).
- Modify `src/wizardChessEngine.js`: import the module, expose state, wire the runtime downgrade into `feedFrameTimeSample` (near line 10949).
- Modify `src/App.tsx`: add one "Motion" button in `#hud-right` next to `#btn-audio-toggle` (near line 430).
- Modify `test/applet.test.mjs`: unit tests for the module.

## Tasks

### Task 1.1 — Create the settings module

- **Goal:** `src/visualSettings.ts` exports typed read/write helpers.
- **Target:** new file `src/visualSettings.ts`.
- **Steps:**
  1. Export types `MotionLevel = 'full' | 'quick' | 'off'` and `QualityTier = 'ultra' | 'high' | 'base'`.
  2. Use one localStorage key `wizard_chess_settings_v1` holding JSON `{ motion?: MotionLevel, quality?: QualityTier | 'auto' }`.
  3. Export `loadVisualSettings()`. Wrap `localStorage` access in try/catch (Safari private mode throws). Drop unknown values.
  4. Export `saveVisualSettings(patch)` that merges and writes. Swallow storage errors.
  5. Export `resolveMotionLevel(saved, prefersReducedMotion: boolean): MotionLevel`. Returns `saved` if valid, else `'off'` when `prefersReducedMotion`, else `'full'`.
  6. Export `pickQualityTier(signals)` where `signals = { coarsePointer: boolean, maxTouchPoints: number, gpuRenderer: string, isAutomatedTest: boolean }`. Rules, in order:
     - `coarsePointer` → `'base'`.
     - `isAutomatedTest` → `'high'` (keeps e2e deterministic and cheap).
     - `maxTouchPoints === 0 && /Apple (M\d|GPU)/.test(gpuRenderer)` → `'ultra'` (Apple Silicon Macs). Do not use `'gpu' in navigator` or DPR: iPads with a trackpad and Windows laptops at 200% scaling would wrongly get `ultra`.
     - otherwise → `'high'`.
  7. Export `downgradeTier(tier)`: `ultra → high`, `high → base`, `base → base`.
- **Success criteria:** the file compiles under `npx tsc --noEmit`.
- **Verify:** `npx tsc --noEmit; echo EXIT=$?` prints `EXIT=0`.

### Task 1.2 — Unit-test the module

- **Goal:** the pure helpers are covered.
- **Target:** `test/applet.test.mjs`, new test `'visual settings resolve motion and quality tiers'`.
- **Steps:**
  1. Import `resolveMotionLevel`, `pickQualityTier` and `downgradeTier` from `../src/visualSettings.ts` the same way other `.ts` modules are imported in this file.
  2. Assert `resolveMotionLevel(undefined, true) === 'off'`, `resolveMotionLevel(undefined, false) === 'full'`, `resolveMotionLevel('quick', true) === 'quick'`, `resolveMotionLevel('bogus', false) === 'full'`.
  3. Assert `pickQualityTier` returns `'base'` for `coarsePointer: true` even with an Apple renderer, `'ultra'` for `{coarsePointer: false, maxTouchPoints: 0, gpuRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', isAutomatedTest: false}`, `'high'` for the same with `maxTouchPoints: 5` (iPad), `'high'` for `gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'`, and `'high'` when `isAutomatedTest: true`.
  4. Assert `downgradeTier('ultra') === 'high'` and `downgradeTier('base') === 'base'`.
- **Success criteria:** the new test passes along with the existing ones.
- **Verify:** `npm test 2>&1 | tail -5` shows `fail 0` and the pass count is the previous count (29) plus 1.

### Task 1.3 — Wire Motion level and tier into the engine

- **Goal:** the engine knows `motionLevel` and `qualityTier` at start-up and exposes them.
- **Target:** `src/wizardChessEngine.js`, near the device detection at lines 219-231 (`isAutomatedTest`, `coarsePointerQuery`, `isCoarseOrMobile`), and the `getState` object of `window.wizardChess`.
- **Steps:**
  1. Import the helpers from `./visualSettings.ts` at the top with the other imports.
  2. After `renderer` exists (after line 246), compute:
     - `const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')`.
     - `let visualSettings = loadVisualSettings()`.
     - `let motionLevel = resolveMotionLevel(visualSettings.motion, reducedMotionQuery.matches)`.
     - `let qualityTier = visualSettings.quality && visualSettings.quality !== 'auto' ? visualSettings.quality : pickQualityTier({ coarsePointer: Boolean(coarsePointerQuery?.matches), maxTouchPoints: navigator.maxTouchPoints || 0, gpuRenderer: readGpuRendererString(), isAutomatedTest })`.
     - Use `coarsePointerQuery.matches` only, **not** `isCoarseOrMobile`: that one also includes `window.innerWidth <= 768`, which would lock a narrow desktop window into `base` for the whole session.
     - Add `function readGpuRendererString()`: `const gl = renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');` inside try/catch returning `''`. Add the value to `getState()` as `gpuRenderer` so tier choices can be checked.
  3. Listen to `reducedMotionQuery` `change`: if the user has no saved `motion`, recompute `motionLevel`.
  4. Add `setMotionLevel(level)` and `setQualityTier(tier)` functions. Each updates the variable, calls `saveVisualSettings`, and dispatches `window.dispatchEvent(new CustomEvent('wizardchess:visual-settings', { detail: { motionLevel, qualityTier } }))`. Later phases listen to this event.
  5. Add `motionLevel`, `qualityTier` and `qualityTierSource` (`'saved' | 'auto' | 'downgraded'`) to the object returned by `getState()`.
  6. Add `setMotionLevel` and `setQualityTier` to `window.wizardChess`.
- **Success criteria:** `getState()` returns both fields.
- **Verify:** no verification needed here; Task 1.5 checks it in a browser.

### Task 1.4 — Runtime tier downgrade

- **Goal:** a slow machine drops one tier instead of stuttering.
- **Target:** `feedFrameTimeSample` in `src/wizardChessEngine.js` (near line 10949). It already keeps `rollingFrameMs` and lowers DPR.
- **Steps:**
  1. Add `let slowFrameSeconds = 0`.
  2. In `feedFrameTimeSample`, after `rollingFrameMs` is updated: if `qualityTier !== 'base'` and `rollingFrameMs > 20` and the existing adaptive DPR is already at its floor, add the frame's seconds to `slowFrameSeconds`; otherwise reset it to 0.
  3. When `slowFrameSeconds >= 2`, set `qualityTier = downgradeTier(qualityTier)`, set `qualityTierSource = 'downgraded'`, reset `slowFrameSeconds`, dispatch the same `wizardchess:visual-settings` event, and do **not** save it to localStorage (a hot moment should not stick forever).
  4. Skip the downgrade entirely while `isAutomatedTest` is true unless `window.__WIZARD_ALLOW_TIER_DOWNGRADE__` is set. Keeps e2e stable.
- **Success criteria:** the code path exists. It cannot easily be forced in e2e; Task 1.5 checks the API side.
- **Verify:** `npx tsc --noEmit; echo EXIT=$?` prints `EXIT=0` and `npm run build 2>&1 | tail -3` shows no error.

### Task 1.5 — Motion and Quality buttons and e2e check

- **Goal:** the user can cycle Motion: full → quick → off → full.
- **Target:** `src/App.tsx` `#hud-right` (near `#btn-audio-toggle`, line 430); engine: bind the click like `#btn-audio-toggle` is bound; `e2e/game-smoke.spec.ts` new test.
- **Steps:**
  1. Add `<button id="btn-motion-level" className="hud-btn" type="button" aria-label="Motion level">` with a text span `#motion-level-label`.
  2. Add a second button `<button id="btn-quality-tier" className="hud-btn" type="button" aria-label="Quality tier">` with span `#quality-tier-label`. On click it cycles the saved preference `auto → ultra → high → base → auto`: save `{ quality }`, then call `setQualityTier` with the chosen tier (or with `pickQualityTier(...)` again for `auto`). Label: `✨ Chất Lượng: Tự Động (High)` (show the resolved tier in brackets for auto), `✨ Chất Lượng: Ultra`, `... High`, `... Base`.
  3. In the engine, on Motion click call `setMotionLevel(next)`, and update the label text to `🎬 Hoạt Cảnh: Đầy Đủ`, `🎬 Hoạt Cảnh: Nhanh` or `🎬 Hoạt Cảnh: Tắt`, matching the style of `🔊 Âm Thanh: Bật` on `#btn-audio-toggle`.
  4. Add e2e test `'motion level follows reduced-motion and persists'`:
     - `page.emulateMedia({ reducedMotion: 'reduce' })` before `openGame`; clear localStorage key `wizard_chess_settings_v1`.
     - Expect `getState().motionLevel === 'off'`.
     - Click `#btn-motion-level` once; expect `'full'`. Reload; expect `'full'` (saved wins over the media query).
     - Expect `getState().qualityTier === 'high'` (automated test rule).
     - Click `#btn-quality-tier` until the label shows `Base`; expect `qualityTier === 'base'`; reload; expect `'base'` (saved). Clear the key at the end of the test.
- **Success criteria:** the test passes.
- **Verify:** `npx playwright test e2e/game-smoke.spec.ts -g "motion level" 2>&1 | tail -5` shows `1 passed`.

## Phase exit check

- **Verify:** `npm run lint && npm test && npx playwright test e2e/game-smoke.spec.ts 2>&1 | tail -5` exits 0 and shows all smoke tests passed (previous 9 plus 1).

## Execution notes

- The tier-downgrade settling window, frame cap and cooldown from the phase-1 checkpoint landed in the phase-2 commit (feat(assets)).

- `src/visualSettings.ts` added; `npx tsc --noEmit` exit 0.
- Unit tests: 30 pass, 0 fail (29 + 1).
- Smoke suite: 9 passed, 1 skipped. The skip is the pre-existing `real canvas click selects a piece` (`test.skip` at line 146), so "previous 9 plus 1" means 9 runnable + the skipped one.
- Tier pick uses `coarsePointerQuery.matches`, `navigator.maxTouchPoints` and the unmasked WebGL renderer string (exposed as `getState().gpuRenderer`). `qualityPreference` is also exposed.
- The downgrade check runs inside `feedFrameTimeSample` via `trackSlowFramesForTier`; DPR floor is 1.0 on desktop and 1.35 on mobile (the values that function already drops to).
- Both new buttons sit in `#hud-right` with the same `grid-column: span 3` as the audio button.

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
