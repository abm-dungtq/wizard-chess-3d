---
title: "Phase 6: In-game comparison and verdict"
status: in-progress
priority: P1
effort: 1.5h
dependencies: [4, 5]
---

> As built (2026-11-10)
>
> - Tasks 6.1 to 6.4 pass: 15 `compare-*.png` files, `PERF_OK` (baseline 14.17, after 11.9), report 59 lines with no key text, `pass 32` / `fail 0`, lint exit 0, no diff in `test/`, working tree as listed, port 3107 free.
> - Four earlier montage files were renamed from `compare-*` to `montage-*` so the count in Task 6.1 holds. `montage-verdict-<theme>.png` stacks the four close-up comparisons of a theme (columns: before, after, after with maps).
> - Task 6.5 is waiting for the user's verdict.

# Phase 6: In-game comparison and verdict

## Goal

The user sees before/after pictures at the same camera, the budget and cost numbers, and decides whether to continue with the other four pieces.

`PLAN` = `plans/261110-0904-knight-pawn-redesign-pilot`. `WS` = `.tools/piece-redesign`. All commands run from the worktree root.

If phase 5 was stopped or dropped on `kongming`'s advice, use the `after-` images wherever this phase says `after-maps-`.

## Files to Create / Modify

- Create: `PLAN/visuals/compare-<theme>-<name>.png`, `PLAN/visuals/compare-<theme>-board.png`
- Create: `PLAN/visuals/after-perf.txt`, `PLAN/visuals/pilot-cost-report.md`

## Tasks & Steps

### Task 6.1 — Build the side-by-side images

- **Goal:** one image per theme and piece that shows before, after, and after with maps.
- **Steps:**
  1. For each theme in `hogwarts jade royal` and each name in `whiteKnight whitePawn blackKnight blackPawn`: `magick PLAN/visuals/before-<theme>-<name>.png PLAN/visuals/after-<theme>-<name>.png PLAN/visuals/after-maps-<theme>-<name>.png +append PLAN/visuals/compare-<theme>-<name>.png`
  2. For each theme: `magick PLAN/visuals/before-<theme>-board.png PLAN/visuals/after-maps-<theme>-board.png +append PLAN/visuals/compare-<theme>-board.png`
- **Verify:** `ls PLAN/visuals/compare-*.png | wc -l` prints `15`.

### Task 6.2 — Frame-time check

- **Goal:** the new pieces do not make frames slower than the baseline.
- **Steps:**
  1. `PERF=1 npx playwright test e2e/perf-budget.spec.ts -g "ultra checkmate p95" 2>&1 | tee PLAN/visuals/after-perf.txt`
  2. Read the larger of the two `medianMean` values in `PLAN/visuals/baseline-perf.txt`, and the value in `PLAN/visuals/after-perf.txt`.
- **Success criteria:** after ≤ baseline × 1.05.
- **Verify:** `node -e "const g=f=>Math.max(...require('fs').readFileSync(f,'utf8').split('\n').filter(l=>l.includes('medianMean')).map(l=>JSON.parse(l.slice(l.indexOf('{'))).medianMean));const b=g('PLAN/visuals/baseline-perf.txt'),a=g('PLAN/visuals/after-perf.txt');console.log(b,a,a<=b*1.05?'PERF_OK':'PERF_WORSE')"` (with `PLAN` replaced) prints `PERF_OK`.

### Task 6.3 — Write the cost report

- **Goal:** the user can judge the price of doing the full set.
- **Target:** new `PLAN/visuals/pilot-cost-report.md`, at most 60 lines.
- **Steps:** write these sections with real numbers only; write "not measured" where a number does not exist:
  1. **Generation:** provider, number of `generate_3d` calls used (from `WS/generation-log.md`), number of G-Labs images generated.
  2. **Time:** elapsed working time per phase and per piece, from the session timestamps.
  3. **Budgets:** a table with baseline and new values for vertices, triangles, `.glb.gz` bytes and total bytes with maps, per piece (from `baseline-stats.json`, `after-stats.json` and Task 5.5 step 4), plus the two `medianMean` values.
  4. **Clips:** the maximum edge ratio per clip per piece from Task 4.7, and whether `Shatter` needed a fallback.
  5. **Estimate for six pieces:** calls and hours for the remaining four pieces, scaled from the pawn (simple figure) and the knight (complex figure). State the assumption: rook like pawn, bishop, queen and king between pawn and knight.
  6. **Known issues:** every check item that needed `kongming`, and anything visibly imperfect in the comparison images.
- **Verify:** `wc -l < PLAN/visuals/pilot-cost-report.md` prints at most `60`, and `grep -c -i "api key\|X-API-Key" PLAN/visuals/pilot-cost-report.md` prints `0`.

### Task 6.4 — Final checks

- **Goal:** the working tree is in a state the user can keep or discard.
- **Steps:**
  1. `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`, `npm run lint; echo EXIT=$?`, `git diff --stat test/`.
  2. `git status --short`
  3. `lsof -i :3107`
- **Verify:** step 1 prints `pass 32`, `fail 0`, `EXIT=0` and no diff for `test/`; step 2 lists only: the two piece `.glb.gz` files, `public/assets/glb/detail/`, `src/wizardChessEngine.js`, `scripts/glb-stats.mjs`, `scripts/glabs-image.mjs`, `e2e/piece-pilot-shots.spec.ts` and files under `plans/`; step 3 prints nothing.

### Task 6.5 — User gate: verdict

- **Goal:** the user decides the next step.
- **Steps:**
  1. Send the user the three `compare-<theme>-board.png` images, the twelve close-up comparisons and `pilot-cost-report.md`.
  2. Ask, with these options: "Continue with rook, bishop, queen and king", "Keep the pilot but without detail maps", "Revise the pawn or knight first", "Discard the pilot".
  3. Do not commit, push or deploy unless the user asks in chat.
  4. If the user chooses "Discard the pilot", run: `git checkout -- public/assets/glb/pawn_white.glb.gz public/assets/glb/knight_white.glb.gz src/wizardChessEngine.js` and `rm -r public/assets/glb/detail`, then `npm test` must print `pass 32`.
  5. If the user chooses "Keep the pilot but without detail maps": delete the two entries in `BASE_PIECE_DETAIL_MAPS` (leave the object empty), delete `public/assets/glb/detail/`, change `ASSET_CACHE_VER` to `'v=statue_pilot_v3'`, and run `npm test` and `npm run lint`.
- **Verify:** the user's choice is recorded as the last line of `pilot-cost-report.md`. For choices 4 and 5 the commands in that step exit 0 and `npm test` prints `pass 32`.

## Verification

- All six acceptance criteria in `plan.md` are either met or listed as not met in the report, with the evidence file named.
- The old `.tools/` scratch folder may stay; it is ignored by git.

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
