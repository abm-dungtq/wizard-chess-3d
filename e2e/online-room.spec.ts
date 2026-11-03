import { test, expect, type Browser, type Page } from '@playwright/test';
import { collectConsoleErrors, getState, openGame, waitForState } from './helpers';

async function openPlayer(browser: Browser): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectConsoleErrors(page);
  await openGame(page);
  return { page, errors };
}

async function createRoom(page: Page): Promise<string> {
  await page.evaluate(() => (window as any).wizardChess.createMultiplayerRoom('w'));
  await waitForState(page, "s.gameMode === 'multi' && Boolean(s.roomCode)");
  const code = (await getState(page)).roomCode as string;
  console.log('ROOM_CODE', code);
  return code;
}

test.describe('online room', () => {
  test('two players exchange moves', async ({ browser }) => {
    const a = await openPlayer(browser);
    const b = await openPlayer(browser);
    const code = await createRoom(a.page);
    await b.page.evaluate((c) => (window as any).wizardChess.joinMultiplayerRoom(c), code);
    await waitForState(b.page, "s.gameMode === 'multi' && s.roomBothReady");
    await waitForState(a.page, 's.roomBothReady');

    await a.page.evaluate(() => (window as any).wizardChess.executeChessMove(6, 4, 4, 4));
    await waitForState(b.page, 's.moveHistoryCount === 1 && !s.isAnimatingMove');
    await waitForState(a.page, '!s.isAnimatingMove');

    await b.page.evaluate(() => (window as any).wizardChess.executeChessMove(1, 4, 3, 4));
    await waitForState(a.page, 's.moveHistoryCount === 2');

    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });
});
