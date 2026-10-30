// T12 성능(PRD §6 S7, §11). CDP: CPU 4배 스로틀 + 10 Mbps 네트워크 에뮬, Performance 도메인으로 JS 힙.
// 프레임: 헤드리스 rAF 간격은 16.7 ms 에 묶여 나와(실측) 그것만으로는 거의 의미가 없다. 그래서 구간마다
//  ① Performance 도메인 TaskDuration 증가분 ÷ 프레임 수 = 프레임당 메인 스레드 일(ms)
//  ② Long Animation Frames API(50 ms 넘은 프레임 = LoAF 항목)
// 를 함께 재고, 50 ms 초과 비율은 rAF 와 LoAF 중 큰 쪽으로 판정한다. 6배 스로틀 한 바퀴는 여유를 보려고 기록만 한다.
// 서버는 full-lesson 과 같은 진짜 Room(시계 주입).
// 수치는 예산 판정 전에 harness/state/traveling-world/reports/perf-<날짜>.json 에 먼저 쓴다(실패해도 숫자가 남게).
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { clock, nextCode, ROOT, setup, Srv, type Built } from './helpers/room-server';
import { joinCode } from './helpers/entry';

const BUDGET = { idleP95Ms: 33, idleOver50Ratio: 0.01, moveFps: 30, cutsceneFps: 30, heapMB: 150, firstLoadMB: 3, ttiMs: 5000 };
const CPU = 4;
const NET = { offline: false, latency: 20, downloadThroughput: (10 * 1e6) / 8, uploadThroughput: (10 * 1e6) / 8 }; // 10 Mbps
const ONLY = 'desktop-solo'; // playwright.config: 다른 spec 과 겹치지 않게 혼자 도는 프로젝트

let B: Built;
// 예산 미달은 다시 돌려 덮으면 안 된다: 재시도 0
test.describe.configure({ mode: 'serial', retries: 0 });
test.use({ trace: 'off' }); // 기록 오버헤드가 프레임을 흔든다
test.beforeAll(async () => { if (test.info().project.name !== ONLY) return; test.setTimeout(180_000); B = await setup('perf'); });
test.afterAll(async () => { await B?.close(); });

/** 페이지 안 rAF 간격 기록. until 이 참인 동안만 센다(조건 없으면 ms 동안) */
async function frames(page: Page, opt: { ms?: number; while?: string; maxMs?: number }) {
  return page.evaluate(({ ms, cond, maxMs }) => new Promise<number[]>((done) => {
    const dts: number[] = [];
    const t0 = performance.now();
    let prev = 0;
    const on = () => (cond ? !!document.querySelector(cond) : true);
    const loop = (t: number) => {
      const el = t - t0;
      if ((ms && el >= ms) || (maxMs && el >= maxMs) || (cond && prev && !on())) return done(dts);
      if (on()) { if (prev) dts.push(t - prev); prev = t; } else prev = 0;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }), { ms: opt.ms ?? 0, cond: opt.while ?? '', maxMs: opt.maxMs ?? 0 });
}

const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const r1 = (x: number) => Math.round(x * 10) / 10;
function stat(dts: number[]) {
  const total = dts.reduce((a, b) => a + b, 0);
  return { frames: dts.length, durationMs: Math.round(total), fps: r1((dts.length * 1000) / total), p50Ms: r1(q(dts, 0.5)), p95Ms: r1(q(dts, 0.95)), maxMs: r1(Math.max(...dts)), over50Ratio: Math.round((dts.filter((d) => d > 50).length / dts.length) * 10000) / 10000 };
}
/** 한 구간: rAF 프레임 + 그동안의 TaskDuration·LoAF */
async function segment(page: Page, cdp: CDPSession, opt: Parameters<typeof frames>[1], start?: () => void) {
  const task0 = await metric(cdp, 'TaskDuration');
  const t0 = await page.evaluate(() => performance.now());
  const f = frames(page, opt);
  start?.();
  const dts = await f;
  const task = (await metric(cdp, 'TaskDuration')) - task0;
  const t1 = await page.evaluate(() => performance.now());
  // 구간과 겹치는 LoAF(시작이 구간 앞이어도): 메인 스레드 그리기가 없는 대기(합성 애니메이션만)에선 긴 프레임의 시작이 그 앞 작업(구간 시작 evaluate)으로 잡혀
  // 시작 ≥ t0 거르기에서 빠졌다(U8-impl 실측: 양성 대조 LoAF 0건 흔들림 — 기준 커밋 1/10, 주사위 B 5/13)
  const loaf = await page.evaluate(([a, b]) => (window as unknown as { __loaf: { s: number; d: number; b: number }[] }).__loaf.filter((x) => x.s + x.d >= a && x.s <= b), [t0, t1]);
  const st = stat(dts);
  const loafRatio = Math.round((loaf.length / Math.max(1, st.frames)) * 10000) / 10000;
  return {
    ...st,
    mainMsPerFrame: r1((task * 1000) / Math.max(1, st.frames)), mainThreadBusyRatio: Math.round((task * 1000 / Math.max(1, t1 - t0)) * 1000) / 1000,
    loaf: { count: loaf.length, maxMs: r1(Math.max(0, ...loaf.map((x) => x.d))), blockingMs: r1(loaf.reduce((a, x) => a + x.b, 0)) },
    over50RafRatio: st.over50Ratio, over50LoafRatio: loafRatio, over50Ratio: Math.max(st.over50Ratio, loafRatio),
  };
}
type Seg = Awaited<ReturnType<typeof segment>>;
const metric = async (cdp: CDPSession, name: string) => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === name)!.value;
const heapMB = async (cdp: CDPSession) => r1((await metric(cdp, 'JSHeapUsedSize')) / 1048576);
/** 스로틀이 실제로 걸렸는지: 같은 계산 시간. 한 번 데우고(JIT) 5번 중 가장 짧은 값 — 다른 spec 이 CPU 를 같이 쓰면
 *  한 번 잰 값이 15 ms → 36 ms 로 부풀어 비율이 2.1 까지 떨어졌다(T15 실측). 최솟값은 경합에 덜 흔들린다 */
const busy = (page: Page) => page.evaluate(() => {
  const once = () => { const t = performance.now(); let x = 0; for (let i = 0; i < 3e7; i++) x += i % 7; return [performance.now() - t, x][0]; };
  once();
  return Math.min(...Array.from({ length: 5 }, once));
});

test('S7 크롬북 예산: TTI·첫 로드 전송량(10 Mbps) / 보드 대기 60초 프레임 / 이동·컷씬 fps / JS 힙 (CPU 4배)', async ({ browser }) => {
  test.skip(test.info().project.name !== ONLY, '데스크톱에서만');
  test.setTimeout(240_000);
  clock.setRate(1);
  const srv = new Srv(B.RoomCtor, nextCode('TWPF'));
  const ctx = await browser.newContext({ baseURL: B.base, viewport: { width: 1366, height: 768 } });
  try {
    await ctx.routeWebSocket(/\/api\/rooms\/[A-Z0-9]{6}\/ws$/, (route) => srv.attach(route, 'p0'));
    // 긴 작업(>50ms) 기록: TTI 는 입력 칸이 쓸 수 있게 된 뒤 마지막 긴 작업이 끝난 시각까지
    await ctx.addInitScript(() => {
      const w = window as unknown as { __lt: { s: number; e: number }[] };
      w.__lt = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push({ s: e.startTime, e: e.startTime + e.duration }); }).observe({ type: 'longtask', buffered: true });
      const v = window as unknown as { __loaf: { s: number; d: number; b: number }[] };
      v.__loaf = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries() as (PerformanceEntry & { blockingDuration: number })[]) v.__loaf.push({ s: e.startTime, d: e.duration, b: e.blockingDuration }); }).observe({ type: 'long-animation-frame', buffered: true });
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', NET);
    const calm = await busy(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    const slow = await busy(page);
    let bytes = 0;
    cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });

    // ── 첫 로드: 첫 화면 '시작하기'를 누를 수 있을 때 → 1초 더 보며 긴 작업 끝 ──
    await page.goto('/', { waitUntil: 'commit' });
    await page.waitForFunction(() => { const el = document.querySelector<HTMLButtonElement>('[data-act="intro-start"]'); return !!el && !el.disabled && el.offsetParent !== null; }, null, { polling: 'raf', timeout: 30_000 });
    const ready = await page.evaluate(() => performance.now());
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    const lt = await page.evaluate(() => (window as unknown as { __lt: { s: number; e: number }[] }).__lt);
    const tti = Math.round(Math.max(ready, ...lt.filter((x) => x.s <= ready + 1000).map((x) => x.e)));
    const firstLoadBytes = bytes;

    // ── 방 → 시작(혼자 + 봇 3). 서버 시계를 멈춰 내 차례 주사위 단계에서 보드가 그대로 대기 ──
    await joinCode(page, srv.code);
    await page.locator('.pick[data-char="0"]').click();
    await expect(page.locator('.lb-slot.is-me')).toHaveCount(1);
    clock.setRate(0);
    await page.locator('[data-act="start"]').click();
    await expect(page.locator('.board-root')).toBeVisible();
    expect(srv.g.turn.seat).toBe(0);
    await page.waitForLoadState('networkidle');
    const gameStartBytes = bytes;
    await page.waitForTimeout(2000);
    const heap: number[] = [await heapMB(cdp)];
    const sampler = setInterval(() => { void heapMB(cdp).then((h) => heap.push(h)).catch(() => {}); }, 5000);

    // 양성 대조: 일부러 120 ms 짜리 프레임 하나를 만들면 rAF·LoAF 둘 다 잡아야 한다(측정기가 살아 있다)
    const control = await segment(page, cdp, { ms: 1500 }, () => { void page.evaluate(() => requestAnimationFrame(() => { const t = performance.now(); while (performance.now() - t < 120); })); });
    expect(control.loaf.count, 'LoAF 가 긴 프레임을 잡음').toBeGreaterThanOrEqual(1);
    expect(control.maxMs, 'rAF 가 긴 프레임을 잡음').toBeGreaterThan(100);
    // 보드 대기 60초
    const idle = await segment(page, cdp, { ms: 60_000 });
    expect(srv.g.turn.step).toBe('roll'); // 정말 대기였다(진행 0)
    // 이동: 9칸(4+5) — 보드가 칸을 건너는 동안(data-hopping=1)
    // 같은 이동을 한 번 먼저(기록만): 처음 보는 글자가 뜨면 웹 글꼴 조각(unicode-range)을 그때 받아 글자를 다시 배치한다.
    // 그 조각이 이동 중에 도착하면 80~270 ms 프레임 하나가 생긴다(T15 실측: 글꼴을 막으면 0/20, 아니면 5/22, 이동마다 조각 3~4개).
    // 이동 예산은 같은 장면이 두 번째일 때 잰다. 첫 이동은 moveCold 로 남긴다(판정 없음)
    const moveCold = await segment(page, cdp, { while: '.board-root[data-hopping="1"]', maxMs: 15_000 }, () => srv.arrive(0, 9, 4, 5));
    // 말을 출발 칸(0)으로 되돌린다(뒤로 홉). 같은 9칸 이동을 다시 재려고
    srv.do((g) => { g.players[0].pos = 0; });
    await page.waitForFunction(() => document.querySelector('.board-root')?.getAttribute('data-hopping') === '1', null, { timeout: 3000 }).catch(() => {}); // 순간 이동이면 홉 없음
    await page.waitForFunction(() => document.querySelector('.board-root')?.getAttribute('data-hopping') === '0', null, { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    // 이동 = 줌 카메라 1.8 이 걸린 채로 홉(R4 T-E, §16.6). 잰 구간에 줌이 실제로 걸렸는지 data-cam 변화를 기록한다
    await page.evaluate(() => {
      const w = window as unknown as { __camSeen: string[] };
      w.__camSeen = [];
      const el = document.querySelector('.board-cam')!;
      new MutationObserver(() => w.__camSeen.push(el.getAttribute('data-cam')!)).observe(el, { attributes: true, attributeFilter: ['data-cam'] });
    });
    const move = await segment(page, cdp, { while: '.board-root[data-hopping="1"]', maxMs: 15_000 }, () => srv.arrive(0, 9, 4, 5));
    const camSeen = await page.evaluate(() => (window as unknown as { __camSeen: string[] }).__camSeen);
    // 컷씬: 랜드마크 건설 로그 → 재생(4.8초). .cut 이 떠 있는 동안
    const cutscene = async () => {
      await page.waitForTimeout(1000);
      const on = page.locator('.cut').waitFor({ state: 'attached' });
      srv.do((g) => { g.log.push({ ev: 'build', seat: 0, tile: 16, level: 4, cost: 1 }); });
      await on;
      return segment(page, cdp, { while: '.cut', maxMs: 15_000 });
    };
    const cut = await cutscene();
    heap.push(await heapMB(cdp));

    // 6배 한 바퀴(기록만, 판정 없음): 대기 10초 · 이동 · 컷씬
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    const slow6 = await busy(page);
    await page.waitForTimeout(1000);
    const sweep6 = {
      busyLoopMs: r1(slow6), ratio: r1(slow6 / calm),
      idle10s: await segment(page, cdp, { ms: 10_000 }),
      move: await segment(page, cdp, { while: '.board-root[data-hopping="1"]', maxMs: 15_000 }, () => srv.arrive(0, 18, 4, 5)),
      cutscene: await cutscene(),
    };
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    clearInterval(sampler);
    heap.push(await heapMB(cdp));
    const head = (x: Seg, b: { p95?: number; fps?: number }) => ({ // 여유 = 예산 ÷ 측정(1 이상이면 안)
      over50: x.over50Ratio === 0 ? 'inf' : r1(BUDGET.idleOver50Ratio / x.over50Ratio), mainPerFrame: r1(33 / Math.max(0.1, x.mainMsPerFrame)),
      ...(b.p95 ? { p95: r1(b.p95 / x.p95Ms) } : {}), ...(b.fps ? { fps: r1(x.fps / b.fps) } : {}),
    });
    const headroom6x = { idle: head(sweep6.idle10s, { p95: BUDGET.idleP95Ms }), move: head(sweep6.move, { fps: BUDGET.moveFps }), cutscene: head(sweep6.cutscene, { fps: BUDGET.cutsceneFps }) };

    const out = {
      date: new Date().toISOString(),
      // 재현용: 지금 스로틀 값이 실제로 걸렸는지(busyLoop 비율)는 throttleCheck
      env: { cpuThrottle: CPU, network: { downMbps: 10, upMbps: 10, latencyMs: NET.latency, cache: 'disabled' }, viewport: '1366x768', browser: `chromium ${browser.version()}`, host: process.platform, note: '헤드리스 Chromium + CDP 스로틀. 실기기 크롬북은 사람 체크리스트' },
      budget: BUDGET,
      budgetNotes: {
        firstLoadMB: '입장 화면 첫 로드(goto → networkidle, 캐시 끔)의 전송량 = result.firstLoadBytes 에만 적용. result.gameStartBytes(방 입장·게임 시작 프리로드까지 누적)는 참고값',
        frames: 'over50Ratio = max(rAF 50 ms 초과 비율, LoAF 항목 수 ÷ 프레임 수). p95·fps 는 rAF 기준(헤드리스에서는 16.7 ms 에 묶임), mainMsPerFrame(TaskDuration ÷ 프레임)은 33 ms 이하를 대리 예산으로 판정',
        overall: '헤드리스 Chromium + CDP 스로틀. 실기기 크롬북은 사람 체크리스트',
      },
      throttleCheck: { busyLoopMs: r1(calm), busyLoopThrottledMs: r1(slow), ratio: r1(slow / calm) },
      result: {
        ttiMs: tti, readyMs: Math.round(ready), longTasks: lt.length,
        firstLoadBytes, firstLoadMB: r1(firstLoadBytes / 1048576), gameStartBytes,
        idle, move, moveCold, cutscene: cut, heapMB: { max: Math.max(...heap), samples: heap },
      },
      control: { note: '일부러 만든 120 ms 프레임 1개', maxMs: control.maxMs, loaf: control.loaf },
      sweep6x: { ...sweep6, headroom: headroom6x, note: '판정 없음(기록만)' },
      pass: {
        tti: tti <= BUDGET.ttiMs, firstLoad: firstLoadBytes <= BUDGET.firstLoadMB * 1048576,
        idleP95: idle.p95Ms <= BUDGET.idleP95Ms, idleOver50: idle.over50Ratio <= BUDGET.idleOver50Ratio,
        idleMain: idle.mainMsPerFrame <= BUDGET.idleP95Ms,
        move: move.fps >= BUDGET.moveFps, moveOver50: move.over50Ratio <= BUDGET.idleOver50Ratio, moveMain: move.mainMsPerFrame <= 1000 / BUDGET.moveFps,
        cutscene: cut.fps >= BUDGET.cutsceneFps, cutsceneOver50: cut.over50Ratio <= BUDGET.idleOver50Ratio, cutsceneMain: cut.mainMsPerFrame <= 1000 / BUDGET.cutsceneFps,
        heap: Math.max(...heap) <= BUDGET.heapMB,
      },
    };
    writeFileSync(`${ROOT}../harness/state/traveling-world/reports/perf-${new Date().toLocaleDateString('sv-SE')}.json`, `${JSON.stringify(out, null, 2)}\n`);
    console.log('[T12 perf]', JSON.stringify(out.result), JSON.stringify(out.pass));
    console.log('[T12 perf 6x]', JSON.stringify(out.sweep6x));

    expect(slow / calm).toBeGreaterThan(2.5); // CPU 스로틀이 실제로 걸렸다
    expect(idle.frames).toBeGreaterThan(1000); // 60초 동안 실제로 그렸다
    expect(move.frames).toBeGreaterThan(10);
    expect(camSeen, '이동 fps 를 잰 구간에 줌(in·follow)이 걸려 있었다').toEqual(expect.arrayContaining(['in', 'follow']));
    expect(cut.frames).toBeGreaterThan(30);
    expect(Object.entries(out.pass).filter(([, v]) => !v).map(([k]) => k), '예산 미달 항목').toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    clock.setRate(1);
    srv.stop();
    await ctx.close().catch(() => {});
  }
});
