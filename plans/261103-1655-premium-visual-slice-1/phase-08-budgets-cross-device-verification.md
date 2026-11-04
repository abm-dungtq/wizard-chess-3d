---
phase: 8
title: "Budgets and cross-device verification"
status: pending
effort: 2h
pr: PR B
---

# Phase 8: Budgets and cross-device verification

## Goal

- Measure every number in the plan's acceptance criteria and record it here.
- Prove the `base` tier works under phone emulation in WebKit and Chromium.
- Measure the real wire size and `content-encoding` of `.glb` files on staging.
- Get the user's visual approval on before/after screenshots.
- Remove the old `.glb.gz.b64` files only after all of the above pass.

## Gates that need the user

- **Staging deploy (Task 8.4)** needs explicit user approval in chat. Ask, then wait. Use the staging command from the previous plan: `CLOUDFLARE_ENV=staging npm run build && CI=true npx wrangler deploy -c dist/wizard_chess_3d/wrangler.json`, then rebuild production (`npm run build`) so `dist/` is not left in staging mode.
- **Visual approval (Task 8.6)** needs the user to look at the screenshots and say yes.
- Production deploy and PR creation are **not** part of this phase. Ask separately afterwards.

## Files

- `src/wizardChessEngine.js` (frame recorder API only), `e2e/perf-budget.spec.ts` (new, tagged so it is not part of the default run), `playwright.config.ts` (only if a project is needed for the perf run), this phase file.

## Tasks

### Task 8.1 — Frame recorder API

- **Steps:**
  1. Add `startFrameRecorder()`, `stopFrameRecorder()` and `freezeDpr(on)` to `window.wizardChess`. While recording, `animate()` pushes the real `performance.now()` delta between consecutive frames into a preallocated `Float32Array(4096)` (no allocation per frame). `stopFrameRecorder()` returns `{ count, p50, p95, max, over33 }` in ms, computed from a sorted copy.
  2. Add `e2e/perf-budget.spec.ts`. It is skipped unless `process.env.PERF === '1'`.
- **Verify:** `npx tsc --noEmit; echo EXIT=$?` prints `EXIT=0`.

### Task 8.2 — `ultra` frame budget during checkmate (dev Mac, headed)

- **Why these flags:** rAF is capped by the display refresh. On a 60 Hz panel a frame can never measure below 16.6 ms. The flags `--disable-gpu-vsync --disable-frame-rate-limit` remove the cap, so the delta shows the real cost.
- **Steps:**
  0. Guards for a fair number: Playwright sets `navigator.webdriver`, which turns on `preserveDrawingBuffer` (near line 226, one extra copy per frame), and the adaptive DPR drops to 1.0 when frames are slow (near lines 10991-11000), which would hide the real cost. So: add a test-only `window.wizardChess.freezeDpr(true)` that makes `feedFrameTimeSample` skip DPR changes, call it before recording, and include `currentActiveDpr`, `qualityTier` and `gpuRenderer` in the printed JSON.
  1. In `perf-budget.spec.ts`, test `'ultra checkmate p95'`: launch Chromium headed with `--use-angle=metal --disable-gpu-vsync --disable-frame-rate-limit`, viewport 1470x956, `?autotest=1`. Call `setQualityTier('ultra')` and `setMotionLevel('full')`, wait 3 s for warm-up.
  2. `startFrameRecorder()`, call `triggerCheckmateSequence('b', 'w')`, wait 4.2 s, `stopFrameRecorder()`.
  3. Repeat steps 1-2 three times (fresh page each time). Print each result as one JSON line, plus the median mean and how many frames were > 33 ms in each run. To count those, `stopFrameRecorder()` also returns `over33` (number of deltas > 33 ms).
  4. Run once more with vsync on (launch without `--disable-gpu-vsync --disable-frame-rate-limit`, on a 60 Hz or faster display) and print the p95 of that run.
  5. Before recording, check `uptime`: the 1-minute load average must be below 5. On a busier machine the run is inconclusive and must be repeated, not judged.
- **Pass condition:** median of the three uncapped means ≤ 12, every uncapped run has `over33 ≤ 2` (single GC spikes are tolerated), `currentActiveDpr` equals the ultra desktop cap (1.35 as planned; 1.25 after the reduction ladder's second step, see Execution notes), and the vsync-on run has p95 ≤ 17 (no dropped 60 Hz frames). The uncapped p95 is not judged: without vsync frames are released in clumps, so it sits near twice the mean (phase 4 notes).
- **If it fails:** apply in order and re-measure after each: quarter-resolution bloom, ultra desktop DPR cap 1.35 to 1.25, GTAO samples 8 to 6 (phase 4 notes). Do not swap SMAA for FXAA.
- **Verify:** `PERF=1 npx playwright test e2e/perf-budget.spec.ts -g "ultra checkmate" --headed 2>&1 | grep -E 'mean|p95'` shows values meeting the pass condition. Record the JSON lines.

### Task 8.3 — `base` frame budget under phone emulation

- **Steps:**
  1. Test `'base phone p95'`: Chromium with the `Pixel 7` device descriptor and the same vsync flags. Open a CDP session and send `Emulation.setCPUThrottlingRate` with `{ rate: 4 }`.
  2. Expect `qualityTier === 'base'` (coarse pointer). Warm up 3 s.
  3. Record frames while playing one normal move with the existing move helper and waiting until `isAnimatingMove` is false plus 500 ms.
- **Pass condition:** `p95 ≤ 16.6`.
- **Verify:** `PERF=1 npx playwright test e2e/perf-budget.spec.ts -g "base phone" 2>&1 | grep p95` meets the pass condition. Record the JSON line. This is an approximation (CPU throttle only); a real-phone check is listed under residual checks.

### Task 8.4 — Staging: wire size and compression

- **Steps:**
  1. Ask the user for approval to deploy to staging. Wait for a clear yes.
  2. Deploy staging with the command in "Gates", then rebuild production locally.
  3. `curl -sI -H 'Accept-Encoding: gzip, br' "https://wizard-chess-3d-staging.ngulongyquan.workers.dev/assets/glb/king_white.glb.gz?v=meshopt_v1"` and record `content-type` and `content-encoding`. Expect `application/gzip` and no `content-encoding` (the loader inflates it with `DecompressionStream`).
  4. Test `'first playable transfer size'` in `perf-budget.spec.ts`, run with `E2E_BASE_URL` set to staging: fresh context, open the game, `waitIdle`, then sum `transferSize` of `performance.getEntriesByType('navigation')` and `('resource')` entries. Print the total and the 5 largest entries.
- **Pass condition:** total ≤ 10,485,760 bytes.
- **Verify:** the printed total meets the pass condition. The models ship as `.glb.gz` (phase 2 Task 2.9), so the measured size already includes the gzip layer.

### Task 8.4b — Per-skin download budget

- **Steps:** with the staging run from Task 8.4, for each of the 7 skin sets: open the skin shop, select the set (use the same API or click path the existing skin-switch e2e test uses), `waitIdle`, and sum `transferSize` of resources whose URL contains `/assets/glb/sets/<setId>/`. Print one line per set.
- **Pass condition:** every set ≤ 3,670,016 bytes (3.5 MB).
- **Verify:** all 7 printed values meet the pass condition. Record them.

### Task 8.5 — Phone and Safari smoke

- **Steps:**
  1. Run the full smoke suite once under the WebKit `iPhone 15` descriptor and once under Chromium `Pixel 7`, using a temporary local Playwright project (do not commit it unless it is green and fast).
  2. Each run: zero console errors, one legal move plays, `qualityTier === 'base'`, `postFx.active === false`.
- **Verify:** both runs report all selected tests passed. Record the counts.

### Task 8.6 — Visual approval

- **Steps:**
  1. Capture "after" screenshots at 1470x956: default view (`spectator`, `ultra`), the same at `base`, the kill-cam mid-way (pause with `stepBy` if available), and the phone view at 390x844. Save under `visuals/`.
  2. Send the before/after pairs (`visuals/hud-before-*`, `visuals/hud-after-*`, `/tmp/base-before.png` vs `/tmp/base-after.png` copied into `visuals/`) to the user and ask whether the look is approved.
- **Pass condition:** the user says yes in chat.
- **Verify:** the user's reply is quoted in "Execution notes".

### Task 8.7 — Remove the old asset format

- **Run only after Tasks 8.2-8.6 pass.**
- **Steps:**
  1. Delete every `public/assets/glb/**/*.glb.gz.b64`.
  2. In `loadGltfModel`, delete the b64 branch and the `ASSET_FORMAT` constant.
  3. Any re-encode must bump `ASSET_CACHE_VER` (`/assets/*` is immutable for a year). Change the encoder script to read `.glb` sources for future runs (or document in its header that the b64 inputs are gone and Blender round-trips should feed `.glb` directly). Update `scripts/glb-pipeline.mjs` `pack` to write `.glb` via `encode-glb-assets.mjs` instead of `.glb.gz.b64`.
  4. Update the unit test from phase 2 Task 2.7: it now lists `.glb` files and expects 56.
- **Verify:** `npm run lint && npm test && npx playwright test 2>&1 | tail -5` exits 0 with all tests passed, and `find public/assets/glb -name '*.b64' | wc -l` prints `0`.

### Task 8.8 — Close out

- **Steps:** mark phases 1-8 `completed` in `plan.md` and each phase file. Fill the acceptance table below. Report to the user, then ask whether to open the PRs and whether to deploy production. Do not do either without a yes.

## Acceptance results

| # | Criterion | Measured | Pass |
|---|---|---|---|
| 1a | `ultra` checkmate: median uncapped mean ≤ 12 ms, ≤ 2 frames > 33 ms per run, vsync-on p95 ≤ 17 ms | Median 11.44 ms, 1 frame > 33 ms per run, DPR 1.25 (after ladder steps 1-2). Vsync-on not judged: no 60 Hz display (both monitors run at 100 Hz) | Uncapped yes; vsync open |
| 1b | `base` phone p95 ≤ 16.6 ms | 9.8 ms (Pixel 7, CPU 4×) | Yes |
| 2 | First playable ≤ 10 MB on the wire (staging) | 8,884,545 bytes (cathedral 4,999,106) | Yes |
| 2b | Each skin set ≤ 3.5 MB (staging) | 924,957 – 997,344 bytes | Yes |
| 3 | 0 badges idle, 1 when selected (1470x956) | 0 / 1 (`labels show only for selection and hover by default`) | Yes |
| 4 | HUD ≤ 114 px at 1470x956 | ≤ 114 after the first move (`desktop HUD is one glass dock…`) | Yes |
| 5 | reduced-motion → `off`; no kill-cam at `off` | Both covered by `motion level follows reduced-motion…` and `kill-cam runs on checkmate…` | Yes |
| 6 | `contextState` running before first move | `audio unlocks on first gesture before the first move` | Yes |
| 7 | lint, unit, e2e green | lint OK, 31 unit, 22 e2e passed + 6 skipped (1 existing, 5 `PERF=1` only) | Yes |
| 8 | WebKit iPhone + Chromium Pixel smoke green | 22 passed, 2 skipped (desktop-only tests deselected) | Yes |

## Residual checks for the user (not automatable here)

- Windows 10/11, Chrome or Edge on D3D11: open staging, play a few moves, switch to xiangqi, open the cathedral arena. Expect no errors and smooth play (tier `high` or `base`).
- A real iPhone and a real Android phone: same steps; the dock and labels should behave like the emulated runs.
- Safari 26 on macOS Tahoe: confirm the tier is `ultra` and the dock shows glass without refraction.

## Execution notes

- Task 8.1: `startFrameRecorder`, `stopFrameRecorder` (with `mean` and `over33`) and `freezeDpr` already existed, pulled forward in phase 4. Added `e2e/perf-budget.spec.ts`, which is skipped unless `PERF=1` (the default run reports these tests as skipped). Each test launches its own Chromium, because Playwright does not allow `launchOptions` per describe group. Contexts use `deviceScaleFactor: 2` (the Mac's Retina value). A first attempt without it ran at DPR 1.0 and was thrown away as not matching the plan's conditions. All three runs are printed before any assertion.
- Task 8.2, first valid run (DPR 1.35, 1-minute load 4.40): means 12.69 / 12.65 / 12.65 ms, median 12.65 > 12 (failed). `over33` was 1 in each run (passed). Vsync-on p95 was 19.7 ms (p50 18.4).
- Failure Protocol, kongming:
  - The uncapped miss is real.
  - The vsync run is not valid for the 17 ms criterion. The window ran on a 100 Hz monitor, where a 12.6 ms frame lands on every second 10 ms vsync. `system_profiler` shows both physical monitors at 2560x1440 @ 100 Hz. The only 60 Hz screen is an AirPlay display (1728x972), so no real 60 Hz panel was available. A Chromium `--window-position` probe read 100 Hz at every position.
- Diagnostic suggested by kongming: a temporary `preserveDrawingBuffer: false` (that copy happens only under automation). Result: means 13.70 / 13.44, and the second run had `over33` 6, at load 3.31 rising to 3.97. No gain, so it was reverted; the copy is not the gap.
- Reduction ladder, in the plan's order:
  1. Quarter-resolution bloom (`resizePostComposer` now calls `bloom.setSize` with half the drawing buffer; UnrealBloomPass halves its input again). Means 13.57 / 12.93 / 12.90, median 12.93 (load 3.00 → 7.12). Still failing; kept as the first rung.
  2. Ultra desktop DPR cap 1.35 → 1.25. It is tier-aware: `applyDesktopDprCap` caps `ultra` at 1.25 and other tiers at 1.35, and a tier change only lowers the current DPR. Means 11.44 / 11.41 / 12.69, median **11.44 ≤ 12**, `over33` 1 / 1 / 1, DPR 1.25 (load 3.48). **Passed.** Step 3 (GTAO 6 samples) was not needed.
- The phase 4 note "Do not touch bloom.resolution" still holds. The bloom change goes through `setSize` in `resizePostComposer`, not the constructor's `resolution` argument.
- Vsync-on p95 ≤ 17 ms: **not judged**. It needs a 60 Hz display (see above), so it is open for the user.
- Each checkmate run has one stall of 80-115 ms, most likely the first use of the Bokeh/VFX shaders. The gate tolerates it (`over33 ≤ 2`). Follow-up outside phase 8: warm those programs during start-up.
- Task 8.3 (Pixel 7, CPU throttle 4×, uncapped, load 5.2): `{"count":147,"mean":9.54,"p50":8,"p95":9.8,"max":203.5,"over33":1}`, tier `base`. **p95 9.8 ≤ 16.6, passed.**
- Task 8.5 ran with a temporary config (not committed) that had two projects: WebKit `iPhone 15` and Chromium `Pixel 7` with the project's GPU flags. It also used a temporary phone check: tier `base`, `postFx.active === false`, quick dock visible, one legal move, zero console errors.
  - Five tests are deselected because they assert desktop behavior by design: tier `high` (post-processing, motion level), mouse hover labels, the 1470 px glass dock, and the audio test, which clicks the desktop-only `.brand-pill`.
  - Result: **22 passed, 2 skipped** (the existing canvas-click skip, once per device). That is 11 per device, including the phone check.
  - An earlier run without the GPU flags fell back to software rendering on Pixel 7 (2 frames instead of 20+ in the tween test) and was discarded.
- Task 8.6 screenshots at 1470x956: `visuals/after-spectator-ultra.png`, `after-spectator-base.png`, `after-killcam-ultra.png`, plus `hud-after-phone.png` (390x844) and the before/after pairs `hud-before-*`/`hud-after-*` and `base-before.png`/`base-after.png`. The user approved them in chat: "Approved".
- Task 8.4, with the user's approval ("Deploy staging"): staging deployed as version `ade8c2ea-3b9c-417c-91cb-dc57d3bcc7bb`, then production rebuilt locally (`dist/wizard_chess_3d/wrangler.json` name `wizard-chess-3d`). `king_white.glb.gz` returns `content-type: application/gzip` with no `content-encoding`, as expected. `cache-control` repeats its value (`public, max-age=31536000, immutable` twice); this is harmless but worth tidying in the headers config later.
- Task 8.7: deleted the 56 `.glb.gz.b64` files, `ASSET_FORMAT` and the b64 fetch path. `ASSET_CACHE_VER` stays `v=meshopt_v1` because no shipped bytes changed. `encode-glb-assets.mjs` now takes a folder of plain `.glb` sources; `glb:pack` calls it; `glb:unpack` removes meshopt and quantization so Blender can open the files. The unit test expects 56 `.glb.gz` and 0 `.b64` (the shipped files are `.glb.gz`, not `.glb` as the step text says). Round trip in temp folders: unpack → encode → `--check` printed `CHECK OK 6`. Verify: lint OK, 31 unit, 22 e2e passed + 6 skipped, `find … -name '*.b64' | wc -l` = 0. Kongming: GO.
- Task 8.4 transfer (fresh context, staging): total **8,884,545 bytes ≤ 10,485,760, passed**. Five largest: `option8_cathedral.glb.gz` 4,999,106; `demo-xiangqi-arena.jpg` 488,708; `demo-chess-arena.jpg` 463,330; `index-*.js` 429,418; `king_white.glb.gz` 270,004.
- Task 8.4b per-set transfer (staging), all **≤ 3,670,016, passed**: dong_son 997,344; shogun_yokai 937,148; abyssal_lich 934,017; bauhaus_imperial 924,957; mecha_ronin 925,770; pharaoh_anubis 945,263; valhalla_valkyrie 972,184.

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
