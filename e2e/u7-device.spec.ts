// U7-device 실측(고치지 않고 잰다): 휴대폰 가로 3 · 태블릿 2 · 크롬북 2 · PC 1 해상도에서
// 인트로·로비·보드·문항·해설·결과의 판 배율, 화면에 그려진 가장 작은 글자 px, 가장 작은 누르는 칸 px, 잘림·넘침, 레터박스.
// 결과: harness/state/traveling-world/reports/U7-device-shots/measure.json + 화면별 스크린숏. desktop 프로젝트에서만 돈다.
import { test, type Browser, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { joinCode } from './helpers/entry';
import { mkdirp, nextCode, setup, Srv, type Built } from './helpers/room-server';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/U7-device-shots/', import.meta.url));

const DEVICES = [
  { cls: '휴대폰', w: 844, h: 390, touch: true },
  { cls: '휴대폰', w: 915, h: 412, touch: true },
  { cls: '휴대폰', w: 740, h: 360, touch: true },
  { cls: '태블릿', w: 1180, h: 820, touch: true },
  { cls: '태블릿', w: 1024, h: 768, touch: true },
  { cls: '크롬북', w: 1366, h: 768, touch: false },
  { cls: '크롬북', w: 1536, h: 864, touch: false },
  { cls: 'PC', w: 1920, h: 1080, touch: false },
] as const;

let DEV = '';
let server: ViteDevServer;
let B: Built;
test.describe.configure({ mode: 'serial' });
// 실측은 desktop 프로젝트에서 한 번만(파일 단위로 건너뛰면 beforeAll 빌드·개발 서버도 안 뜬다)
test.skip(({ isMobile }) => isMobile, '실측은 desktop 프로젝트에서만(tablet-touch = isMobile)');
test.setTimeout(600_000);
test.beforeAll(async () => {
  test.setTimeout(180_000);
  server = await createServer({
    root: ROOT,
    configFile: `${ROOT}vite.config.ts`,
    server: { port: 0 },
    cacheDir: `${ROOT}node_modules/.vite-u7-device`, // 다른 spec 의 개발 서버 묶음과 안 섞이게(U5 실측)
    optimizeDeps: { entries: ['index.html', 'src/dev/board-harness.tsx', 'src/dev/overlay-harness.tsx', 'src/ui/results/harness.tsx'], include: ['preact', 'preact/hooks', 'preact/compat', 'preact/jsx-runtime'] },
    logLevel: 'error',
  });
  await server.listen();
  DEV = server.resolvedUrls!.local[0].replace(/\/$/, '');
  B = await setup('u7dev');
  mkdirp(SHOTS);
});
test.afterAll(async () => { await server?.close(); await B?.close(); });

const settle = async (page: Page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(800);
};

type Screen = 'intro' | 'lobby' | 'board' | 'question' | 'explain' | 'results';
const STAGE_SEL: Record<Screen, string | null> = { intro: '.in-stage', lobby: null, board: '.board-stage', question: '.ov-stage', explain: '.ov-stage', results: '.rs-stage' };
/** 글자 크기를 재는 범위(그 화면의 주인공). 보드는 판 전체, 문항·해설은 오버레이 판, 결과는 결과 판 */
const SCOPE: Record<Screen, string> = { intro: '.in-stage', lobby: 'main', board: '.board-stage', question: '.ov-stage', explain: '.ov-stage', results: '.rs-stage' };
/** 화면의 본문 글자(배지·버전 같은 꼬리표 말고 아이들이 읽어야 하는 글) */
const KEY: Record<Screen, string> = { intro: ".intro-start-face", lobby: ".lb-slot-name", board: ".panel-name-w, .sign-text, .board-timer", question: ".qs-stem, .ov-ans", explain: ".ex-text, .ex-body, .ex-answer", results: ".rs-name, .rs-plate-text, .rs-lines" };

async function goto(browser: Browser, d: (typeof DEVICES)[number], s: Screen, srv: Srv | null) {
  const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, hasTouch: d.touch, isMobile: d.touch, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  if (s === 'intro') await page.goto(`${DEV}/`);
  else if (s === 'lobby') {
    await ctx.routeWebSocket(/\/api\/rooms\/[A-Z0-9]{6}\/ws$/, (route) => srv!.attach(route, `${d.w}`));
    await page.goto(`${B.base}/`);
    await joinCode(page, srv!.code);
    await page.locator('.lb-slot').first().waitFor();
    await page.evaluate(() => scrollTo(0, 0));
  } else if (s === 'board') {
    await page.goto(`${DEV}/dev/board`);
    await page.addScriptTag({ type: 'module', url: '/src/dev/board-harness.tsx' });
    await page.waitForFunction(() => (window as unknown as { __board?: { ready?: () => boolean } }).__board?.ready?.() === true);
    await page.evaluate(() => (window as unknown as { __board: { demo: () => Promise<void> } }).__board.demo());
  } else if (s === 'results') {
    await page.goto(`${DEV}/dev/results?kind=final`);
    await page.addScriptTag({ type: 'module', url: '/src/ui/results/harness.tsx' });
    await page.waitForSelector('.rs');
  } else {
    await page.route(/\/src\/main\.tsx(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await page.goto(`${DEV}/dev/overlay?view=${s === 'question' ? 'question' : 'explain&correct=1'}`);
    await page.addScriptTag({ type: 'module', url: '/src/dev/overlay-harness.tsx' });
    await page.waitForFunction(() => '__ov' in window);
  }
  await settle(page);
  return { ctx, page };
}

function measure(args: { stageSel: string | null; scope: string; keySel: string; hitScope: string }) {
  const { stageSel, scope, keySel, hitScope } = args;
  const W = innerWidth, H = innerHeight;
  const shown = (e: Element) => {
    for (let p: Element | null = e; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    }
    const r = e.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };
  const tag = (e: Element) => `${e.tagName.toLowerCase()}${e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''}`;
  const st = stageSel ? document.querySelector<HTMLElement>(stageSel) : null;
  const sr = st?.getBoundingClientRect();
  const k = st && sr ? sr.width / st.offsetWidth : 1;
  const root = document.querySelector(scope) ?? document.body;
  // 글자: 글자 노드를 바로 가진 요소마다 font-size × (화면 상자 ÷ 레이아웃 상자). SVG 글자는 화면 행렬 배율
  const texts: { px: number; css: number; el: string; text: string; clipped: boolean; key: boolean }[] = [];
  for (const e of root.querySelectorAll('*')) {
    const own = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent!.trim()).map((n) => n.textContent!.trim()).join(' ');
    if (!own || !shown(e)) continue;
    const css = parseFloat(getComputedStyle(e).fontSize);
    let ratio = k;
    if (e instanceof SVGGraphicsElement) ratio = e.getScreenCTM()?.a ?? k;
    else if (e instanceof HTMLElement && e.offsetWidth > 0) ratio = e.getBoundingClientRect().width / e.offsetWidth;
    const r = e.getBoundingClientRect();
    texts.push({ px: +(css * ratio).toFixed(1), css, el: tag(e), text: own.slice(0, 18), clipped: r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1, key: !!e.closest(keySel) });
  }
  texts.sort((a, b) => a.px - b.px);
  // 누르는 칸: 보이는 button·input·[role=button]·a[href] (막힌 것 제외)
  const hits: { px: number; w: number; h: number; el: string; label: string; clipped: boolean }[] = [];
  for (const e of document.querySelectorAll<HTMLElement>('button, input, select, a[href], [role="button"]')) {
    if ((e as HTMLButtonElement).disabled || e.closest('[inert]') || !shown(e)) continue;
    const r = e.getBoundingClientRect();
    hits.push({ px: +Math.min(r.width, r.height).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), el: tag(e), label: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 14),
      clipped: r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1 });
  }
  hits.sort((a, b) => a.px - b.px);
  const se = document.scrollingElement!;
  return {
    scale: +k.toFixed(3),
    stage: sr ? { w: Math.round(sr.width), h: Math.round(sr.height) } : null,
    letterbox: sr ? { x: Math.round(Math.max(0, (W - sr.width) / 2)), y: Math.round(Math.max(0, (H - sr.height) / 2)) } : null,
    minText: texts.slice(0, 3),
    minKey: texts.filter((t) => t.key).slice(0, 2),
    textUnder12: texts.filter((t) => t.px < 12).length,
    textUnder14: texts.filter((t) => t.px < 14).length,
    textCount: texts.length,
    minHit: hits.slice(0, 3),
    hitsUnder44: hits.filter((h) => h.px < 44).length,
    hitCount: hits.length,
    overflow: { x: se.scrollWidth - W, y: se.scrollHeight - H },
    clippedText: texts.filter((t) => t.clipped).map((t) => `${t.el}:${t.text}`).slice(0, 5),
    clippedHits: hits.filter((h) => h.clipped).map((h) => `${h.el}:${h.label}`).slice(0, 5),
  };
}

test('U7 기기별 실측 8 해상도 × 6 화면 → measure.json + 스크린숏', async ({ browser }) => {
  const out: Record<string, unknown>[] = [];
  for (const d of DEVICES) {
    const srv = new Srv(B.RoomCtor, nextCode('TWDV')); // 로비: 해상도마다 새 방(4자리 넘지 않게)
    for (const s of ['intro', 'lobby', 'board', 'question', 'explain', 'results'] as const) {
      const { ctx, page } = await goto(browser, d, s, srv);
      const m = await page.evaluate(measure, { stageSel: STAGE_SEL[s], scope: SCOPE[s], keySel: KEY[s], hitScope: s === 'question' || s === 'explain' ? '.ov-stage' : 'body' });
      await page.screenshot({ path: `${SHOTS}${s}-${d.w}x${d.h}.png` });
      out.push({ device: d.cls, vp: `${d.w}×${d.h}`, screen: s, ...m });
      await ctx.close();
    }
    srv.stop();
  }
  writeFileSync(`${SHOTS}measure.json`, JSON.stringify(out, null, 1));
});
