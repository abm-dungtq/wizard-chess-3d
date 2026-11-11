import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { openGame } from './helpers';

// Measures how well pieces and squares separate on screen, not part of the default run:
// `READABILITY=1 READ_LABEL=before npx playwright test e2e/board-readability.spec.ts`.
test.skip(process.env.READABILITY !== '1', 'set READABILITY=1 to measure board readability');

const LABEL = process.env.READ_LABEL || 'before';
const OUT = process.env.READ_OUT || 'plans/reports';
const THEMES = (process.env.READ_THEMES || 'hogwarts').split(',');

type Sample = { kind: string; r: number; c: number; x: number; y: number; sqW: number; baseY?: number };

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(4000);
  let last = '';
  let stableSince = Date.now();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const p = await page.evaluate(() => (window as any).wizardChess.getPieceScreenPoint(7, 1));
    const key = `${Math.round(p.x)},${Math.round(p.y)}`;
    if (key !== last) {
      last = key;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 1000) return;
    await page.waitForTimeout(100);
  }
  throw new Error('camera did not settle');
}

test('contrast on the start position', async ({ page }) => {
  test.setTimeout(300_000);
  const lines: string[] = [];
  for (const theme of THEMES) {
    await openGame(page, '/?autotest=1');
    await page.evaluate((id) => {
      const w = (window as any).wizardChess;
      w.setQualityTier('high', false);
      w.setMotionLevel('off', false);
      w.setPieceTheme(id, 'both');
    }, theme);
    await settle(page);
    const samples: Sample[] = await page.evaluate(() => {
      const w = (window as any).wizardChess;
      const out: any[] = [];
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const light = (r + c) % 2 === 0;
          const sq = w.getSquareScreenPoint(r, c);
          const next = w.getSquareScreenPoint(r, c < 7 ? c + 1 : c - 1);
          const sqW = Math.abs(next.x - sq.x);
          if (r >= 2 && r <= 5) out.push({ kind: light ? 'lightSq' : 'darkSq', r, c, ...sq, sqW });
          else out.push({ kind: (r >= 6 ? 'white' : 'black') + (light ? 'OnLight' : 'OnDark'), r, c, ...w.getPieceScreenPoint(r, c), sqW });
        }
      }
      return out;
    });
    const shot = await page.screenshot({ path: `${OUT}/readability-${LABEL}-${theme}.png` });
    // Second frame with only the piece bodies drawn white on black: which pixels belong to a piece.
    await page.evaluate(() => (window as any).wizardChess.setPieceMaskView(true));
    await page.waitForTimeout(500);
    const mask = await page.screenshot();
    await page.evaluate(() => (window as any).wizardChess.setPieceMaskView(false));
    const viewport = page.viewportSize()!;
    const result = await page.evaluate(
      async ({ b64, maskB64, samples, vw }) => {
        const load = async (data: string) => {
          const img = new Image();
          img.src = 'data:image/png;base64,' + data;
          await img.decode();
          const cv = document.createElement('canvas');
          cv.width = img.width;
          cv.height = img.height;
          const ctx = cv.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(img, 0, 0);
          return { ctx, width: img.width };
        };
        const { ctx, width } = await load(b64);
        const { ctx: maskCtx } = await load(maskB64);
        const k = width / vw;
        const lin = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4));
        const lumOf = (d: Uint8ClampedArray, i: number) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
        const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
        const squareAt = (x: number, y: number) => {
          // median luminance of a 7x7 patch on an empty square
          const d = ctx.getImageData(Math.round(x * k) - 3, Math.round(y * k) - 3, 7, 7).data;
          const ls: number[] = [];
          let hot = 0;
          for (let i = 0; i < d.length; i += 4) {
            ls.push(lumOf(d, i));
            if (Math.max(d[i], d[i + 1], d[i + 2]) >= 250) hot++;
          }
          return { lum: median(ls), hot: hot / 49 };
        };
        const pieceAt = (s: any) => {
          // every pixel of the piece's own column, from just above the base to just under the top
          const h = (s.baseY - s.y) * 2;
          const x0 = Math.round((s.x - s.sqW * 0.22) * k);
          const y0 = Math.round((s.baseY - h * 0.95) * k);
          const w = Math.max(1, Math.round(s.sqW * 0.44 * k));
          const hh = Math.max(1, Math.round(h * 0.8 * k));
          const d = ctx.getImageData(x0, y0, w, hh).data;
          const m = maskCtx.getImageData(x0, y0, w, hh).data;
          const all: number[] = [];
          const body: number[] = [];
          for (let i = 0; i < d.length; i += 4) {
            if (m[i] < 128) continue;
            const l = lumOf(d, i);
            all.push(l);
            // gold trim: clearly more red than blue; the bodies are near-neutral
            const max = Math.max(d[i], d[i + 1], d[i + 2]);
            const trim = max > 70 && d[i] > d[i + 2] * 1.6;
            if (!trim) body.push(l);
          }
          const src = body.length >= 20 ? body : all;
          if (src.length === 0) return { lum: NaN, all: NaN, trimShare: 0, px: 0, hot: 0 };
          const sorted = [...src].sort((a, b) => a - b);
          return {
            lum: median(src),
            all: median(all),
            p10: sorted[Math.floor(sorted.length * 0.1)],
            p90: sorted[Math.floor(sorted.length * 0.9)],
            trimShare: 1 - body.length / all.length,
            px: all.length,
            hot: 0
          };
        };
        return samples.map((s: any) => ({ ...s, ...(s.kind.endsWith('Sq') ? squareAt(s.x, s.y) : pieceAt(s)) }));
      },
      { b64: shot.toString('base64'), maskB64: mask.toString('base64'), samples, vw: viewport.width }
    );
    const of = (kind: string) => result.filter((s: any) => s.kind === kind).map((s: any) => s.lum as number);
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const light = of('lightSq');
    const dark = of('darkSq');
    // each piece against the median empty square of the colour it stands on
    const pieceRatios = (kind: string, sq: number[]) => of(kind).map((l) => ratio(l, med(sq)));
    const row = {
      theme,
      lightSq: +med(light).toFixed(3),
      darkSq: +med(dark).toFixed(3),
      lightVsDark: +ratio(med(light), med(dark)).toFixed(2),
      whiteOnLight: { median: +med(pieceRatios('whiteOnLight', light)).toFixed(2), min: +Math.min(...pieceRatios('whiteOnLight', light)).toFixed(2) },
      whiteOnDark: { median: +med(pieceRatios('whiteOnDark', dark)).toFixed(2), min: +Math.min(...pieceRatios('whiteOnDark', dark)).toFixed(2) },
      blackOnLight: { median: +med(pieceRatios('blackOnLight', light)).toFixed(2), min: +Math.min(...pieceRatios('blackOnLight', light)).toFixed(2) },
      blackOnDark: { median: +med(pieceRatios('blackOnDark', dark)).toFixed(2), min: +Math.min(...pieceRatios('blackOnDark', dark)).toFixed(2) },
      // median luminance of the body pixels, and how much of a piece is gold trim rather than body
      whiteBody: +med(result.filter((s: any) => s.kind.startsWith('white')).map((s: any) => s.lum)).toFixed(3),
      blackBody: +med(result.filter((s: any) => s.kind.startsWith('black')).map((s: any) => s.lum)).toFixed(3),
      whiteTrimShare: +med(result.filter((s: any) => s.kind.startsWith('white')).map((s: any) => s.trimShare)).toFixed(2),
      blackTrimShare: +med(result.filter((s: any) => s.kind.startsWith('black')).map((s: any) => s.trimShare)).toFixed(2),
      // how far one square colour drifts across the board (1.0 means perfectly even)
      lightSpread: +ratio(Math.max(...light), Math.min(...light)).toFixed(2),
      darkSpread: +ratio(Math.max(...dark), Math.min(...dark)).toFixed(2),
      hotLightSquares: result.filter((s: any) => s.kind === 'lightSq' && s.hot > 0.2).length
    };
    if (process.env.READ_GRID) console.log('GRID ' + JSON.stringify(result.filter((s: any) => s.kind.endsWith('Sq')).map((s: any) => [s.r, s.c, +s.lum.toFixed(3)])));
    if (process.env.READ_GRID) console.log('PIECES ' + JSON.stringify(result.filter((s: any) => !s.kind.endsWith('Sq')).map((s: any) => [s.r, s.c, +s.lum.toFixed(3), +s.all.toFixed(3), +s.p10.toFixed(3), +s.p90.toFixed(3), +s.trimShare.toFixed(2), s.px])));
    lines.push(JSON.stringify(row));
    console.log('READABILITY ' + JSON.stringify(row));
  }
  writeFileSync(`${OUT}/readability-${LABEL}.jsonl`, lines.join('\n') + '\n');
});
