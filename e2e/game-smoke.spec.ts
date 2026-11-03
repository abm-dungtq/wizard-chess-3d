import { test, expect } from '@playwright/test';
import { collectConsoleErrors, getState, openGame, waitForState, waitIdle } from './helpers';

test.describe('single-player smoke', () => {
  test('move and AI reply', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openGame(page);
    await page.evaluate(() => (window as any).wizardChess.executeChessMove(6, 4, 4, 4));
    await waitIdle(page);
    expect((await getState(page)).moveHistoryCount).toBeGreaterThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  test('undo reduces the move history', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openGame(page);
    await page.evaluate(() => (window as any).wizardChess.executeChessMove(6, 4, 4, 4));
    await waitIdle(page);
    const before = (await getState(page)).moveHistoryCount;
    await page.evaluate(() => (window as any).wizardChess.undoLastMove());
    await waitIdle(page);
    expect((await getState(page)).moveHistoryCount).toBeLessThan(before);
    expect(errors).toEqual([]);
  });

  test('rapid undo, AI and reset input stays consistent', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openGame(page);
    await page.evaluate(() => {
      const w = (window as any).wizardChess;
      w.executeChessMove(6, 3, 4, 3);
      w.undoLastMove();
      w.undoLastMove();
      w.undoLastMove();
      w.triggerAIMoveNow();
      w.resetChessBoard(true, false);
      w.undoLastMove();
    });
    await waitIdle(page);
    const s = await getState(page);
    expect(s.gameVariant).toBe('chess');
    expect(s.isAnimatingMove).toBe(false);
    expect(errors).toEqual([]);
  });

  test('chess and xiangqi switching does not grow GPU geometry', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openGame(page);
    let afterFirst = 0;
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => (window as any).wizardChess.setGameVariant('xiangqi'));
      await waitForState(page, 's.boardCols === 9', 30_000);
      await page.waitForTimeout(1500);
      await page.evaluate(() => (window as any).wizardChess.setGameVariant('chess'));
      await waitForState(page, 's.boardCols === 8', 30_000);
      await page.waitForTimeout(1500);
      if (i === 0) afterFirst = (await getState(page)).rendererMemory.geometries;
    }
    expect((await getState(page)).rendererMemory.geometries).toBeLessThanOrEqual(afterFirst + 10);
    expect(errors).toEqual([]);
  });

  test('skin cycling reaches a stable geometry count', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openGame(page);
    const counts: number[] = [];
    for (let round = 0; round < 2; round++) {
      const ids: string[] = await page.evaluate(() => (window as any).wizardChess.PIECE_THEME_ORDER);
      for (const id of ids) {
        await page.evaluate((skin) => (window as any).wizardChess.setPieceTheme(skin), id);
        await page.waitForTimeout(800);
      }
      counts.push((await getState(page)).rendererMemory.geometries);
    }
    expect(counts[1]).toBe(counts[0]);
    expect(errors).toEqual([]);
  });

  test('real canvas click selects a piece', async () => {
    test.skip(true, 'Engine exposes no world-to-screen helper; pointer picking is covered by unit raycast tests');
  });
});
