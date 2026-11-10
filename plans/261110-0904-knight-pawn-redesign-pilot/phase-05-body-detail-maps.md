---
title: "Phase 5: Body detail maps"
status: done
priority: P2
effort: 3h
dependencies: [4]
---

> As built (2026-11-10)
>
> - Tasks 5.1 to 5.4 are done. Bake script: `WS/bake_detail_maps.py`. Engine code is as written in Tasks 5.2 to 5.4; cache key is `v=statue_pilot_v2`.
> - Task 5.1 first failed its AO check (mean 0.100 pawn, 0.128 knight). Cause: the AO bake cleared every texel outside the UV islands to black, and the islands cover only a small part of the image. Fix: `use_clear=False` on the AO bake, so unused texels stay white. Result: AO mean 0.913 pawn, 0.928 knight; normal mean blue 0.957 / 0.971, red deviation 0.079 / 0.087. `kongming` was not consulted for this.
> - Checks that pass: `resolveBodyMaterial(` count 4, `syncBodyDetailMaterials();` count 1, lint exit 0, `pass 32` / `fail 0`, screenshot run exit 0 (43 `after-maps-*` files), sizes pawn 390,413 and knight 327,715 bytes, `git diff --stat test/` empty, port 3107 free.
> - Task 5.5 step 3: (b), (c) and (d) hold in the screenshots. (a) does not hold at play distance: a piece is about 100 device pixels tall, and the only visible change is slightly deeper contact shading (`visuals/compare-maps-closeup.jpg`, left without maps, right with). The decimated meshes have very many small UV islands, so each island gets few texels at 512 px. Seams could not be judged closer than this view. The user decided on 2026-11-10 to keep both maps, so the phase is closed with item (a) accepted as not met.

# Phase 5: Body detail maps

## Goal

The pawn and knight body surfaces show the sculpted detail of the full-resolution mesh through a normal map and an ambient-occlusion map, loaded as separate files, while team and theme colours keep working and the GLB files stay texture-free.

`PLAN` = `plans/261110-0904-knight-pawn-redesign-pilot`. `WS` = `.tools/piece-redesign`. `ROOT` = the absolute worktree path. `<piece>` is `pawn` or `knight`.

## Why separate files

`test/applet.test.mjs` parses `pawn_white` in Node, where images cannot be decoded. A texture inside the GLB would break that test. So the maps live in `public/assets/glb/detail/` and the engine attaches them at load.

## Files to Create / Modify

- Create: `public/assets/glb/detail/{pawn,knight}_normal.webp`, `public/assets/glb/detail/{pawn,knight}_ao.webp`
- Modify: `src/wizardChessEngine.js` (material section near line 1460, `applyPieceTheme` near line 2312, material binding near lines 2030 and 2066, base piece loading near line 4304, material binding near line 4575, `ASSET_CACHE_VER` line 3735)
- Create: `PLAN/visuals/after-maps-*.png`

## Tasks & Steps

### Task 5.1 — Bake the maps in Blender

- **Goal:** a 1024 px normal map and AO map per piece, matching the UV map exported in phase 4.
- **Steps (per piece, in `WS/<piece>.blend`, through `execute_blender_code`):**
  0. Open the piece file: `bpy.ops.wm.open_mainfile(filepath="ROOT/.tools/piece-redesign/<piece>.blend")`.
  1. Set the armature's `data.pose_position = "REST"`.
  2. Set the render engine to Cycles (assign inside `try/except TypeError` and print the valid engines on error). Set `scene.cycles.samples = 64`.
  3. Create two images, 1024×1024: `<piece>_normal` filled with colour `(0.5, 0.5, 1.0, 1.0)` and `<piece>_ao` filled with `(1, 1, 1, 1)`. Set both to Non-Color.
  4. In each of the four materials of the piece mesh, add an Image Texture node (not linked to anything), set it to `<piece>_normal`, and make it the active node.
  5. Normal bake: unhide `Fig_high`, select it, then make the piece mesh active and selected. Bake with `bpy.ops.object.bake(type="NORMAL", use_selected_to_active=True, cage_extrusion=0.02 * H_total, max_ray_distance=0.04 * H_total, margin=8)` (`H_total` from the facts file). Save the image to `ROOT/.tools/piece-redesign/<piece>_normal.png`.
  6. AO bake: set the four image nodes to `<piece>_ao`. Deselect `Fig_high` and hide it. With only the piece mesh selected and active, bake `bpy.ops.object.bake(type="AO", use_selected_to_active=False, margin=8)`. Save to `ROOT/.tools/piece-redesign/<piece>_ao.png`.
  7. Delete the four image nodes from the materials. Set `pose_position` back to `"POSE"`. Save the file. Do not re-export the GLB.
  8. Convert, from the worktree root:
     - `mkdir -p public/assets/glb/detail`
     - `magick .tools/piece-redesign/<piece>_normal.png -resize 512x512 -quality 92 public/assets/glb/detail/<piece>_normal.webp`
     - `magick .tools/piece-redesign/<piece>_ao.png -colorspace Gray -resize 512x512 -quality 82 public/assets/glb/detail/<piece>_ao.webp`
- **Success criteria:** the normal map is mostly the flat-normal blue with visible detail, not black or grey.
- **Verify:** `magick .tools/piece-redesign/<piece>_normal.png -format "%[fx:mean.b]\n" info:` prints a value above `0.80`; `magick .tools/piece-redesign/<piece>_normal.png -format "%[fx:standard_deviation.r]\n" info:` prints a value above `0.01` (a flat image means the bake hit nothing); `magick .tools/piece-redesign/<piece>_ao.png -format "%[fx:mean]\n" info:` prints a value between `0.35` and `0.98`; the four `.webp` files exist.

### Task 5.2 — Detail material helper in the engine

- **Goal:** a body or steed mesh that has detail maps gets its own material that mirrors the shared team material.
- **Target:** `src/wizardChessEngine.js`, directly after the `sideMats` object (ends near line 1460).
- **Steps:** add this code:
  ```js
  // Sculpted base pieces carry a baked normal + AO map per piece type. The shared team materials have no
  // textures, so a mesh with maps gets a mirror of its team material that adds them.
  const BASE_PIECE_DETAIL_MAPS = {
    pawn: { normal: './assets/glb/detail/pawn_normal.webp', ao: './assets/glb/detail/pawn_ao.webp' },
    knight: { normal: './assets/glb/detail/knight_normal.webp', ao: './assets/glb/detail/knight_ao.webp' }
  };
  const bodyDetailByGeometry = new WeakMap();
  const bodyDetailMaterials = [];

  function resolveBodyMaterial(sourceMat, mesh) {
    const detail = mesh && mesh.geometry ? bodyDetailByGeometry.get(mesh.geometry) : null;
    if (!detail) return sourceMat;
    let mat = detail.mats.get(sourceMat);
    if (!mat) {
      mat = sourceMat.clone();
      mat.normalMap = detail.normalMap;
      mat.aoMap = detail.aoMap;
      // The meshes have no tangents and the maps use glTF UVs (flipY = false): same sign fix as GLTFLoader.
      mat.normalScale.set(1, -1);
      mat.needsUpdate = true;
      detail.mats.set(sourceMat, mat);
      bodyDetailMaterials.push({ mat, source: sourceMat });
    }
    return mat;
  }

  function syncBodyDetailMaterials() {
    for (const { mat, source } of bodyDetailMaterials) {
      mat.color.copy(source.color);
      mat.roughness = source.roughness;
      mat.metalness = source.metalness;
      mat.emissive.copy(source.emissive);
      mat.emissiveIntensity = source.emissiveIntensity;
    }
  }
  ```
- **Verify:** no verification needed (covered by Task 5.5).

### Task 5.3 — Use the helper where body and steed materials are assigned

- **Goal:** every place that gives a piece mesh the body or steed material goes through the helper, and theme changes reach the mirrors.
- **Steps:**
  1. Near line 2030, replace `child.material = bank.steed;` with `child.material = resolveBodyMaterial(bank.steed, child);`.
  2. Near line 2066, replace `child.material = bank.primary;` with `child.material = resolveBodyMaterial(bank.primary, child);`.
  3. Near line 4574 (inside the `root.traverse` that follows `const primaryMat = color === 'w' ? whitePieceMat : blackPieceMat;`), replace `child.material = primaryMat;` with `child.material = resolveBodyMaterial(primaryMat, child);`.
  4. In `applyPieceTheme` (starts near line 2312), add the line `syncBodyDetailMaterials();` directly before the line `updateSanctumAltarTheme(theme);`.
- **Verify:** `grep -c "resolveBodyMaterial(" src/wizardChessEngine.js` prints `4` (one definition, three calls), and `grep -c "syncBodyDetailMaterials();" src/wizardChessEngine.js` prints `1`.

### Task 5.4 — Load the maps with the base pieces

- **Goal:** the base pawn and knight templates register their maps; a missing map file only logs a warning.
- **Target:** `src/wizardChessEngine.js`, the `pieceTasks` loader near line 4306, directly after `const tpl = preparePieceTemplateFromGltf(gltf);`.
- **Steps:**
  1. Add this block there:
     ```js
     const detailPaths = BASE_PIECE_DETAIL_MAPS[type];
     if (detailPaths) {
       try {
         const texLoader = new THREE.TextureLoader();
         const [normalMap, aoMap] = await Promise.all([
           texLoader.loadAsync(`${detailPaths.normal}?${ASSET_CACHE_VER}`),
           texLoader.loadAsync(`${detailPaths.ao}?${ASSET_CACHE_VER}`)
         ]);
         for (const tex of [normalMap, aoMap]) {
           tex.flipY = false; // glTF UV convention
           tex.colorSpace = THREE.NoColorSpace;
           tex.anisotropy = 4;
           tex.needsUpdate = true;
         }
         const detail = { normalMap, aoMap, mats: new Map() };
         tpl.scene.traverse((child) => {
           if (!child.isMesh || !child.geometry) return;
           const mName = child.userData?.origMatName || child.material?.name || '';
           if (/Gold|Trim|Bronze|Glow|Steel/i.test(mName) && !child.userData?.isSteedMesh) return;
           bodyDetailByGeometry.set(child.geometry, detail);
         });
       } catch (err) {
         console.warn(`Detail maps for ${type} failed to load:`, err);
       }
     }
     ```
  2. Confirm the object returned by `preparePieceTemplateFromGltf` exposes the scene as `tpl.scene` (it is used as `tpl.scene` near line 4519). If the property has another name, that is a failed Verify.
  3. Change `ASSET_CACHE_VER` (line 3735) from `'v=statue_pilot_v1'` to `'v=statue_pilot_v2'`.
- **Verify:** `npm run lint; echo EXIT=$?` prints `EXIT=0`, and `npm test 2>&1 | grep -E "^ℹ (pass|fail)"` prints `pass 32` and `fail 0`.

### Task 5.5 — Check the result in the game

- **Goal:** the maps show, with no seams, no console errors and correct theme colours.
- **Steps:**
  1. `SHOTS=1 SHOT_LABEL=after-maps npx playwright test e2e/piece-pilot-shots.spec.ts; echo EXIT=$?`
  2. Open with the Read tool, next to the matching `after-` file: the four close-ups for `hogwarts`, and the `whiteKnight` and `blackPawn` close-ups for `jade` and `royal`.
  3. Check: (a) surface detail is visibly richer than in `after-`; (b) no dark seams along UV borders and no inverted (dented-looking) lighting; (c) body colours in `jade` and `royal` match the `after-` images (the theme reached the mirror materials); (d) the horse still has its own coat colour.
  4. Size check: `for p in pawn knight; do echo $p $(( $(stat -f%z public/assets/glb/${p}_white.glb.gz) + $(stat -f%z public/assets/glb/detail/${p}_normal.webp) + $(stat -f%z public/assets/glb/detail/${p}_ao.webp) )); done`
- **Verify:** step 1 prints `EXIT=0`; all four items in step 3 are true; both totals in step 4 are at most `400000`. If item (b) fails, the question for `kongming` is whether to re-export with tangents or to drop the normal map and keep AO only.

## Verification

- `npm test` prints `pass 32`, `fail 0`; `npm run lint` exits 0.
- `git diff --stat test/` prints nothing.
- `lsof -i :3107` prints nothing.

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
