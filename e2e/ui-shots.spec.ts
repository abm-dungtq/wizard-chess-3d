import { expect, test } from '@playwright/test';

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

// Free camera on desktop: a click still moves a piece, a drag orbits without moving one, and one tap goes home.
test('camera toggle, home and guide, desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?camguide=1');
  await page.waitForFunction(
    () => Boolean(document.getElementById('loading-overlay')?.classList.contains('hidden')),
    null,
    { timeout: 60_000 }
  );
  const api = <T>(fn: string) => page.evaluate((src) => new Function('w', `return ${src}`)((window as any).wizardChess), fn) as Promise<T>;
  await api('w.closeGameSelectorModal()');
  await page.waitForTimeout(1500);
  expect(await api('w.isCameraLocked()')).toBe(false);
  await expect(page.locator('#btn-top-cam')).toHaveText('🔒 Khóa góc');
  await expect(page.locator('#btn-cam-home')).toBeVisible();
  await expect(page.locator('#cam-guide')).toBeHidden();

  const home = await api<{ x: number; y: number }>('w.getSquareScreenPoint(6, 4)');
  const target = await api<{ x: number; y: number }>('w.getSquareScreenPoint(4, 4)');
  await page.mouse.click(home.x, home.y);
  await page.waitForTimeout(400);
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction(() => (window as any).wizardChess.getState().moveHistoryCount >= 1, null, { timeout: 15_000 });
  await expect(page.locator('#cam-guide')).toBeVisible({ timeout: 6000 });
  await page.screenshot({ path: `${OUT}/desktop-cam-guide.png` });
  await page.locator('#btn-cam-guide-try').click();
  await expect(page.locator('#cam-guide')).toBeHidden();

  // Wait for the AI reply, then drag across a white piece: the view turns and no move is made.
  await page.waitForFunction(() => {
    const s = (window as any).wizardChess.getState();
    return s.moveHistoryCount >= 2 && !s.isAnimatingMove && !s.aiSearchInFlight;
  }, null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const before = await api<{ x: number; y: number }>('w.getSquareScreenPoint(7, 0)');
  const grab = await api<{ x: number; y: number }>('w.getSquareScreenPoint(6, 3)');
  const count = await api<number>('w.getState().moveHistoryCount');
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 220, grab.y - 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const after = await api<{ x: number; y: number }>('w.getSquareScreenPoint(7, 0)');
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(30);
  expect(await api('w.getState().moveHistoryCount')).toBe(count);
  await page.screenshot({ path: `${OUT}/desktop-cam-rotated.png` });

  await page.locator('#btn-cam-home').click();
  await page.waitForTimeout(1500);
  const back = await api<{ x: number; y: number }>('w.getSquareScreenPoint(7, 0)');
  expect(Math.hypot(back.x - before.x, back.y - before.y)).toBeLessThan(4);

  await page.locator('#btn-top-cam').click();
  expect(await api('w.isCameraLocked()')).toBe(true);
  await expect(page.locator('#btn-top-cam')).toHaveText('🎥 Xoay 3D');
  await expect(page.locator('#btn-cam-home')).toBeHidden();
  await page.screenshot({ path: `${OUT}/desktop-cam-locked.png` });

  // The guide is remembered: a second visit plays a move and stays quiet.
  await page.reload();
  await page.waitForFunction(
    () => Boolean(document.getElementById('loading-overlay')?.classList.contains('hidden')),
    null,
    { timeout: 60_000 }
  );
  await api('w.closeGameSelectorModal()');
  await api('w.executeChessMove(6, 4, 4, 4)');
  await page.waitForTimeout(4000);
  await expect(page.locator('#cam-guide')).toBeHidden();
});

test('camera starts locked with the guide, phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?camguide=1');
  await page.waitForFunction(
    () => Boolean(document.getElementById('loading-overlay')?.classList.contains('hidden')),
    null,
    { timeout: 60_000 }
  );
  await page.evaluate(() => (window as any).wizardChess.closeGameSelectorModal());
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as any).wizardChess.isCameraLocked())).toBe(true);
  await expect(page.locator('#btn-quick-lock')).toHaveText('🎥 Xoay 3D');
  await page.evaluate(() => (window as any).wizardChess.executeChessMove(6, 4, 4, 4));
  await expect(page.locator('#cam-guide')).toBeVisible({ timeout: 8000 });
  await page.screenshot({ path: `${OUT}/phone-cam-guide.png` });
  await page.locator('#btn-cam-guide-try').click();
  expect(await page.evaluate(() => (window as any).wizardChess.isCameraLocked())).toBe(false);
  await expect(page.locator('#btn-quick-lock')).toHaveText('🔒 Khóa góc');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/phone-cam-free.png` });
});

// The dock must stay on one row with the camera buttons and the longest status text.
// At 1024 the dock already takes two rows without them.
for (const width of [1280, 1440]) {
  test(`top dock stays on one row at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await load(page);
    await page.evaluate(() => {
      (window as any).wizardChess.closeGameSelectorModal();
      document.getElementById('turn-text')!.textContent = 'Black to Move (AI thinking...)';
    });
    await page.waitForTimeout(500);
    const tops = await page.evaluate(() =>
      ['btn-game-variant', 'btn-top-cam', 'btn-cam-home', 'btn-mobile-controls'].map(
        (id) => Math.round(document.getElementById(id)!.getBoundingClientRect().top)
      )
    );
    await page.screenshot({ path: `${OUT}/dock-${width}.png`, clip: { x: 0, y: 0, width, height: 110 } });
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(8);
  });
}
