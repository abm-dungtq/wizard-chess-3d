---
title: "Premium visual upgrade, slice 1: camera, HUD, labels, post-FX, motion settings, assets, audio"
description: "Make the default view look premium on Mac while phones and Windows keep running: 3/4 camera, Liquid Glass dock, hover/selection labels, tiered post-processing, a Motion setting, binary meshopt/KTX2 assets, and a stall-free spatial audio bus."
status: pending
priority: P2
effort: 26h
branch: claude/premium-visual-slice-1
tags: [frontend, rendering, ui, assets, audio, performance]
blockedBy: []
blocks: []
created: 2026-11-03
---

# Premium visual upgrade, slice 1

Source decision: [brainstorm report](../reports/brainstorm-261103-1643-premium-visual-upgrade.md), approach A ("web, tuned for Mac"), slice 1 only.

Plan review: `kongming` returned GO-WITH-FIXES (2026-11-03). All 12 fixes are applied in the phase files: Apple-GPU-only `ultra` rule, uncompressed `.glb` budget with a `.glb.gz` path, start-up camera set in `resetChessBoard`, meshopt pipeline without duplicate passes plus shape checks, MSAA/half-float guard, transparent effects under GTAO/DOF, SVG refraction cost gate, fair perf measurement (3 runs, frozen DPR), frozen-frame parity check, square-tile hover raycast, per-skin budget, and a Quality button.

This plan is written for a downstream executor model. Every phase lists tasks with exact targets and mechanical Verify conditions, and carries its own Failure Protocol. Stopping on a failed Verify is intended behavior.

## Outcome

- The game opens in a 3/4 "spectator" camera. One tap returns to top-down.
- Top and bottom HUD bars become one floating Liquid Glass dock with P3 gold. Safari and Firefox get a plain frosted fallback.
- Piece name labels appear only for the selected piece and the hovered piece. A legend toggle still shows all of them.
- Post-processing runs by quality tier:
  - `ultra`: bloom, half-resolution GTAO, and kill-cam depth of field.
  - `high`: bloom only.
  - `base`: none.
- A "Motion" setting (full / quick / off) is persisted. Its default follows `prefers-reduced-motion`. It controls camera cinematics, camera tweens and screen tremors. Piece move animations keep their timing, because online play depends on it.
- A "Quality" button (auto / ultra / high / base) lets the user override the detected tier.
- Piece, skin-set, xiangqi and cathedral models ship as binary `.glb` with meshopt geometry. Cathedral textures ship as KTX2. The base64 layer is gone.
- The first move no longer stalls on AudioContext start-up. Impact sounds are positioned in 3D (HRTF) at the board square.

## Constraints

- Phones (iOS Safari, Android Chrome) and Windows (Chrome/Edge on D3D11) must keep working. The `base` tier must be safe for them.
- Do not change chess or xiangqi rules, AI, or the online room protocol. `isAnimatingMove` must never be held by camera, DOF or post-FX work. Cinematic state uses a separate `cinematicActive` flag.
- Three.js stays at r170 with `WebGLRenderer`. No WebGPU.
- Keep `window.wizardChess` test API fields that existing e2e tests read. New fields may be added.
- Keep all existing camera presets (`player`, `top`, `side`, `wide`) and their buttons. Only the default changes.
- Deploys and PRs need explicit user approval in chat each time. Staging first.
- Never print secrets. `.dev.vars` and Cloudflare credentials stay untouched.

## Non-goals

- Finishers (kill animations), per-piece creative movement, and redrawn hero skins. Those are slices 2 and 3.
- WebGPU, a native macOS app, haptics, Game Center.
- New 3D models or textures. This slice only re-encodes existing ones.
- Changing the AI, rules, or room server.

## Phases

| # | Phase | PR | Effort | Status | Depends on |
|---|---|---|---|---|---|
| 1 | [Settings store, Motion setting, quality tiers](phase-01-settings-motion-quality-tiers.md) | PR A | 3h | pending | none |
| 2 | [Binary meshopt/KTX2 asset delivery](phase-02-binary-meshopt-ktx2-assets.md) | PR A | 5h | pending | none |
| 3 | [Audio unlock and HRTF bus](phase-03-audio-unlock-hrtf.md) | PR A | 2h | pending | none |
| 4 | [Tiered post-processing composer](phase-04-tiered-post-processing.md) | PR B | 4h | pending | 1 |
| 5 | [3/4 default camera, top-down toggle, kill-cam DOF](phase-05-camera-default-killcam-dof.md) | PR B | 4h | pending | 1, 4 |
| 6 | [Labels on selection and hover](phase-06-labels-selection-hover.md) | PR B | 2h | pending | 5 |
| 7 | [Liquid Glass HUD dock](phase-07-liquid-glass-hud-dock.md) | PR B | 4h | pending | 1, 5 |
| 8 | [Budgets and cross-device verification](phase-08-budgets-cross-device-verification.md) | PR B | 2h | pending | 1-7 |

- PR A (phases 1-3) has no visible layout change except the Motion setting row. It can ship on its own.
- PR B (phases 4-8) is branched from PR A.
- Phases 1, 2 and 3 touch different files and may run in any order.

## Acceptance criteria (whole plan)

Numbers come from the brainstorm contract. Phase 8 measures all of them.

1. **Frame budget:**
   - `ultra` tier on the dev Mac: median p95 frame time ≤ 12 ms over 3 runs of the checkmate sequence with kill-cam DOF; at most 2 frames > 33 ms per run.
   - `base` tier under Playwright mobile emulation with 4x CPU throttle: p95 ≤ 16.6 ms during a normal move.
2. **Wire size:** the first playable load (default skin, default arena) transfers ≤ 10 MB, and each skin set ≤ 3.5 MB, measured by `PerformanceResourceTiming.transferSize` sums on staging. Cloudflare does not compress `.glb`, so phase 2 budgets uncompressed bytes.
3. **Labels:** at 1470x956 in the default camera with nothing selected and the mouse off the board, `visibleOverheadBadgeCount` is 0. With one piece selected in the start position it is 1 (no capture targets exist yet).
4. **HUD:** at 1470x956 the dock's bounding box height is ≤ 12% of the viewport height (≤ 114 px).
5. **Motion:** with `prefers-reduced-motion: reduce` emulated and no saved setting, `getState().motionLevel === 'off'`. Kill-cam and camera swoops do not run at `off`.
6. **Audio:** the first player move after page load does not create the AudioContext inside the move handler. `getState().audioState.contextState` is `running` before the first move when any earlier gesture happened (field added in phase 3).
7. **No regressions:** `npm run lint`, `npm test` and `npm run test:e2e` (all existing smoke and online tests) pass.
8. **Phones and Windows:** the `base` tier loads and plays a move with zero console errors under Playwright WebKit iPhone emulation and Chromium Pixel emulation. Windows is checked by the user on a real machine, listed as a residual check.

## Key facts verified in code (2026-11-03)

- All `renderer.render(scene, camera)` calls in `src/wizardChessEngine.js` draw to screen (lines near 276, 9781, 9967, 10028, 10291, 10335, 10448, 10584, 10932, 11060, 11127). None are offscreen. Phase 4 routes them through one `renderFrame()`.
- `renderer.setSize`/`setPixelRatio` are called at lines near 238, the 10970-11013 block (adaptive DPR), and 11042-11047 (`handleViewportResize`). Phase 4 routes them through one `applyRendererSize()`.
- Assets: 56 files, 36 MB as `.glb.gz.b64`. Piece GLBs have no textures (skinned, 4 clips each). The cathedral is 26 MB raw GLB with 33 JPEG textures (about 2.4 MB). Geometry dominates, so meshopt is the main win. KTX2 mainly saves GPU memory there.
- The camera starts locked, in the `top` preset. There is no kill-cam today. `combatCameraZoomEnabled = false` gates the duel swoops.
- There is no settings persistence today. Existing localStorage keys: `wizard_chess_unlocked_skins_v1`, `wizard_chess_token`, `wizard_chess_room_${code}`.
- Audio: `src/soundEngine.ts` creates the AudioContext lazily. `unlock()` is only called from the canvas `pointerdown`.

## Risks

- **Tier detection.** `ultra` is given only to Apple GPUs without touch (unmasked WebGL renderer string). Everything else starts at `high` or `base`, and the user can override.
- **Post-FX cost on weak GPUs.** Mitigation: tier detection plus a runtime downgrade if rolling frame time stays above budget (phase 1 task 1.4, phase 4).
- **MSAA loss under EffectComposer.** The composer render target needs `samples: 4` on WebGL2, otherwise edges get jaggy. Covered in phase 4.
- **Cloudflare does not compress `.glb`** (`model/gltf-binary` is not on its compressible list). Phase 2 measures uncompressed bytes and switches to `.glb.gz` + `DecompressionStream` if the budget fails.
- **KTX2 transcoder files** must be served from `/assets/basis/`. A missing file makes the cathedral fail to load. Phase 2 has a check for this.
- **Online sync.** Only breaks if kill-cam holds `isAnimatingMove`. Phase 5 forbids it and the online e2e tests guard it.

## Rollback

- Each phase is one or more commits on the branch. Revert the phase commits.
- Phase 2 keeps the old `.glb.gz.b64` loader path behind `ASSET_FORMAT` until phase 8 passes on staging. Rolling back the asset change means setting `ASSET_FORMAT = 'b64'` and rebuilding.
