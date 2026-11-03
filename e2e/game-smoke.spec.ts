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

  test('audio unlocks on first gesture before the first move', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openGame(page);
    expect((await getState(page)).audioState.contextState).toBe('none');
    // A HUD element, not the canvas: the document-level listener must catch it.
    await page.click('.brand-pill');
    await waitForState(page, "s.audioState.contextState === 'running'", 5_000);
    const playsBefore = (await getState(page)).audioState.playCount;
    await page.evaluate(() => (window as any).wizardChess.executeChessMove(6, 4, 4, 4));
    await waitIdle(page);
    const after = (await getState(page)).audioState;
    expect(after.contextState).toBe('running');
    expect(after.playCount).toBeGreaterThan(playsBefore);
    expect(errors).toEqual([]);
  });

  test('post-processing follows the quality tier', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openGame(page);
    const s = await getState(page);
    expect(s.qualityTier).toBe('high');
    expect(s.postFx).toEqual({ active: true, gtao: false, bloom: true, dof: false });

    await page.evaluate(() => (window as any).wizardChess.setQualityTier('ultra'));
    await waitIdle(page);
    expect((await getState(page)).postFx.gtao).toBe(true);
    // A black or blank canvas compresses far below this.
    expect((await page.locator('canvas').first().screenshot()).length).toBeGreaterThan(20_000);

    await page.evaluate(() => (window as any).wizardChess.setQualityTier('base'));
    expect((await getState(page)).postFx.active).toBe(false);
    expect((await page.locator('canvas').first().screenshot()).length).toBeGreaterThan(20_000);

    await page.evaluate(() => (window as any).wizardChess.executeChessMove(6, 4, 4, 4));
    await waitIdle(page);
    await page.evaluate(() => (window as any).wizardChess.setQualityTier('auto'));
    expect(errors).toEqual([]);
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
  test('spectator camera keeps the whole board in view', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectConsoleErrors(page);
    await page.setViewportSize({ width: 1470, height: 956 });
    await openGame(page);
    await expect(page.locator('#btn-cam-spectator')).toHaveClass(/active/);
    expect((await getState(page)).boardCornersInView).toBe(true);
    // The quick-cam button lives in the mobile dock and is hidden on desktop.
    await page.evaluate(() => (document.getElementById('btn-quick-cam') as HTMLButtonElement).click());
    await expect(page.locator('#btn-cam-top')).toHaveClass(/active/);
    await page.evaluate(() => (document.getElementById('btn-quick-cam') as HTMLButtonElement).click());
    await expect(page.locator('#btn-cam-spectator')).toHaveClass(/active/);

    for (const size of [{ width: 1470, height: 956 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      for (const variant of ['chess', 'xiangqi']) {
        await page.evaluate((v) => (window as any).wizardChess.setGameVariant(v), variant);
        await waitForState(page, `s.boardCols === ${variant === 'xiangqi' ? 9 : 8}`, 30_000);
        await waitIdle(page);
        await page.evaluate(() => {
          const w = (window as any).wizardChess;
          if (!document.getElementById('btn-cam-spectator')?.classList.contains('active')) w.setCameraPreset('spectator');
        });
        await page.waitForTimeout(900);
        const s = await getState(page);
        expect(s.boardCornersInView, `${variant} ${size.width}x${size.height} ${JSON.stringify(s.boardCornerNdc)}`).toBe(true);
      }
    }
    expect(errors).toEqual([]);
  });
  test('kill-cam runs on checkmate, skips, and never blocks moves', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectConsoleErrors(page);
    await openGame(page);
    await waitIdle(page);
    await page.evaluate(() => {
      const w = (window as any).wizardChess;
      w.setMotionLevel('full');
      w.setQualityTier('ultra');
      w.triggerCheckmateSequence('b', 'w');
    });
    await waitForState(page, 's.cinematicActive === true', 500);
    let s = await getState(page);
    expect(s.killCamDof).toBe(true);
    expect(s.isAnimatingMove).toBe(false);

    await page.mouse.click(5, 5);
    await waitForState(page, 's.cinematicActive === false && s.killCamDof === false', 1_200);

    // A second checkmate while the kill-cam runs must still return the camera to the original seat.
    const seat = (await getState(page)).cameraPos as number[];
    await page.evaluate(() => (window as any).wizardChess.triggerCheckmateSequence('b', 'w'));
    await waitForState(page, 's.cinematicActive === true', 500);
    await page.evaluate(() => (window as any).wizardChess.triggerCheckmateSequence('b', 'w'));
    await waitForState(page, 's.cinematicActive === true', 500);
    await waitForState(page, 's.cinematicActive === false', 4_500);
    await page.waitForTimeout(1_200);
    const back = (await getState(page)).cameraPos as number[];
    expect(Math.hypot(back[0] - seat[0], back[1] - seat[1], back[2] - seat[2])).toBeLessThan(0.05);

    await page.evaluate(() => {
      const w = (window as any).wizardChess;
      w.setMotionLevel('off');
      w.triggerCheckmateSequence('b', 'w');
    });
    for (let i = 0; i < 10; i++) {
      s = await getState(page);
      expect(s.cinematicActive).toBe(false);
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => (window as any).wizardChess.setQualityTier('auto'));
    expect(errors).toEqual([]);
  });

  test('labels show only for selection and hover by default', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.setViewportSize({ width: 1470, height: 956 });
    await openGame(page);
    await page.mouse.move(5, 5);
    await waitIdle(page);
    const badges = async () => (await getState(page)).visibleOverheadBadgeCount;
    expect((await getState(page)).pieceLabelMode).toBe('tap');
    expect(await badges()).toBe(0);

    await page.evaluate(() => (window as any).wizardChess.inspectSquare(7, 1));
    expect(await badges()).toBe(1);
    await page.evaluate(() => (window as any).wizardChess.inspectSquare(-1, -1));
    expect(await badges()).toBe(0);

    const king = await page.evaluate(() => (window as any).wizardChess.getPieceScreenPoint(7, 4));
    await page.mouse.move(king.x, king.y);
    await expect.poll(async () => (await getState(page)).hoveredSquare).toEqual({ r: 7, c: 4 });
    expect(await badges()).toBe(1);

    await page.mouse.move(5, 5);
    await expect.poll(badges).toBe(0);

    await page.locator('#btn-piece-labels').evaluate((el: HTMLElement) => el.click());
    await page.locator('#btn-piece-labels').evaluate((el: HTMLElement) => el.click());
    expect((await getState(page)).pieceLabelMode).toBe('all');
    await expect.poll(badges).toBeGreaterThanOrEqual(30);
    expect(errors).toEqual([]);
  });
});
