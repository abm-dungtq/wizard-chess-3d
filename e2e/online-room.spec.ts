import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { collectConsoleErrors, getState, openGame, waitForState, waitIdle } from './helpers';

const openContexts: BrowserContext[] = [];

async function openPlayer(
  browser: Browser,
  beforeLoad?: (page: Page) => Promise<void>
): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext();
  openContexts.push(context);
  const page = await context.newPage();
  const errors = collectConsoleErrors(page);
  if (beforeLoad) await beforeLoad(page);
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
  // Each player is a full 3D scene; leftovers from a previous test starve the next one's load.
  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((context) => context.close().catch(() => {})));
  });

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

    const server = await a.page.request.get(`/api/rooms/${code}/state`);
    expect((await server.json()).room.moves.length).toBe(2);
    expect((await getState(b.page)).moveHistoryCount).toBe(2);

    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });


  async function pairedRoom(browser: Browser) {
    const a = await openPlayer(browser);
    const b = await openPlayer(browser);
    const code = await createRoom(a.page);
    await b.page.evaluate((code) => (window as any).wizardChess.joinMultiplayerRoom(code), code);
    await waitForState(b.page, "s.gameMode === 'multi' && s.roomBothReady");
    await waitForState(a.page, 's.roomBothReady');
    return { a, b, code };
  }

  test('leaving the room mid-replay applies no further remote moves', async ({ browser }) => {
    const { a, b } = await pairedRoom(browser);
    await a.page.evaluate(() => (window as any).wizardChess.executeChessMove(6, 4, 4, 4));
    await b.page.evaluate(() => (window as any).wizardChess.setPassAndPlayMode(true));
    const before = (await getState(b.page)).moveHistoryCount;
    await b.page.waitForTimeout(3000);
    const after = await getState(b.page);
    expect(after.gameMode).not.toBe('multi');
    expect(after.moveHistoryCount).toBe(before);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });

  test('a desynced board heals from the server move list', async ({ browser }) => {
    const { a, b } = await pairedRoom(browser);
    await a.page.evaluate(() => (window as any).wizardChess.executeChessMove(6, 4, 4, 4));
    await waitForState(b.page, 's.moveHistoryCount === 1 && !s.isAnimatingMove');
    await b.page.evaluate(() => (window as any).wizardChess.executeChessMove(1, 4, 3, 4));
    await waitForState(a.page, 's.moveHistoryCount === 2 && !s.isAnimatingMove');
    await waitForState(b.page, '!s.isAnimatingMove');

    await b.page.evaluate(() => (window as any).wizardChess.resetChessBoard(true, false));
    await a.page.evaluate(() => (window as any).wizardChess.executeChessMove(7, 6, 5, 5));
    await waitForState(b.page, 's.moveHistoryCount === 3 && !s.isAnimatingMove', 15_000);

    const knight = await b.page.evaluate(() => (window as any).wizardChess.inspectSquare(5, 5));
    expect(knight.type).toBe('knight');
    expect(knight.color).toBe('w');
    const pawn = await b.page.evaluate(() => (window as any).wizardChess.inspectSquare(4, 4));
    expect(pawn.type).toBe('pawn');
    expect(a.errors).toEqual([]);
  });

  test('a move the server rejects is rolled back to the server state', async ({ browser }) => {
    const a = await openPlayer(browser);
    const b = await openPlayer(browser);
    // Starve A of room updates so its client still believes it is white's turn
    // after the server has already accepted a white move.
    let blockStatePoll = false;
    await a.page.route('**/api/rooms/*/events', (route) => route.abort());
    await a.page.route('**/api/rooms/*/state', (route) => (blockStatePoll ? route.abort() : route.fallback()));
    const code = await createRoom(a.page);
    await b.page.evaluate((code) => (window as any).wizardChess.joinMultiplayerRoom(code), code);
    await waitForState(a.page, 's.roomBothReady');
    blockStatePoll = true;

    const token = await a.page.evaluate(() => sessionStorage.getItem('wizard_chess_token'));
    const direct = await a.page.request.post(`/api/rooms/${code}/move`, {
      data: { playerToken: token, from: { r: 6, c: 4 }, to: { r: 4, c: 4 } }
    });
    expect(direct.status()).toBe(200);

    await a.page.evaluate(() => (window as any).wizardChess.executeChessMove(6, 3, 4, 3));
    await expect
      .poll(async () => (await a.page.locator('#duel-status-msg').textContent()) || '')
      .toContain('Not your turn');
    await waitForState(a.page, 's.moveHistoryCount === 1 && !s.isAnimatingMove', 15_000);
    expect((await a.page.evaluate(() => (window as any).wizardChess.inspectSquare(6, 3))).type).toBe('pawn');
    expect((await a.page.evaluate(() => (window as any).wizardChess.inspectSquare(4, 4))).type).toBe('pawn');
    expect((await getState(a.page)).currentTurn).toBe('b');
  });

  test('joining a xiangqi room with moves waits for the models before replaying', async ({ browser }) => {
    const a = await openPlayer(browser);
    await a.page.evaluate(() => (window as any).wizardChess.setGameVariant('xiangqi'));
    await waitForState(a.page, 's.boardCols === 9', 30_000);
    await waitIdle(a.page);
    const code = await createRoom(a.page);
    // Red soldier forward one point, before anyone joins.
    await a.page.evaluate(() => (window as any).wizardChess.executeChessMove(6, 4, 5, 4));
    await waitIdle(a.page);

    // B's startup preload fails, so its xiangqi models are still loading (slowly) when it joins.
    const resyncWarnings: string[] = [];
    let xiangqiAssets: 'abort' | 'slow' = 'abort';
    let slowAssetsServed = 0;
    const b = await openPlayer(browser, async (page) => {
      page.on('console', (msg) => {
        if (msg.type() === 'warning' && msg.text().includes('Room resynced')) resyncWarnings.push(msg.text());
      });
      await page.route('**/assets/glb/xiangqi/**', async (route) => {
        if (xiangqiAssets === 'abort') return route.abort();
        await new Promise((r) => setTimeout(r, 1500));
        await route.fallback();
        slowAssetsServed += 1;
      });
    });
    await b.page.waitForTimeout(5500); // let the failed-load retry backoff expire
    xiangqiAssets = 'slow';
    await b.page.evaluate((code) => (window as any).wizardChess.joinMultiplayerRoom(code), code);

    // Assert only after the slow load has finished and its board reset has run:
    // boardCols follows the variant flag, so it cannot tell a chess board from a xiangqi one.
    await expect.poll(() => slowAssetsServed, { timeout: 30_000 }).toBeGreaterThanOrEqual(7);
    await waitIdle(b.page);
    await waitForState(b.page, 's.moveHistoryCount === 1 && !s.isAnimatingMove', 15_000);
    const probe = (r: number, c: number) =>
      b.page.evaluate(([r, c]) => (window as any).wizardChess.inspectSquare(r, c), [r, c]);
    expect((await probe(9, 4))?.type).toBe('king');
    expect((await probe(0, 8))?.type).toBe('rook');
    expect((await probe(5, 4))?.color).toBe('w');
    expect(await probe(6, 4)).toBeNull();
    expect(resyncWarnings).toEqual([]);
    expect(b.errors.filter((e) => !e.includes('Failed to load resource'))).toEqual([]);
  });

  test('xiangqi moves picked from the client rules are accepted by the server', async ({ browser }) => {
    const a = await openPlayer(browser);
    await a.page.evaluate(() => (window as any).wizardChess.setGameVariant('xiangqi'));
    await waitForState(a.page, 's.boardCols === 9', 30_000);
    await waitIdle(a.page);
    const code = await createRoom(a.page);
    const b = await openPlayer(browser);
    await b.page.evaluate((code) => (window as any).wizardChess.joinMultiplayerRoom(code), code);
    await waitForState(b.page, "s.gameMode === 'multi' && s.roomBothReady && s.boardCols === 9", 30_000);
    await waitForState(a.page, 's.roomBothReady');

    // Two plies per side, each the first legal move the mover's own client offers.
    const players = [a, b, a, b];
    for (let ply = 0; ply < players.length; ply++) {
      const mover = players[ply].page;
      await waitIdle(mover);
      const move = await mover.evaluate(() => (window as any).wizardChess.getAllLegalMoves()[0]);
      await mover.evaluate(
        (m) => (window as any).wizardChess.executeChessMove(m.fromR, m.fromC, m.toR, m.toC),
        move
      );
      await waitForState(a.page, `s.moveHistoryCount === ${ply + 1} && !s.isAnimatingMove`, 15_000);
      await waitForState(b.page, `s.moveHistoryCount === ${ply + 1} && !s.isAnimatingMove`, 15_000);
    }
    const server = await a.page.request.get(`/api/rooms/${code}/state`);
    expect((await server.json()).room.moves.length).toBe(4);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });

  test('a third player is turned away from a full room', async ({ browser }) => {
    const a = await openPlayer(browser);
    const b = await openPlayer(browser);
    const code = await createRoom(a.page);
    await b.page.evaluate((code) => (window as any).wizardChess.joinMultiplayerRoom(code), code);
    await waitForState(b.page, "s.gameMode === 'multi' && s.roomBothReady");
    const before = (await (await b.page.request.get(`/api/rooms/${code}/state`)).json()).room;
    expect(before.whiteJoined && before.blackJoined).toBe(true);

    // Seats persist after disconnect, so closing A keeps the room full while
    // holding only two live 3D scenes. A leave-on-unload feature would break this.
    await a.page.context().close();
    const c = await openPlayer(browser);

    const joined = await c.page.evaluate((code) => (window as any).wizardChess.joinMultiplayerRoom(code), code);
    expect(joined).toBe(false);
    expect(await c.page.locator('#duel-status-msg').textContent()).toContain('Room is full');
    expect((await getState(c.page)).roomCode).not.toBe(code);

    const direct = await c.page.request.post('/api/rooms/join', { data: { code, playerToken: 'e2e-third-seat' } });
    expect(direct.status()).toBe(409);

    const bState = await getState(b.page);
    expect(bState.roomBothReady).toBe(true);
    expect(bState.roomCode).toBe(code);
    const after = (await (await b.page.request.get(`/api/rooms/${code}/state`)).json()).room;
    expect(after.moves.length).toBe(0);
    expect(after.whiteJoined && after.blackJoined).toBe(true);

    expect(c.errors.filter((e) => !/409/.test(e))).toEqual([]);
    expect(b.errors).toEqual([]);
  });
});
