import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { collectConsoleErrors, openGame, waitIdle } from './helpers';

// Stills and frame strips of the xiangqi set, not part of the default run:
// `XQ=1 XQ_OUT=<dir> npx playwright test e2e/xiangqi-shots.spec.ts`.
test.skip(process.env.XQ !== '1', 'set XQ=1 to capture xiangqi screenshots');
// Twice the pixel density, so the pieces stay readable in crops.
test.use({ deviceScaleFactor: 2 });

const OUT = process.env.XQ_OUT || 'test-results/xiangqi-shots';

async function strip(page: Page, name: string, move: number[], frames: number, gapMs: number) {
  await page.evaluate(([a, b, c, d]) => (window as any).wizardChess.executeChessMove(a, b, c, d), move);
  for (let i = 0; i < frames; i++) {
    await page.screenshot({ path: `${OUT}/${name}-${String(i).padStart(2, '0')}.jpg`, quality: 80 });
    await page.waitForTimeout(gapMs);
  }
  await waitIdle(page);
}

test('xiangqi stills and capture strips', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  await openGame(page, '/?autotest=1');
  await page.evaluate(() => {
    const api = (window as any).wizardChess;
    api.setQualityTier('high', false);
    api.setCombatCameraZoomEnabled(false);
    api.setGameVariant('xiangqi');
    api.setPassAndPlayMode(true, false);
  });
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `${OUT}/start-red-side.png` });
  // Calling the active preset again flips the camera to the other side of the board.
  await page.evaluate(() => (window as any).wizardChess.setCameraPreset('spectator'));
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/start-black-side.png` });
  await page.evaluate(() => (window as any).wizardChess.setCameraPreset('spectator'));
  await page.waitForTimeout(5000);

  // The red cannon jumps the black cannon and takes the horse; the black chariot takes it back; a red horse steps out.
  await strip(page, 'cannon-takes-horse', [7, 1, 0, 1], 22, 130);
  await strip(page, 'chariot-takes-cannon', [0, 0, 0, 1], 22, 130);
  await strip(page, 'horse-move', [9, 7, 7, 6], 12, 130);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/after-moves.png` });
  expect(errors).toEqual([]);
});
