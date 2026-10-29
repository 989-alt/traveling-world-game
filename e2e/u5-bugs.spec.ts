// U5-bugs: 사용자 배포본 피드백 3·4·5·6·7 을 진짜 방 흐름(빌드 번들 + 이 프로세스 안의 worker/room.ts Room)에서 재현·검증한다.
// 개발 보드 하네스가 아니라 로비 → 시작 → 서버 상태 방송 → Board 로 그린 화면을 잰다.
// 스크린숏: harness/state/traveling-world/reports/U5-bugs-shots/<U5_LABEL|after>-<무엇>-<프로젝트>.png
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { joinCode } from './helpers/entry';
import { mkdirp, nextCode, setup, Srv, type Built } from './helpers/room-server';
import { paintedTiles } from './helpers/painted';

const SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/U5-bugs-shots/', import.meta.url));
const LABEL = process.env.U5_LABEL ?? 'after';
/** 칸 그림 상자(스테이지 px)·실측 비율(U5: 30장 공터 무게중심 가운데값 0.408, 세로 다리 자리 절벽 끝 0.82, 윗면 뒤 변 0.08) */
const BOX = 124, CLEAR_Y = 0.408, BODY_END = 0.82, TOP_BACK = 0.08;

let B: Built;
test.beforeAll(async () => { test.setTimeout(180_000); B = await setup('u5bugs'); mkdirp(SHOTS); });
test.afterAll(async () => { await B?.close(); });

async function startGame(browser: import('@playwright/test').Browser, project: string) {
  const srv = new Srv(B.RoomCtor, nextCode('TWU5'));
  const tablet = project === 'tablet-touch';
  const ctx = await browser.newContext({ baseURL: B.base, viewport: tablet ? { width: 1180, height: 820 } : { width: 1366, height: 768 }, hasTouch: tablet, isMobile: tablet });
  await ctx.routeWebSocket(/\/api\/rooms\/[A-Z0-9]{6}\/ws$/, (route) => srv.attach(route, 'a'));
  const page = await ctx.newPage();
  await page.goto('/');
  await joinCode(page, srv.code);
  await page.locator('.pick[data-char="1"]').click();
  await page.locator('[data-act="start"]').click();
  await expect(page.locator('.board-root')).toHaveAttribute('data-art', '1', { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  return { srv, ctx, page };
}
const shot = (page: Page, what: string) => page.screenshot({ path: `${SHOTS}${LABEL}-${what}-${test.info().project.name}.png` });
/** 스테이지 배율·원점(화면 px) */
const stageOf = (page: Page) => page.locator('.board-stage').evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { k: r.width / 1366, x: r.x, y: r.y };
});

test('피드백 4·5: 남이 산 땅 깃발·지은 건물이 실제 방 상태 방송으로 보이고, 풍경과 갈리는 스티커 테·자리색 받침이 있다', async ({ browser }) => {
  test.setTimeout(120_000);
  const { srv, ctx, page } = await startGame(browser, test.info().project.name);
  // 서버 상태: 봇(자리 2) 이 2번(타이)을 사고, 자리 1(나) 이 3번(중국)에 2단계, 봇(자리 3) 이 12번(프랑스)에 랜드마크
  srv.do((g) => {
    g.tiles[2] = { owner: 1, level: 0, festivalTarget: false };
    g.tiles[3] = { owner: 0, level: 2, festivalTarget: false };
    g.tiles[12] = { owner: 2, level: 4, festivalTarget: false };
  });
  await expect(page.locator('.tile-flag')).toHaveCount(3);
  await expect(page.locator('.tile-bld')).toHaveCount(2);
  await page.waitForTimeout(600); // 꽂힘 튀어 오름 420ms
  await shot(page, 'owned');
  await page.screenshot({ path: `${SHOTS}${LABEL}-owned-crop-${test.info().project.name}.png`, clip: await clipOf(page, [2, 3]) });
  await page.screenshot({ path: `${SHOTS}${LABEL}-owned-crop-right-${test.info().project.name}.png`, clip: await clipOf(page, [12, 13]) });
  const seatColor = (s: number) => page.evaluate((s) => {
    const p = document.createElement('i'); p.style.color = `var(--seat-${s})`; document.body.append(p);
    const c = getComputedStyle(p).color; p.remove(); return c;
  }, s);
  for (const [tile, owner] of [[2, 1], [3, 0], [12, 2]] as const) {
    const f = page.locator(`.tile-flag[data-tile="${tile}"]`);
    await expect(f.locator('img')).toHaveAttribute('src', new RegExp(`UI-flag-${owner + 1}`));
    const m = await f.evaluate((el) => {
      const img = el.querySelector('img')!, base = el.querySelector('.tile-flag-base');
      const r = el.getBoundingClientRect();
      return { filter: getComputedStyle(img).filter, base: base ? getComputedStyle(base).backgroundColor : null, w: r.width, h: r.height, op: getComputedStyle(el).opacity };
    });
    const { k } = await stageOf(page);
    expect(m.op).toBe('1');
    expect(m.h / k, `칸 ${tile} 깃발 크기(스테이지 px)`).toBeGreaterThanOrEqual(23.5);
    expect(m.filter, `칸 ${tile} 깃발 흰 테`).toMatch(/drop-shadow/);
    expect(m.base, `칸 ${tile} 깃발 자리색 받침`).toBe(await seatColor(owner + 1));
  }
  for (const [tile, owner, re] of [[3, 0, /BLD-06-2/], [12, 2, /LM-12/]] as const) {
    const b = page.locator(`.tile-bld[data-tile="${tile}"]`);
    await expect(b.locator('img')).toHaveAttribute('src', re);
    const m = await b.evaluate((el) => ({ filter: getComputedStyle(el.querySelector('img')!).filter, plate: getComputedStyle(el.querySelector('.tile-bld-shadow')!).backgroundColor }));
    expect(m.filter, `칸 ${tile} 건물 흰 테`).toMatch(/drop-shadow/);
    expect(m.plate, `칸 ${tile} 건물 자리색 받침`).toBe(await seatColor(owner + 1));
  }
  // 단계가 오르면 건물이 새로 마운트돼 다시 튀어 오른다(지어짐이 눈에 띄게)
  const before = await page.locator('.tile-bld[data-tile="3"]').elementHandle();
  srv.do((g) => { g.tiles[3].level = 3; });
  await expect(page.locator('.tile-bld[data-tile="3"]')).toHaveAttribute('data-level', '3');
  expect(await before!.evaluate((el) => el.isConnected)).toBe(false);
  await ctx.close(); srv.stop();
});

async function clipOf(page: Page, tiles: number[]) {
  const rs = await Promise.all(tiles.map((t) => page.locator(`.tile[data-tile="${t}"]`).boundingBox()));
  const x0 = Math.min(...rs.map((r) => r!.x)), y0 = Math.min(...rs.map((r) => r!.y));
  const x1 = Math.max(...rs.map((r) => r!.x + r!.width)), y1 = Math.max(...rs.map((r) => r!.y + r!.height));
  return { x: Math.max(0, x0), y: Math.max(0, y0), width: x1 - Math.max(0, x0), height: y1 - Math.max(0, y0) };
}

test('피드백 3: 줌(이동) 동안 재화 패널·남은 시간·규칙·멈춤 간판이 확대된 판 위에 떠 있지 않다 — 자리 그대로 걷혔다가 줌이 풀리면 돌아온다', async ({ browser }) => {
  test.setTimeout(120_000);
  const { srv, ctx, page } = await startGame(browser, test.info().project.name);
  const HUD = '.board-hud .panel, .board-timer-sign, .gm-sign';
  const read = () => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => {
    const r = el.getBoundingClientRect();
    return { box: [r.x, r.y, r.width, r.height].map(Math.round).join(','), op: Number(getComputedStyle(el).opacity), inWorld: !!el.closest('.board-world') };
  }), HUD);
  const idle = await read();
  expect(idle.length).toBeGreaterThanOrEqual(4 + 1 + 2);
  for (const x of idle) { expect(x.inWorld).toBe(false); expect(x.op).toBe(1); }
  srv.arrive(0, 5); // 0 → 5: 다섯 홉, 줌 1.8
  await expect(page.locator('.board-cam')).toHaveAttribute('data-cam', /in|follow/, { timeout: 5000 });
  await page.waitForTimeout(500);
  const zoom = await read();
  await shot(page, 'zoom-hud');
  zoom.forEach((x, i) => {
    expect(x.box, 'HUD 자리·크기는 줌에 안 바뀐다(화면 레이어)').toBe(idle[i].box);
    expect(x.inWorld).toBe(false);
    expect(x.op, `HUD ${i} 줌 동안 걷힘`).toBeLessThanOrEqual(0.05);
  });
  await expect(page.locator('.board-cam')).toHaveAttribute('data-cam', 'idle', { timeout: 10_000 });
  await page.waitForTimeout(300);
  for (const x of await read()) expect(x.op).toBe(1);
  await ctx.close(); srv.stop();
});

test('피드백 6: 혼자 선 캐릭터 발이 칸 그림 공터 실측 중심(상자 41%)에 선다', async ({ browser }) => {
  test.setTimeout(120_000);
  const { srv, ctx, page } = await startGame(browser, test.info().project.name);
  // 자리마다 다른 칸에 혼자 세운다. 발 자리만 잰다 → 움직임 줄이기로 줌 없이(앵커는 같다)
  await page.emulateMedia({ reducedMotion: 'reduce' });
  srv.do((g) => { g.players[0].pos = 3; g.players[1].pos = 12; g.players[2].pos = 18; g.players[3].pos = 27; });
  await expect(page.locator('.bc[data-seat="3"]')).toHaveAttribute('data-tile', '27', { timeout: 10_000 });
  await expect(page.locator('.board-root')).toHaveAttribute('data-hopping', '0', { timeout: 10_000 });
  await expect(page.locator('.board-cam')).toHaveAttribute('data-cam', 'idle');
  await page.waitForTimeout(300);
  await shot(page, 'anchor');
  await page.screenshot({ path: `${SHOTS}${LABEL}-anchor-crop-${test.info().project.name}.png`, clip: await clipOf(page, [2, 3, 4]) });
  const { k } = await stageOf(page);
  for (const [seat, tile] of [[0, 3], [1, 12], [2, 18], [3, 27]] as const) {
    const m = await page.evaluate(([seat, tile]) => {
      const t = document.querySelector<HTMLElement>(`.tile[data-tile="${tile}"]`)!.getBoundingClientRect();
      const c = document.querySelector<HTMLElement>(`.bc[data-seat="${seat}"]`)!;
      const s = c.querySelector('.bc-sprite')!.getBoundingClientRect();
      return { tileY: t.y, tileX: t.x, tileW: t.width, foot: s.y + s.height, cx: s.x + s.width / 2, onTile: c.dataset.tile };
    }, [seat, tile]);
    expect(m.onTile).toBe(String(tile));
    const want = m.tileY + CLEAR_Y * BOX * k;
    expect(Math.abs(m.foot - want) / k, `칸 ${tile} 발 ↔ 공터 중심(스테이지 px)`).toBeLessThanOrEqual(2);
    expect(Math.abs(m.cx - (m.tileX + m.tileW / 2)) / k).toBeLessThanOrEqual(2);
  }
  await ctx.close(); srv.stop();
});

test('피드백 7: 좌우 열 세로 다리 10개가 윗칸 절벽과 아랫칸 윗면 양쪽에 6px 이상 걸친다(화면 배율 그대로)', async ({ browser }) => {
  test.setTimeout(120_000);
  const { srv, ctx, page } = await startGame(browser, test.info().project.name);
  await shot(page, 'bridges');
  await page.screenshot({ path: `${SHOTS}${LABEL}-bridges-left-${test.info().project.name}.png`, clip: await clipOf(page, [25, 26, 27]) });
  await page.screenshot({ path: `${SHOTS}${LABEL}-bridges-right-${test.info().project.name}.png`, clip: await clipOf(page, [12, 13, 14]) });
  const { k } = await stageOf(page);
  const v = await page.evaluate(() => [...document.querySelectorAll<SVGGElement>('.board-bridges .br')].map((el) => {
    const [from, to] = el.dataset.bridge!.split('-').map(Number);
    const r = el.getBoundingClientRect();
    const tb = (i: number) => document.querySelector<HTMLElement>(`.tile[data-tile="${i}"]`)!.getBoundingClientRect();
    return { from, to, dir: el.dataset.dir, top: r.y, bottom: r.y + r.height, a: tb(from).y, b: tb(to).y };
  }));
  expect(v).toHaveLength(30);
  const vert = v.filter((x) => x.dir === 'v').sort((a, b) => a.from - b.from); // U5: 다리는 층(z)마다 SVG 가 나뉘어 DOM 순서가 칸 순서가 아니다
  expect(vert.map((x) => x.from)).toEqual([10, 11, 12, 13, 14, 25, 26, 27, 28, 29]);
  for (const x of vert) {
    const [up, down] = x.a < x.b ? [x.a, x.b] : [x.b, x.a];
    expect((up + BODY_END * BOX * k - x.top) / k, `다리 ${x.from}-${x.to} 위 끝이 윗칸 절벽에 걸침`).toBeGreaterThanOrEqual(6);
    expect((x.bottom - (down + TOP_BACK * BOX * k)) / k, `다리 ${x.from}-${x.to} 아래 끝이 아랫칸 윗면에 걸침`).toBeGreaterThanOrEqual(6);
  }
  await ctx.close(); srv.stop();
});

// U5-layout 회귀(orchestrator 리뷰: board.png 에서 칸 8·9·10 이 안 그려짐). 진짜 방 흐름으로 판을 연 뒤 30칸 그림이 전부 받아지고(naturalWidth > 0)
// 보이고 스테이지 안이고 실제로 칠해졌는지(윗면 가운데 마젠타 < 3%) — 1366×768 · 1024×768
for (const [w, h] of [[1366, 768], [1024, 768]] as const) {
  test(`U5-layout: 진짜 방에서 판을 열면 30칸 그림이 전부 칠해진다 ${w}×${h}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const srv = new Srv(B.RoomCtor, nextCode('TWU5'));
    const ctx = await browser.newContext({ baseURL: B.base, viewport: { width: w, height: h } });
    await ctx.routeWebSocket(/\/api\/rooms\/[A-Z0-9]{6}\/ws$/, (route) => srv.attach(route, 'a'));
    const page = await ctx.newPage();
    await page.goto('/');
    await joinCode(page, srv.code);
    await page.locator('.pick[data-char="1"]').click();
    await page.locator('[data-act="start"]').click();
    await expect(page.locator('.board-root')).toHaveAttribute('data-art', '1', { timeout: 15_000 });
    await expect(page.locator('.board-loading')).toHaveCount(0);
    // 판이 열린 첫 화면에서 곧바로(디코드 기다림 없이) 잰다 — 판 그림은 디코드까지 받은 뒤에 열린다(preload decode · decoding=sync)
    const r = await paintedTiles(page);
    await page.screenshot({ path: `${SHOTS}${LABEL}-painted-${w}x${h}-${test.info().project.name}.png` });
    expect(r).toHaveLength(30);
    expect(r.filter((x) => !(x.done && x.nw > 0 && x.vis && x.inside && x.magenta < 0.03)).map((x) => `칸 ${x.t}: ${JSON.stringify(x)}`)).toEqual([]);
    await ctx.close(); srv.stop();
  });
}
