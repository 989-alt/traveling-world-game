// COIN-anim (사용자 요청 2026-10-28): 코인 롤링 숫자(바뀐 자리만 릴) · 증감 팝("월급 +480") · 코인 흐름.
// 개발 보드 하네스(/dev/board)를 vite 개발 서버로 띄우고 window.__board.coins 로 "상태 + 로그" 방송 한 번을 흉내 낸다.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import type { GameState, LogEvent } from '../src/shared/types';

let BASE = '';
const SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/COIN-anim-shots/', import.meta.url));
let server: ViteDevServer;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { port: 0 },
    optimizeDeps: { entries: ['index.html', 'src/dev/board-harness.tsx'], include: ['preact', 'preact/hooks', 'preact/compat', 'preact/jsx-runtime'] },
    logLevel: 'error',
  });
  await server.listen();
  BASE = server.resolvedUrls!.local[0].replace(/\/$/, '');
  mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(async () => { await server?.close(); });

type H = { ready: () => boolean; coins: (f: (g: GameState) => void, ev: LogEvent[], resync?: boolean) => Promise<void> };

async function open(page: Page, reduced = false) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.goto(`${BASE}/dev/board`);
  await page.addScriptTag({ type: 'module', url: '/src/dev/board-harness.tsx' });
  await page.waitForFunction(() => (window as unknown as { __board?: H }).__board?.ready?.() === true && document.querySelectorAll('.bc').length === 4);
  await page.waitForFunction(() => document.querySelector('.board-root')?.getAttribute('data-art') === '1', undefined, { timeout: 10_000 });
}

/** 상태 바꾸기 + 로그를 한 방송으로. 함수는 문자열로 넘긴다(브라우저 안에서 실행) */
async function cast(page: Page, patch: string, events: LogEvent[], resync = false) {
  await page.evaluate(([p, ev, rs]) => (window as unknown as { __board: H }).__board.coins(new Function('g', p as string) as (g: GameState) => void, ev as LogEvent[], rs as boolean),
    [patch, events, resync] as const);
}

const panel = (page: Page, seat: number) => page.locator(`.panel[data-seat="${seat}"]`);
const coinText = (page: Page, seat: number) => panel(page, seat).locator('.coin-num').evaluate((el) => el.textContent);
const spinning = (page: Page, seat: number) => panel(page, seat).locator('.reel.is-spin').count();
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}${name}-${test.info().project.name}.png` });

test('월급: 이동 연출 뒤 "월급 +480" 팝 + 바뀐 자리만 돌고 최종값', async ({ page }) => {
  await open(page);
  expect(await coinText(page, 0)).toBe('4,820');
  // 자리 0: 칸 21 → 주사위 5+4 → 출발(0) 도착 = 월급
  await cast(page, 'g.players[0].pos = 0; g.players[0].coin += 480;',
    [{ ev: 'dice', seat: 0, d1: 5, d2: 4 }, { ev: 'move', seat: 0, from: 21, to: 0, via: 'dice' }]);
  // 이동 연출(홉 9번 + 줌) 동안은 숫자가 그대로
  await page.waitForTimeout(600);
  expect(await coinText(page, 0)).toBe('4,820');
  expect(await panel(page, 0).locator('.coin-pop').count()).toBe(0);
  const pop = panel(page, 0).locator('.coin-pop');
  await expect(pop).toHaveText('월급 +480', { timeout: 8000 });
  // 4,820 → 5,300: 4→5, 8→3, 2→0 세 자리만 돈다(끝자리 0 은 그대로)
  await expect.poll(() => spinning(page, 0)).toBe(3);
  await expect(page.locator('.coin-drop')).not.toHaveCount(0);
  await shot(page, 'salary-rolling');
  const strip = await panel(page, 0).locator('.reel').evaluateAll((els) => els.map((e) => e.classList.contains('is-spin')));
  expect(strip).toEqual([true, false, true, true, false]);
  await expect.poll(() => coinText(page, 0), { timeout: 3000 }).toBe('5,300');
  await expect.poll(() => spinning(page, 0)).toBe(0);
  await expect(panel(page, 0)).toHaveAttribute('aria-label', /코인 5,300/);
});

test('통행료: 낸 쪽 "통행료 −370", 받은 쪽 "통행료 +370", 코인이 날아간다', async ({ page }) => {
  await open(page);
  await cast(page, 'g.players[3].coin -= 370; g.players[2].coin += 370;',
    [{ ev: 'toll', payer: 3, owner: 2, tile: 12, base: 370, multiplier: 1, discounted: false, paid: 370 }]);
  await expect(panel(page, 3).locator('.coin-pop')).toHaveText('통행료 −370', { timeout: 3000 });
  await expect(page.locator('.coin-fly')).not.toHaveCount(0);
  await expect(panel(page, 3).locator('.panel-coin-ico.is-shake')).toHaveCount(1);
  // 5,600 → 5,230: 6→2, 0→3 두 자리만
  expect(await spinning(page, 3)).toBe(2);
  await page.waitForTimeout(250);
  await shot(page, 'toll-flying');
  await expect(panel(page, 2).locator('.coin-pop')).toHaveText('통행료 +370', { timeout: 3000 });
  // 3,390 → 3,760: 3→7, 9→6 두 자리만
  await expect.poll(() => spinning(page, 2)).toBe(2);
  await shot(page, 'toll-received');
  await expect.poll(() => coinText(page, 3), { timeout: 3000 }).toBe('5,230');
  await expect.poll(() => coinText(page, 2), { timeout: 3000 }).toBe('3,760');
});

test('은행에 냄(땅 사기): 코인이 빠지고 아이콘이 흔들린다', async ({ page }) => {
  await open(page);
  await cast(page, 'g.players[1].coin -= 740;', [{ ev: 'buy', seat: 1, tile: 6, price: 740, discounted: false }]);
  await expect(panel(page, 1).locator('.coin-pop')).toHaveText('땅 사기 −740', { timeout: 3000 });
  await expect(page.locator('.coin-drain')).not.toHaveCount(0);
  await expect(panel(page, 1).locator('.panel-coin-ico.is-shake')).toHaveCount(1);
  await page.waitForTimeout(200);
  await shot(page, 'buy-drain');
  await expect.poll(() => coinText(page, 1), { timeout: 3000 }).toBe('5,410');
});

test('여러 변화 한 번에 + 자리수 변화(999→1,479, 1,000→630)', async ({ page }) => {
  await open(page);
  await cast(page, 'g.players[0].coin = 999; g.players[1].coin = 1000;', [], true); // 다시 받기: 연출 없이
  expect(await coinText(page, 0)).toBe('999');
  expect(await coinText(page, 1)).toBe('1,000');
  await cast(page, 'g.players[0].coin = 1479; g.players[1].coin = 630; g.players[2].coin += 370; g.players[0].pos = 0;', [
    { ev: 'dice', seat: 0, d1: 5, d2: 4 }, { ev: 'move', seat: 0, from: 21, to: 0, via: 'dice' },
    { ev: 'toll', payer: 1, owner: 2, tile: 12, base: 370, multiplier: 1, discounted: false, paid: 370 },
  ]);
  await expect(panel(page, 0).locator('.coin-pop').first()).toHaveText('월급 +480', { timeout: 8000 });
  await expect(panel(page, 1).locator('.coin-pop')).toHaveText('통행료 −370', { timeout: 3000 });
  await shot(page, 'multi-digits');
  await expect(panel(page, 2).locator('.coin-pop')).toHaveText('통행료 +370', { timeout: 3000 });
  await expect.poll(() => coinText(page, 0), { timeout: 4000 }).toBe('1,479');
  await expect.poll(() => coinText(page, 1), { timeout: 4000 }).toBe('630');
  await expect.poll(() => panel(page, 1).locator('.reel').count()).toBe(3);
});

test('재접속(전체 다시 받기): 연출 없이 최종값', async ({ page }) => {
  await open(page);
  await cast(page, 'g.players[3].coin -= 370; g.players[2].coin += 370;',
    [{ ev: 'toll', payer: 3, owner: 2, tile: 12, base: 370, multiplier: 1, discounted: false, paid: 370 }], true);
  expect(await coinText(page, 3)).toBe('5,230');
  expect(await coinText(page, 2)).toBe('3,760');
  await page.waitForTimeout(700);
  expect(await page.locator('.coin-pop, .coin-fly, .reel.is-spin').count()).toBe(0);
});

test('reduced-motion: 숫자 즉시 · 팝만 잠깐(움직임 없음) · 코인 안 날림', async ({ page }) => {
  await open(page, true);
  await cast(page, 'g.players[3].coin -= 370; g.players[2].coin += 370;',
    [{ ev: 'toll', payer: 3, owner: 2, tile: 12, base: 370, multiplier: 1, discounted: false, paid: 370 }]);
  expect(await coinText(page, 3)).toBe('5,230');
  expect(await coinText(page, 2)).toBe('3,760');
  expect(await spinning(page, 3)).toBe(0);
  await expect(panel(page, 3).locator('.coin-pop.is-still')).toHaveText('통행료 −370');
  expect(await page.locator('.coin-fly, .coin-drain, .coin-drop').count()).toBe(0);
  await shot(page, 'reduced');
  await expect(panel(page, 3).locator('.coin-pop')).toHaveCount(0, { timeout: 3000 });
});

test('성능: CPU 4배 스로틀에서 코인 연출 중 30fps 이상', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', '데스크톱에서만');
  await open(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const task = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration')!.value;
  // 네 자리 모두: 통행료 2건(날아감) + 땅 사기(빠짐) + 보너스(떨어짐)
  const frames = page.evaluate(() => new Promise<number[]>((done) => {
    const dts: number[] = [];
    let prev = 0;
    const t0 = performance.now();
    const loop = (t: number) => {
      if (prev) dts.push(t - prev);
      prev = t;
      if (t - t0 > 2600) return done(dts);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }));
  const t0 = await task();
  await cast(page, 'g.players[3].coin -= 370; g.players[2].coin += 370; g.players[1].coin -= 1220; g.players[0].coin += 1220 + 300 - 740;', [
    { ev: 'toll', payer: 3, owner: 2, tile: 12, base: 370, multiplier: 1, discounted: false, paid: 370 },
    { ev: 'toll', payer: 1, owner: 0, tile: 22, base: 1220, multiplier: 1, discounted: false, paid: 1220 },
    { ev: 'event', seat: 0, kind: 'korea', payload: { correct: true, bonus: 300 } },
    { ev: 'buy', seat: 0, tile: 6, price: 740, discounted: false },
  ]);
  const dts = await frames;
  const busy = (await task()) - t0;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const total = dts.reduce((a, b) => a + b, 0);
  const sorted = [...dts].sort((a, b) => a - b);
  const r = {
    cpu: 4, frames: dts.length, fps: Math.round((dts.length * 10000) / total) / 10,
    p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10, maxMs: Math.round(Math.max(...dts) * 10) / 10,
    over50: dts.filter((d) => d > 50).length, mainMsPerFrame: Math.round(((busy * 1000) / dts.length) * 10) / 10,
  };
  writeFileSync(`${SHOTS}perf-4x.json`, JSON.stringify(r, null, 2));
  expect(r.fps).toBeGreaterThanOrEqual(30);
  expect(r.mainMsPerFrame).toBeLessThan(33);
});
