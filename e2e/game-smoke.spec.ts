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

  test('faulty tween does not freeze the game', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openGame(page);
    await page.evaluate(() => {
      const w = (window as any).wizardChess;
      w.executeChessMove(6, 4, 4, 4);
      w.injectFaultyTweenForTest();
    });
    await waitIdle(page);
    const s = await getState(page);
    if (s.currentTurn === 'w') {
      await page.evaluate(() => (window as any).wizardChess.executeChessMove(6, 3, 4, 3));
      await waitIdle(page);
    }
    const after = await getState(page);
    expect(after.aiSearchInFlight).toBe(false);
    expect(after.isAnimatingMove).toBe(false);
    expect(after.moveHistoryCount).toBeGreaterThanOrEqual(1);
    const frames = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let count = 0;
          const end = performance.now() + 1000;
          const tick = (now: number) => {
            count += 1;
            if (now < end) requestAnimationFrame(tick);
            else resolve(count);
          };
          requestAnimationFrame(tick);
        })
    );
    expect(frames).toBeGreaterThan(20);
    expect(errors.filter((e) => !e.includes('Move tween failed; dropped'))).toEqual([]);
  });

  test('a burst of resize events settles to the window size', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openGame(page);
    await page.setViewportSize({ width: 900, height: 700 });
    const sizes = await page.evaluate(async () => {
      for (let i = 0; i < 50; i++) window.dispatchEvent(new Event('resize'));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { canvas: document.querySelector('canvas')!.clientWidth, window: window.innerWidth };
    });
    expect(sizes.canvas).toBe(sizes.window);
    expect(errors).toEqual([]);
  });

  test('a failed xiangqi model load does not refetch in a storm', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    // Xiangqi models preload at startup, so the failure must be in place before the page loads.
    let requests = 0;
    await page.route('**/assets/glb/xiangqi/**', (route) => {
      requests += 1;
      return route.abort();
    });
    await openGame(page);
    expect(requests).toBeGreaterThan(0);
    const beforeSwitch = requests;
    await page.evaluate(() => (window as any).wizardChess.setGameVariant('xiangqi'));
    await page.waitForTimeout(3000);
    expect(requests - beforeSwitch).toBeLessThanOrEqual(28);
    // Aborted fetches surface as resource-load errors; anything else is a real failure.
    expect(errors.filter((e) => !e.includes('Failed to load resource'))).toEqual([]);
  });

  test('real canvas click selects a piece', async () => {
    test.skip(true, 'Engine exposes no world-to-screen helper; pointer picking is covered by unit raycast tests');
  });

  test('motion level follows reduced-motion and persists', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('settings-cleared')) {
        localStorage.removeItem('wizard_chess_settings_v1');
        sessionStorage.setItem('settings-cleared', '1');
      }
    });
    await openGame(page);
    expect((await getState(page)).motionLevel).toBe('off');

    await page.evaluate(() => (document.getElementById('btn-motion-level') as HTMLButtonElement).click());
    expect((await getState(page)).motionLevel).toBe('full');
    await page.reload();
    await openGame(page);
    expect((await getState(page)).motionLevel).toBe('full');
    expect((await getState(page)).qualityTier).toBe('high');

    for (let i = 0; i < 4 && (await getState(page)).qualityPreference !== 'base'; i++) {
      await page.evaluate(() => (document.getElementById('btn-quality-tier') as HTMLButtonElement).click());
    }
    expect((await getState(page)).qualityTier).toBe('base');
    await expect(page.locator('#quality-tier-label')).toHaveText(/Base/);
    await page.reload();
    await openGame(page);
    expect((await getState(page)).qualityTier).toBe('base');
    await page.evaluate(() => localStorage.removeItem('wizard_chess_settings_v1'));
    expect(errors).toEqual([]);
  });
});
