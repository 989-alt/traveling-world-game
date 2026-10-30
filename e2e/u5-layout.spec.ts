// U5-layout(DESIGN §16.9, PRD §2.1 U-14·§12.2): 광장 네 귀 전신 캐릭터 · 패널 200×48 재배치 · 세로 피치 110 · 낮은 광장(PLAZA-U5).
// 개발 보드 하네스(/dev/board)를 vite 개발 서버로 띄워 DOM 상자로 잰다(board-placement.spec 과 같은 방식).
// 스크린숏: harness/state/traveling-world/reports/U5-layout-shots/
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { paintedTiles } from './helpers/painted';

let BASE = '';
const SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/U5-layout-shots/', import.meta.url));
let server: ViteDevServer;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { port: 0 },
    // 자기 의존성 캐시: board-placement·overlays spec 의 개발 서버와 같은 node_modules/.vite 를 동시에 다시 묶으면 서로의 묶음을 지워
    // 'Failed to load script board-harness.tsx' 로 하네스가 안 뜬다(U5 계약 검사 tablet-touch 실측)
    cacheDir: fileURLToPath(new URL('../node_modules/.vite-u5-layout', import.meta.url)),
    optimizeDeps: { entries: ['index.html', 'src/dev/board-harness.tsx'], include: ['preact', 'preact/hooks', 'preact/compat', 'preact/jsx-runtime'] },
    logLevel: 'error',
  });
  await server.listen();
  BASE = server.resolvedUrls!.local[0].replace(/\/$/, '');
  mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(async () => { await server?.close(); });

type H = { demo: () => Promise<void>; scene: (t: number, n: number, l: number) => Promise<void>; log: (ev: unknown) => Promise<void>; move: (s: number, p: number) => Promise<void> };

async function open(page: Page, w: number, h: number, reduced: boolean, q = '') {
  await page.setViewportSize({ width: w, height: h });
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.goto(`${BASE}/dev/board${q}`);
  await page.addScriptTag({ type: 'module', url: '/src/dev/board-harness.tsx' });
  await page.waitForFunction(() => (window as unknown as { __board?: { ready?: () => boolean } }).__board?.ready?.() === true && document.querySelectorAll('.bc').length === 4 && document.querySelectorAll('.bcc').length === 4);
}
const ready = async (page: Page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};

test('board.png 1366×768: 귀퉁이 전신 캐릭터 4 + 땅 주인·건물 + 패널 4(초상 없음)', async ({ page }) => {
  await open(page, 1366, 768, true);
  await page.evaluate(() => (window as unknown as { __board: H }).__board.demo());
  await ready(page);
  // 찍기 전에 30칸이 정말 칠해졌는지(빈 칸 판을 board.png 로 남기지 않는다)
  expect((await paintedTiles(page)).filter((x) => !(x.nw > 0 && x.magenta < 0.03)).map((x) => x.t)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}board.png` });
  for (const [name, clip] of [['corner-tl', { x: 150, y: 120, width: 400, height: 190 }], ['corner-tr', { x: 830, y: 120, width: 400, height: 190 }],
    ['corner-bl', { x: 110, y: 340, width: 400, height: 190 }], ['corner-br', { x: 870, y: 340, width: 400, height: 190 }], ['left-column', { x: 0, y: 40, width: 260, height: 690 }]] as const) {
    await page.screenshot({ path: `${SHOTS}${name}.png`, clip });
  }
});

type Box = { x: number; y: number; w: number; h: number };
const hit = (a: Box, b: Box) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.3 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.3;

test('DOM 상자(1366×768·1024×768): 귀퉁이 캐릭터 키 96·발이 돌 단 위, 패널 200×48 초상 없음·캐릭터 바로 옆, 이름표·HUD·이정표와 교차 0', async ({ page }) => {
  for (const [w, h] of [[1366, 768], [1024, 768]] as const) {
    await open(page, w, h, true);
    await page.evaluate(() => (window as unknown as { __board: H }).__board.demo());
    await ready(page);
    const m = await page.evaluate(() => {
      const sr = document.querySelector('.board-stage')!.getBoundingClientRect(), k = sr.width / 1366;
      const st = (el: Element) => { const r = el.getBoundingClientRect(); return { x: (r.left - sr.left) / k, y: (r.top - sr.top) / k, w: r.width / k, h: r.height / k }; };
      return {
        corners: [...document.querySelectorAll<HTMLElement>('.board-world .bcc')].map((el) => ({ seat: +el.dataset.seat!, box: st(el.querySelector('.bc-sprite')!) })),
        panels: [...document.querySelectorAll<HTMLElement>('.board-hud .panel')].map((el) => ({ seat: +el.dataset.seat!, box: st(el), faces: el.querySelectorAll('.panel-face, img[src*="F00"]').length, coin: st(el.querySelector('.panel-coin-img')!) })),
        tiles: [...document.querySelectorAll<HTMLElement>('.tile')].map((el) => ({ t: +el.dataset.tile!, img: st(el), z: +getComputedStyle(el).zIndex })),
        hud: [
          { id: 'dice', box: st(document.querySelector('.dice')!) }, { id: 'timer', box: st(document.querySelector('.board-timer')!) },
          // 이정표 = 그림 상자에서 발(돌받침 밑, 그림 92.5%)까지 — 그 아래는 투명 여백
          ...[...document.querySelectorAll('.sign-face')].map((el) => { const b = st(el.parentElement!); return { id: `sign-${(el.parentElement as HTMLElement).dataset.continent}`, box: { ...b, h: b.h * 0.925 } }; }),
        ],
      };
    });
    expect(m.corners.map((c) => c.seat)).toEqual([0, 1, 2, 3]);
    // U8-impl: 원판 윗면 중심 재실측(옛 값은 3~6px 남쪽), 발 = 중심. 위 단(뒤) 키 75 · 아래 단 96(원판 중심에 서면 96 은 윗줄 이름표를 덮는다)
    const pads = [{ x: 270, y: 229, w: 80, h: 34 }, { x: 1099, y: 229, w: 80, h: 34 }, { x: 210, y: 451, w: 89, h: 40 }, { x: 1151, y: 451, w: 87, h: 38 }];
    const H = [75, 75, 96, 96];
    const bad: string[] = [];
    for (const c of m.corners) {
      expect(Math.abs(c.box.h - H[c.seat]), `귀퉁이 ${c.seat} 키`).toBeLessThan(0.6);
      const foot = { x: c.box.x + c.box.w / 2, y: c.box.y + c.box.h }, p = pads[c.seat];
      if (Math.abs(foot.x - p.x) > p.w / 4 || Math.abs(foot.y - p.y) > p.h / 2) bad.push(`귀퉁이 ${c.seat} 발 ${JSON.stringify(foot)} 이 돌 단 밖`);
      for (const pl of m.panels) if (hit(c.box, pl.box)) bad.push(`귀퉁이 ${c.seat}·패널 ${pl.seat}`);
      for (const x of m.hud) if (hit(c.box, x.box)) bad.push(`귀퉁이 ${c.seat}·${x.id}`);
      // 이름표(칸 그림 속 볼트 판, 상자 17~83% × 66~86%)를 가리지 않는다
      for (const t of m.tiles) {
        const plate = { x: t.img.x + 0.17 * t.img.w, y: t.img.y + 0.66 * t.img.h, w: 0.66 * t.img.w, h: 0.2 * t.img.h };
        if (hit(c.box, plate)) bad.push(`귀퉁이 ${c.seat}·칸 ${t.t} 이름표`);
      }
    }
    for (const pl of m.panels) {
      expect([Math.round(pl.box.w), Math.round(pl.box.h)], `패널 ${pl.seat}`).toEqual([200, 48]);
      expect(pl.faces, '패널 초상 없음').toBe(0);
      const c = m.corners[pl.seat].box, gap = Math.max(pl.box.x - (c.x + c.w), c.x - (pl.box.x + pl.box.w));
      if (gap <= 0 || gap > 8) bad.push(`패널 ${pl.seat} ↔ 귀퉁이 캐릭터 틈 ${gap.toFixed(1)}`);
      for (const x of m.hud) if (hit(pl.box, x.box)) bad.push(`패널 ${pl.seat}·${x.id}`);
      for (const t of m.tiles) {
        const plate = { x: t.img.x + 0.17 * t.img.w, y: t.img.y + 0.66 * t.img.h, w: 0.66 * t.img.w, h: 0.2 * t.img.h };
        if (hit(pl.box, plate)) bad.push(`패널 ${pl.seat}·칸 ${t.t} 이름표`);
      }
    }
    // 세로 이웃(같은 열)은 아래 칸이 앞(z), 그 이름표는 아래 칸 상자 위
    const byT = new Map(m.tiles.map((t) => [t.t, t]));
    for (const [up, down] of [[25, 26], [26, 27], [27, 28], [28, 29], [29, 0], [15, 14], [14, 13], [13, 12], [12, 11], [11, 10]] as const) {
      const a = byT.get(up)!, b = byT.get(down)!;
      if (!(b.z > a.z)) bad.push(`칸 ${down} 이 ${up} 보다 앞이 아님`);
      if (a.img.y + 0.86 * a.img.h > b.img.y + 0.3) bad.push(`칸 ${up} 이름표가 칸 ${down} 에 가림`);
    }
    expect(bad, `${w}x${h}`).toEqual([]);
    if (w === 1024) await page.screenshot({ path: `${SHOTS}board-1024x768.png` });
  }
});

test('이모션(U5 §16.9.3): 귀퉁이 캐릭터만 5~10초 랜덤 대기 이모션(동시 ≤ 2), 칸 위 말은 0, 반응도 귀퉁이에서', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, 1366, 768, false);
  await page.evaluate(() => (window as unknown as { __board: H }).__board.demo());
  const t0 = Date.now();
  const first = new Map<string, number>();
  let maxIdle = 0;
  const token = new Set<string>();
  while (Date.now() - t0 < 16_000) {
    const s = await page.evaluate(() => ({
      corner: [...document.querySelectorAll<HTMLElement>('.bcc')].map((el) => [el.dataset.seat!, el.dataset.motion!]),
      token: [...document.querySelectorAll<HTMLElement>('.bc')].map((el) => el.dataset.motion!),
    }));
    const idle = s.corner.filter(([, m]) => ['rest', 'stretch', 'look', 'wave', 'yawn'].includes(m));
    maxIdle = Math.max(maxIdle, idle.length);
    for (const [seat] of idle) if (!first.has(seat)) first.set(seat, Date.now() - t0);
    s.token.forEach((m) => m && token.add(m));
    await page.waitForTimeout(100);
  }
  console.log('[U5] 첫 대기 이모션(ms)', JSON.stringify(Object.fromEntries(first)), '동시 최대', maxIdle);
  expect(first.size, '네 귀퉁이 중 2명 이상이 16초 안에 이모션').toBeGreaterThanOrEqual(2);
  for (const [, ms] of first) expect(ms).toBeGreaterThanOrEqual(4800); // 5초 전엔 없다(첫 간격 ≥ 5000)
  expect(maxIdle).toBeLessThanOrEqual(2);
  expect([...token]).toEqual([]);
  // 반응: 통행료 → 낸 사람 울상·받는 사람 웃기+동전은 귀퉁이 캐릭터, 말은 가만히
  await page.evaluate(() => (window as unknown as { __board: H }).__board.log({ ev: 'toll', payer: 3, owner: 2, tile: 26, base: 1, multiplier: 1, discounted: false, paid: 1 }));
  await expect(page.locator('.bcc[data-seat="3"]')).toHaveAttribute('data-motion', 'cry');
  await expect(page.locator('.bcc[data-seat="2"]')).toHaveAttribute('data-motion', 'smileCoin');
  await expect(page.locator('.bc[data-seat="3"]')).toHaveAttribute('data-motion', '');
  await page.screenshot({ path: `${SHOTS}corner-reaction.png`, clip: { x: 110, y: 340, width: 1160, height: 190 } });
  // 이동 홉은 말이 한다
  await page.evaluate(() => (window as unknown as { __board: H }).__board.move(0, 23));
  await expect(page.locator('.bc[data-seat="0"]')).toHaveAttribute('data-motion', 'hop');
});

for (const [w, h] of [[1366, 768], [1024, 768]] as const) {
  test(`30칸 그림 전부 받아서 칠해짐 ${w}×${h}(naturalWidth > 0 · 보임 · 스테이지 안 · 윗면 마젠타 < 3%)`, async ({ page }) => {
    await open(page, w, h, true);
    await page.evaluate(() => (window as unknown as { __board: H }).__board.demo());
    await ready(page);
    const r = await paintedTiles(page);
    expect(r).toHaveLength(30);
    const bad = r.filter((x) => !(x.done && x.nw > 0 && x.vis && x.inside && x.magenta < 0.03)).map((x) => `칸 ${x.t}: ${JSON.stringify(x)}`);
    expect(bad).toEqual([]);
  });
}
