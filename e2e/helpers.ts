import type { Page } from '@playwright/test';

export async function openGame(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => Boolean((window as any).wizardChess?.getState), null, { timeout: 60_000 });
  await page.waitForFunction(
    () => Boolean(document.getElementById('loading-overlay')?.classList.contains('hidden')),
    null,
    { timeout: 60_000 }
  );
  await page.evaluate(() => (window as any).wizardChess.closeGameSelectorModal?.());
}

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

export async function getState(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).wizardChess.getState());
}

/** Waits until no AI search is running and the move count has been stable for 1.5 s. */
export async function waitIdle(page: Page, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const s = await getState(page);
    const busy = s.aiSearchInFlight || s.isAnimatingMove;
    if (busy || s.moveHistoryCount !== lastCount) {
      lastCount = s.moveHistoryCount;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 1500) {
      return;
    }
    await page.waitForTimeout(150);
  }
  throw new Error('waitIdle timed out');
}

export async function waitForState(
  page: Page,
  predicate: string,
  timeoutMs = 15_000
): Promise<void> {
  await page.waitForFunction(
    (src) => new Function('s', `return (${src});`)((window as any).wizardChess.getState()),
    predicate,
    { timeout: timeoutMs, polling: 100 }
  );
}
