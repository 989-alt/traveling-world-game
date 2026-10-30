// U8-impl(DESIGN §17): 주사위 B 나무 컵 · 땅 표시 C2 를 진짜 방 흐름(빌드 번들 + 이 프로세스 안의 worker/room.ts Room)에서 잰다.
// ① 화면 주사위 눈 = 서버 d1·d2(굴린 기기·관전 기기 둘 다), 같은 눈 칩, 뗌 → 이동 시작 1830(움직임 줄임 900), 서버 마감이 그만큼 늦음
// ② 땅 사기·건설(행동 버튼) → 삼각기·세로 깃발·발코니 미니어처, 1366·1024 에서 칸마다 풍경 가림(픽셀 diff) 실측
// 스크린숏·실측: harness/state/traveling-world/reports/U8-impl-shots/
import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { joinCode } from './helpers/entry';
import { clock, mkdirp, nextCode, rngFor, setup, Srv, type Built } from './helpers/room-server';
import { DICE_SHOW_MS, DICE_SHOW_MS_REDUCED, moveShowMs } from '../src/shared/timing';
import type { GameState, LogEvent } from '../src/shared/types';

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../assets/manifest.json', import.meta.url)), 'utf8')) as { entries: Record<string, string> };
const fileOf = (k: string) => manifest.entries[k].replace(/^webp\//, '');
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/U8-impl-shots/', import.meta.url));

let B: Built;
test.beforeAll(async () => { test.setTimeout(180_000); B = await setup('u8'); mkdirp(SHOTS); });
test.afterAll(async () => { await B?.close(); });

const proj = () => test.info().project.name;
const TURN = (seat: 0 | 1 | 2 | 3, step: GameState['turn']['step'], tile: number | null = null, correct: boolean | null = null): Partial<GameState['turn']> =>
  ({ seat, step, tile, correct, discount: false, rolledDouble: false, extraRoll: false, question: null, tf: null, missionId: null, missionSuccess: false, rewardOptions: [], takeoverCost: 0 });

/** 사람 n 명(0번 = 방장) + 봇. reduced = 움직임 줄임 */
async function room(browser: Browser, n: number, o: { reduced?: boolean; viewport?: { width: number; height: number } } = {}) {
  const srv = new Srv(B.RoomCtor, nextCode('TWU8'));
  const tablet = proj() === 'tablet-touch';
  const pages: Page[] = [];
  const ctxs = [];
  for (let i = 0; i < n; i++) {
    const ctx = await browser.newContext({
      baseURL: B.base, viewport: o.viewport ?? (tablet ? { width: 1180, height: 820 } : { width: 1366, height: 768 }), hasTouch: tablet, isMobile: tablet,
      reducedMotion: o.reduced ? 'reduce' : 'no-preference',
    });
    await ctx.routeWebSocket(/\/api\/rooms\/[A-Z0-9]{6}\/ws$/, (route) => srv.attach(route, `p${i}`));
    const page = await ctx.newPage();
    await page.goto('/');
    await joinCode(page, srv.code);
    await page.locator(`.pick[data-char="${i + 1}"]`).click();
    await expect(page.locator('.lb-slot.is-me')).toHaveCount(1);
    pages.push(page); ctxs.push(ctx);
  }
  await pages[0].locator('[data-act="start"]').click();
  for (const p of pages) {
    await expect(p.locator('.board-root')).toHaveAttribute('data-art', '1', { timeout: 15_000 });
    await p.evaluate(() => document.fonts.ready);
  }
  return { srv, pages, close: async () => { srv.stop(); for (const c of ctxs) await c.close(); } };
}

const lastDice = (srv: Srv) => [...srv.g.log].reverse().find((e) => e.ev === 'dice') as Extract<LogEvent, { ev: 'dice' }> | undefined;
/** 지금 단계 마감을 멀리(측정 동안 서버가 넘기지 않게) */
const freeze = (srv: Srv) => srv.do(() => { srv.room.rec!.deadlineAt = clock.now() + 600_000; });

/** 굴린 기기에서: 뗀 시각·카메라 in·말이 첫 칸을 뜬 시각(performance.now) */
async function watch(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __u8: { rel: number; hop: number; cam: number } };
    w.__u8 = { rel: 0, hop: 0, cam: 0 };
    const btn = document.querySelector('.dice-btn')!;
    for (const ev of ['keyup', 'pointerup']) btn.addEventListener(ev, () => { if (!w.__u8.rel) w.__u8.rel = performance.now(); }, true);
    const tok = document.querySelector<HTMLElement>('.bc[data-seat="0"]')!, cam = document.querySelector<HTMLElement>('.board-cam')!;
    const t0 = tok.dataset.tile;
    new MutationObserver(() => { if (!w.__u8.hop && tok.dataset.tile !== t0) w.__u8.hop = performance.now(); }).observe(tok, { attributes: true, attributeFilter: ['data-tile'] });
    new MutationObserver(() => { if (!w.__u8.cam && cam.dataset.cam === 'in') w.__u8.cam = performance.now(); }).observe(cam, { attributes: true, attributeFilter: ['data-cam'] });
  });
}
const times = (page: Page) => page.evaluate(() => (window as unknown as { __u8: { rel: number; hop: number; cam: number } }).__u8);

/** 상태를 바꿔 말이 움직였으면(홉·줌) 다 끝나고 컵이 대기(누를 수 있음)가 될 때까지 */
async function still(page: Page) {
  await expect(page.locator('.board-root')).toHaveAttribute('data-hopping', '0', { timeout: 10_000 });
  await expect(page.locator('.board-cam')).toHaveAttribute('data-cam', 'idle', { timeout: 10_000 });
}
/** 서버 상태 방송(srv.do)이 화면에 왔다: 자리 seat 의 말이 칸 tile 에 섰다 */
const on = (page: Page, seat: number, tile: number) => expect(page.locator(`.bc[data-seat="${seat}"]`)).toHaveAttribute('data-tile', String(tile), { timeout: 10_000 });
async function ready(page: Page) {
  await still(page);
  await expect(page.locator('.dice')).toHaveClass(/is-ready/, { timeout: 5000 });
}

/** 컵을 누르고(키보드 — 데스크톱·터치 같은 길) ms 뒤 뗀다 */
async function press(page: Page, ms: number) {
  await ready(page);
  await page.locator('.dice-btn').focus();
  await page.keyboard.down(' ');
  await page.waitForTimeout(ms);
  await page.keyboard.up(' ');
}

/** 주사위 HUD 상자 둘레 클립(화면 px) */
async function diceClip(page: Page) {
  const r = (await page.locator('.dice').boundingBox())!;
  const k = r.width / 200;
  return { x: r.x - 40 * k, y: r.y - 50 * k, width: r.width + 80 * k, height: r.height + 70 * k };
}

/** 합 팝(data-phase=pop)이 되는 순간 화면을 적어 둔다: 보이는 두 눈·그림 파일·합·더블 칩 — 기기 둘을 차례로 봐도 놓치지 않게 */
async function watchPop(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __pop: unknown[] };
    w.__pop = [];
    const root = document.querySelector<HTMLElement>('.dice')!;
    new MutationObserver(() => {
      if (root.dataset.phase !== 'pop') return;
      requestAnimationFrame(() => w.__pop.push({
        dice: [...root.querySelectorAll<HTMLElement>('.dice-die')].map((el) => {
          const vis = [...el.querySelectorAll<HTMLElement>('.dice-face')].filter((f) => getComputedStyle(f).opacity === '1');
          return { face: el.dataset.face, n: vis.length, src: vis[0]?.getAttribute('src') ?? '', out: el.dataset.out === '1' };
        }),
        sum: root.querySelector('.dice-sum-n')?.textContent ?? null,
        double: root.querySelector('.dice-double')?.textContent ?? null,
      }));
    }).observe(root, { attributes: true, attributeFilter: ['data-phase'] });
  });
}
type Pop = { dice: { face: string; n: number; src: string; out: boolean }[]; sum: string | null; double: string | null };
const pops = (page: Page) => page.evaluate(() => (window as unknown as { __pop: Pop[] }).__pop);

/** 굴린 화면에 보이는 두 눈(면 6장 중 보이는 것)과 그 그림 파일 */
const shownFaces = (page: Page) => page.locator('.dice-die').evaluateAll((els) => els.map((el) => {
  const vis = [...el.querySelectorAll<HTMLElement>('.dice-face')].filter((f) => getComputedStyle(f).opacity === '1');
  return { face: (el as HTMLElement).dataset.face, n: vis.length, src: (vis[0] as HTMLImageElement | undefined)?.getAttribute('src') ?? '', out: (el as HTMLElement).dataset.out === '1' };
}));

test('주사위 B: 굴린 기기·관전 기기의 두 눈 = 서버 d1·d2, 같은 눈이면 "더블!", 뗌 → 이동 시작 1830, 서버 마감이 그만큼 늦다 + 타임라인 프레임', async ({ browser }) => {
  test.setTimeout(150_000);
  const { srv, pages: [a, b], close } = await room(browser, 2);
  srv.do((g) => { g.players[0].pos = 3; g.turn = { ...g.turn, ...TURN(0, 'roll') }; g.rngState = rngFor(3, 3); }); // 3 → 9(무인도 아님), 같은 눈
  await on(a, 0, 3);
  await ready(a);
  await expect(b.locator('.dice')).toHaveClass(/is-dim/); // 남의 차례: 컵 정지 · 옅게
  await a.waitForTimeout(500);
  await a.screenshot({ path: `${SHOTS}dice-0-idle-${proj()}.png`, clip: await diceClip(a) });
  await watch(a);
  for (const p of [a, b]) await watchPop(p);
  const clip = await diceClip(a);
  // 누름: 컵 흔들림 + 쟁반 테 게이지
  await a.locator('.dice-btn').focus();
  await a.keyboard.down(' ');
  await a.waitForTimeout(450);
  await expect(a.locator('.dice')).toHaveAttribute('data-phase', 'press');
  await a.screenshot({ path: `${SHOTS}dice-1-press-${proj()}.png`, clip });
  await a.keyboard.up(' ');
  // 타임라인 프레임(실시간 — 찍는 데 걸린 시간만큼 늦을 수 있어 실제 시각·단계를 이름에 적는다)
  const frames: { name: string; ms: number; phase: string }[] = [];
  for (const [name, ms] of [['2-pour', 140], ['3-bounce', 420], ['4-stop', 800], ['5-pop', 1000], ['6-double', 1350], ['7-move', 1900]] as const) {
    const now = await a.evaluate(() => performance.now() - (window as unknown as { __u8: { rel: number } }).__u8.rel);
    if (ms > now) await a.waitForTimeout(ms - now);
    const at = await a.evaluate(() => Math.round(performance.now() - (window as unknown as { __u8: { rel: number } }).__u8.rel));
    const phase = (await a.locator('.dice').getAttribute('data-phase'))!;
    frames.push({ name, ms: at, phase });
    await a.screenshot({ path: `${SHOTS}dice-${name}-${proj()}.png`, clip: name === '7-move' ? undefined : clip });
  }
  console.log('프레임', JSON.stringify(frames));
  const d = lastDice(srv)!;
  expect([d.seat, d.d1, d.d2]).toEqual([0, 3, 3]);
  // 서버: 다음 단계 마감·봇 행동이 주사위 연출 + 이동 연출만큼 늦다(shared/timing 단일 출처)
  expect(DICE_SHOW_MS).toBe(1830);
  // 두 기기 다 멈춘 눈 = 서버 눈(왼쪽 = 첫 눈)
  const t = await times(a);
  expect(t.hop - t.rel, '뗌 → 말이 첫 칸을 뜸').toBeGreaterThan(1830 - 50);
  expect(t.hop - t.rel, '뗌 → 말이 첫 칸을 뜸').toBeLessThan(1830 + 120);
  console.log('뗌 → 이동 시작', Math.round(t.hop - t.rel), 'ms · 줌 in', Math.round(t.cam - t.rel), 'ms');
  for (const p of [a, b]) { // 합 팝 순간 화면에 보인 두 눈·합·칩
    await expect.poll(async () => (await pops(p)).length, { timeout: 3000 }).toBeGreaterThan(0);
    const [f] = await pops(p);
    expect(f.dice.map((x) => [x.face, x.n])).toEqual([[String(d.d1), 1], [String(d.d2), 1]]);
    expect([f.sum, f.double]).toEqual([String(d.d1 + d.d2), '더블!']);
  }
  await expect.poll(() => srv.g.players[0].pos).toBe(9);
  await close();
});

test('주사위 B: 관전 기기도 같은 눈·합·더블 칩을 본다(멈춤 → 합 팝 구간), 다른 눈이면 칩 없음', async ({ browser }) => {
  test.setTimeout(120_000);
  const { srv, pages: [a, b], close } = await room(browser, 2);
  for (const [d1, d2] of [[5, 5], [2, 6]] as const) {
    srv.do((g) => { g.players[0].pos = 1; g.turn = { ...g.turn, ...TURN(0, 'roll') }; g.rngState = rngFor(d1, d2); });
    await on(a, 0, 1);
    await ready(a);
    for (const p of [a, b]) await watchPop(p);
    await press(a, 300);
    for (const p of [a, b]) {
      await expect.poll(async () => (await pops(p)).length, { timeout: 3000 }).toBeGreaterThan(0);
      const [f] = await pops(p);
      expect(f.dice.map((x) => [x.face, x.n, x.out])).toEqual([[String(d1), 1, true], [String(d2), 1, true]]);
      expect(f.dice[0].src).toMatch(new RegExp(`DICE-top-${d1}\\.webp$`));
      expect(f.dice[1].src).toMatch(new RegExp(`DICE-top-${d2}\\.webp$`));
      expect(f.sum).toBe(String(d1 + d2));
      expect(f.double).toBe(d1 === d2 ? '더블!' : null);
    }
    await b.screenshot({ path: `${SHOTS}dice-spectator-${d1}${d2}-${proj()}.png`, clip: await diceClip(b) });
    expect([lastDice(srv)!.d1, lastDice(srv)!.d2]).toEqual([d1, d2]);
    // 이동이 끝나고 다음 차례까지 기다린다(같은 눈 → 다시 내 차례)
    await expect.poll(() => srv.g.players[0].pos, { timeout: 8000 }).toBe((1 + d1 + d2) % 30);
    await expect(a.locator('.board-root')).toHaveAttribute('data-hopping', '0', { timeout: 10_000 });
  }
  await close();
});

test('주사위 B: 서버 마감 = 단계 기본 + 1830 + 이동 연출, 봇 굴림은 흔들기 600 뒤 쏟는다', async ({ browser }) => {
  test.setTimeout(120_000);
  const { srv, pages: [a], close } = await room(browser, 1);
  srv.do((g) => { g.players[0].pos = 3; g.turn = { ...g.turn, ...TURN(0, 'roll') }; g.rngState = rngFor(1, 2); });
  await on(a, 0, 3);
  await expect(a.locator('.dice-btn')).toBeEnabled();
  await press(a, 200);
  await expect.poll(() => lastDice(srv)?.seat === 0 && srv.g.turn.step !== 'roll').toBe(true);
  const r = srv.room.rec!;
  const show = (r.showUntil ?? 0) - clock.now();
  expect(show, '서버 연출 늦춤(주사위 + 3홉)').toBeGreaterThan(DICE_SHOW_MS + moveShowMs(3, 6) - 200);
  expect(show).toBeLessThanOrEqual(DICE_SHOW_MS + moveShowMs(3, 6));
  // 봇(자리 1) 차례: 누름 없이 컵 흔들기(shake) → 쏟기
  await expect(a.locator('.dice')).toHaveAttribute('data-d1', '1'); // 내 굴림 연출이 화면에 왔다
  await still(a);
  await expect(a.locator('.dice')).toHaveAttribute('data-phase', 'idle');
  await watchPop(a);
  srv.do((g) => { g.turn = { ...g.turn, ...TURN(1, 'roll') }; });
  await expect(a.locator('.dice')).toHaveAttribute('data-phase', 'shake', { timeout: 6000 });
  await a.screenshot({ path: `${SHOTS}dice-bot-shake-${proj()}.png`, clip: await diceClip(a) });
  await expect(a.locator('.dice')).toHaveAttribute('data-phase', /tilt|pour/, { timeout: 1000 });
  await expect(a.locator('.dice')).toHaveAttribute('data-seat', '1');
  await expect.poll(async () => (await pops(a)).length, { timeout: 3000 }).toBeGreaterThan(0);
  const d = lastDice(srv)!;
  expect(d.seat).toBe(1);
  expect((await pops(a))[0].dice.map((x) => x.face)).toEqual([String(d.d1), String(d.d2)]);
  await close();
});

test('주사위 B 움직임 줄임: 흔들림·튕김 없이 멈춘 눈 + 숫자, 뗌 → 이동 900, 착지까지 숫자 유지', async ({ browser }) => {
  test.setTimeout(120_000);
  const { srv, pages: [a], close } = await room(browser, 1, { reduced: true });
  srv.do((g) => { g.players[0].pos = 3; g.turn = { ...g.turn, ...TURN(0, 'roll') }; g.rngState = rngFor(4, 2); });
  await on(a, 0, 3);
  await expect(a.locator('.dice-btn')).toBeEnabled();
  expect(await a.locator('.dice-cup--stand').evaluate((el) => getComputedStyle(el).animationName)).toBe('none'); // 달그락 0
  await ready(a);
  await watch(a);
  await press(a, 300);
  await expect(a.locator('.dice')).toHaveAttribute('data-phase', 'pop', { timeout: 1000 });
  expect((await shownFaces(a)).map((x) => x.face)).toEqual(['4', '2']);
  await a.screenshot({ path: `${SHOTS}dice-reduced-${proj()}.png`, clip: await diceClip(a) });
  await expect.poll(async () => (await times(a)).hop, { timeout: 4000 }).toBeGreaterThan(0);
  const t = await times(a);
  expect(t.hop - t.rel).toBeGreaterThan(DICE_SHOW_MS_REDUCED - 50);
  expect(t.hop - t.rel).toBeLessThan(DICE_SHOW_MS_REDUCED + 150);
  console.log('reduced 뗌 → 이동 시작', Math.round(t.hop - t.rel), 'ms');
  await expect(a.locator('.dice-sum-n')).toHaveText('6'); // 홉 중에도 HUD 숫자 유지(말 칩 없음)
  await expect(a.locator('.hop-chip')).toHaveCount(0);
  await close();
});

// ── 귀퉁이 캐릭터 = 원판 중심(U8-impl 사용자 피드백 "네 모퉁이 원판에서 중앙이 아니야. 남쪽으로 내려와 있어") ──
test('귀퉁이 캐릭터 4: 발(스프라이트 바닥 가운데)이 광장 그림 돌 원판 윗면 중심 ±4px + 4귀퉁이 크롭', async ({ browser }) => {
  test.setTimeout(120_000);
  const { pages: [a], close } = await room(browser, 1);
  await still(a);
  const PADS = [[270, 229], [1099, 229], [210, 451], [1151, 451]]; // PLAZA-U5 실측(스테이지 px)
  const feet = await a.evaluate(() => {
    const sr = document.querySelector('.board-stage')!.getBoundingClientRect(), k = sr.width / 1366;
    return [0, 1, 2, 3].map((s) => {
      const r = document.querySelector(`.bcc[data-seat="${s}"] .bc-sprite`)!.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - sr.left) / k, y: (r.bottom - sr.top) / k, k, sx: sr.left, sy: sr.top };
    });
  });
  feet.forEach((f, i) => {
    expect(Math.abs(f.x - PADS[i][0]), `자리 ${i + 1} 발 x ${f.x.toFixed(1)}`).toBeLessThanOrEqual(4);
    expect(Math.abs(f.y - PADS[i][1]), `자리 ${i + 1} 발 y ${f.y.toFixed(1)}`).toBeLessThanOrEqual(4);
  });
  await a.waitForTimeout(400);
  const { k, sx, sy } = feet[0];
  for (const [i, [cx, cy]] of PADS.entries()) {
    const w = 150, h = 150;
    await a.screenshot({ path: `${SHOTS}corner-${i + 1}-${proj()}.png`, clip: { x: sx + (cx - w / 2) * k, y: sy + (cy - 115) * k, width: w * k, height: h * k } });
  }
  await a.screenshot({ path: `${SHOTS}corners-board-${proj()}.png` });
  await close();
});

// ── 땅 표시 C2 ──

/** 칸마다 풍경 가림: 소유 표시를 숨긴/보인 화면을 비교해, 칸 상자 풍경 영역(x 4~120 · y 0~79, 상자 124 기준)에서 바뀐 픽셀 비율.
 *  all = 소유 표시 전부, bld = 발코니 + 건물 미니어처만 */
async function occlusion(page: Page, tiles: number[]) {
  await page.addStyleTag({ content: '.own-flagset, .own-bld { animation: none !important; } .bc, .bcc { visibility: hidden !important; }' });
  await page.waitForTimeout(100);
  const set = (css: string) => page.evaluate((c) => {
    let el = document.getElementById('u8-occ') as HTMLStyleElement | null;
    if (!el) { el = document.createElement('style'); el.id = 'u8-occ'; document.head.append(el); }
    el.textContent = c;
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, css);
  const shot = async () => (await page.screenshot()).toString('base64');
  await set('.own { visibility: hidden !important; }');
  const none = await shot();
  await set('');
  const all = await shot();
  await set('.own-flagset { visibility: hidden !important; }');
  const bld = await shot();
  await set('');
  const boxes = await page.evaluate((ts) => ts.map((t) => { const r = document.querySelector(`.tile[data-tile="${t}"]`)!.getBoundingClientRect(); return { t, x: r.x, y: r.y, w: r.width, h: r.height }; }), tiles);
  return page.evaluate(async ([n, a, b, bx, dpr]) => {
    const load = async (s: string) => {
      const img = new Image(); img.src = `data:image/png;base64,${s}`; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const c = cv.getContext('2d')!; c.drawImage(img, 0, 0); return c.getImageData(0, 0, cv.width, cv.height);
    };
    const [N, A, Bd] = await Promise.all([load(n as string), load(a as string), load(b as string)]);
    return (bx as { t: number; x: number; y: number; w: number; h: number }[]).map((r) => {
      const k = (r.w / 124) * (dpr as number);
      const x0 = Math.round((r.x * (dpr as number)) + 4 * k), x1 = Math.round((r.x * (dpr as number)) + 120 * k);
      const y0 = Math.round(r.y * (dpr as number)), y1 = Math.round((r.y * (dpr as number)) + 79 * k);
      let tot = 0, ca = 0, cb = 0;
      for (let y = Math.max(0, y0); y < Math.min(N.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(N.width, x1); x++) {
        const i = (y * N.width + x) * 4;
        const diff = (D: ImageData) => Math.max(Math.abs(D.data[i] - N.data[i]), Math.abs(D.data[i + 1] - N.data[i + 1]), Math.abs(D.data[i + 2] - N.data[i + 2])) > 24;
        tot++;
        if (diff(A)) ca++;
        if (diff(Bd)) cb++;
      }
      return { tile: r.t, all: ca / tot, bld: cb / tot };
    });
  }, [none, all, bld, boxes, await page.evaluate(() => devicePixelRatio)] as const);
}

test('땅 C2 실제 흐름: 행동 버튼으로 사기 → 짓기 1~4단계, 깃발 길이·금별·발코니 미니어처 표시, 1366·1024 풍경 가림 실측', async ({ browser }) => {
  test.setTimeout(180_000);
  const { srv, pages: [a, b], close } = await room(browser, 2);
  const T = 2; // 타이(아시아)
  srv.do((g) => { g.players[0].pos = T; g.players[0].coin = 20_000; g.turn = { ...g.turn, ...TURN(0, 'action', T, false) }; });
  await expect(a.locator('[data-act="buy"]')).toBeVisible();
  await a.locator('[data-act="buy"]').click();
  await expect.poll(() => srv.g.tiles[T].owner).toBe(0);
  for (const p of [a, b]) {
    await expect(p.locator(`.own[data-tile="${T}"]`)).toHaveAttribute('data-level', '0');
    await expect(p.locator(`.own[data-tile="${T}"] .own-pennants`)).toHaveAttribute('data-n', '7');
    await expect(p.locator(`.own[data-tile="${T}"] .own-flag`)).toHaveAttribute('data-len', '24');
    await expect(p.locator(`.own[data-tile="${T}"] .own-bld`)).toHaveCount(0); // 땅만: 발코니 없음
  }
  await a.waitForTimeout(500);
  await a.screenshot({ path: `${SHOTS}own-buy-${proj()}.png`, clip: await tileClip(a, [T - 1, T, T + 1]) });
  const lens = [24, 32, 40, 48];
  for (let lv = 1; lv <= 4; lv++) {
    srv.do((g) => { g.players[0].pos = T; g.turn = { ...g.turn, ...TURN(0, 'action', T, true) }; });
    await expect(a.locator('[data-act="build"]')).toBeVisible();
    await a.locator('[data-act="build"]').click();
    await expect.poll(() => srv.g.tiles[T].level).toBe(lv);
    for (const p of [a, b]) {
      const o = p.locator(`.own[data-tile="${T}"]`);
      await expect(o).toHaveAttribute('data-level', String(lv));
      await expect(o.locator('.own-flag')).toHaveAttribute('data-len', String(lens[lv - 1]));
      await expect(o.locator('.own-bld')).toHaveAttribute('data-level', String(lv));
      await expect(o.locator('.own-mini')).toHaveAttribute('src', new RegExp(`${esc(fileOf(lv === 4 ? `landmark.${T}` : `building.${T}.${lv}`))}$`));
      await expect(o.locator('.own-balcony')).toHaveAttribute('src', /BALCONY-1/);
      await expect(o.locator('.own-star')).toHaveCount(lv === 4 ? 1 : 0);
    }
    await expect(a.locator('.ap')).toHaveCount(0); // 행동 판이 닫힌 뒤(닫히는 막이 칸을 덮지 않게)
    if (lv === 4) { // 랜드마크 컷씬(탭으로 건너뜀) 뒤에 판을 찍는다
      await expect(a.locator('.cut')).toBeVisible();
      await a.locator('.cut').click();
      await expect(a.locator('.cut')).toHaveCount(0, { timeout: 8000 });
    }
    await a.waitForTimeout(500);
    await a.screenshot({ path: `${SHOTS}own-build-lv${lv}-${proj()}.png`, clip: await tileClip(a, [T - 1, T, T + 1]) });
  }
  // 시안 C2 와 같은 6칸(자리·단계)을 더 깔고 판 전체 + 가림 실측
  const OWNED: [number, 0 | 1 | 2 | 3, number][] = [[T, 0, 4], [3, 1, 2], [23, 2, 3], [13, 3, 4], [21, 0, 2], [26, 3, 1], [16, 2, 0]];
  srv.do((g) => {
    for (const [t, s, l] of OWNED) g.tiles[t] = { owner: s, level: l, festivalTarget: false };
    [10, 11, 25, 0].forEach((p, s) => { g.players[s].pos = p; }); // 말은 잴 칸 밖
    g.turn = { ...g.turn, ...TURN(1, 'roll') }; // 사람(b) 차례: 봇이 움직이지 않는다
  });
  freeze(srv);
  await on(a, 0, 10);
  const out: Record<string, { tile: number; all: number; bld: number }[]> = {};
  for (const [vw, vh, tag] of [[...(proj() === 'tablet-touch' ? [1180, 820] : [1366, 768]), proj() === 'tablet-touch' ? '1180' : '1366'], [1024, 768, '1024']] as const) {
    await a.setViewportSize({ width: vw as number, height: vh as number });
    await expect(a.locator(`.own[data-tile="16"]`)).toHaveCount(1);
    await still(a);
    await a.waitForTimeout(600);
    await a.screenshot({ path: `${SHOTS}own-board-${tag}-${proj()}.png` });
    for (const t of [T, 13]) await a.screenshot({ path: `${SHOTS}own-tile${t}-${tag}-${proj()}.png`, clip: await tileClip(a, [t]) });
    out[tag] = await occlusion(a, OWNED.map(([t]) => t));
    await a.evaluate(() => document.querySelectorAll('style').forEach((s) => { if (s.textContent?.includes('.bc, .bcc')) s.remove(); }));
  }
  const fmt = (r: { tile: number; all: number; bld: number }[]) => r.map((x) => `칸${x.tile} 전체 ${(x.all * 100).toFixed(1)}% · 건물 ${(x.bld * 100).toFixed(2)}%`).join(' / ');
  for (const [k, r] of Object.entries(out)) console.log(`풍경 가림 ${k}:`, fmt(r));
  writeFileSync(`${SHOTS}occlusion-${proj()}.json`, JSON.stringify({ owned: OWNED, out }, null, 1));
  for (const [k, r] of Object.entries(out)) for (const x of r) {
    // §17.2 목표 ≤ 7% 였으나 수정 1회차(조율자): '한눈에 보임' 우선 — 시안 무게(삼각기 13×14 · 깃발 천 16 · 남색 외곽선)로 키운 실측을 회귀 상한으로(보고서에 수치)
    expect(x.all, `${k} 칸 ${x.tile} 풍경 가림`).toBeLessThanOrEqual(k === '1366' ? 0.19 : 0.21); // 사용자 '시안만큼 굵게'(≈ 15% 수용)
    expect(x.bld, `칸 ${x.tile} 건물 풍경 가림(목표 0)`).toBeLessThanOrEqual(0.005);
  }
  await close();
});

async function tileClip(page: Page, tiles: number[]) {
  const rs = await Promise.all(tiles.map((t) => page.locator(`.tile[data-tile="${t}"]`).boundingBox()));
  const x0 = Math.min(...rs.map((r) => r!.x)), y0 = Math.min(...rs.map((r) => r!.y));
  const x1 = Math.max(...rs.map((r) => r!.x + r!.width)), y1 = Math.max(...rs.map((r) => r!.y + r!.height));
  return { x: Math.max(0, x0 - 8), y: Math.max(0, y0 - 8), width: x1 - Math.max(0, x0 - 8) + 8, height: y1 - Math.max(0, y0 - 8) + 8 };
}
