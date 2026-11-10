import { test } from '@playwright/test';

// Stills of the game selector and the menu, not part of the default run:
// `UI=1 UI_OUT=<dir> npx playwright test e2e/ui-shots.spec.ts`.
test.skip(process.env.UI !== '1', 'set UI=1 to capture selector and menu screenshots');

const OUT = process.env.UI_OUT || 'test-results/ui-shots';

async function load(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(
    () => Boolean(document.getElementById('loading-overlay')?.classList.contains('hidden')),
    null,
    { timeout: 60_000 }
  );
  await page.waitForTimeout(1500);
}

for (const [name, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['phone', { width: 390, height: 844 }]
] as const) {
  test(`selector and menu, ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await load(page);
    await page.screenshot({ path: `${OUT}/${name}-selector.png` });
    await page.evaluate(() => (window as any).wizardChess.closeGameSelectorModal());
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/${name}-board.png` });
    await page.locator('#btn-mobile-controls').click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/${name}-menu.png` });
  });
}

// The two preview images of the selector cards: the board alone, HUD hidden.
test('arena preview images', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await load(page);
  await page.evaluate(() => {
    const api = (window as any).wizardChess;
    api.closeGameSelectorModal();
    api.setQualityTier('ultra', false);
  });
  await page.addStyleTag({
    content:
      '#hud-top,#hud-bottom,#btn-feedback-fab,#trainer-logo-watermark,#mobile-quick-dock,#piece-overhead-layer,#captured-tray{display:none!important}'
  });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/demo-chess-arena.png` });
  await page.evaluate(() => (window as any).wizardChess.setGameVariant('xiangqi'));
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `${OUT}/demo-xiangqi-arena.png` });
});
