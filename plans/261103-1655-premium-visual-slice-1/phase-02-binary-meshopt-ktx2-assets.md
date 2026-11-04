---
phase: 2
title: "Binary meshopt/KTX2 asset delivery"
status: completed
effort: 5h
pr: PR A
---

# Phase 2: Binary meshopt/KTX2 asset delivery

## Goal

- All 56 model files ship as binary `.glb` with `EXT_meshopt_compression` geometry, instead of gzip+base64 text.
- Cathedral textures ship as KTX2 (`KHR_texture_basisu`, ETC1S).
- The client decodes them with `MeshoptDecoder` and `KTX2Loader`.
- The first playable load stays ≤ 10 MB on the wire (measured again in phase 8 on staging).
- Old `.glb.gz.b64` files stay in the repo and loadable until phase 8 passes, then they are deleted.

## Facts verified before planning

- Loader: `loadGltfModel(baseName)` in `src/wizardChessEngine.js` lines 3503-3542. `ASSET_CACHE_VER = 'v=masterwork_v2'` at line 3502. It fetches `${base}.glb.gz.b64`, base64-decodes, gunzips with `DecompressionStream('gzip')`, then calls `gltfLoader.parse`. `gltfLoader` is created near line 2252.
- The raw `.glb` fallback at line 3534 never works today: unknown paths return `index.html` (SPA fallback).
- Asset paths:
  - root pieces: `public/assets/glb/${type}_white` (6), used near line 4092;
  - skin sets: `public/assets/glb/sets/${setId}/${type}_white` (7 sets × 6), used near line 3842;
  - xiangqi: `public/assets/glb/xiangqi/${type}_white` (7), used near line 3805;
  - cathedral: `public/assets/glb/option8_cathedral` (8.85 MB as b64; 26 MB raw GLB, 16 meshes, 33 JPEG images ≈ 2.4 MB), used near line 3927.
- Piece GLBs are skinned (1 skin, 4 animation clips) and have no images.
- `public/_headers` makes `/assets/*` immutable for one year. Cache busting relies on the `?v=` query, so `ASSET_CACHE_VER` must be bumped.
- `scripts/glb-pipeline.mjs` only knows root pieces and xiangqi.

## Files

- `package.json`: add devDependencies `@gltf-transform/cli`, `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`, `meshoptimizer`. Pin the versions `npm install` resolves.
- Create `scripts/encode-glb-assets.mjs` (new; the old `glb-pipeline.mjs` stays for Blender round-trips).
- Create `scripts/copy-basis-transcoder.mjs` (new) and add it to the `prebuild` and `predev` npm scripts.
- `src/wizardChessEngine.js`: `gltfLoader` setup near line 2252, `loadGltfModel` near 3503.
- `public/assets/basis/` (generated copy of the transcoder; add to `.gitignore`).
- `public/assets/glb/**.glb` (new generated binary files; committed).
- `test/applet.test.mjs`: asset inventory test.

## Tasks

### Task 2.1 — Add the encoder toolchain

- **Goal:** the gltf-transform library is available to Node scripts.
- **Steps:**
  1. `npm install -D @gltf-transform/cli @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer`.
  2. Run `npx gltf-transform --version`.
- **Success criteria:** the version prints.
- **Verify:** `npx gltf-transform --version; echo EXIT=$?` prints a version and `EXIT=0`.

### Task 2.2 — Write the encoder script

- **Goal:** one command turns every `.glb.gz.b64` into a meshopt `.glb` next to it.
- **Target:** new `scripts/encode-glb-assets.mjs`.
- **Steps:**
  1. Walk `public/assets/glb` recursively and collect every `*.glb.gz.b64`.
  2. For each: base64-decode, gunzip (`node:zlib`), and load the bytes with `NodeIO` from `@gltf-transform/core`, registered with `ALL_EXTENSIONS` from `@gltf-transform/extensions` and the `meshoptimizer` encoder/decoder dependencies (`io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })`, after `await MeshoptEncoder.ready`).
  3. Transform with `@gltf-transform/functions`, in this order: `dedup()`, `prune({ keepAttributes: true })`, `weld()`, `meshopt({ encoder: MeshoptEncoder, level: 'medium' })`. `meshopt()` already runs `reorder()` and `quantize()` inside; do not add them again.
     - Do **not** run `simplify` or `resample`: they change shapes and animation curves.
  4. Only for files whose document contains textures (today only the cathedral): convert textures to KTX2 ETC1S with the CLI, because the library path needs the external `toktx` binary:
     - Check `which toktx`. If it is missing, print `toktx not found: install KTX-Software (brew install ktx) to encode KTX2` and skip KTX2 for that file, keeping JPEG. Do not fail the whole run.
     - If present, run `npx gltf-transform etc1s <in.glb> <out.glb> --quality 128` on the meshopt output.
  5. Write `<name>.glb` next to the source. Print one line per file: name, b64 bytes, new bytes, ratio.
  6. Print a total line `TOTAL b64=<bytes> glb=<bytes>`.
  7. Add npm script `"glb:encode": "node scripts/encode-glb-assets.mjs"`.
- **Success criteria:** 56 `.glb` files exist and the total is smaller.
- **Verify:** `npm run glb:encode 2>&1 | tail -3` ends with a `TOTAL` line where `glb` < `b64`, and `find public/assets/glb -name '*.glb' | wc -l` prints `56`.

### Task 2.3 — Validate the encoded files

- **Goal:** every new file is a valid glTF with the same node, skin and animation counts as its source.
- **Steps:**
  1. Extend the script with a `--check` flag that, for each pair, reads both documents and compares:
     - number of meshes, skins, animations and animation channels;
     - every animation name in the source exists in the output;
     - the lists of mesh names and material names are identical (`dedup` can merge materials the engine looks up by name; if names differ, rerun with `dedup({ propertyTypes: ['ACCESSOR', 'MESH', 'TEXTURE'] })` so materials are not merged);
     - per mesh, the world-space bounding box (`getBounds` from `@gltf-transform/core` on each scene node) differs by at most 1% of the source box extent on every axis.
  2. Print `CHECK OK <n>` when all pairs match, else print each mismatch and exit 1.
  3. Also run `npx gltf-transform validate public/assets/glb/king_white.glb` and `.../option8_cathedral.glb`.
  4. Visual check: in the dev server, select a piece and trigger one capture so its attack clip plays; take a screenshot of the idle pose and one mid-attack, save them to `visuals/asset-idle.png` and `visuals/asset-attack.png`, and compare by eye with the same frames on the old build. Record what you saw.
- **Success criteria:** zero mismatches; validator reports 0 errors; no visible shape or animation difference.
- **Verify:** `node scripts/encode-glb-assets.mjs --check 2>&1 | tail -1` prints `CHECK OK 56`; each `gltf-transform validate` output contains no line with severity `error` (warnings are allowed).

### Task 2.4 — Serve the KTX2 transcoder

- **Goal:** `/assets/basis/basis_transcoder.js` and `.wasm` are served in dev and in the build.
- **Steps:**
  1. Write `scripts/copy-basis-transcoder.mjs`: copy `node_modules/three/examples/jsm/libs/basis/basis_transcoder.js` and `basis_transcoder.wasm` into `public/assets/basis/`. Create the folder if missing. Exit 1 if a source file is missing.
  2. Add `node scripts/copy-basis-transcoder.mjs` to the `prebuild` and `predev` scripts after the existing install guard (`... || npm install) && node scripts/copy-basis-transcoder.mjs`).
  3. Add `public/assets/basis/` to `.gitignore`.
- **Success criteria:** both files exist after `npm run build` and appear in `dist/client/assets/basis/` (or wherever vite writes public files; check with `find dist -name 'basis_transcoder.wasm'`).
- **Verify:** `npm run build >/dev/null 2>&1; find dist -name 'basis_transcoder.wasm' | wc -l` prints `1` or more.

### Task 2.5 — Decode meshopt and KTX2 in the client

- **Goal:** `gltfLoader` can parse the new files.
- **Target:** `src/wizardChessEngine.js`, where `gltfLoader` is created (near line 2252).
- **Steps:**
  1. Import `MeshoptDecoder` from `three/examples/jsm/libs/meshopt_decoder.module.js` and `KTX2Loader` from `three/examples/jsm/loaders/KTX2Loader.js` at the top of the file.
  2. After `gltfLoader` is created: `gltfLoader.setMeshoptDecoder(MeshoptDecoder)`.
  3. Create `const ktx2Loader = new KTX2Loader().setTranscoderPath('./assets/basis/').detectSupport(renderer)` and call `gltfLoader.setKTX2Loader(ktx2Loader)`. The path is relative (`./`) on purpose: the app already fetches models relatively (`./assets/glb/`, near line 3506). `renderer` must already exist at this point; if `gltfLoader` is created before `renderer`, move only these two lines to just after renderer creation.
- **Success criteria:** the build passes.
- **Verify:** `npm run build 2>&1 | tail -3` shows no error.

### Task 2.6 — Switch `loadGltfModel` to binary `.glb`

- **Goal:** models load from `.glb` with one `fetch` and `gltfLoader.parse(arrayBuffer)`. The b64 path is kept behind a constant for rollback.
- **Target:** `loadGltfModel` (lines 3503-3542) and `ASSET_CACHE_VER` (line 3502).
- **Steps:**
  1. Add `const ASSET_FORMAT = 'glb'; // 'b64' restores the old gzip+base64 files` above `ASSET_CACHE_VER`.
  2. Bump `ASSET_CACHE_VER` to `'v=meshopt_v1'`.
  3. When `ASSET_FORMAT === 'glb'`: `fetch(`${base}.glb?${ASSET_CACHE_VER}`)`. Treat the response as failed if `!res.ok` **or** the `content-type` header contains `text/html` (SPA fallback). Read `await res.arrayBuffer()` and pass it to `gltfLoader.parse(buffer, '', resolve, reject)`.
  4. Keep the existing b64 branch unchanged for `ASSET_FORMAT === 'b64'`.
  5. Delete the dead raw-`.glb` fallback near line 3534 (it is replaced by step 3).
  6. Keep the existing caching/promise-dedup behavior of the function exactly as it is.
- **Success criteria:** the game loads pieces, skin sets, xiangqi pieces and the cathedral from `.glb` files.
- **Verify:** `npx playwright test e2e/game-smoke.spec.ts 2>&1 | tail -5` shows all tests passed, and a one-off check in the dev server (port 3107 via Playwright or the preview tool) shows `performance.getEntriesByType('resource').filter(e => e.name.includes('.glb.gz.b64')).length === 0` and `> 0` entries ending in `.glb?v=meshopt_v1` after selecting the cathedral arena and the xiangqi variant.

### Task 2.7 — Asset inventory unit test

- **Goal:** a missing or HTML-fallback asset is caught before deploy.
- **Target:** `test/applet.test.mjs`, new test `'every model asset has a binary glb'`.
- **Steps:**
  1. List every `*.glb.gz.b64` under `public/assets/glb`. For each, assert the sibling `.glb` exists and its first 4 bytes are ASCII `glTF`.
  2. Assert `scripts/copy-basis-transcoder.mjs` exists.
- **Verify:** `npm test 2>&1 | tail -5` shows `fail 0`.

### Task 2.8 — Measure first-load size and choose the transport

- **Why:** Cloudflare does not compress `model/gltf-binary` responses (its compressible content-type list does not include it), and the cathedral loads unconditionally at start-up (near line 3927). So the **uncompressed** `.glb` bytes are what goes over the wire.
- **Steps:**
  1. `npm run build`.
  2. Sum the first playable load: the JS/CSS bundle in the build output (gzip size, since Cloudflare does compress JS/CSS: `gzip -c <f> | wc -c`), plus the **uncompressed** size of the 6 root piece `.glb` files and `option8_cathedral.glb`.
  3. Record the total and the per-file sizes in "Execution notes".
- **Pass condition:** total ≤ 10,485,760 bytes.
- **If it passes:** keep plain `.glb`. Go to the phase exit check.
- **If it fails:** do Task 2.9.
- **Verify:** the total is recorded, and either it is ≤ 10,485,760 bytes or Task 2.9 is done and its Verify passes.

### Task 2.9 — Gzip-in-file transport (only if Task 2.8 failed)

- **Steps:**
  1. In the encoder, also write `<name>.glb.gz` (`zlib.gzipSync(glbBytes, { level: 9 })`) next to each `.glb`.
  2. In `loadGltfModel`, for `ASSET_FORMAT === 'glb'`, fetch `${base}.glb.gz?${ASSET_CACHE_VER}`, check `res.ok` and that the content type is not `text/html`, then `new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()` and pass that to `gltfLoader.parse`. `DecompressionStream` is already used by the current b64 path, so browser support is unchanged.
  3. Update the Task 2.7 unit test to also require the `.glb.gz` sibling and check that it gunzips to bytes starting with `glTF`.
  4. Re-measure as in Task 2.8 using the `.glb.gz` sizes.
- **Pass condition:** total ≤ 10,485,760 bytes.
- **Verify:** the re-measured total meets the pass condition, and `npx playwright test e2e/game-smoke.spec.ts 2>&1 | tail -5` shows all passed.

## Phase exit check

- **Verify:** `npm run lint && npm test && npx playwright test 2>&1 | tail -5` exits 0 with all tests passed. Known effect: the xiangqi refetch-storm tests (`e2e/game-smoke.spec.ts` near line 127 and `e2e/online-room.spec.ts` near line 147) now see 1 request per model instead of 2 (no more b64-then-glb fallback). Their bound of ≤ 28 still holds. Do not loosen those tests.

## Notes for phase 8

- Delete the `.glb.gz.b64` files, the b64 branch, and `ASSET_FORMAT` only after phase 8 passes on staging, in a separate commit.
- Staging runs on `workers.dev`, so its measurement matches production (no compression for `.glb` on either).

## Execution notes

- Toolchain: `@gltf-transform/cli` 4.5.1 plus core/extensions/functions and `meshoptimizer`.
- **KTX2 not applied yet.** KTX-Software (`ktx`/`toktx`) is not installed and is not in Homebrew; installing it needs the official `.pkg` from GitHub and sudo. The encoder prints `toktx not found ...` and keeps the cathedral's JPEG textures. Running `npm run glb:encode` again after installing KTX-Software will add ETC1S KTX2. The client already has `KTX2Loader` and the transcoder wired.
- First `--check` run failed: `option8_cathedral: materialNames differ` (`Opt8_Column_Stone`, `Opt8_Lancet_Glass` merged by `dedup`). The engine looks those names up (around lines 4061 and 4122). Applied the remedy written in Task 2.3: `dedup` limited to accessors, meshes and textures. Second run: `CHECK OK 56`.
- `prune` logs "Removed Skin (1)" for xiangqi files, but the check confirms every file keeps the same skin count as its source (xiangqi `rook_white`: 1 skin, 1 skinned node before and after).
- `gltf-transform validate`: no errors on `king_white` and `option8_cathedral` (warnings only).
- Visual check: idle and mid-move screenshots with the old b64 and the new files look identical (`visuals/asset-idle-old.png`, `visuals/asset-idle.png`). An attack clip was not captured separately.
- Task 2.8: uncompressed first load = 11,912,913 bytes (bundle gzip 384,145 + 6 pieces + cathedral 9,267,648) > 10 MB, so Task 2.9 ran.
- Task 2.9: models ship as `.glb.gz`; first load = 6,643,450 bytes. The loader inflates with `DecompressionStream` and skips that when the server already decoded it (Vite dev sends `Content-Encoding: gzip`; checked via the gzip magic bytes).
- Deviation: plain `.glb` files are not committed or shipped. Only `.glb.gz` exists in `public/assets/glb` (56 files, 14.0 MB vs 37.9 MB of b64). The encoder writes the plain `.glb` to a temp file only for the optional KTX2 step, and `--check` and the unit test gunzip the `.glb.gz`.
- Exit check: `tsc` clean, unit 31/31, e2e 16 passed + 1 pre-existing skip. Refetch-storm tests still pass.
- Checkpoint fix: `--check` now also compares skinned meshes. meshopt stores skinned positions as normalized int16 and folds the scale into the inverse bind matrices, so raw POSITION ranges differ by design; the check compares bind-pose skinned bounds (joint world matrix x inverse bind matrix, weighted) within 1%, requires JOINTS_0/WEIGHTS_0, and requires one inverse bind matrix per joint. 55 skinned meshes compared, `CHECK OK 56`. With the tolerance cut to 1e-7 all 55 report a mismatch, so the comparison is live.

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
