---
phase: 4
title: "Tiered post-processing composer"
status: completed
effort: 4h
pr: PR B
---

# Phase 4: Tiered post-processing composer

## Goal

- One `renderFrame()` draws every frame. It uses an `EffectComposer` when the tier has post-FX, and plain `renderer.render` on `base`.
- Passes by tier:
  - `ultra`: RenderPass → GTAOPass (half resolution) → BokehPass (disabled until phase 5 turns it on) → UnrealBloomPass → OutputPass.
  - `high`: RenderPass → UnrealBloomPass → OutputPass.
  - `base`: no composer.
- Changing tier at runtime (phase 1 event `wizardchess:visual-settings`) rebuilds or disposes the composer without a reload.
- Colors and brightness on `base` stay identical to today. On `high`/`ultra` they stay the same apart from the added glow and AO (OutputPass applies the same ACES tone mapping and sRGB output).

## Facts verified before planning

- Renderer (`src/wizardChessEngine.js` lines 222-246): `antialias: true`, `preserveDrawingBuffer: isAutomatedTest`, ACES tone mapping, exposure 1.24, sRGB output, `shadowMap.autoUpdate = false`.
- Every `renderer.render(scene, camera)` call draws to screen. Call sites (approximate lines): 276, 9781, 9967, 10028, 10291, 10335, 10448 (`captureScreenshot`), 10584 (`stepBy`), 10932 (end of `stepScene`), 11060 (`handleViewportResize`), 11127 (after `compileAsync`).
- Size changes happen at lines 238-239, the adaptive DPR block 10970-11013 (four `setPixelRatio` + `setSize` pairs inside `feedFrameTimeSample`), and `handleViewportResize` 11042-11047.
- three r170 tone-maps only when rendering to the screen. Rendering into the composer's render target is therefore linear, and `OutputPass` applies the renderer's `toneMapping` and `outputColorSpace`. No double tone mapping.
- `antialias: true` does not apply to composer render targets. The composer's render target needs `samples: 4` (WebGL2 MSAA).

## Files

- `src/wizardChessEngine.js` only, plus `e2e/game-smoke.spec.ts`.

## Tasks

### Task 4.1 — Introduce `renderFrame()` and `applyRendererSize()`

- **Goal:** one place renders, one place resizes. Behavior is unchanged in this task.
- **Steps:**
  1. Right after the renderer set-up block (after line 246), add:
     - `let postComposer = null;`
     - `function renderFrame(dt = 0) { if (postComposer) postComposer.render(dt); else renderer.render(scene, camera); }`
     - `function applyRendererSize() { renderer.setPixelRatio(currentActiveDpr); renderer.setSize(window.innerWidth, window.innerHeight); if (postComposer) resizePostComposer(); }`
     - A stub `function resizePostComposer() {}` (filled in Task 4.2).
     - Function declarations are hoisted, so this placement is fine as long as the first **call** happens after `scene` and `camera` exist. The line-276 call is inside the `webglcontextrestored` handler, so it always runs after `camera` exists; replace it like the others.
  2. Replace every listed `renderer.render(scene, camera)` with `renderFrame()`. In `stepScene` pass the frame `dt`: `renderFrame(dt)`.
  3. Replace each `renderer.setPixelRatio(currentActiveDpr); renderer.setSize(window.innerWidth, window.innerHeight);` pair with `applyRendererSize()`. In `handleViewportResize`, where `setPixelRatio` happens only on mobile and `setSize` always, replace the final `renderer.setSize(...)` with `applyRendererSize()` (setting the same DPR again is harmless).
- **Success criteria:** `grep -c "renderer.render(scene, camera)" src/wizardChessEngine.js` prints `1` (inside `renderFrame`). The game behaves exactly as before.
- **Verify:** `npx playwright test e2e/game-smoke.spec.ts 2>&1 | tail -5` shows all passed.

### Task 4.2 — Build the composer per tier

- **Goal:** `buildPostComposer(tier)` creates the right passes; `base` gets none.
- **Steps:**
  1. Import at the top: `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `GTAOPass`, `BokehPass`, `OutputPass` from `three/examples/jsm/postprocessing/<Name>.js`.
  2. Add `let postPasses = { gtao: null, bokeh: null, bloom: null };`.
  3. `function disposePostComposer()`: if `postComposer` exists, call `dispose()` on each pass that has it and on the composer (if r170's `EffectComposer` has no `dispose`, dispose `renderTarget1` and `renderTarget2` instead). Set `postComposer = null` and reset `postPasses`.
  4. `function buildPostComposer(tier)`:
     - Call `disposePostComposer()`. If `tier === 'base'` or `isWebGLContextLost`, return.
     - `const size = renderer.getDrawingBufferSize(new THREE.Vector2())`.
     - `const halfFloatOk = renderer.capabilities.isWebGL2 && Boolean(renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'))`.
     - `const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: halfFloatOk ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: halfFloatOk ? 4 : 0 })`.
     - `postComposer = new EffectComposer(renderer, rt)`.
     - `postComposer.addPass(new RenderPass(scene, camera))`.
     - If `tier === 'ultra'`:
       - Create `GTAOPass(scene, camera, size.x, size.y)`, set `blendIntensity = 0.85`, call `updateGtaoMaterial({ radius: 0.35, distanceExponent: 1, thickness: 1, scale: 1, samples: 12 })`, add it, store in `postPasses.gtao`.
       - Create `BokehPass(scene, camera, { focus: 6, aperture: 0.0025, maxblur: 0.008 })`, set `enabled = false`, add it, store in `postPasses.bokeh`.
     - Both tiers: `new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.45, 0.88)` (strength, radius, threshold). Add, store in `postPasses.bloom`.
     - `postComposer.addPass(new OutputPass())`.
     - Call `resizePostComposer()`.
  5. Fill in `resizePostComposer()`:
     - `postComposer.setPixelRatio(currentActiveDpr); postComposer.setSize(window.innerWidth, window.innerHeight);`
     - Read the drawing buffer size `w, h`. If `postPasses.gtao`, call `postPasses.gtao.setSize(Math.ceil(w / 2), Math.ceil(h / 2))`. This makes GTAO half resolution; it must run **after** `postComposer.setSize`, which sets every pass to full size.
     - Do not touch `postPasses.bloom.resolution`: it is only read in the constructor, and `UnrealBloomPass.setSize` (called by the composer) already halves its internal targets.
  6. Call `buildPostComposer(qualityTier)` once after `scene` and `camera` exist (after line ~361). Listen to `wizardchess:visual-settings` and call `buildPostComposer(detail.qualityTier)` when the tier changed. Keep a `builtTier` variable and return early from the listener when `detail.qualityTier === builtTier`: the event also fires for Motion changes and from inside `feedFrameTimeSample`. The event only fires on changes, so the first build must read `qualityTier` directly.
  7. In the existing `webglcontextlost` handler (search `isWebGLContextLost = true`) call `disposePostComposer()`. In the `webglcontextrestored` handler call `buildPostComposer(qualityTier)`.
- **Success criteria:** composer exists on `high` and `ultra`; none on `base`.
- **Verify:** covered by Task 4.4.

### Task 4.3 — Expose post-FX state

- **Steps:** add to `getState()`: `postFx: { active: Boolean(postComposer), gtao: Boolean(postPasses.gtao), bloom: Boolean(postPasses.bloom), dof: Boolean(postPasses.bokeh?.enabled) }`.
- **Verify:** no verification needed; Task 4.4 reads it.

### Task 4.4 — E2E coverage for tiers

- **Target:** `e2e/game-smoke.spec.ts`, new test `'post-processing follows the quality tier'`.
- **Steps:**
  1. Open the game with `collectConsoleErrors`. Expect `getState().qualityTier === 'high'` and `postFx` equal to `{ active: true, gtao: false, bloom: true, dof: false }`.
  2. Call `window.wizardChess.setQualityTier('ultra')`; wait idle; expect `postFx.gtao === true`.
  3. Take `page.locator('canvas').first().screenshot()`; expect the PNG buffer length > 20,000 bytes (a black or blank canvas compresses far smaller).
  4. Call `setQualityTier('base')`; expect `postFx.active === false`; take another screenshot with the same size check.
  5. Play one move with the existing helper and expect zero console errors.
- **Verify:** `npx playwright test e2e/game-smoke.spec.ts -g "post-processing" 2>&1 | tail -5` shows `1 passed`.

### Task 4.5 — Visual parity check on `base`

- **Goal:** prove `base` still looks like before.
- **Steps:**
  0. Freeze animation on both builds the same way: call `window.wizardChess.setManualStepMode(true)` (near line 10939), then `window.wizardChess.stepBy(1.0)` once, so flames and particles are at the same time on both captures.
  1. On the commit before this phase, open the game with `?autotest=1`, `waitIdle`, freeze as in step 0, and save `page.locator('canvas').first().screenshot()` to `/tmp/base-before.png`.
  2. On this phase's code, call `setQualityTier('base')`, `waitIdle`, freeze as in step 0, and save `/tmp/base-after.png` the same way.
  3. Compare with a throwaway Node script. Use `pngjs` if it is already in `node_modules`; otherwise install it with `npm install --no-save pngjs`. Count pixels whose RGB differs by more than 8 on any channel.
- **Success criteria:** differing pixels ≤ 3% of the image (some particle systems use `Math.random` and cannot be frozen).
- **Verify:** the recorded differing-pixel ratio is ≤ 0.03. Keep both images for the user's visual review in phase 8.

### Task 4.6 — Frame cost spot check

- **Steps:** with the dev server on the dev Mac in a normal (headed) browser, set `ultra`, let the idle scene run 10 s, read `getState().rollingFrameMs`. Repeat for `high` and `base`. Record all three in "Execution notes".
- **Success criteria:** `ultra` rolling frame time ≤ 12 ms on the dev Mac. If it is above, first reduce GTAO `samples` to 8, re-measure; then `radius` to 0.25, re-measure; record each. If it is still above after both, STOP and use the Failure Protocol.
- **Verify:** recorded `ultra` `rollingFrameMs` ≤ 12.

### Task 4.7 — Transparent effects under GTAO and DOF

- **Why:** GTAO and Bokeh re-render the scene with override materials. Transparent flames, particles and crystals then draw as solid shapes in the normal/depth pass, which can leave dark AO halos or sharp DOF edges around them.
- **Steps:**
  1. On `ultra`, take a screenshot near a torch/flame and near the relic crystals. Compare with `high` (no GTAO). Save both to `visuals/gtao-flames-ultra.png` and `visuals/gtao-flames-high.png`.
  2. If there is a dark halo or outline around flames or crystals on `ultra` that is not on `high`: collect the meshes whose material has `transparent === true` or `depthWrite === false` once after the scene is built (refresh the list when the skin or arena changes). Wrap the GTAO pass in a tiny pass subclass whose `render()` sets those meshes `visible = false`, calls the GTAO pass's `render`, then restores `visible`. Do the same for Bokeh's depth render. Take the screenshots again.
- **Success criteria:** no halo visible on `ultra` that is absent on `high`.
- **Verify:** both screenshot pairs are saved and the halo comparison result is written in "Execution notes". If a halo remains after step 2, use the Failure Protocol.

## Phase exit check

- **Verify:** `npm run lint && npm test && npx playwright test 2>&1 | tail -5` exits 0 with all tests passed.

## Execution notes

- Tasks 4.1-4.4 done (uncommitted at time of writing): one `renderFrame()`/`applyRendererSize()`, tiered composer, `postFx` in `getState()`, e2e 'post-processing follows the quality tier' passes.
- Task 4.5: `base` parity 0.03% differing pixels (442/1,405,320); same-code noise floor 0.02%. Pass. Images in `visuals/base-before.png`, `visuals/base-after.png`.
- Task 4.6 failed its pass condition. Prescribed fallback applied: GTAO samples 8 (ultra 15.24 ms), then radius 0.25 (13.76, 14.14 ms), all at an adaptive DPR that had fallen to 1.0. Failure Protocol: kongming said the run was optimistic (DPR 1.0, not the 1.35 desktop cap) and asked for a frozen-DPR ablation. `freezeDpr` and the frame recorder from phase 8 Task 8.1 were pulled forward for this.
- Ablation, Apple M4, headed Chromium, ANGLE Metal, vsync uncapped, 1470x956, idle scene, 6 s recorded per run, two runs each (mean ms):

  | Config @ DPR 1.35 | mean | p50 |
  |---|---|---|
  | ultra as specified (MSAA 4, HalfFloat) | 20.6-24.1 | 19-23 |
  | ultra, GTAO off | 14.3 | 13.5 |
  | ultra, MSAA 2 | 18.7 | 19.6 |
  | ultra, UnsignedByte target | 16.7 | 14.7 |
  | ultra, bloom off | 17.5 | 15.4 |
  | **ultra, MSAA 0 + SMAA** | **12.1** | 10-14 |
  | ultra, MSAA 0 + FXAA | 10.7 | 10.7 |
  | ultra, MSAA 0, no AA | 11.7 | 10.3 |
  | high as specified | 12.2-12.7 | 12.7 |
  | **high, MSAA 0 + SMAA** | **8.6** | 7.6 |
  | base | 6.3 | 5.1 |

  At DPR 1.0: ultra 13.6, high 8.3, base 5.0. MSAA on the half-float composer target is the largest single cost on ANGLE Metal, larger than GTAO. Uncapped p95 is about twice the mean because frames are released in clumps without vsync, so stutter has to be judged in a vsync-on run.
- User chose SMAA. The composer target has no MSAA; an `SMAAPass` runs before `OutputPass` on high and ultra.
- Task 4.7: on ultra the brazier flame drew as a solid dark AO silhouette on the wall; absent on high. Step 2 applied: GTAO and Bokeh skip see-through meshes (`transparent` or `depthWrite === false`) during their own render. The list is scanned each frame, not cached, because attack effects add see-through meshes at any time. After the fix ultra matches high at the flames and at the relic crystals. Images: `visuals/gtao-flames-{ultra,high}.png`, `visuals/gtao-crystals-{ultra,high}.png` (flame-ultra is the post-fix frame).
- Re-measured with SMAA and the see-through skip, DPR frozen at 1.35, same harness, while the machine was under heavy unrelated load (load average 43-53): ultra 13.1-13.5 ms, high 10.0 ms, base 6.5-7.2 ms. Base was 6.3 ms in the quiet ablation, so the load adds about 5-13%. Scaled by the ultra/base ratio (about 2.0), ultra is about 12.6 ms on a quiet machine: still slightly above the 12 ms target. Reported at the checkpoint.
- Kongming checkpoint: GO-WITH-FIXES. Task 4.6: quiet ablation 12.1 ms (at threshold); the loaded re-measure (13.1-13.5 ms at load average 43-53) is inconclusive. The final ultra budget gate is phase 8 Task 8.2 on a quiet machine (1-minute load average < 5, check `uptime`). Fixes applied: `SMAAPass` moved after `OutputPass` (its edge threshold and gamma-corrected blend expect display-encoded input); `disposePostComposer` also frees GTAO's `gtaoMaterial` and `blendMaterial`, which `GTAOPass.dispose()` leaves behind.
- Carried into phase 5: when Bokeh is enabled, set `scene.background` to `null` inside `skipSeeThroughObjects` and restore it in `finally`, otherwise the background colour clear unpacks as near depth in Bokeh's depth target.
- Phase 8 reduction ladder if the quiet run still misses 12 ms (in order, re-measure after each): quarter-resolution bloom via `postPasses.bloom.setSize` in `resizePostComposer`; ultra desktop DPR cap 1.35 to 1.25; GTAO samples 8 to 6.
- Phase exit check: lint OK, unit 31 pass, e2e 18 pass + 1 pre-existing skip.

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
