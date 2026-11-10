import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openGame, waitIdle } from './helpers';

// Comparison screenshots of the knight and pawn, not part of the default run:
// `SHOTS=1 SHOT_LABEL=before npx playwright test e2e/piece-pilot-shots.spec.ts`.
test.skip(process.env.SHOTS !== '1', 'set SHOTS=1 to capture pilot screenshots');
// Twice the pixel density, so the small close-up crops stay readable.
test.use({ deviceScaleFactor: 2 });

const LABEL = process.env.SHOT_LABEL || 'before';
const OUT = 'plans/261110-0904-knight-pawn-redesign-pilot/visuals';
const THEMES = ['hogwarts', 'jade', 'royal'];
// On the start squares the back rank hides the pawns, so the stills are taken after 1.e4 e5 2.Nf3 Nc6.
const OPENING: [number, number, number, number][] = [
  [6, 4, 4, 4],
  [1, 4, 3, 4],
  [7, 6, 5, 5],
  [0, 1, 2, 2]
];
const PIECES: Record<string, [number, number]> = {
  whiteKnight: [5, 5],
  whitePawn: [4, 4],
  blackKnight: [2, 2],
  blackPawn: [3, 4],
  whiteRook: [7, 0],
  whiteBishop: [7, 2],
  whiteQueen: [7, 3],
  whiteKing: [7, 4],
  blackRook: [0, 0],
  blackBishop: [0, 2],
  blackQueen: [0, 3],
  blackKing: [0, 4]
};
const CLOSEUP_PX = 150;
const FRAME_COUNT = 14;
const FRAME_GAP_MS = 150;

async function prepare(page: Page, theme: string): Promise<void> {
  await openGame(page, '/?autotest=1');
  await page.evaluate((themeId) => {
    const w = (window as any).wizardChess;
    w.setQualityTier('high', false);
    w.setMotionLevel('off', false);
    w.setCombatCameraZoomEnabled(false);
    w.setPieceTheme(themeId, 'both');
    // Calling the preset while it is already active flips the camera to the other side of the board.
    if (!document.getElementById('btn-cam-spectator')?.classList.contains('active')) w.setCameraPreset('spectator');
  }, theme);
  await waitCameraSettled(page);
}

/** Waits until the theme transition glow has faded and a piece has kept the same screen position for 1 s. */
async function waitCameraSettled(page: Page): Promise<void> {
  await page.waitForTimeout(4000);
  let last = '';
  let stableSince = Date.now();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const point = await page.evaluate(() => (window as any).wizardChess.getPieceScreenPoint(7, 1));
    const key = `${Math.round(point.x)},${Math.round(point.y)}`;
    if (key !== last) {
      last = key;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 1000) {
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error('camera did not settle');
}

async function captureFrames(page: Page, name: string): Promise<void> {
  for (let i = 0; i < FRAME_COUNT; i++) {
    await page.screenshot({ path: `${OUT}/${LABEL}-${name}-${String(i).padStart(2, '0')}.png` });
    await page.waitForTimeout(FRAME_GAP_MS);
  }
}

test('still shots', async ({ page }) => {
  test.setTimeout(240_000);
  for (const theme of THEMES) {
    await prepare(page, theme);
    await page.evaluate(() => (window as any).wizardChess.setPassAndPlayMode(true, false));
    for (const move of OPENING) {
      await page.evaluate((m) => (window as any).wizardChess.executeChessMove(...m), move);
      await waitIdle(page);
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${LABEL}-${theme}-board.png` });
    for (const [name, [r, c]] of Object.entries(PIECES)) {
      const point = await page.evaluate(([row, col]) => (window as any).wizardChess.getPieceScreenPoint(row, col), [r, c]);
      await page.screenshot({
        path: `${OUT}/${LABEL}-${theme}-${name}.png`,
        clip: { x: Math.max(0, point.x - CLOSEUP_PX / 2), y: Math.max(0, point.y - CLOSEUP_PX * 0.62), width: CLOSEUP_PX, height: CLOSEUP_PX }
      });
    }
  }
});

test('clip frames', async ({ page }) => {
  test.setTimeout(240_000);
  await prepare(page, 'hogwarts');
  await page.evaluate(() => (window as any).wizardChess.triggerDemoCapture());
  await captureFrames(page, 'pawn-capture');

  await page.evaluate(() => (window as any).wizardChess.resetChessBoard(true));
  await waitIdle(page);
  await page.evaluate(() => (window as any).wizardChess.setPassAndPlayMode(true, false));
  await page.evaluate(() => (window as any).wizardChess.executeChessMove(7, 6, 5, 5));
  await waitIdle(page);
  await page.evaluate(() => (window as any).wizardChess.executeChessMove(1, 4, 3, 4));
  await waitIdle(page);
  await page.evaluate(() => (window as any).wizardChess.executeChessMove(5, 5, 3, 4));
  await captureFrames(page, 'knight-capture');
});

test('bishop clip frames', async ({ page }) => {
  test.setTimeout(240_000);
  await prepare(page, 'hogwarts');
  await page.evaluate(() => (window as any).wizardChess.setPassAndPlayMode(true, false));
  // 1.e4 a6 2.Bxa6
  for (const move of [[6, 4, 4, 4], [1, 0, 2, 0]]) {
    await page.evaluate((m) => (window as any).wizardChess.executeChessMove(...m), move);
    await waitIdle(page);
  }
  await page.evaluate(() => (window as any).wizardChess.executeChessMove(7, 5, 2, 0));
  await captureFrames(page, 'bishop-capture');
});
