// U10 S13(PRD §6) 표시 시간 실측 + 보드에서 칸 고르기(DESIGN §18). 사람 1(자리 1) + 봇 3, 빌드 번들 + 이 프로세스 안의 진짜 worker/room.ts,
// 실제 시간 1배. 화면 오버레이를 50ms 마다 기록한다(reports/U10-타이밍-실측.md 방법 그대로).
// 스크린숏: harness/state/traveling-world/reports/U10-pick-shots/<무엇>-<프로젝트>.png (7장 × desktop·tablet-touch + reduced)
import { expect, test, type Browser, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { joinCode } from './helpers/entry';
import { mkdirp, nextCode, setup, Srv, type Built } from './helpers/room-server';
import type { Seat, Step } from '../src/shared/types';

const SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/U10-pick-shots/', import.meta.url));

let B: Built;
test.beforeAll(async () => { test.setTimeout(180_000); B = await setup('u10timing'); mkdirp(SHOTS); });
test.afterAll(async () => { await B?.close(); });

const isTablet = () => test.info().project.name === 'tablet-touch';

async function startGame(browser: Browser, o: { reduced?: boolean } = {}) {
  const srv = new Srv(B.RoomCtor, nextCode('TWUT'));
  const tablet = isTablet();
  const ctx = await browser.newContext({
    baseURL: B.base, viewport: tablet ? { width: 1180, height: 820 } : { width: 1366, height: 768 }, hasTouch: tablet, isMobile: tablet,
    reducedMotion: o.reduced ? 'reduce' : 'no-preference',
  });
  await ctx.routeWebSocket(/\/api\/rooms\/[A-Z0-9]{6}\/ws$/, (route) => srv.attach(route, 'a'));
  const page = await ctx.newPage();
  await page.goto('/');
  await joinCode(page, srv.code);
  await page.locator('.pick[data-char="1"]').click();
  await page.locator('[data-act="start"]').click();
  await expect(page.locator('.board-root')).toHaveAttribute('data-art', '1', { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  const close = async () => { srv.stop(); await ctx.close(); };
  return { srv, ctx, page, close };
}

/** 그 자리의 그 단계로 바로(서버 상태). 세계여행은 travelPending 도 켠다 */
function toStep(srv: Srv, seat: Seat, step: Step) {
  srv.do((g) => {
    g.turn = { ...g.turn, seat, step, tile: null, correct: null, discount: false, rolledDouble: false, extraRoll: false, question: null, tf: null,
      missionId: null, missionSuccess: false, rewardOptions: [], takeoverCost: 0, preview: null };
    if (step === 'travel') g.players[seat].travelPending = true;
  });
}

const shot = (page: Page, what: string) => page.screenshot({ path: `${SHOTS}${what}-${test.info().project.name}.png` });
const press = (page: Page, sel: string) => (isTablet() ? page.locator(sel).tap() : page.locator(sel).click());
/** 스테이지 px → 화면 px */
const stageOf = (page: Page) => page.locator('.board-stage').evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { k: r.width / 1366, x: r.x, y: r.y };
});
async function pressStage(page: Page, x: number, y: number) {
  const s = await stageOf(page);
  const px = s.x + x * s.k, py = s.y + y * s.k;
  if (isTablet()) await page.touchscreen.tap(px, py); else await page.mouse.click(px, py);
}
const sentActs = (srv: Srv, type: string) => srv.got.filter((x) => x.tag === 'a' && x.msg.includes(`"type":"${type}"`)).length;
const sentPreviews = (srv: Srv) => srv.sent('a', /"t":"pickPreview"/);

/** 50ms 기록기: 화면에서 읽을 값을 함수 문자열로 넣고, 나중에 [t, ...값] 을 돌려받는다 */
async function startProbe(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __probe: unknown[][]; __probeH: number };
    const q = <T extends Element>(s: string) => document.querySelector<T>(s);
    w.__probe = [];
    w.__probeH = window.setInterval(() => {
      const count = q<HTMLElement>('.ex .ov-count');
      w.__probe.push([
        performance.now(),
        !!q('.evc'), !!q('.ap--notice'), !!q('.cc'), !!q('.qs'), !!q('.ex'), !!q('.ex-tf.is-result'),
        count ? Number(count.dataset.ms) : null, !!q('.ov-count-wait'),
        !!q('.dice-wrap.is-locked'),
        [...document.querySelectorAll<HTMLElement>('.bc')].map((b) => `${b.dataset.seat}:${b.dataset.tile}`).join(','),
        q<HTMLElement>('.game')?.dataset.step ?? '', q<HTMLElement>('.game')?.dataset.turn ?? '',
      ]);
    }, 50);
  });
}
type Row = { t: number; evc: boolean; toll: boolean; cc: boolean; qs: boolean; ex: boolean; tfRes: boolean; countMs: number | null; wait: boolean; locked: boolean; pos: Record<string, string>; step: string; turn: string };
async function stopProbe(page: Page): Promise<Row[]> {
  const raw = await page.evaluate(() => { const w = window as unknown as { __probe: unknown[][]; __probeH: number }; clearInterval(w.__probeH); return w.__probe; });
  return (raw as [number, boolean, boolean, boolean, boolean, boolean, boolean, number | null, boolean, boolean, string, string, string][]).map((r) => ({
    t: r[0], evc: r[1], toll: r[2], cc: r[3], qs: r[4], ex: r[5], tfRes: r[6], countMs: r[7], wait: r[8], locked: r[9],
    pos: Object.fromEntries(r[10].split(',').filter(Boolean).map((x) => x.split(':'))), step: r[11], turn: r[12],
  }));
}
/** 참인 구간들 [시작, 끝](ms) */
function runs(rows: Row[], f: (r: Row) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let s: number | null = null;
  rows.forEach((r, i) => {
    if (f(r) && s === null) s = r.t;
    if (!f(r) && s !== null) { out.push([s, rows[i - 1].t]); s = null; }
  });
  if (s !== null) out.push([s, rows[rows.length - 1].t]);
  return out;
}
const len = (r: [number, number]) => r[1] - r[0];

// ─────────────────────────── 보드에서 칸 고르기(DESIGN §18) ───────────────────────────

test('세계여행 고르기: 29칸 밝힘·25 옅음 → 선택(말풍선)·옮김·윗줄·왼쪽 열 클램프 → 확정 1회, 옅은 칸·광장 누름은 상태 변화 0', async ({ browser }) => {
  test.setTimeout(90_000);
  const { srv, page, close } = await startGame(browser);
  toStep(srv, 0, 'travel');
  await expect(page.locator('.pick-sign')).toBeVisible();
  await expect(page.locator('.pick-title')).toHaveText('세계여행');
  await expect(page.locator('.pick-note')).toHaveText('가고 싶은 나라 칸을 눌러요');
  await expect(page.locator('.tile[data-pick="lit"]')).toHaveCount(29);
  await expect(page.locator('.tile[data-tile="25"]')).toHaveAttribute('data-pick', 'dim');
  await expect(page.locator('.pick-hit')).toHaveCount(29);
  await expect(page.locator('.dice-wrap')).toHaveClass(/is-pick/);
  await expect(page.locator('.tp, .tp-tile')).toHaveCount(0); // 옛 목록 창 없음
  await page.waitForTimeout(300); // 들어올림 200ms
  await shot(page, 'lit-all');

  // 칸 누름 영역 = 칸 상자 124 × 배율
  const k = (await stageOf(page)).k;
  const hit = (await page.locator('.pick-hit[data-tile="3"]').boundingBox())!;
  expect(hit.width).toBeCloseTo(124 * k, 0);
  expect(hit.height).toBeCloseTo(124 * k, 0);

  // 옅은 칸(25)·광장을 눌러도 아무 일 없음
  const t25 = (await page.locator('.tile[data-tile="25"]').boundingBox())!;
  if (isTablet()) await page.touchscreen.tap(t25.x + t25.width / 2, t25.y + t25.height / 2); else await page.mouse.click(t25.x + t25.width / 2, t25.y + t25.height / 2);
  await pressStage(page, 683, 520);
  await expect(page.locator('.pick-bubble')).toHaveCount(0);
  expect(sentPreviews(srv)).toBe(0);

  // 선택(아랫줄 3 중국): 자리색 테 + 말풍선 + 서버 pickPreview 1회
  await press(page, '.pick-hit[data-tile="3"]');
  await expect(page.locator('.tile[data-tile="3"]')).toHaveAttribute('data-pick', 'sel');
  const bub = page.locator('.pick-bubble');
  await expect(bub).toBeVisible();
  await expect(bub.locator('.pick-bubble-name')).toHaveText('중국');
  await expect(bub.locator('.pick-go')).toHaveText('여기로 갈래요');
  await expect.poll(() => srv.g.turn.preview).toBe(3);
  expect(sentPreviews(srv)).toBe(1);
  const t3 = (await page.locator('.pick-hit[data-tile="3"]').boundingBox())!;
  const b3 = (await bub.boundingBox())!;
  expect(b3.y + b3.height).toBeLessThanOrEqual(t3.y + 1); // 칸 위
  if (isTablet()) { // 태블릿 0.75(1024×768): 칸 누름 영역 93×93 ≥ 44, 말풍선(= 확정 누름 영역) 135×60
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect.poll(async () => (await stageOf(page)).k).toBeCloseTo(0.75, 3);
    const h = (await page.locator('.pick-hit[data-tile="3"]').boundingBox())!;
    const bb = (await bub.boundingBox())!;
    expect([Math.round(h.width), Math.round(h.height)]).toEqual([93, 93]);
    expect([Math.round(bb.width), Math.round(bb.height)]).toEqual([135, 60]);
    await page.setViewportSize(vp);
    await expect.poll(async () => (await stageOf(page)).k).toBeCloseTo(vp.width / 1366, 3);
  }
  await page.waitForTimeout(250);
  await shot(page, 'select-bottom');

  // 옅은 칸·광장 누름 → 선택 유지
  if (isTablet()) await page.touchscreen.tap(t25.x + t25.width / 2, t25.y + t25.height / 2); else await page.mouse.click(t25.x + t25.width / 2, t25.y + t25.height / 2);
  await pressStage(page, 683, 520);
  await expect(page.locator('.tile[data-tile="3"]')).toHaveAttribute('data-pick', 'sel');
  expect(sentPreviews(srv)).toBe(1);

  // 윗줄(r0) 22 캐나다: 말풍선이 칸 아래, 꼬리 위로, 스테이지 밖 노출 0
  await press(page, '.pick-hit[data-tile="22"]');
  await expect(page.locator('.tile[data-tile="3"]')).toHaveAttribute('data-pick', 'lit');
  await expect(page.locator('.tile[data-tile="22"]')).toHaveAttribute('data-pick', 'sel');
  await expect(bub).toHaveClass(/is-below/);
  await expect.poll(() => srv.g.turn.preview).toBe(22);
  const t22 = (await page.locator('.pick-hit[data-tile="22"]').boundingBox())!;
  const b22 = (await bub.boundingBox())!;
  expect(b22.y).toBeGreaterThanOrEqual(t22.y + t22.height - 1);
  const st = await stageOf(page);
  expect(b22.y).toBeGreaterThanOrEqual(st.y);
  await page.waitForTimeout(250);
  await shot(page, 'select-top-row');

  // 왼쪽 열(c0) 28 · 오른쪽 열(c10) 12: x 8~1358 안으로 클램프, 꼬리는 칸 중심
  for (const [tile, name] of [[12, 'right-col'], [28, 'left-col']] as const) {
    await press(page, `.pick-hit[data-tile="${tile}"]`);
    await expect(page.locator(`.pick-bubble[data-tile="${tile}"]`)).toBeVisible();
    const b = (await page.locator('.pick-bubble').boundingBox())!;
    const s = await stageOf(page);
    expect((b.x - s.x) / s.k).toBeGreaterThanOrEqual(8 - 0.5);
    expect((b.x + b.width - s.x) / s.k).toBeLessThanOrEqual(1358 + 0.5);
    const tailX = await page.locator('.pick-bubble').evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--tail-x')));
    const tb = (await page.locator(`.pick-hit[data-tile="${tile}"]`).boundingBox())!;
    expect(Math.abs(b.x + tailX * s.k - (tb.x + tb.width / 2))).toBeLessThan(2);
    if (name === 'left-col') { await page.waitForTimeout(250); await shot(page, 'select-left-col'); }
  }
  expect(sentPreviews(srv)).toBe(4);

  // 확정: 말풍선 단추 → 같은 칸·단추 연타해도 서버 메시지 1회
  await press(page, '.pick-go');
  for (let i = 0; i < 3; i++) {
    await page.locator('.pick-hit[data-tile="28"], .pick-go').first().click({ force: true, timeout: 500 }).catch(() => {});
  }
  await expect.poll(() => srv.g.players[0].pos, { timeout: 5000 }).toBe(28);
  expect(sentActs(srv, 'travel')).toBe(1);
  await expect(page.locator('.pick-sign')).toHaveCount(0);
  await close();
});

test('키보드만으로 세계여행: Tab → 화살표 → Enter(선택·말풍선 단추로 초점) → Enter(확정), Esc = 선택 해제', async ({ browser }) => {
  test.skip(isTablet(), '키보드 시나리오는 데스크톱');
  test.setTimeout(60_000);
  const { srv, page, close } = await startGame(browser);
  toStep(srv, 0, 'travel');
  await expect(page.locator('.pick-title')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.pick-hit[data-tile="0"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.pick-hit[data-tile="2"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter'); // 선택
  await expect(page.locator('.pick-bubble[data-tile="2"]')).toBeVisible();
  await expect(page.locator('.pick-go')).toBeFocused();
  await page.keyboard.press('Escape'); // 해제 → 초점 칸으로
  await expect(page.locator('.pick-bubble')).toHaveCount(0);
  await expect(page.locator('.pick-hit[data-tile="2"]')).toBeFocused();
  await expect.poll(() => srv.g.turn.preview ?? null).toBe(null);
  // 세계여행 칸(25) 은 건너뛴다: 24 에서 → 26
  await page.keyboard.press('Enter');
  await expect(page.locator('.pick-go')).toBeFocused();
  await page.keyboard.press('Enter'); // 확정
  await expect.poll(() => srv.g.players[0].pos, { timeout: 5000 }).toBe(2);
  expect(sentActs(srv, 'travel')).toBe(1);
  await close();
});

test('관전 미리보기 · 봇 반짝 1.0초 뒤 이동(S13) · 축제 간판(단추) · 확정 뒤 연타 1회', async ({ browser }) => {
  test.setTimeout(90_000);
  const { srv, page, close } = await startGame(browser);
  // 봇(자리 2)이 세계여행 고르기: 관전 간판 · 서버 미리보기를 따라가는 자리색 테 · 누름 영역 없음
  toStep(srv, 1, 'travel');
  srv.do((g) => { g.turn.preview = 7; });
  await expect(page.locator('.pick-note')).toHaveText('로봇 2가 갈 곳을 고르고 있어요');
  await expect(page.locator('.tile[data-tile="7"]')).toHaveAttribute('data-pick', 'sel');
  await expect(page.locator('.pick-hit, .pick-bubble, .pick-skip')).toHaveCount(0);
  await page.waitForTimeout(250);
  await shot(page, 'spectator-preview');
  // 봇 반짝: 반짝 시작 → 말 이동 시작 사이를 화면에서 잰다
  await page.evaluate(() => {
    const w = window as unknown as { __flash: { at: number; tile: string } | null; __move: number | null };
    w.__flash = null; w.__move = null;
    const tok = () => document.querySelector<HTMLElement>('.bc[data-seat="1"]')?.dataset.tile;
    const from = tok();
    const h = setInterval(() => {
      const f = document.querySelector<HTMLElement>('.tile[data-pick="flash"]');
      if (f && !w.__flash) w.__flash = { at: performance.now(), tile: f.dataset.tile! };
      if (w.__flash && w.__move === null && tok() !== from) { w.__move = performance.now(); clearInterval(h); }
    }, 10);
  });
  await expect(page.locator('.tile[data-pick="flash"]')).toHaveCount(1, { timeout: 10_000 });
  await page.waitForTimeout(450); // 반짝 1→.3→1(500ms) 의 밝은 쪽
  await shot(page, 'bot-flash');
  const fl = await page.waitForFunction(() => { const w = window as unknown as { __flash: { at: number; tile: string } | null; __move: number | null }; return w.__move !== null ? { gap: w.__move - w.__flash!.at, tile: w.__flash!.tile } : null; }, null, { timeout: 10_000 }).then((h) => h.jsonValue());
  expect(Number(fl.tile)).toBe(srv.g.players[1].pos);
  if (!isTablet()) { expect(fl.gap).toBeGreaterThanOrEqual(800); expect(fl.gap).toBeLessThanOrEqual(1200); }
  test.info().annotations.push({ type: 'bot-flash-gap-ms', description: String(Math.round(fl.gap)) });

  // 축제(내 땅 2): 간판 300×150 + "이번엔 안 고를래요", 밝힘 2 · 옅음 28
  srv.do((g) => { g.tiles[1] = { owner: 0, level: 1, festivalTarget: false }; g.tiles[13] = { owner: 0, level: 0, festivalTarget: false }; });
  toStep(srv, 0, 'festival');
  await expect(page.locator('.pick-title')).toHaveText('세계 축제');
  await expect(page.locator('.pick-note')).toHaveText('통행료를 두 배로 받을 내 땅을 눌러요');
  await expect(page.locator('.tile[data-pick="lit"]')).toHaveCount(2);
  await expect(page.locator('.tile[data-pick="dim"]')).toHaveCount(28);
  await expect(page.locator('.pick-skip')).toHaveText('이번엔 안 고를래요');
  await page.waitForTimeout(300); // 간판 내려옴 200ms 가 끝난 뒤에 잰다
  const s = await stageOf(page);
  const sign = (await page.locator('.pick-sign').boundingBox())!;
  expect(Math.round((sign.x - s.x) / s.k)).toBe(533);
  expect(Math.round((sign.y - s.y) / s.k)).toBe(290);
  expect(Math.round(sign.width / s.k)).toBe(300);
  expect(Math.round(sign.height / s.k)).toBe(150);
  await press(page, '.pick-hit[data-tile="13"]');
  await expect(page.locator('.pick-go')).toHaveText('여기로 할래요');
  await page.waitForTimeout(250);
  await shot(page, 'festival-sign');
  // 같은 칸 다시 = 확정, 그 뒤 연타·건너뛰기 무시
  await press(page, '.pick-hit[data-tile="13"]');
  for (let i = 0; i < 3; i++) await page.locator('.pick-hit[data-tile="13"], .pick-skip').first().click({ force: true, timeout: 500 }).catch(() => {});
  await expect.poll(() => srv.g.tiles[13].festivalTarget, { timeout: 5000 }).toBe(true);
  expect(sentActs(srv, 'pickFestival')).toBe(1);
  await close();
});

test('움직임 줄임: 들어올림·말풍선·확정 scale 의 transform 애니메이션 0, 옅음·글로우는 그대로', async ({ browser }) => {
  test.skip(isTablet(), '데스크톱 한 번');
  test.setTimeout(60_000);
  const { srv, page, close } = await startGame(browser, { reduced: true });
  toStep(srv, 0, 'travel');
  await press(page, '.pick-hit[data-tile="3"]');
  await expect(page.locator('.pick-bubble')).toBeVisible();
  const st = await page.evaluate(() => ({
    anims: document.getAnimations().filter((a) => {
      const t = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null;
      return !!t?.closest('.tile, .own, .pick-bubble, .pick-sign');
    }).length,
    tf: getComputedStyle(document.querySelector('.tile[data-tile="3"]')!).transform,
    dim: getComputedStyle(document.querySelector('.tile[data-tile="25"]')!).opacity,
    glow: getComputedStyle(document.querySelector('.tile[data-tile="3"] .tile-pick')!).opacity,
  }));
  expect(st.anims).toBe(0);
  expect(st.tf).toBe('none');
  expect(st.dim).toBe('0.45');
  expect(st.glow).toBe('1');
  await shot(page, 'reduced-select');
  await close();
});

test('고르기 고침 1: 축제 "이번엔 안 고를래요" 연타 → 서버 메시지 1회, 그 뒤 칸·단추 잠금', async ({ browser }) => {
  test.setTimeout(60_000);
  const { srv, page, close } = await startGame(browser);
  srv.do((g) => { g.tiles[1] = { owner: 0, level: 1, festivalTarget: false }; g.tiles[13] = { owner: 0, level: 0, festivalTarget: false }; });
  srv.held = []; // 서버가 처리하지 않게 붙잡아 두고(단계가 그대로) 화면 잠금만 본다
  toStep(srv, 0, 'festival');
  await expect(page.locator('.pick-skip')).toBeVisible();
  await press(page, '.pick-skip');
  for (let i = 0; i < 3; i++) await page.locator('.pick-skip').click({ force: true, timeout: 500 }).catch(() => {});
  await page.locator('.pick-hit[data-tile="13"]').click({ force: true, timeout: 500 }).catch(() => {});
  await expect(page.locator('.pick-skip')).toBeDisabled();
  await expect(page.locator('.pick-hit[data-tile="13"]')).toBeDisabled();
  expect(srv.held!.filter((x) => x.msg.includes('"type":"pickFestival"'))).toHaveLength(1);
  expect(srv.held!.filter((x) => x.msg.includes('"tile":null'))).toHaveLength(1);
  srv.release();
  await expect.poll(() => srv.g.turn.step).not.toBe('festival');
  await close();
});

test('고르기 고침 3·6: 확정하면 말풍선 100ms 로 사라지고 테는 자리색, 서버가 안 받으면 ROLL_GIVE_UP_MS 뒤 다시 고를 수 있다', async ({ browser }) => {
  test.skip(isTablet(), '데스크톱 한 번');
  test.setTimeout(60_000);
  const { srv, page, close } = await startGame(browser);
  toStep(srv, 0, 'travel');
  await press(page, '.pick-hit[data-tile="3"]');
  await expect.poll(() => srv.g.turn.preview).toBe(3);
  srv.held = []; // 확정 메시지가 서버에 닿지 않음(유실)
  await press(page, '.pick-go');
  await expect(page.locator('.pick-bubble')).toHaveClass(/is-gone/);
  await expect(page.locator('.pick-bubble')).toHaveCSS('opacity', '0');
  await expect(page.locator('.tile[data-tile="3"]')).toHaveAttribute('data-pick', 'confirm');
  expect(await page.locator('.tile[data-tile="3"]').evaluate((el) => el.style.getPropertyValue('--ring'))).toBe('var(--seat-1)');
  await expect(page.locator('.pick-hit[data-tile="3"]')).toBeDisabled();
  // 4초(ROLL_GIVE_UP_MS) 뒤 풀림 → 다시 확정하면 이번엔 서버가 받는다
  srv.held = null;
  await expect(page.locator('.pick-hit[data-tile="3"]')).toBeEnabled({ timeout: 6000 });
  await expect(page.locator('.pick-bubble')).not.toHaveClass(/is-gone/);
  await press(page, '.pick-go');
  await expect.poll(() => srv.g.players[0].pos, { timeout: 5000 }).toBe(3);
  expect(sentActs(srv, 'travel')).toBe(2); // 유실 1 + 다시 1
  await close();
});

test('고르기 고침 4·5: 고르는 중 새로고침 → 서버 선택 표시(preview)로 다시 보임, 초점이 body 여도 Esc = 선택 해제', async ({ browser }) => {
  test.skip(isTablet(), '데스크톱 한 번');
  test.setTimeout(60_000);
  const { srv, page, close } = await startGame(browser);
  toStep(srv, 0, 'travel');
  await press(page, '.pick-hit[data-tile="12"]');
  await expect.poll(() => srv.g.turn.preview).toBe(12);
  await page.reload();
  await expect(page.locator('.pick-sign')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.tile[data-tile="12"]')).toHaveAttribute('data-pick', 'sel');
  await expect(page.locator('.pick-bubble[data-tile="12"]')).toBeVisible();
  // 마우스로 다른 칸을 고른 뒤 초점을 body 로 → Esc
  await page.locator('.pick-hit[data-tile="3"]').click();
  await expect.poll(() => srv.g.turn.preview).toBe(3);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(page.locator('.pick-bubble')).toHaveCount(0);
  await expect.poll(() => srv.g.turn.preview ?? null).toBe(null);
  await close();
});

test('고르기 고침 2: 미션 관전 참/거짓 — 결과 2초 동안 정답 테 + 맞힌 사람 칩, 결과 동안 눌러도 안 보냄', async ({ browser }) => {
  test.skip(isTablet(), '실제 시간 실측은 데스크톱');
  test.setTimeout(90_000);
  const { srv, page, close } = await startGame(browser);
  srv.arrive(1, 6, 2, 4); // 봇(자리 2) → 미션 칸
  const tf = page.locator('.mp .tf-btn--t:not([disabled])');
  await expect(tf).toBeVisible({ timeout: 40_000 });
  await tf.click();
  const res = page.locator('.mp .tf.is-result');
  await expect(res).toBeVisible({ timeout: 10_000 });
  expect(srv.g.turn.step).toBe('tfResult');
  await expect(res.locator('.ex-tf-chip')).toHaveCount(3);
  const ans = srv.g.turn.tf!.answer!;
  await expect(res.locator(`.tf-btn[data-tf="${ans}"]`)).toHaveClass(/is-answer/);
  await expect(res.locator(`.tf-btn[data-tf="${!ans}"]`)).toHaveClass(/is-off/);
  await expect(res.locator('.tf-btn:not([disabled])')).toHaveCount(0);
  expect(sentActs(srv, 'tfAnswer')).toBe(1);
  await close();
});

// ─────────────────────────── S13 표시 시간(실제 시간 1배) ───────────────────────────

test('S13 주사위 5초 누름: 2.9초에 저절로 쏟기, 게이지 = 그 순간(≈83%), 뗀 뒤 입력 무시', async ({ browser }) => {
  test.skip(isTablet(), '데스크톱 한 번');
  test.setTimeout(60_000);
  const { srv, page, close } = await startGame(browser);
  toStep(srv, 0, 'roll');
  await expect(page.locator('.dice.is-ready')).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { __press: number | null; __tilt: number | null; __gauge: string | null };
    w.__press = null; w.__tilt = null; w.__gauge = null;
    document.querySelector('.dice-btn')!.addEventListener('pointerdown', () => { w.__press = performance.now(); }, { capture: true });
    const d = document.querySelector<HTMLElement>('.dice')!;
    new MutationObserver(() => { if (w.__tilt === null && d.dataset.phase === 'tilt') { w.__tilt = performance.now(); w.__gauge = d.dataset.gauge ?? null; } }).observe(d, { attributes: true, attributeFilter: ['data-phase'] });
  });
  const b = (await page.locator('.dice-btn').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(5000);
  await page.mouse.up();
  const r = await page.evaluate(() => { const w = window as unknown as { __press: number; __tilt: number; __gauge: string | null }; return { gap: w.__tilt - w.__press, gauge: Number(w.__gauge) }; });
  const gauge = r.gauge;
  test.info().annotations.push({ type: 'press-to-pour-ms', description: String(Math.round(r.gap)) });
  expect(r.gap).toBeGreaterThanOrEqual(2900 - 50);
  expect(r.gap).toBeLessThanOrEqual(2900 + 50);
  expect(gauge).toBeCloseTo(0.833, 1); // 쏟기 시작 때 게이지 = 2.9초 시점
  expect(sentActs(srv, 'roll')).toBe(1);
  await close();
});

test('S13 알림 카드: 봇이 세계여행 칸에 도착 → 알림이 숨지 않고 3.2초를 채우고 다음 사람 이동 전에 끝남, 그동안 내 컵 잠금', async ({ browser }) => {
  test.skip(isTablet(), '실제 시간 실측은 데스크톱');
  test.setTimeout(60_000);
  const { srv, page, close } = await startGame(browser);
  await startProbe(page);
  srv.arrive(1, 25, 2, 3);
  await expect.poll(() => srv.g.turn.seat, { timeout: 15_000 }).toBe(2);
  // 다음 사람(자리 3)이 움직일 때까지 기록
  const from2 = String(srv.g.players[2].pos);
  await expect.poll(async () => page.locator('.bc[data-seat="2"]').getAttribute('data-tile'), { timeout: 20_000 }).not.toBe(from2);
  await page.waitForTimeout(500);
  const rows = await stopProbe(page);
  const ev = runs(rows, (r) => r.evc);
  const move2 = rows.find((r) => r.pos['2'] !== undefined && r.pos['2'] !== from2)!.t;
  test.info().annotations.push({ type: 'notice-runs-ms', description: ev.map((x) => `${Math.round(x[0] - rows[0].t)}+${Math.round(len(x))}`).join(' ') });
  expect(ev).toHaveLength(1); // 도중에 숨었다 다시 뜨는 일 0
  expect(len(ev[0])).toBeGreaterThanOrEqual(3200 - 150);
  expect(ev[0][1]).toBeLessThan(move2); // 다음 사람 이동 뒤에 뜨거나 남지 않음
  for (const r of rows) if (r.evc) expect(r.locked).toBe(true); // 알림 중 내 컵 disabled + .6
  await close();
});

test('S13 봇 도착 흐름(관전자 화면): 문화 카드 첫 방문 ≥ 4.5초 · 봇 문항 ≥ 4.5초 · 해설 막대 줄기만(늘어나는 프레임 0, 잠깐만요) · 참/거짓 결과 2.0 ± 0.3초', async ({ browser }) => {
  test.skip(isTablet(), '실제 시간 실측은 데스크톱');
  test.setTimeout(120_000);
  const { srv, page, close } = await startGame(browser);
  await startProbe(page);
  srv.arrive(1, 2, 1, 1); // 봇(자리 2) → 타이(처음 와 본 나라)
  // 해설이 뜨면 화면을 세로로 돌려 '본 시간'을 늦춘다 → 서버가 shown 을 기다리며 마감을 늘림(옛 막대 재충전 상황)
  await expect(page.locator('.ex')).toBeVisible({ timeout: 40_000 });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(4000);
  await page.setViewportSize({ width: 1366, height: 768 });
  // 참/거짓: 내가 답하고 봇 둘이 답하면 결과 2초
  const tfBtn = page.locator('.ex-tf-btn[data-tf="true"]:not([disabled])');
  await expect(tfBtn).toBeVisible({ timeout: 20_000 });
  await tfBtn.click();
  await expect(page.locator('.ex-tf.is-result')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.ex-tf-chip')).toHaveCount(3);
  await expect(page.locator('.ex-tf.is-result')).toHaveCount(0, { timeout: 5000 });
  await page.waitForTimeout(300);
  const rows = await stopProbe(page);
  const t0 = rows[0].t;
  const cc = runs(rows, (r) => r.cc), qs = runs(rows, (r) => r.qs), res = runs(rows, (r) => r.tfRes);
  test.info().annotations.push({ type: 'culture-qs-tfres-ms', description: JSON.stringify({ cc: cc.map(len), qs: qs.map(len), res: res.map(len), at: res.map((x) => x[0] - t0) }) });
  expect(cc).toHaveLength(1);
  expect(len(cc[0])).toBeGreaterThanOrEqual(4500);
  expect(qs).toHaveLength(1);
  expect(len(qs[0])).toBeGreaterThanOrEqual(4500);
  expect(res).toHaveLength(1);
  expect(len(res[0])).toBeGreaterThanOrEqual(1700);
  expect(len(res[0])).toBeLessThanOrEqual(2300);
  // 해설 막대: 늘어나는 프레임 0, 0 에 멈춘 동안 '잠깐만요'
  const counts = rows.filter((r) => r.countMs !== null);
  let up = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i].countMs! > counts[i - 1].countMs! + 1 && counts[i].t - counts[i - 1].t < 200) up++;
  expect(up).toBe(0);
  if (process.env.U10_DUMP) writeFileSync(process.env.U10_DUMP, JSON.stringify({ holds: [...srv.holds], rows: rows.filter((r) => r.ex).map((r) => [Math.round(r.t - t0), r.countMs, r.wait, r.step]) }));
  test.info().annotations.push({ type: 'explain-wait', description: `잠깐만요 frames ${rows.filter((r) => r.wait).length}, holds ${srv.holds.size}` });
  // 서버가 shown 을 1.5초 넘게 기다렸으면(마감 연장) 그동안 막대는 0 + '잠깐만요'
  if ([...srv.holds.values()].some((h) => (h.end ?? Infinity) - h.start >= 1500)) expect(rows.some((r) => r.wait)).toBe(true);
  await close();
});

test('S13 문화 카드 다시 온 나라 ≥ 2.7초(관전자 화면)', async ({ browser }) => {
  test.skip(isTablet(), '실제 시간 실측은 데스크톱');
  test.setTimeout(60_000);
  const { srv, page, close } = await startGame(browser);
  srv.do((g) => { g.seenCountries.push('th'); });
  await startProbe(page);
  srv.arrive(1, 2, 1, 1);
  await expect(page.locator('.qs')).toBeVisible({ timeout: 20_000 });
  const rows = await stopProbe(page);
  const cc = runs(rows, (r) => r.cc);
  test.info().annotations.push({ type: 'culture-revisit-ms', description: cc.map(len).join(',') });
  expect(cc).toHaveLength(1);
  expect(len(cc[0])).toBeGreaterThanOrEqual(2700);
  await close();
});

test('S13 턴 길이 중앙값 보고(봇 4, 실제 시간 200초)', async ({ browser }) => {
  test.skip(isTablet(), '데스크톱 한 번');
  test.setTimeout(300_000);
  const { srv, close } = await startGame(browser);
  srv.do((g) => { g.seats[0].isBot = true; });
  const starts: { seat: number; at: number }[] = [];
  let last = -1;
  const t0 = Date.now();
  while (Date.now() - t0 < 200_000) {
    const s = srv.g.turn.seat;
    if (s !== last) { starts.push({ seat: s, at: Date.now() }); last = s; }
    await new Promise((r) => setTimeout(r, 50));
  }
  const d = starts.slice(1).map((x, i) => x.at - starts[i].at).slice(1).sort((a, b) => a - b); // 첫 턴(시작 직후) 빼고
  const med = d.length ? d[Math.floor(d.length / 2)] : NaN;
  const out = { turns: d.length, medianMs: med, minMs: d[0], maxMs: d[d.length - 1], all: d };
  writeFileSync(`${SHOTS}turn-median.json`, `${JSON.stringify(out, null, 2)}\n`);
  test.info().annotations.push({ type: 'turn-median-ms', description: `${med} (n=${d.length})` });
  expect(d.length).toBeGreaterThanOrEqual(3);
  await close();
});
