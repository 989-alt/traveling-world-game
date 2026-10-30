// U9-hires 실측(판정 없음, 값만 기록): 1920×1080 × 장치 배율 1·2 에서 화면에 그려진 그림마다
// 배율비 = (WebP 원본 px) ÷ (화면에 그려진 장치 px). 1 미만 = 원본보다 크게 늘려 그림 → 흐림·깨짐.
// <img>(object-fit 반영) · CSS background/mask(크기 반영) · border-image(모서리·가운데 따로) 를 다 잰다. 캔버스(색종이·동전)는 제외.
// 장면: 실제 앱(인트로·팝업·로비·보드·줌 이동·컷씬) + 개발 하네스(줌 붙잡기·문항·문화·해설·미션·결과).
// 결과: harness/state/traveling-world/reports/U9-hires-shots/measure-<U9_TAG>.json + 장면 스크린숏·확대 조각. desktop 프로젝트에서만.
// 사용: U9_TAG=before npx playwright test --project=desktop e2e/u9-hires.spec.ts  (U9_TAG 없으면 건너뜀 — 평소 시험에 안 낀다)
import { test, type Browser, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { openJoin } from './helpers/entry';
import { clock, mkdirp, nextCode, setup, Srv, type Built } from './helpers/room-server';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/U9-hires-shots/', import.meta.url));
const TAG = process.env.U9_TAG ?? '';
const VP = { width: 1920, height: 1080 };

let DEV = '';
let server: ViteDevServer;
let B: Built;
test.describe.configure({ mode: 'default' });
test.skip(({ isMobile }) => isMobile || !TAG, 'U9_TAG 를 준 desktop 실행에서만');
test.setTimeout(600_000);
test.beforeAll(async () => {
  test.setTimeout(240_000);
  server = await createServer({
    root: ROOT, configFile: `${ROOT}vite.config.ts`, server: { port: 0 },
    cacheDir: `${ROOT}node_modules/.vite-u9-hires`,
    optimizeDeps: { entries: ['index.html', 'src/dev/board-harness.tsx', 'src/dev/overlay-harness.tsx', 'src/ui/results/harness.tsx'], include: ['preact', 'preact/hooks', 'preact/compat', 'preact/jsx-runtime'] },
    logLevel: 'error',
  });
  await server.listen();
  DEV = server.resolvedUrls!.local[0].replace(/\/$/, '');
  B = await setup('u9hires');
  mkdirp(SHOTS);
});
test.afterAll(async () => { await server?.close(); await B?.close(); });

const settle = async (page: Page, ms = 800) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(ms);
};

type Row = { file: string; kind: string; el: string; ratio: number; srcW: number; srcH: number; devW: number; devH: number };
/** 화면의 그림마다 배율비(원본 px ÷ 장치 px, 늘린 축 기준 최솟값). 같은 파일은 가장 나쁜 값 하나 */
async function measure(): Promise<Row[]> {
  const dpr = devicePixelRatio, W = innerWidth, H = innerHeight;
  const nat = new Map<string, Promise<[number, number]>>();
  const size = (u: string) => {
    if (!nat.has(u)) nat.set(u, new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res([0, 0]); i.src = u; }));
    return nat.get(u)!;
  };
  const shown = (e: Element) => {
    for (let p: Element | null = e; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    const r = e.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.right > 0 && r.bottom > 0 && r.left < W && r.top < H;
  };
  const tag = (e: Element) => `${e.tagName.toLowerCase()}${e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''}`;
  const urlOf = (v: string) => v.match(/url\("?([^")]+)"?\)/)?.[1];
  const short = (u: string) => decodeURIComponent(u.replace(/^.*?\/(webp\/)/, '$1').split('?')[0]);
  const rows: Row[] = [];
  const push = (file: string, kind: string, e: Element, nw: number, nh: number, dw: number, dh: number) => {
    if (!nw || !nh || dw < 1 || dh < 1) return;
    rows.push({ file: short(file), kind, el: tag(e), ratio: +Math.min(nw / dw, nh / dh).toFixed(3), srcW: nw, srcH: nh, devW: Math.round(dw), devH: Math.round(dh) });
  };
  /** 레이아웃 px → 장치 px (조상 transform 포함) */
  const kOf = (e: Element) => { const he = e as HTMLElement; const r = e.getBoundingClientRect(); return (he.offsetWidth ? r.width / he.offsetWidth : 1) * dpr; };
  /** 그림 크기 규칙(contain·cover·백분율·px·auto) → 레이아웃 px 의 그림 크기 */
  const fit = (sz: string, bw: number, bh: number, nw: number, nh: number): [number, number] => {
    const s = sz.split(',')[0].trim();
    if (s === 'contain') { const k = Math.min(bw / nw, bh / nh); return [nw * k, nh * k]; }
    if (s === 'cover') { const k = Math.max(bw / nw, bh / nh); return [nw * k, nh * k]; }
    const [a, b = 'auto'] = s.split(/\s+/);
    const one = (v: string, box: number) => (v === 'auto' ? NaN : v.endsWith('%') ? (parseFloat(v) / 100) * box : parseFloat(v));
    let w = one(a, bw), h = one(b, bh);
    if (isNaN(w) && isNaN(h)) { w = nw; h = nh; } else if (isNaN(w)) w = (h * nw) / nh; else if (isNaN(h)) h = (w * nh) / nw;
    return [w, h];
  };
  for (const e of document.querySelectorAll('*')) {
    if (!shown(e)) continue;
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    if (e instanceof HTMLImageElement && e.currentSrc && e.naturalWidth) {
      const nw = e.naturalWidth, nh = e.naturalHeight, rw = r.width * dpr, rh = r.height * dpr;
      const of = cs.objectFit;
      if (of === 'contain' || of === 'scale-down') { const k = Math.min(rw / nw, rh / nh); push(e.currentSrc, 'img', e, nw, nh, nw * k, nh * k); }
      else if (of === 'cover') { const k = Math.max(rw / nw, rh / nh); push(e.currentSrc, 'img', e, nw, nh, nw * k, nh * k); }
      else push(e.currentSrc, 'img', e, nw, nh, rw, rh);
    }
    const he = e as HTMLElement;
    const k = kOf(e);
    for (const [prop, sizeProp, kind] of [['backgroundImage', 'backgroundSize', 'bg'], ['maskImage', 'maskSize', 'mask'], ['webkitMaskImage', 'webkitMaskSize', 'mask']] as const) {
      const u = urlOf((cs as unknown as Record<string, string>)[prop] ?? '');
      if (!u || /^data:|#/.test(u)) continue;
      if (kind === 'mask' && prop === 'webkitMaskImage' && urlOf(cs.maskImage ?? '') === u) continue;
      const [nw, nh] = await size(u);
      if (!nw) continue;
      const [w, h] = fit((cs as unknown as Record<string, string>)[sizeProp] ?? 'auto', he.offsetWidth || r.width, he.offsetHeight || r.height, nw, nh);
      push(u, kind, e, nw, nh, w * k, h * k);
    }
    const bi = urlOf(cs.borderImageSource);
    if (bi) {
      const [nw, nh] = await size(bi);
      if (!nw) continue;
      const sl = cs.borderImageSlice.replace('fill', '').trim().split(/\s+/);
      const [st0, sr0 = st0, sb0 = st0, sL0 = sr0] = sl;
      const sv = (v: string, n: number) => (v.endsWith('%') ? (parseFloat(v) / 100) * n : parseFloat(v)); // 백분율 = 원본 크기 기준
      const st = sv(st0, nh), sr = sv(sr0, nw), sb = sv(sb0, nh), sL = sv(sL0, nw);
      const bwv = cs.borderImageWidth.split(/\s+/);
      const bw = (v: string, side: number, border: number) => (v.endsWith('px') ? parseFloat(v) : v.endsWith('%') ? (parseFloat(v) / 100) * side : v === 'auto' ? NaN : parseFloat(v) * border);
      const [wt0, wr0 = wt0, wb0 = wt0, wl0 = wr0] = bwv;
      const ow = he.offsetWidth, oh = he.offsetHeight;
      const ov = cs.borderImageOutset.split(/\s+/).map(parseFloat);
      const [ot, or = ot, ob = ot, ol = or] = ov;
      const wt = bw(wt0, oh, parseFloat(cs.borderTopWidth)), wr = bw(wr0, ow, parseFloat(cs.borderRightWidth));
      const wb = bw(wb0, oh, parseFloat(cs.borderBottomWidth)), wl = bw(wl0, ow, parseFloat(cs.borderLeftWidth));
      const boxW = ow + ol + or, boxH = oh + ot + ob;
      // 모서리 4: (그려진 폭 × 높이) ÷ (조각 폭 × 높이). 가운데: 남는 폭 ÷ 남는 원본 폭
      const corner = Math.min(sL / (wl * k), st / (wt * k), sr / (wr * k), sb / (wb * k));
      const midW = (nw - sL - sr) / ((boxW - wl - wr) * k), midH = (nh - st - sb) / ((boxH - wt - wb) * k);
      rows.push({ file: short(bi), kind: 'border-corner', el: tag(e), ratio: +corner.toFixed(3), srcW: nw, srcH: nh, devW: Math.round(boxW * k), devH: Math.round(boxH * k) });
      rows.push({ file: short(bi), kind: 'border-fill', el: tag(e), ratio: +Math.min(midW, midH).toFixed(3), srcW: nw, srcH: nh, devW: Math.round(boxW * k), devH: Math.round(boxH * k) });
    }
  }
  // 같은 파일·종류는 가장 나쁜 값 + 개수
  const best = new Map<string, Row & { n: number }>();
  for (const x of rows) {
    const key = `${x.file}|${x.kind}`;
    const cur = best.get(key);
    if (!cur) best.set(key, { ...x, n: 1 });
    else { cur.n++; if (x.ratio < cur.ratio) Object.assign(cur, x, { n: cur.n }); }
  }
  return [...best.values()].sort((a, b) => a.ratio - b.ratio);
}

type Out = { dpr: number; scene: string; scale: number; rows: Row[] };
const out: Out[] = [];
const zoomOf = (page: Page) => page.evaluate(() => {
  const w = document.querySelector('.board-world');
  const m = w ? getComputedStyle(w).transform : 'none';
  return m === 'none' ? 1 : Number(m.match(/matrix\(([^,]+)/)![1]);
});
async function rec(page: Page, dpr: number, scene: string, crops: [string, { x: number; y: number; width: number; height: number }][] = []) {
  const rows = await page.evaluate(measure);
  const scale = await page.evaluate(() => {
    const st = document.querySelector<HTMLElement>('.board-stage, .ov-stage, .rs-stage, .in-stage, .pp-stage');
    return st ? +(st.getBoundingClientRect().width / st.offsetWidth).toFixed(3) : 1;
  });
  out.push({ dpr, scene, scale: +(scale * (await zoomOf(page))).toFixed(3), rows });
  await page.screenshot({ path: `${SHOTS}${TAG}-${scene}-dpr${dpr}.jpg`, type: 'jpeg', quality: 80, scale: 'css' }); // 전체 장면은 참고용(CSS px). 화질 비교는 아래 조각(장치 px PNG)
  for (const [name, clip] of crops) await page.screenshot({ path: `${SHOTS}${TAG}-crop-${name}-dpr${dpr}.png`, clip });
}

type Z = { scene: (t: number, n: number, l: number) => Promise<void>; move: (s: number, p: number) => Promise<void>; demo: () => Promise<void> };
async function harness(browser: Browser, dpr: number, path: string, mod: string, wait: (p: Page) => Promise<unknown>, motion = false) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: dpr, reducedMotion: motion ? 'no-preference' : 'reduce' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  if (mod.includes('overlay')) await page.route(/\/src\/main\.tsx(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.goto(`${DEV}${path}`);
  await page.addScriptTag({ type: 'module', url: mod });
  await wait(page);
  await settle(page);
  return { ctx, page };
}

for (const dpr of [1, 2]) {
  test(`U9 실측 1920×1080 dpr${dpr}: 실제 앱(인트로·팝업·로비·보드·줌·컷씬)`, async ({ browser }) => {
    clock.setRate(1);
    const srv = new Srv(B.RoomCtor, nextCode(dpr === 1 ? 'TWHA' : 'TWHB'));
    const ctx = await browser.newContext({ baseURL: B.base, viewport: VP, deviceScaleFactor: dpr });
    await ctx.routeWebSocket(/\/api\/rooms\/[A-Z0-9]{6}\/ws$/, (route) => srv.attach(route, `p${dpr}`));
    const page = await ctx.newPage();
    page.setDefaultTimeout(30_000);
    try {
      await page.goto('/');
      await page.locator('[data-act="intro-start"]').waitFor();
      await settle(page, 1500);
      await rec(page, dpr, 'intro', [['intro-logo', { x: 560, y: 60, width: 800, height: 420 }]]);
      await openJoin(page);
      await settle(page);
      await rec(page, dpr, 'popup');
      await page.locator('#room-code').fill(srv.code);
      await page.locator('[data-act="join"]').click();
      await page.locator('.lb-slot').first().waitFor();
      await page.locator('.pick[data-char="0"]').click();
      await settle(page, 1200);
      await rec(page, dpr, 'lobby');
      clock.setRate(0);
      await page.locator('[data-act="start"]').click();
      await page.locator('.board-root').waitFor();
      await page.waitForLoadState('networkidle');
      await settle(page, 1500);
      await rec(page, dpr, 'board', [['board-plaza', { x: 760, y: 420, width: 400, height: 240 }], ['board-tile0', { x: 1650, y: 820, width: 270, height: 260 }]]);
      // 실제 줌 이동: 홉 중(follow) 1.8배일 때 잰다
      srv.arrive(0, 9, 4, 5);
      await page.waitForFunction(() => {
        const el = document.querySelector('.board-cam');
        const w = document.querySelector('.board-world');
        const m = w ? getComputedStyle(w).transform : 'none';
        return el?.getAttribute('data-cam') === 'follow' && m !== 'none' && Math.abs(Number(m.match(/matrix\(([^,]+)/)![1]) - 1.8) < 0.01;
      }, null, { timeout: 10_000, polling: 'raf' });
      await rec(page, dpr, 'board-zoom-live');
      await page.waitForFunction(() => document.querySelector('.board-root')?.getAttribute('data-hopping') === '0', null, { timeout: 15_000 });
      await page.waitForTimeout(2500);
      // 컷씬(랜드마크 건설): 캐릭터·랜드마크·배경이 다 보이는 2.6초 시점
      const on = page.locator('.cut').waitFor({ state: 'attached' });
      srv.do((g) => { g.log.push({ ev: 'build', seat: 0, tile: 16, level: 4, cost: 1 }); });
      await on;
      await page.waitForTimeout(2600);
      await rec(page, dpr, 'cutscene');
    } finally {
      srv.stop();
      await ctx.close();
    }
  });

  test(`U9 실측 1920×1080 dpr${dpr}: 줌 붙잡기·문항·문화·해설·미션·결과`, async ({ browser }) => {
    const ready = (p: Page) => p.waitForFunction(() => (window as unknown as { __board?: { ready?: () => boolean } }).__board?.ready?.() === true && document.querySelectorAll('.bc').length === 4);
    {
      const { ctx, page } = await harness(browser, dpr, '/dev/board?hold=600000', '/src/dev/board-harness.tsx', ready, true);
      await page.evaluate(() => (window as unknown as { __board: Z }).__board.scene(25, 1, 0));
      await settle(page);
      await page.evaluate(() => (window as unknown as { __board: Z }).__board.move(0, 27));
      await page.waitForFunction(() => document.querySelector('.board-cam')?.getAttribute('data-cam') === 'hold', null, { timeout: 10_000 });
      await page.waitForTimeout(2500); // 고해상 타일이 다 깔릴 때까지
      await rec(page, dpr, 'board-zoom', [['zoom-char', { x: 0, y: 420, width: 480, height: 400 }], ['zoom-tiles', { x: 0, y: 100, width: 700, height: 330 }], ['zoom-plaza', { x: 500, y: 300, width: 600, height: 400 }]]);
      await ctx.close();
    }
    const ov = (q: string) => harness(browser, dpr, `/dev/overlay?${q}`, '/src/dev/overlay-harness.tsx', (p) => p.waitForFunction(() => '__ov' in window));
    for (const [scene, q, crop] of [
      ['question', 'view=question', ['question-char', { x: 1200, y: 300, width: 600, height: 600 }]],
      ['culture', 'view=culture', ['culture-card', { x: 360, y: 160, width: 1200, height: 520 }]],
      ['explain', 'view=explain&correct=1', null],
      ['mission-photo', 'view=mission&m=m-23', null],
      ['mission-connect', 'view=mission&m=m-01', null],
    ] as const) {
      const { ctx, page } = await ov(q);
      await rec(page, dpr, scene, crop ? [crop as [string, { x: number; y: number; width: number; height: number }]] : []);
      await ctx.close();
    }
    {
      const { ctx, page } = await harness(browser, dpr, '/dev/results?kind=final', '/src/ui/results/harness.tsx', (p) => p.waitForSelector('.rs'));
      await rec(page, dpr, 'results', [['results-top', { x: 300, y: 0, width: 1320, height: 500 }]]);
      await ctx.close();
    }
  });
}

// 첫 로드 전송량(perf S7 과 같은 정의: goto → networkidle, 캐시 끔). hi 단계가 켜지는 1920×1080 에서 3MB 안인지
const loads: Record<string, unknown>[] = [];
for (const [w, h, dpr] of [[1366, 768, 1], [1920, 1080, 1], [1920, 1080, 2]] as const) {
  test(`U9 첫 로드 ${w}×${h}·dpr${dpr}`, async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: B.base, viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    let bytes = 0, hiN = 0;
    cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
    page.on('request', (r) => { if (r.url().includes('/webp/hi/')) hiN++; });
    await page.goto('/', { waitUntil: 'commit' });
    await page.locator('[data-act="intro-start"]').waitFor();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    const tier = await page.evaluate(() => [...document.images].some((i) => i.currentSrc.includes('/webp/hi/')));
    loads.push({ vp: `${w}x${h}`, dpr, bytes, MB: +(bytes / 1048576).toFixed(2), hiRequests: hiN, hiOnScreen: tier });
    await ctx.close();
  });
}

test.afterAll(() => {
  if (loads.length) writeFileSync(`${SHOTS}firstload-${TAG}.json`, JSON.stringify(loads, null, 1));
  if (!out.length) return;
  writeFileSync(`${SHOTS}measure-${TAG}.json`, JSON.stringify(out, null, 1));
});
