---
phase: 7
title: "Liquid Glass HUD dock"
status: pending
effort: 4h
pr: PR B
---

# Phase 7: Liquid Glass HUD dock

## Goal

- On desktop (viewport wider than 768 px and taller than 520 px) the top bar and the bottom bar become **one** floating glass dock at the top center. The board gets the bottom of the screen back.
- The dock uses shared glass tokens: translucent fill, `backdrop-filter` blur + saturate, a specular inset highlight, and P3 gold where the display supports it.
- Chromium (Chrome, Edge) adds a subtle SVG refraction to the glass when the quality tier is not `base`. Safari and Firefox get the same glass without refraction.
- Users with "Reduce transparency" get an opaque dock.
- Phone layout (the `max-width: 768px` and short-landscape media queries) keeps its current structure. It only picks up the new tokens.
- At 1470x956 the visible HUD is ≤ 114 px tall (12% of 956).

## Facts verified before planning

- `src/App.tsx`:
  - `#hud-top` (line 152) holds `#hud-left` (brand pill, `#status-pill`, variant, AI difficulty, room, skin shop, mobile-controls buttons) and `#hud-right` (the consolidated menu panel / mobile sheet).
  - `#hud-bottom` (line 450) holds `#controls-hint` (line 451), `#captured-tray` (line 454) and `#mobile-quick-dock` (line 455).
- `src/styles.css`:
  - `:root` tokens at lines 1-10 (`--hud-bg`, `--hud-border`, `--gold`, `--gold-bright`, ...).
  - `#hud-top` line 50, `.hud-group` line 64, `.hud-btn` line 138, `#hud-bottom` line 181, `.hint-pill` line 195, `.captured-pill` line 212, `.mobile-quick-dock` line 621, `#hud-right.consolidated-menu-panel` line 647.
  - 17 `backdrop-filter` declarations, only 2 with a `-webkit-` prefix.
  - Media queries at lines 841, 1063, 1114, 1329, 1560, 1743, 1960.
- The engine looks up HUD elements by id only (`#captured-tray` near line 8342, `#controls-hint` near line 9488). Moving elements in the DOM is safe as long as ids stay.
- Phase 1 dispatches `wizardchess:visual-settings` with `qualityTier` and `motionLevel`.

## Files

- `src/App.tsx`, `src/styles.css`, `src/wizardChessEngine.js` (two `dataset` lines and the hint collapse), `e2e/game-smoke.spec.ts`.

## Tasks

### Task 7.1 — Capture the "before" screenshots

- **Steps:** at 1470x956 and at 390x844, open the game, `waitIdle`, and save full-page screenshots to `plans/261103-1655-premium-visual-slice-1/visuals/hud-before-desktop.png` and `hud-before-phone.png`.
- **Verify:** `ls plans/261103-1655-premium-visual-slice-1/visuals/hud-before-*.png | wc -l` prints `2`.

### Task 7.2 — Glass tokens and P3 gold

- **Steps:**
  1. In `:root` add:
     - `--glass-fill: rgba(16, 20, 30, 0.46);`
     - `--glass-stroke: rgba(255, 255, 255, 0.14);`
     - `--glass-blur: blur(22px) saturate(165%);`
     - `--glass-specular: inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -1px 0 rgba(0, 0, 0, 0.28);`
     - `--glass-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);`
  2. Add `@supports (color: color(display-p3 1 1 1)) { :root { --gold: color(display-p3 0.86 0.69 0.24); --gold-bright: color(display-p3 0.99 0.85 0.40); } }` right after `:root`.
  3. Add `@media (prefers-reduced-transparency: reduce) { :root { --glass-fill: rgba(12, 15, 22, 0.97); --glass-blur: none; } }`.
  4. For every existing `backdrop-filter:` line that lacks a `-webkit-backdrop-filter:` twin, add the twin with the same value (Safari 17 and older need the prefix).
- **Verify (run now, before Task 7.5):** `grep -c "backdrop-filter" src/styles.css` minus `grep -c "\-webkit-backdrop-filter" src/styles.css` equals `grep -c "\-webkit-backdrop-filter" src/styles.css` (every unprefixed line has a prefixed twin). Write the three numbers in "Execution notes". This parity will intentionally break by one in Task 7.5 (the refraction rule has no `-webkit-` twin); do not re-run this check after 7.5.

### Task 7.3 — Build the desktop dock

- **Steps:**
  1. In `src/App.tsx`, inside `#hud-left`, add a new last child `<div className="dock-tray" id="dock-tray"></div>`. Move the `#captured-tray` element from `#hud-bottom` into `#dock-tray`. Keep its id and class.
  2. Leave `#controls-hint` and `#mobile-quick-dock` in `#hud-bottom`.
  3. In `src/styles.css`, add a desktop-only block `@media (min-width: 769px) and (min-height: 521px) { ... }` placed **before** line 841 so the existing phone queries still win on phones. Inside it:
     - `#hud-top`: `left: 50%; right: auto; transform: translateX(-50%); max-width: min(1180px, calc(100vw - 28px)); top: 12px;`.
     - `#hud-left`: `background: var(--glass-fill); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--glass-stroke); box-shadow: var(--glass-specular), var(--glass-shadow); border-radius: 18px; padding: 6px 8px; flex-wrap: nowrap;`.
     - `.hud-btn` inside `#hud-left`: transparent background and border at rest; on `:hover` a faint `rgba(255,255,255,0.08)` fill; keep current font sizes.
     - `#hud-bottom .hint-pill`: shown, but gets `.is-collapsed` styles (see step 4).
  4. Hint collapse (this is how the bottom bar disappears on desktop, so the two bars become one dock; the hint is still shown before the first move): in `src/wizardChessEngine.js`, after the first committed move (search for where the move counter or `moveHistory` grows in `executeChessMove`, near line 6228), add `document.getElementById('controls-hint')?.classList.add('is-collapsed')` once. In CSS (desktop block), `.hint-pill.is-collapsed { opacity: 0; pointer-events: none; transition: opacity .4s; }`. On phones nothing changes.
  5. Make sure the menu panel `#hud-right.consolidated-menu-panel` (line 647, `top: calc(54px + ...)`, `left: 14px`) still opens below the dock: in the desktop block set its `left: 50%; transform: translateX(-50%); top: calc(64px + env(safe-area-inset-top, 0px));` and apply the glass tokens to it as well.
- **Success criteria:** on desktop, nothing is pinned to the bottom except the hint pill (which fades after the first move).
- **Verify:** covered by Task 7.6.

### Task 7.4 — Expose tier and motion to CSS

- **Steps:**
  1. In `src/wizardChessEngine.js`, set `document.body.dataset.qualityTier = qualityTier` and `document.body.dataset.motion = motionLevel` inside `announceVisualSettings()` (the single place every change goes through), and also once at start-up right after the phase 1 block, because the event only fires on changes.
  2. Add `const supportsSvgBackdrop = 'userAgentData' in navigator && CSS.supports?.('backdrop-filter', 'url(#a)') === true;` and set `document.body.classList.toggle('svg-backdrop', supportsSvgBackdrop)` once at start-up. `navigator.userAgentData` exists only in Chromium browsers, so Safari and Firefox never get the refraction even if they parse the value.
- **Verify:** no verification needed; Task 7.6 reads the attributes.

### Task 7.5 — Chromium refraction layer

- **Steps:**
  1. In `src/App.tsx`, add once at the end of the root element: an `<svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>` holding `<filter id="liquid-glass-refract" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="1" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="14" xChannelSelector="R" yChannelSelector="G"/></filter>`.
  2. In CSS: `body.svg-backdrop:not([data-quality-tier="base"]) #hud-left { backdrop-filter: url(#liquid-glass-refract) var(--glass-blur); }`. Do not add a `-webkit-` twin for this rule (Safari must not get it).
- **Cost gate:** the SVG filter is re-applied every frame over the WebGL canvas. On the dev Mac in a headed Chromium, read `getState().rollingFrameMs` after 10 s idle on `high` with `body.svg-backdrop` present, then remove the class in the console, wait 10 s, and read it again. Keep the refraction rule only if the difference is ≤ 1 ms. Otherwise delete the rule and the SVG filter, keep the plain glass, and record the numbers.
- **Verify:** the two `rollingFrameMs` values and the keep/drop decision are written in "Execution notes". Task 7.6 checks the computed style only if the rule was kept.

### Task 7.6 — E2E and screenshots

- **Target:** `e2e/game-smoke.spec.ts`, new test `'desktop HUD is one glass dock within 12% of the viewport height'`.
- **Steps:**
  1. Viewport 1470x956. Open the game.
  2. Collect bounding boxes of every visible element among `#hud-left`, `#hud-bottom > *` (skip elements with `opacity` 0 or `display: none`). Compute the union height of boxes in the top half plus the union height of boxes in the bottom half.
  3. Play one move. Recompute. Expect the total ≤ 114 px.
  4. Expect `#captured-tray` to be a descendant of `#hud-left`.
  5. Expect `document.body.dataset.qualityTier === 'high'`. If the refraction rule was kept in Task 7.5, also expect, in Chromium, `getComputedStyle(#hud-left).backdropFilter` to contain `url(`; otherwise expect it to contain `blur`.
  6. Viewport 390x844. Open the game. Expect `#mobile-quick-dock` visible and every existing mobile assertion in the suite still passing.
  7. Save "after" screenshots to `visuals/hud-after-desktop.png` and `visuals/hud-after-phone.png` (same setup as Task 7.1).
- **Verify:** `npx playwright test e2e/game-smoke.spec.ts -g "glass dock" 2>&1 | tail -5` shows `1 passed`, and `ls plans/261103-1655-premium-visual-slice-1/visuals/hud-after-*.png | wc -l` prints `2`.

### Task 7.7 — Safari check

- **Steps:** run the same test with Playwright WebKit once: `npx playwright test e2e/game-smoke.spec.ts -g "glass dock" --browser=webkit` if the config allows a `--browser` override; otherwise add a temporary `webkit` project locally and do not commit it. In WebKit, skip assertion 5's `url(` part and instead expect `backdropFilter` (or `webkitBackdropFilter`) to contain `blur`.
- **Verify:** the WebKit run shows `1 passed`. If WebKit is not installed, run `npx playwright install webkit` first. Record the result.

## Phase exit check

- **Verify:** `npm run lint && npx playwright test 2>&1 | tail -5` exits 0 with all tests passed.

## Execution notes

(fill in during execution)

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
