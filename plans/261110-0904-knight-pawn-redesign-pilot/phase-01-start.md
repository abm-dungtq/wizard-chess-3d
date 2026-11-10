---
title: "Phase 1: Baseline, tooling and workspace"
status: done
priority: P1
effort: 2h
dependencies: []
---

# Phase 1: Baseline, tooling and workspace

## Goal

Before any model changes, the "before" screenshots, model statistics and frame-time baseline are saved, and the three helper scripts the later phases need exist.

All commands run from the worktree root: `/Volumes/2/wizard-chess-3d/.claude/worktrees/redesign-3d-chess-pieces-bf8f22`. `PLAN` below means `plans/261110-0904-knight-pawn-redesign-pilot`.

## Files to Create / Modify

- Create: `scripts/glb-stats.mjs`
- Create: `scripts/glabs-image.mjs`
- Create: `e2e/piece-pilot-shots.spec.ts`
- Create (ignored by git): `.tools/piece-redesign/{original,concept,candidates,export}/`
- Create: `PLAN/visuals/baseline-stats.json`, `PLAN/visuals/baseline-perf.txt`, `PLAN/visuals/before-*.png`

## Tasks & Steps

### Task 1.1 — Check preconditions

- **Goal:** dependencies, tests, G-Labs and Blender are all ready.
- **Steps:**
  1. Run `bun install`.
  2. Run `npm test 2>&1 | tail -8`.
  3. Run `curl -s -m 5 http://127.0.0.1:8765/api/health`.
  4. Run `security find-generic-password -s glabs -w >/dev/null 2>&1 && echo KEY_SET || echo KEY_MISSING`.
  5. Call the Blender MCP tool `get_addon_status`.
- **Success criteria:** tests pass, G-Labs is up, the key is available, Blender answers.
- **Verify:**
  - step 2 prints `pass 32` and `fail 0`;
  - step 3 prints JSON containing `"status": "ok"`;
  - step 4 prints `KEY_SET`. If it prints `KEY_MISSING`, stop and ask the user to store the key themself by running `security add-generic-password -s glabs -a glabs -w` in their own terminal (it prompts for the value), then repeat step 4. Never type the key into a command, a file or a message: commands are saved in the session transcript. Every later command that needs the key starts with `GLABS_API_KEY=$(security find-generic-password -s glabs -w)`;
  - step 5 returns a Blender version. If it returns "Could not connect to Blender", ask the user to open Blender and enable the MCP add-on, then repeat step 5. This one retry is allowed without the Failure Protocol.

### Task 1.2 — Create the workspace

- **Goal:** scratch and evidence folders exist.
- **Steps:** run `mkdir -p .tools/piece-redesign/original .tools/piece-redesign/concept .tools/piece-redesign/candidates .tools/piece-redesign/export PLAN/visuals` (replace `PLAN` with the real path).
- **Verify:** `git status --short .tools | wc -l` prints `0` (the folder is ignored), and `ls -d PLAN/visuals` prints the path.

### Task 1.3 — Model statistics script and baseline

- **Goal:** one command prints the numbers every later phase checks.
- **Target:** new `scripts/glb-stats.mjs`.
- **Steps:**
  1. Write the script. Imports: `node:fs`, `node:zlib`, `NodeIO` from `@gltf-transform/core`, `ALL_EXTENSIONS` from `@gltf-transform/extensions`, `MeshoptDecoder` from `meshoptimizer`. Build the reader exactly like `createIO()` in `scripts/encode-glb-assets.mjs` (await `MeshoptDecoder.ready`, register `ALL_EXTENSIONS` and the `'meshopt.decoder'` dependency).
  2. Arguments: one or more file paths ending in `.glb.gz` or `.glb`. Gunzip when the name ends in `.gz`.
  3. For each file print one JSON line with: `file`, `bytes` (file size on disk), `vertices` (sum of `POSITION` counts over all primitives), `triangles` (sum of index counts / 3), `primitives` (array of material names in order), `textures` (count), `joints` (array of joint names of the first skin), `clips` (sorted array of animation names), `durations` (object: clip name → the largest sampler input time of that clip, rounded to 3 decimals).
  4. Run `node scripts/glb-stats.mjs public/assets/glb/pawn_white.glb.gz public/assets/glb/knight_white.glb.gz > PLAN/visuals/baseline-stats.json`.
- **Success criteria:** the baseline file has two lines.
- **Verify:** `grep -c '"vertices":21875' PLAN/visuals/baseline-stats.json` prints `1`, `grep -c '"vertices":13623' PLAN/visuals/baseline-stats.json` prints `1`, and `grep -c '"Shatter":1.875' PLAN/visuals/baseline-stats.json` prints `2`.

### Task 1.4 — G-Labs image script

- **Goal:** one command turns a prompt (and optional reference images) into a saved PNG through G-Labs.
- **Target:** new `scripts/glabs-image.mjs`. Node built-ins only (`fetch`, `node:fs`, `node:path`).
- **Steps:**
  1. Arguments: `--prompt-file <path>` (required), `--out <path>` (required), `--aspect <ratio>` (default `1:1`), `--ref <path>` (repeatable, at most 5).
  2. Read the key from `process.env.GLABS_API_KEY`. If empty, print `GLABS_API_KEY is not set` to stderr and exit 2. Base URL: `process.env.GLABS_URL` or `http://127.0.0.1:8765`.
  3. `POST {base}/api/openai/generate` with headers `Content-Type: application/json` and `X-API-Key: <key>`, body `{ prompt, aspect_ratio, quality: "high", prompt_mode: "direct", reasoning: "none", web_search: false, reference_images }`. Each reference is a string `data:image/png;base64,<file bytes as base64>` (use `image/jpeg` for `.jpg`/`.jpeg`, `image/webp` for `.webp`).
  4. Expect HTTP 202 with `task_id`. Otherwise print the status and body to stderr and exit 1.
  5. Poll `GET {base}/api/status/{task_id}` (same `X-API-Key` header) every 5 seconds, for at most 10 minutes. On `failed`, print `error_code` and `error` to stderr and exit 1. On timeout, exit 1.
  6. On `completed`, download `results[0]` and write it to `--out`. Print `saved <out> <byte count>`.
  7. Never print the key, and never print the request headers.
- **Success criteria:** running without a key fails cleanly; the real call is exercised in phase 2.
- **Verify:** `GLABS_API_KEY= node scripts/glabs-image.mjs --prompt-file package.json --out /dev/null; echo EXIT=$?` prints `GLABS_API_KEY is not set` and `EXIT=2`. Also `grep -c "X-API-Key" scripts/glabs-image.mjs` prints at least `1`, and `grep -n "console.*key" scripts/glabs-image.mjs` prints nothing.

### Task 1.5 — Screenshot spec

- **Goal:** one command saves comparable screenshots of the knight and pawn, still and in motion.
- **Target:** new `e2e/piece-pilot-shots.spec.ts`. Follow the structure of `e2e/perf-budget.spec.ts` and import `openGame` and `waitIdle` from `./helpers`.
- **Steps:**
  1. First line of the body: `test.skip(process.env.SHOTS !== '1', 'set SHOTS=1 to capture pilot screenshots');`.
  2. Constants: `LABEL = process.env.SHOT_LABEL || 'before'`; `OUT = 'plans/261110-0904-knight-pawn-redesign-pilot/visuals'`; `THEMES = ['hogwarts', 'jade', 'royal']`.
  3. Test `still shots`. For each theme:
     1. `openGame(page, '/?autotest=1')`.
     2. In `page.evaluate`, with `w = window.wizardChess`: `w.setQualityTier('high', false); w.setMotionLevel('off', false); w.setCombatCameraZoomEnabled(false); w.setPieceTheme(theme, 'both'); w.setCameraPreset('spectator');`.
     3. `await page.waitForTimeout(2500)`.
     4. Full screenshot to `${OUT}/${LABEL}-${theme}-board.png`.
     5. For each of `whiteKnight: [7, 6]`, `whitePawn: [6, 4]`, `blackKnight: [0, 1]`, `blackPawn: [1, 4]`: get `{x, y}` from `w.getPieceScreenPoint(r, c)`, then take a screenshot with `clip: { x: x - 110, y: y - 170, width: 220, height: 220 }` (clamp `x` and `y` to 0 or more) to `${OUT}/${LABEL}-${theme}-${name}.png`.
  4. Test `clip frames` (theme `hogwarts` only, same settings as step 3.2):
     1. Call `w.triggerDemoCapture()`, then take 14 full screenshots 150 ms apart to `${OUT}/${LABEL}-pawn-capture-${index}.png` (index `00` to `13`).
     2. `w.resetChessBoard(true)`, `await waitIdle(page)`, `w.setPassAndPlayMode(true, false)`.
     3. `w.executeChessMove(7, 6, 5, 5)` then `waitIdle`; `w.executeChessMove(1, 4, 3, 4)` then `waitIdle`.
     4. `w.executeChessMove(5, 5, 3, 4)` (knight takes pawn), then take 14 full screenshots 150 ms apart to `${OUT}/${LABEL}-knight-capture-${index}.png`.
  5. Set `test.setTimeout(240_000)` in both tests.
  6. As built (changed during execution, because the first run gave unusable stills): the spec uses `deviceScaleFactor: 2`; it calls `setCameraPreset('spectator')` only when that preset is not already active (a second call flips the board side); it waits 4 s and then until a piece's screen point is stable for 1 s; the stills are taken after the moves 1.e4 e5 2.Nf3 Nc6, so the subjects are `whiteKnight: [5, 5]`, `whitePawn: [4, 4]`, `blackKnight: [2, 2]`, `blackPawn: [3, 4]` (on the start squares the back rank hides the pawns); the close-up crop is 150 px square.
- **Success criteria:** the "before" images exist.
- **Verify:** `SHOTS=1 SHOT_LABEL=before npx playwright test e2e/piece-pilot-shots.spec.ts; echo EXIT=$?` prints `EXIT=0`, and `ls PLAN/visuals/before-*.png | wc -l` prints `43` (3 themes × 5 stills + 28 frames). After the run, `lsof -i :3107` prints nothing.

### Task 1.6 — Editable originals

- **Goal:** the current knight and pawn exist as plain `.glb` files that Blender can import.
- **Steps:** run `node scripts/glb-pipeline.mjs unpack .tools/piece-redesign/original`.
- **Verify:** `ls .tools/piece-redesign/original/pawn_white.glb .tools/piece-redesign/original/knight_white.glb` lists both files.

### Task 1.7 — Frame-time baseline

- **Goal:** a "before" frame-time number exists.
- **Steps:** run `PERF=1 npx playwright test e2e/perf-budget.spec.ts -g "ultra checkmate p95" 2>&1 | tee PLAN/visuals/baseline-perf.txt`, then run it a second time with `tee -a` (append). Two runs show the noise; phase 6 compares against the slower one.
- **Success criteria:** the log holds the `medianMean` line. The test's own threshold may pass or fail on this machine; only the number matters here.
- **Verify:** `grep -c '"medianMean"' PLAN/visuals/baseline-perf.txt` prints `2`.

## Verification

- `npm test 2>&1 | grep -E "^ℹ (pass|fail)"` prints `pass 32` and `fail 0`.
- `npm run lint; echo EXIT=$?` prints `EXIT=0`.
- `git status --short` lists only the three new scripts and files under `plans/`.

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
