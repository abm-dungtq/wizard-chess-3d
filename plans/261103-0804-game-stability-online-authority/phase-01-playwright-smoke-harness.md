---
phase: 1
title: "Playwright smoke harness"
status: pending
effort: 3h
pr: PR 1
---

# Phase 1: Playwright smoke harness

## Goal

Before any engine edit, a real-browser test must pass against the **current, unmodified** code. Later phases are judged against it.

## Context

- `src/wizardChessEngine.js` (about 11k lines) has no runtime test. `test/applet.test.mjs` mostly checks source strings.
- The engine exposes a debug API on `window.wizardChess`. The calls this phase uses:
  - `getState()` returns `gameVariant`, `moveHistoryCount`, `aiSearchInFlight`, `undoAvailableCount`, `rendererMemory`, `isWebGLContextLost`.
  - `executeChessMove(fromR, fromC, toR, toC, options)`
  - `undoLastMove()`, `resetChessBoard(...)`
  - `setGameVariant('chess' | 'xiangqi')`, `getGameVariant()`
  - `setPieceTheme(id)`, `PIECE_THEME_ORDER`
  - `createMultiplayerRoom(color)`, `joinMultiplayerRoom(code)`
- Chess board orientation: row 7 is the white back rank and row 6 holds the white pawns. Rows 0 and 1 are black. So white e2 to e4 is `executeChessMove(6, 4, 4, 4)`.
- The loading overlay is `#loading-overlay`. The engine adds the class `hidden` to it when ready (`src/wizardChessEngine.js` near line 10951).
- On load, a game-selector modal is shown. Close it with `window.wizardChess.closeGameSelectorModal()`.

## Files

| Action | Path | Change |
|---|---|---|
| modify | `package.json` | Add devDependency `@playwright/test`. Add scripts `test` and `test:e2e`. |
| create | `playwright.config.ts` | Configure the dev server on port 3107 and the Chromium project. |
| create | `e2e/game-smoke.spec.ts` | Single-player smoke tests. |
| create | `e2e/online-room.spec.ts` | Two-context online room test. |
| create | `e2e/helpers.ts` | Shared wait and console-error helpers. |
| modify | `.gitignore` | Ignore `test-results/` and `playwright-report/`. |

## Tasks

### Task 1.1: Install Playwright

- **Goal:** `@playwright/test` is a devDependency and Chromium is installed.
- **Target files:** `package.json`, `bun.lock`.
- **Steps:**
  1. Run `npm install -D @playwright/test@^1`.
  2. Run `npx playwright install chromium`.
  3. In `package.json` `scripts`:
     - add `"test": "node --test test/applet.test.mjs"`
     - add `"test:e2e": "playwright test"`
  4. If `bun.lock` is used by the repo, also run `bun install` so that `bun.lock` matches.
- **Success criteria:** `npx playwright --version` prints a version.
- **Verify:** `npx playwright --version` exits 0 and its output starts with `Version 1.`.

### Task 1.2: Playwright config

- **Goal:** `npx playwright test` starts its own Vite dev server on port 3107.
- **Target files:** `playwright.config.ts`, `.gitignore`.
- **Steps:**
  1. Create `playwright.config.ts` with:
     - `testDir: 'e2e'`
     - `timeout: 90_000`
     - `workers: 1`
     - `fullyParallel: false`
     - `use: { baseURL: 'http://localhost:3107', viewport: { width: 1024, height: 768 } }`
     - one project `chromium` with `launchOptions.args: ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu-rasterization']`
     - `webServer: { command: 'npx vite --port=3107 --strictPort', url: 'http://localhost:3107', reuseExistingServer: false, timeout: 120_000 }`
  2. Append `test-results/` and `playwright-report/` to `.gitignore`.
- **Success criteria:** The config file exists and parses.
- **Verify:** `npx playwright test --list` exits 0. The file list printed must not be empty after Task 1.3 is done; before that, exit 0 is enough.

### Task 1.3: Helpers

- **Goal:** Reusable helpers for "wait until the game is ready" and "collect console errors".
- **Target files:** `e2e/helpers.ts`.
- **Steps:**
  1. Export `async function openGame(page)`. It must:
     - call `page.goto('/')`
     - wait for `window.wizardChess?.getState` to exist (`page.waitForFunction`, timeout 60s)
     - wait for `document.getElementById('loading-overlay')?.classList.contains('hidden')` to be true (timeout 60s)
     - call `window.wizardChess.closeGameSelectorModal?.()`
  2. Export `function collectConsoleErrors(page): string[]`. It must:
     - push the text of every `console` message of type `error` into the returned array
     - push every `pageerror` message into the returned array
  3. Export `async function waitIdle(page)`. It waits until `getState().aiSearchInFlight === false` and `getState().moveHistoryCount` stays the same for 1500 ms. Timeout 30s.
- **Success criteria:** The file compiles under Playwright.
- **Verify:** no verification needed. Task 1.4 runs these helpers.

### Task 1.4: Single-player smoke spec

- **Goal:** One spec file covering the main offline flows.
- **Target files:** `e2e/game-smoke.spec.ts`.
- **Steps:** Write these tests. Every test calls `collectConsoleErrors` first and ends with `expect(errors).toEqual([])`.
  1. **move and AI reply**
     - `openGame`, then `executeChessMove(6,4,4,4)`, then `waitIdle`.
     - Expect `moveHistoryCount >= 2` (the AI answered).
  2. **undo**
     - After test 1's flow, call `undoLastMove()` and then `waitIdle`.
     - Expect `moveHistoryCount` to be smaller than before the undo.
  3. **rapid input stress**
     - Do the move, then without waiting call `undoLastMove()` three times, `triggerAIMoveNow()`, `resetChessBoard(true, false)`, and `undoLastMove()`.
     - Then `waitIdle`.
     - Expect `getState().gameVariant === 'chess'` and no console errors.
  4. **variant switch**
     - Loop 3 times: `setGameVariant('xiangqi')`, wait for `getState().boardCols === 9`, then `setGameVariant('chess')`, wait for `getState().boardCols === 8`.
     - Expect `rendererMemory.geometries` after the loop to be at most the value after the first iteration plus 10.
  5. **skin cycle**
     - Call `setPieceTheme` for every id in `PIECE_THEME_ORDER` twice, waiting 800 ms each.
     - Expect the geometry count after round 2 to equal the count after round 1.
  6. **real canvas click**
     - Find the canvas bounding box. Click the e2 pawn's screen position, which the test gets from the engine, not from hard-coded pixels.
     - If the engine API has a world-to-screen helper, use it. If it has none, skip this test with `test.skip` and a reason string. Do not add new engine code in this phase.
- **Success criteria:** All non-skipped tests pass on the unmodified engine.
- **Verify:** `npx playwright test e2e/game-smoke.spec.ts --reporter=line` exits 0. The output contains `passed` and does not contain `failed`.

### Task 1.5: Online room spec (baseline)

- **Goal:** Two browser contexts play three moves through the local room API.
- **Target files:** `e2e/online-room.spec.ts`.
- **Steps:**
  1. Create two contexts, `A` and `B`, each with its own page, and call `openGame` on both.
  2. In A, call `await window.wizardChess.createMultiplayerRoom('w')`. Read the room code from `new URL(location.href).searchParams.get('room')`.
  3. In B, call `await window.wizardChess.joinMultiplayerRoom(code)`.
  4. A plays `executeChessMove(6,4,4,4)`.
  5. Wait until B's `getState().moveHistoryCount === 1` (timeout 15s).
  6. B plays `executeChessMove(1,4,3,4)`.
  7. Wait until A's `moveHistoryCount === 2`.
  8. Expect no console errors in either page.
- **Success criteria:** The test passes on the unmodified code. If `joinMultiplayerRoom` or `createMultiplayerRoom` have different signatures, read them in `src/wizardChessEngine.js` (search `async function createMultiplayerRoom`, `async function joinMultiplayerRoom`) and adapt the call, not the engine.
- **Verify:** `npx playwright test e2e/online-room.spec.ts --reporter=line` exits 0.

### Task 1.6: Full baseline run and commit

- **Goal:** The whole suite is green and committed.
- **Steps:**
  1. Run `npm run lint`, `npm test`, and `npm run test:e2e`.
  2. Commit with the message `test: add Playwright smoke harness for game flows`.
- **Verify:** All three commands exit 0.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same failure evidence to the user. Never continue by self-reasoning.

A test that fails on the **unmodified** engine is a real finding. Do not weaken the assertion and do not fix the engine in this phase. Report it through the Failure Protocol.
