import { test, expect, devices, chromium } from '@playwright/test';
import { getState, openGame, waitIdle } from './helpers';

// Budget measurements, not part of the default run: `PERF=1 npx playwright test e2e/perf-budget.spec.ts`.
test.skip(process.env.PERF !== '1', 'set PERF=1 to run the budget measurements');

// rAF is capped by the display refresh; these flags remove the cap so a frame delta shows the real cost.
const UNCAPPED = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];
const GPU = ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu-rasterization'];

async function recordUltraCheckmate(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1470, height: 956 });
  await openGame(page, '/?autotest=1');
  await page.evaluate(() => {
    const w = (window as any).wizardChess;
    w.setQualityTier('ultra', false);
    w.setMotionLevel('full', false);
    w.freezeDpr(true);
  });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const w = (window as any).wizardChess;
    w.startFrameRecorder();
    w.triggerCheckmateSequence('b', 'w');
  });
  await page.waitForTimeout(4200);
  const result = await page.evaluate(() => (window as any).wizardChess.stopFrameRecorder());
  const s = await getState(page);
  return { ...result, currentActiveDpr: s.currentActiveDpr, qualityTier: s.qualityTier, gpuRenderer: s.gpuRenderer };
}

// Each test launches its own browser: launch flags differ per test and cannot be set per describe group.
// deviceScaleFactor 2 matches the Retina display, so the ultra desktop DPR cap (1.25) is what gets measured.
test('ultra checkmate p95', async ({ headless, baseURL }) => {
  test.setTimeout(180_000);
  const browser = await chromium.launch({ headless, args: [...GPU, ...UNCAPPED] });
  const means: number[] = [];
  const results: Awaited<ReturnType<typeof recordUltraCheckmate>>[] = [];
  for (let run = 0; run < 3; run++) {
    const context = await browser.newContext({ baseURL, deviceScaleFactor: 2 });
    const r = await recordUltraCheckmate(await context.newPage());
    console.log(JSON.stringify({ run, ...r }));
    means.push(r.mean);
    results.push(r);
    await context.close();
  }
  await browser.close();
  const median = [...means].sort((a, b) => a - b)[1];
  console.log(JSON.stringify({ medianMean: median }));
  // All three runs are printed before any assertion, so a failure still records every run.
  for (const r of results) {
    expect(r.qualityTier).toBe('ultra');
    expect(r.currentActiveDpr).toBeCloseTo(1.25, 2);
    expect(r.over33).toBeLessThanOrEqual(2);
  }
  expect(median).toBeLessThanOrEqual(12);
});

test('ultra checkmate vsync p95', async ({ headless, baseURL }) => {
  test.setTimeout(90_000);
  const browser = await chromium.launch({ headless, args: GPU });
  const r = await recordUltraCheckmate(await (await browser.newContext({ baseURL, deviceScaleFactor: 2 })).newPage());
  await browser.close();
  console.log(JSON.stringify({ vsync: true, ...r }));
  expect(r.p95).toBeLessThanOrEqual(17);
});

test.describe('base phone', () => {
  test('base phone p95', async ({ headless, baseURL }) => {
    test.setTimeout(120_000);
    const { defaultBrowserType: _ignored, ...pixel7 } = devices['Pixel 7'];
    const browser = await chromium.launch({ headless, args: [...GPU, ...UNCAPPED] });
    const page = await (await browser.newContext({ ...pixel7, baseURL })).newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await openGame(page);
    expect((await getState(page)).qualityTier).toBe('base');
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      const w = (window as any).wizardChess;
      w.startFrameRecorder();
      w.executeChessMove(6, 4, 4, 4);
    });
    await page.waitForFunction(() => !(window as any).wizardChess.getState().isAnimatingMove, null, {
      timeout: 60_000
    });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => (window as any).wizardChess.stopFrameRecorder());
    await browser.close();
    console.log(JSON.stringify({ phone: 'Pixel 7', cpuThrottle: 4, ...r }));
    expect(r.p95).toBeLessThanOrEqual(16.6);
  });
});

// Run against staging: `E2E_BASE_URL=<staging origin> PERF=1 npx playwright test e2e/perf-budget.spec.ts -g transfer`.
test.describe('transfer size', () => {
  test('first playable transfer size', async ({ page }) => {
    test.setTimeout(120_000);
    await openGame(page);
    await waitIdle(page);
    const entries = await page.evaluate(() =>
      [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')].map((e) => ({
        name: e.name,
        size: (e as PerformanceResourceTiming).transferSize
      }))
    );
    const total = entries.reduce((n, e) => n + e.size, 0);
    const top = [...entries].sort((a, b) => b.size - a.size).slice(0, 5);
    console.log(JSON.stringify({ total, top }));
    expect(total).toBeLessThanOrEqual(10_485_760);
  });
});
