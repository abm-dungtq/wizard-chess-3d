import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { collectConsoleErrors, openGame, waitIdle } from './helpers';

// Frame strips of a move, a capture and a check, not part of the default run:
// `FX=1 FX_OUT=<dir> npx playwright test e2e/piece-effects-shots.spec.ts`.
test.skip(process.env.FX !== '1', 'set FX=1 to capture effect frame strips');

const OUT = process.env.FX_OUT || 'test-results/piece-effects';
const MOTION = process.env.FX_MOTION || 'full';

type Piece = { type: string; color: 'w' | 'b'; r: number; c: number };
const KINGS: Piece[] = [
  { type: 'king', color: 'w', r: 7, c: 4 },
  { type: 'king', color: 'b', r: 0, c: 6 }
];

async function strip(page: Page, name: string, pieces: Piece[], move: number[], frames: number, gapMs: number) {
  await page.evaluate(
    ([p, motion]) => {
      const api = (window as any).wizardChess;
      api.setPassAndPlayMode(true);
      api.setMotionLevel(motion);
      api.setupCustomScenario(p, 'w');
    },
    [pieces, MOTION] as const
  );
  await page.waitForTimeout(400);
  await page.evaluate(([a, b, c, d]) => (window as any).wizardChess.executeChessMove(a, b, c, d), move);
  for (let i = 0; i < frames; i++) {
    await page.screenshot({ path: `${OUT}/${name}-${MOTION}-${String(i).padStart(2, '0')}.jpg`, quality: 80 });
    await page.waitForTimeout(gapMs);
  }
  await waitIdle(page);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/${name}-${MOTION}-after.jpg`, quality: 80 });
}

test('move, capture and check frame strips', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectConsoleErrors(page);
  await openGame(page);
  await strip(page, 'move', [...KINGS, { type: 'rook', color: 'w', r: 7, c: 0 }], [7, 0, 2, 0], 12, 120);
  await strip(
    page,
    'capture-check',
    [...KINGS, { type: 'queen', color: 'w', r: 6, c: 3 }, { type: 'knight', color: 'b', r: 3, c: 3 }, { type: 'pawn', color: 'b', r: 1, c: 7 }],
    [6, 3, 3, 3],
    26,
    130
  );
  expect(errors).toEqual([]);
});
