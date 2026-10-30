// S8 보드 배치 검사 (PRD §12.1). 개발 하네스(/dev/board)를 vite 개발 서버로 띄워 DOM 상자(getBoundingClientRect)로 잰다.
// 하네스는 앱 라우트가 아니라(app.tsx 는 T07 소유) 이 spec 이 모듈을 직접 주입한다.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

let BASE = '';
const SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/R4-TAD-shots/', import.meta.url));
let server: ViteDevServer;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { port: 0 }, // 빈 포트(반복 실행·병렬 충돌 없음)
    cacheDir: fileURLToPath(new URL('../node_modules/.vite-board-placement', import.meta.url)), // 자기 의존성 캐시(다른 spec 개발 서버와 동시 재묶음 충돌 방지, U5)
    // 첫 실행에 preact/hooks 를 늦게 찾으면 preact 사본이 둘이 된다 → 하네스 입구까지 미리 묶는다
    optimizeDeps: { entries: ['index.html', 'src/dev/board-harness.tsx'], include: ['preact', 'preact/hooks', 'preact/compat', 'preact/jsx-runtime'] },
    logLevel: 'error',
  });
  await server.listen();
  BASE = server.resolvedUrls!.local[0].replace(/\/$/, '');
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(fileURLToPath(new URL('../../harness/state/traveling-world/reports/U1-art-shots/', import.meta.url)), { recursive: true });
  mkdirSync(fileURLToPath(new URL('../../harness/state/traveling-world/reports/U4-rotate-shots/', import.meta.url)), { recursive: true });
});
test.afterAll(async () => { await server?.close(); });

async function open(page: Page, w: number, h: number, reduced: boolean) {
  await page.setViewportSize({ width: w, height: h });
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.goto(`${BASE}/dev/board`);
  await page.addScriptTag({ type: 'module', url: '/src/dev/board-harness.tsx' });
  await page.waitForFunction(() => (window as unknown as { __board?: { ready?: () => boolean } }).__board?.ready?.() === true && document.querySelectorAll('.bc').length === 4);
}

// ── 측정(브라우저) ──
type Box = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };
interface Snap {
  tiles: Record<number, { top: Pt[]; anchor: Pt; topW: number }>;
  chars: { seat: number; tile: number; box: Box }[];
  buildings: { tile: number; box: Box }[];
}
const SNAP = () => {
  const sr = document.querySelector('.board-stage')!.getBoundingClientRect();
  const k = sr.width / 1366;
  const st = (r: DOMRect) => ({ x: (r.left - sr.left) / k, y: (r.top - sr.top) / k, w: r.width / k, h: r.height / k });
  const pts = (s: string) => s.split(' ').map((p) => { const [x, y] = p.split(',').map(Number); return { x, y }; });
  const tiles: Record<number, unknown> = {};
  document.querySelectorAll<HTMLElement>('.tile').forEach((el) => {
    tiles[+el.dataset.tile!] = { top: pts(el.dataset.top!), anchor: pts(el.dataset.anchor!)[0], topW: +el.dataset.topW! };
  });
  return {
    tiles,
    chars: [...document.querySelectorAll<HTMLElement>('.bc')].map((el) => ({ seat: +el.dataset.seat!, tile: +el.dataset.tile!, box: st(el.querySelector('.bc-sprite')!.getBoundingClientRect()) })),
    // U8 C2: 건물 = 앞오른쪽 절벽 발코니 미니어처(윗면 밖) — 얼굴 가림 규칙은 그대로 잰다
    buildings: [...document.querySelectorAll<HTMLElement>('.own-bld')].map((el) => ({ tile: +el.closest<HTMLElement>('.own')!.dataset.tile!, box: st(el.getBoundingClientRect()) })),
  };
};

// ── 규칙(PRD §12.1) — layout.ts 와 독립으로 다시 적는다 ──
const TOL = 0.3; // 하위 픽셀 반올림
function inset(poly: Pt[], p: Pt) {
  const c = poly.reduce((a, q) => ({ x: a.x + q.x / poly.length, y: a.y + q.y / poly.length }), { x: 0, y: 0 });
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], len = Math.hypot(b.x - a.x, b.y - a.y);
    const side = (q: Pt) => ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)) / len;
    min = Math.min(min, Math.sign(side(c)) * side(p));
  }
  return min;
}
const hit = (a: Box, b: Box) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > TOL && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > TOL;
const face = (b: Box): Box => ({ ...b, h: b.h * 0.4 });

/** facesOnly: 모션 도중 표본 — 발 위치 규칙은 서 있는 자리(정적 배치·착지 프레임) 규칙이라 빼고, 얼굴·건물 가림만 본다(PRD §12.1 점프 호 예외). */
function check(s: Snap, label: string, facesOnly = false): string[] {
  const bad: string[] = [];
  const byTile = new Map<number, Snap['chars']>();
  s.chars.forEach((c) => byTile.set(c.tile, [...(byTile.get(c.tile) ?? []), c]));
  for (const [t, cs] of byTile) {
    const g = s.tiles[t];
    const foot = (c: Snap['chars'][number]) => ({ x: c.box.x + c.box.w / 2, y: c.box.y + c.box.h });
    const bld = s.buildings.find((b) => b.tile === t)?.box;
    cs.forEach((c, i) => {
      const f = foot(c);
      const ins = inset(g.top, f);
      if (!facesOnly && ins < 0.1 * g.topW - TOL) bad.push(`${label} 칸${t} 자리${c.seat}: 가장자리에서 ${ins.toFixed(1)}px (< 10% ${(0.1 * g.topW).toFixed(1)})`);
      const d = Math.hypot(f.x - g.anchor.x, f.y - g.anchor.y);
      const lim = (cs.length === 1 ? 0.05 : 0.15) * g.topW;
      if (!facesOnly && d > lim + TOL) bad.push(`${label} 칸${t} 자리${c.seat}: 중앙점 거리 ${d.toFixed(1)} > ${lim.toFixed(1)}`);
      cs.forEach((o, j) => {
        if (j === i) return;
        if (j > i && hit(face(c.box), face(o.box))) bad.push(`${label} 칸${t}: 얼굴 겹침 ${c.seat}·${o.seat}`);
        const oFront = foot(o).y > f.y + TOL || (Math.abs(foot(o).y - f.y) <= TOL && j > i);
        if (oFront && hit(face(c.box), o.box)) bad.push(`${label} 칸${t}: 자리${c.seat} 얼굴을 자리${o.seat} 가 가림`);
      });
      if (bld) {
        if (hit(face(c.box), bld)) bad.push(`${label} 칸${t}: 자리${c.seat} 얼굴·건물 겹침`);
        if (hit(c.box, { ...bld, h: bld.h / 2 })) bad.push(`${label} 칸${t}: 자리${c.seat} 가 건물 위 50% 가림`);
      }
    });
  }
  return bad;
}

test('전수: 30칸 × 캐릭터 1~4 × 건물 0~4단계(지을 수 있는 칸)', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, 1366, 768, true);
  const buildable: number[] = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.tile')].map((el) => +el.dataset.tile!).filter((t) => ![0, 6, 7, 8, 9, 10, 20, 25].includes(t)));
  expect(buildable).toHaveLength(22);
  const combos: [number, number, number][] = [];
  for (let t = 0; t < 30; t++) for (let n = 1; n <= 4; n++) for (const lv of buildable.includes(t) ? [0, 1, 2, 3, 4] : [0]) combos.push([t, n, lv]);
  const snaps: { label: string; snap: Snap }[] = await page.evaluate(async ({ combos, snapSrc }) => {
    const snap = new Function(`return (${snapSrc})()`) as () => Snap;
    const b = (window as unknown as { __board: { scene: (t: number, n: number, l: number) => Promise<void> } }).__board;
    const out = [];
    for (const [t, n, lv] of combos) { await b.scene(t, n, lv); out.push({ label: `[칸${t} ${n}명 ${lv}단계]`, snap: snap() }); }
    return out;
  }, { combos, snapSrc: SNAP.toString() });
  expect(snaps).toHaveLength(combos.length);
  const bad = snaps.flatMap(({ label, snap }) => {
    const [t, n, lv] = label.match(/\d+/g)!.map(Number);
    const extra: string[] = [];
    if (snap.chars.filter((c) => c.tile === t).length !== n) extra.push(`${label} 칸 위 인원 ${n} 아님`);
    if ((lv > 0) !== snap.buildings.some((x) => x.tile === t)) extra.push(`${label} 건물 표시 불일치`);
    return [...extra, ...check(snap, label)];
  });
  console.log(`전수 장면 ${snaps.length}개, 위반 ${bad.length}건`);
  expect(bad).toEqual([]);
});

test('이동: 0→29→0 한 바퀴, 칸당 1홉, 착지마다 규칙 만족(모션 켬)', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, 1366, 768, false);
  await page.evaluate(() => (window as unknown as { __board: { scene: (t: number, n: number, l: number) => Promise<void> } }).__board.scene(0, 1, 0));
  // 대기 모션을 켠 실제 설정 그대로 잰다(붐비는 칸은 A 트윈 없음, B·C 는 위아래 3% — Character crowded)
  const bad: string[] = [];
  const landed: number[] = [];
  for (let p = 1; p <= 30; p++) {
    const to = p % 30;
    await page.evaluate((to) => (window as unknown as { __board: { move: (s: number, p: number) => Promise<void> } }).__board.move(0, to), to);
    // 홉 도중: 움직이는 캐릭터만 will-change
    const wc = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.bc')].map((el) => ({ seat: el.dataset.seat, moving: el.classList.contains('is-moving'), wc: getComputedStyle(el).willChange, motion: el.dataset.motion })));
    for (const c of wc) if ((c.wc === 'transform') !== c.moving) bad.push(`칸${to}: will-change 가 is-moving 과 어긋남 ${JSON.stringify(c)}`);
    if (!wc.find((c) => c.seat === '0')?.moving) bad.push(`칸${to}: 홉 중인데 is-moving 아님`);
    await page.waitForFunction(() => {
      const b = (window as unknown as { __board: { busy: () => boolean } }).__board;
      return !b.busy() && document.querySelector('.board-cam')?.getAttribute('data-cam') === 'idle' // 줌이 풀린 1배 판에서 잰다
        && document.getAnimations().every((a) => a.playState !== 'running' || !(a.effect as KeyframeEffect).target?.classList.contains('bc'));
    }, undefined, { timeout: 8000 });
    await page.waitForTimeout(220); // 착지 눌림 180ms
    const snap: Snap = await page.evaluate(`(${SNAP.toString()})()`);
    const me = snap.chars.find((c) => c.seat === 0)!;
    landed.push(me.tile);
    bad.push(...check(snap, `[착지 칸${to}]`));
  }
  expect(landed).toEqual([...Array.from({ length: 29 }, (_, i) => i + 1), 0]);
  expect(bad).toEqual([]);
});

for (const [w, h, name] of [[1366, 768, '1366x768'], [1024, 768, '1024x768']] as const) {
  test(`뷰포트 ${name}: 30칸 땅덩이가 한 화면 안 + 스크린숏`, async ({ page }) => {
    await open(page, w, h, true);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    const out = await page.evaluate(() => {
      const sr = document.querySelector('.board-stage')!.getBoundingClientRect(), k = sr.width / 1366;
      return [...document.querySelectorAll<HTMLElement>('.tile')].map((el) => {
        const [x, y, lw, lh] = el.dataset.land!.split(',').map(Number); // 땅덩이(상자 4~96% × 0~97%) — 상자 투명 여백은 화면 밖 1.9px
        const l = sr.left + x * k, t = sr.top + y * k, r = l + lw * k, b = t + lh * k;
        return { t: el.dataset.tile, in: l >= -0.5 && t >= -0.5 && r <= innerWidth + 0.5 && b <= innerHeight + 0.5 };
      });
    });
    expect(out).toHaveLength(30);
    expect(out.filter((o) => !o.in)).toEqual([]);
    await expect(page.locator('.board-rotate')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}board-${name}.png` });
  });
}

test('세로 768x1024: 가로로 돌려 달라는 안내(가로 전용), 돌리면 사라짐', async ({ page }) => {
  await open(page, 768, 1024, true);
  await page.evaluate(() => document.fonts.ready);
  const ov = page.locator('.board-rotate');
  await expect(ov).toBeVisible();
  await expect(ov).toContainText('기기를 가로로 돌려 주세요');
  const box = await ov.boundingBox();
  expect(box).toEqual({ x: 0, y: 0, width: 768, height: 1024 });
  await page.screenshot({ path: `${SHOTS}board-768x1024.png` });
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(ov).toHaveCount(0);
});

// QA6(r6 minor, DESIGN §4.2): 세로 안내는 게임 루트의 fixed 최상위 덮개. 규칙·멈춤 간판(GameMenu)이 위로 안 올라오고 눌리지 않는다.
// 뒤 레이어는 inert, 돌리면 inert 가 풀리고 간판이 다시 눌린다
for (const [w, h] of [[360, 640], [390, 844], [768, 1024], [820, 1180]] as const) {
  test(`QA6 세로 ${w}x${h}: 게임 메뉴 간판·주사위가 덮개 위로 안 나오고 눌리지 않음(inert)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${BASE}/dev/board?menu=1`);
    await page.addScriptTag({ type: 'module', url: '/src/dev/board-harness.tsx' });
    await page.waitForSelector('.board-rotate');
    await expect(page.locator('.gm-btn')).not.toHaveCount(0); // 간판은 DOM 에 있다(덮여 있을 뿐)
    const exposed = await page.evaluate(() => [...document.querySelectorAll('button')].filter((e) => {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0) || e.closest('.board-rotate')) return false;
      const x = Math.min(innerWidth - 1, Math.max(0, r.x + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.y + r.height / 2));
      return document.elementFromPoint(x, y)?.closest('button') === e;
    }).map((e) => e.className));
    expect(exposed).toEqual([]);
    const ov = page.locator('.board-rotate');
    expect(await ov.evaluate((el) => [getComputedStyle(el).position, getComputedStyle(el).zIndex, el.parentElement!.lastElementChild === el])).toEqual(['fixed', '100', true]);
    // 형제 레이어(보드·메뉴)는 전부 inert, 덮개는 아님
    expect(await ov.evaluate((el) => [...el.parentElement!.children].filter((c) => c !== el).every((c) => c.hasAttribute('inert')))).toBe(true);
    expect(await ov.evaluate((el) => el.hasAttribute('inert'))).toBe(false);
    // 덮개 아래 간판을 억지로 눌러도(force) 멈춤 확인 문구가 안 뜬다
    await page.locator('.gm-btn[data-act=pause]').click({ force: true }).catch(() => {});
    await expect(page.locator('.gm-ask')).toHaveCount(0);
    // 가로로 돌리면 덮개가 사라지고 inert 가 풀려 간판이 다시 눌린다
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(ov).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelectorAll('[inert]').length)).toBe(0);
    await page.locator('.gm-btn[data-act=pause]').click();
    await expect(page.locator('.gm-ask')).toHaveText('잠깐 쉴까요? 한 번 더 누르면 멈춰요');
  });
}

// U1·U4(DESIGN §4.2 세로 화면 안내): 전용 일러스트 카드 + 크림 알약, 버튼 없음. 폰·태블릿 세로(9:16·3:4)에서 카드·알약이 잘리지 않는다.
// 움직임을 줄이면 P 카드(세로판 3:4) 정지만, 가로판(UI-rotate-wide)은 요청도 하지 않는다
const U1_SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/U1-art-shots/', import.meta.url));
const U4_SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/U4-rotate-shots/', import.meta.url));
const ROT_SIZES = [[360, 640], [390, 844], [768, 1024], [820, 1180]] as const;
const inView = (b: { x: number; y: number; width: number; height: number }, w: number, h: number) => {
  expect(b.x).toBeGreaterThanOrEqual(-0.5); expect(b.y).toBeGreaterThanOrEqual(-0.5);
  expect(b.x + b.width).toBeLessThanOrEqual(w + 0.5); expect(b.y + b.height).toBeLessThanOrEqual(h + 0.5);
};
for (const [w, h] of ROT_SIZES) {
  test(`U1 세로 안내 ${w}x${h}: 카드·알약이 화면 안, 버튼 없음, 줄인 동작은 세로판 정지·가로판 미요청`, async ({ page }) => {
    const wideReq: string[] = [];
    page.on('request', (r) => { if (/UI-rotate-wide/.test(r.url())) wideReq.push(r.url()); });
    await open(page, w, h, true);
    await page.evaluate(() => document.fonts.ready);
    const ov = page.locator('.board-rotate');
    await expect(ov).toBeVisible();
    await expect(ov).toHaveAttribute('data-mode', 'still');
    const card = ov.locator('.board-rotate-card.is-p'), art = card.locator('img.board-rotate-art');
    await expect(art).toHaveCount(1);
    await page.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>('.board-rotate-art'); return !!i && i.complete && i.naturalWidth > 0; });
    expect(await art.getAttribute('src')).toMatch(/UI-rotate\.webp$/);
    await expect(ov.locator('.board-rotate-card.is-l')).toHaveCount(0);
    await expect(ov.locator('.board-rotate-icon')).toHaveCount(0); // 옛 CSS 아이콘은 로드 실패 대체로만
    await expect(ov.locator('button, [role=button]')).toHaveCount(0);
    await expect(ov.locator('.board-rotate-title')).toHaveText('기기를 가로로 돌려 주세요');
    const a = (await card.boundingBox())!, p = (await ov.locator('.board-rotate-pill').boundingBox())!;
    inView(a, w, h); inView(p, w, h);
    expect(p.y).toBeGreaterThanOrEqual(a.y + a.height - 1); // 알약은 카드 아래
    expect(a.width).toBeLessThanOrEqual(Math.min(w * 0.78, 420) + 0.5);
    expect(a.width).toBeGreaterThan(Math.min(w * 0.78, 420) * 0.6); // 너무 작아지지 않음
    expect(Math.abs(a.height / a.width - 4 / 3)).toBeLessThan(0.02); // P 카드 3:4
    expect(Math.abs(a.y + a.height / 2 - h * 0.42)).toBeLessThan(2); // 회전 중심 42vh
    expect(await card.evaluate((el) => [getComputedStyle(el).animationName, getComputedStyle(el).transform])).toEqual(['none', 'none']); // 정지
    await page.waitForTimeout(300);
    expect(wideReq).toEqual([]); // 가로판 요청 0
    await page.screenshot({ path: `${U1_SHOTS}rotate-${w}x${h}.png` });
    await page.screenshot({ path: `${U4_SHOTS}reduced-${w}x${h}-${test.info().project.name}.png` });
  });
}

// U4(DESIGN §4.2 2026-10-29 U4): 세로판 카드가 시계방향 90° 돌며 가로판(16:9)으로 크로스페이드 → 머묾 → 거울로 되돌기. 4.8s 무한.
// 애니메이션을 멈추고 시각을 정해 잰다: 세로 머묾 600ms · 돌기 한가운데 1600ms · 가로 머묾 3000ms · 되돌기 한가운데 4400ms
const U4_AT = [['portrait', 600], ['mid-turn', 1600], ['landscape', 3000], ['mid-return', 4400]] as const;
for (const [w, h] of ROT_SIZES) {
  test(`U4 세로 안내 ${w}x${h}: 카드가 돌며 세로판→가로판, 모든 순간 화면 안, 알약 고정`, async ({ page }) => {
    await open(page, w, h, false);
    await page.evaluate(() => document.fonts.ready);
    const ov = page.locator('.board-rotate');
    await expect(ov).toHaveAttribute('data-mode', 'turn');
    const P = ov.locator('.board-rotate-card.is-p'), L = ov.locator('.board-rotate-card.is-l');
    expect(await L.locator('img').getAttribute('src')).toMatch(/UI-rotate-wide\.webp$/);
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.board-rotate-art')].every((i) => i.complete && i.naturalWidth > 0));
    const cfg = await P.evaluate((el) => { const c = getComputedStyle(el); return [c.animationName, c.animationDuration, c.animationIterationCount]; });
    expect(cfg).toEqual(['rotate-card-p-turn, rotate-card-p-fade', '4.8s, 4.8s', 'infinite, infinite']);
    const pill0 = (await ov.locator('.board-rotate-pill').boundingBox())!;
    const seen: Record<string, unknown> = {};
    for (const [name, t] of U4_AT) {
      const st = await page.evaluate((t) => {
        for (const a of document.getAnimations()) {
          const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
          if (el?.classList.contains('board-rotate-card')) { a.pause(); a.currentTime = t; }
        }
        const one = (sel: string) => {
          const el = document.querySelector<HTMLElement>(sel)!, c = getComputedStyle(el), r = el.getBoundingClientRect();
          const m = new DOMMatrix(c.transform), deg = Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI);
          return { op: +c.opacity, deg, box: { x: r.x, y: r.y, width: r.width, height: r.height }, w: el.offsetWidth, h: el.offsetHeight };
        };
        return { p: one('.board-rotate-card.is-p'), l: one('.board-rotate-card.is-l') };
      }, t);
      seen[name] = st;
      for (const c of [st.p, st.l]) if (c.op > 0.01) inView(c.box, w, h); // 보이는 카드는 어느 순간이든 화면 안(돌 때 쓸리는 상자 포함)
      expect((await ov.locator('.board-rotate-pill').boundingBox())!).toEqual(pill0); // 알약 고정
      if (name === 'portrait') {
        expect([st.p.op, st.l.op, st.p.deg]).toEqual([1, 0, 0]);
        expect(Math.abs(st.p.h / st.p.w - 4 / 3)).toBeLessThan(0.02);
        expect(pill0.y).toBeGreaterThanOrEqual(st.p.box.y + st.p.box.height); // 알약은 카드 아래
      }
      if (name === 'mid-turn' || name === 'mid-return') {
        expect(st.p.op).toBeGreaterThan(0); expect(st.p.op).toBeLessThan(1); // 크로스페이드 중
        expect(st.p.deg).toBeGreaterThan(20); expect(st.p.deg).toBeLessThan(80); // 시계방향으로 도는 중
        expect(st.l.deg).toBeLessThan(-10); expect(st.l.deg).toBeGreaterThan(-70);
      }
      if (name === 'landscape') {
        expect([st.p.op, st.l.op, st.l.deg]).toEqual([0, 1, 0]);
        expect(Math.abs(st.l.w / st.l.h - 16 / 9)).toBeLessThan(0.02); // 가로판 16:9, 바로 선 그림
        expect(st.l.box.width).toBeGreaterThan(st.l.box.height);
        expect(pill0.y).toBeGreaterThanOrEqual(st.l.box.y + st.l.box.height);
      }
      await page.screenshot({ path: `${U4_SHOTS}${name}-${w}x${h}-${test.info().project.name}.png` });
    }
    console.log(`[U4] ${w}x${h}`, JSON.stringify(seen));
  });
}
test('U4 세로 안내: 가로판을 못 받으면 P 카드만 옛 ±3° 2.4s 흔들림, 알약은 정지', async ({ page }) => {
  await page.route(/UI-rotate-wide\.webp$/, (r) => r.abort());
  await open(page, 390, 844, false);
  const ov = page.locator('.board-rotate');
  await expect(ov).toHaveAttribute('data-mode', 'sway');
  await expect(ov.locator('.board-rotate-card.is-l')).toHaveCount(0);
  const st = await ov.locator('.board-rotate-card.is-p').evaluate((el) => { const c = getComputedStyle(el); return [c.animationName, c.animationDuration, c.animationIterationCount]; });
  expect(st).toEqual(['board-rotate-sway', '2.4s', 'infinite']);
  expect(await page.locator('.board-rotate-pill').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});
test('U4 성능: CPU 4배 스로틀에서 카드 회전 한 주기 30fps 이상', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', '데스크톱에서만');
  await open(page, 390, 844, false);
  await expect(page.locator('.board-rotate')).toHaveAttribute('data-mode', 'turn');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // 돌기·되돌기를 모두 지나는 한 주기(4.8s)
  const dts = await page.evaluate(() => new Promise<number[]>((done) => {
    const out: number[] = [];
    let prev = 0;
    const t0 = performance.now();
    const loop = (t: number) => { if (prev) out.push(t - prev); prev = t; if (t - t0 > 4900) return done(out); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const total = dts.reduce((a, b) => a + b, 0), sorted = [...dts].sort((a, b) => a - b);
  const r = { cpu: 4, frames: dts.length, fps: Math.round((dts.length * 10000) / total) / 10, p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10, maxMs: Math.round(Math.max(...dts) * 10) / 10 };
  writeFileSync(`${U4_SHOTS}perf-4x.json`, JSON.stringify(r, null, 2));
  console.log('[U4 perf]', JSON.stringify(r));
  expect(r.fps).toBeGreaterThanOrEqual(30);
});

test('두 자리가 동시에 움직여도 둘 다 끝까지 홉하고 busy 가 풀린다', async ({ page }) => {
  await open(page, 1366, 768, true);
  type B = { scene: (t: number, n: number, l: number) => Promise<void>; patch: (f: (g: { players: { pos: number }[] }) => void) => Promise<void>; busy: () => boolean };
  await page.evaluate(() => (window as unknown as { __board: B }).__board.scene(0, 2, 0)); // 자리 0·1 은 칸 0, 2·3 은 칸 20
  await page.evaluate(() => (window as unknown as { __board: B }).__board.patch((g) => { g.players[0].pos = 6; g.players[1].pos = 4; }));
  await page.waitForTimeout(500); // 자리 1 이 홉하는 도중에
  await page.evaluate(() => (window as unknown as { __board: B }).__board.patch((g) => { g.players[0].pos = 9; })); // 자리 0 목표만 바뀜
  await page.waitForFunction(() => !(window as unknown as { __board: B }).__board.busy(), undefined, { timeout: 8000 });
  const where = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.bc')].map((el) => [+el.dataset.seat!, +el.dataset.tile!]));
  expect(Object.fromEntries(where)).toEqual({ 0: 9, 1: 4, 2: 20, 3: 20 });
});

// U5(§16.9.3): 이모션·반응은 광장 귀퉁이 전신 캐릭터(.bcc)만 한다. 칸 위 말(.bc)은 이모션 0 — 붐비는 칸에서도 얼굴 규칙 그대로
test('붐비는 칸: 반응·대기 이모션은 귀퉁이 캐릭터가 하고 말은 가만히, 얼굴 규칙 유지(모션 켬, 표본 검사)', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, 1366, 768, false);
  type B = { scene: (t: number, n: number, l: number) => Promise<void>; log: (ev: unknown) => Promise<void> };
  await page.evaluate(() => (window as unknown as { __board: B }).__board.scene(5, 4, 0));
  const bad: string[] = [];
  const seen = new Set<string>();
  const tokenSeen = new Set<string>();
  const sample = async (ms: number) => {
    for (let t = 0; t < ms; t += 120) {
      const snap: Snap = await page.evaluate(`(${SNAP.toString()})()`);
      bad.push(...check(snap, `[t${t}]`, true));
      (await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.bcc')].map((el) => el.dataset.motion!))).forEach((m) => m && seen.add(m));
      (await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.bc')].map((el) => el.dataset.motion!))).forEach((m) => m && tokenSeen.add(m));
      await page.waitForTimeout(120);
    }
  };
  // 반응(B·C): 자리 0 정답 환호, 3 울상·2 웃기+동전, 1 놀람
  await page.evaluate(() => {
    const b = (window as unknown as { __board: B }).__board;
    void b.log({ ev: 'answer', seat: 0, qid: 'q', choice: 1, correct: true, ms: 1, isBot: false });
    void b.log({ ev: 'toll', payer: 3, owner: 2, tile: 5, base: 1, multiplier: 1, discounted: false, paid: 1 });
    void b.log({ ev: 'event', seat: 2, kind: 'island', payload: {} }); // 자리 1 만 놀람(0·3 은 C 중, 2 는 당사자)
  });
  await sample(2500);
  await sample(12_000); // 대기 A (귀퉁이 5~10초 간격)
  console.log('귀퉁이 모션', [...seen].join(','), '· 말 모션', [...tokenSeen].join(','));
  expect([...seen].some((m) => ['rest', 'stretch', 'look', 'wave', 'yawn'].includes(m))).toBe(true);
  expect(['cheer', 'smileCoin', 'surprised'].every((m) => seen.has(m))).toBe(true);
  expect([...tokenSeen]).toEqual([]); // 말은 이모션 0
  expect(bad).toEqual([]);
});

test('스크린숏(2배 확대): 같은 칸 2~4명 + 건물', async ({ browser }) => {
  const ctx = await browser.newContext({ deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await open(page, 1366, 768, true);
  for (const [t, n, l] of [[0, 4, 0], [15, 2, 3], [26, 3, 4], [5, 1, 2], [6, 2, 0], [28, 4, 2], [21, 1, 1], [16, 4, 0]] as const) {
    await page.evaluate(([t, n, l]) => (window as unknown as { __board: { scene: (t: number, n: number, l: number) => Promise<void> } }).__board.scene(t, n, l), [t, n, l]);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    const a = await page.evaluate((t) => document.querySelector<HTMLElement>(`.tile[data-tile="${t}"]`)!.dataset.anchor!.split(',').map(Number), t);
    await page.screenshot({ path: `${SHOTS}tile${t}-${n}p-lv${l}.png`, clip: { x: Math.max(0, a[0] - 110), y: Math.max(0, a[1] - 80), width: 220, height: 130 } });
  }
  await page.screenshot({ path: `${SHOTS}panel-tl.png`, clip: { x: 0, y: 0, width: 300, height: 90 } });
  await ctx.close();
});

test('주사위: 누른 동안 기대 모션, 떼면 0~1 값 하나', async ({ page }) => {
  await open(page, 1366, 768, false);
  const btn = page.locator('.dice-btn');
  await expect(btn).toBeEnabled();
  await btn.hover();
  await page.mouse.down();
  await page.waitForTimeout(400);
  await expect(page.locator('.bcc[data-seat="0"]')).toHaveAttribute('data-motion', 'expect'); // 기대 = 귀퉁이 캐릭터(U5)
  await expect(page.locator('.bc[data-seat="0"]')).toHaveAttribute('data-motion', '');
  await page.mouse.up();
  const g = await page.evaluate(() => (window as unknown as { __lastRoll: number }).__lastRoll);
  expect(g).toBeGreaterThanOrEqual(0);
  expect(g).toBeLessThanOrEqual(1);
  await expect(page.locator('.bcc[data-seat="0"]')).not.toHaveAttribute('data-motion', 'expect');
});

test('파산(봇): 말·귀퉁이 캐릭터 둘 다 쓰러짐 뒤 회색, 모션 없음', async ({ page }) => {
  await open(page, 1366, 768, false);
  await page.evaluate(() => (window as unknown as { __board: { patch: (f: (g: { players: { bankrupt: boolean }[] }) => void) => Promise<void> } }).__board.patch((g) => { g.players[1].bankrupt = true; }));
  const both = ['.bc[data-seat="1"]', '.bcc[data-seat="1"]'];
  for (const sel of both) await expect(page.locator(sel)).toHaveAttribute('data-motion', 'collapse');
  for (const sel of both) {
    const bot = page.locator(sel);
    await expect(bot).toHaveClass(/is-grey/, { timeout: 3000 });
    await expect(bot).toHaveAttribute('data-motion', '');
    expect(await bot.locator('.bc-sprite').evaluate((el) => getComputedStyle(el).filter)).toContain('grayscale');
    expect(await bot.locator('.bc-breath').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  }
});

// ── R4 판(DESIGN §16): 합성 스크린숏·하늘 비율·HUD 교차·독점 연출·그림 미로드 폴백 ──
type H = { demo: () => Promise<void>; monopoly: (c: string, s: number) => Promise<void> };
const ready = async (page: Page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {})))); // decoding=async: 그려진 뒤 찍는다
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};

test('합성 1장(시안 대조용): 30칸 + 광장 + 이정표 + HUD + 캐릭터 4(눈·사막·숲·얼음), 고리 bbox(y 47~721, U5 §16.9.1) 안 하늘 픽셀 ≤ 15%', async ({ page }) => {
  await open(page, 1366, 768, true);
  await page.evaluate(() => (window as unknown as { __board: H }).__board.demo());
  await ready(page);
  const where = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.bc')].map((el) => [+el.dataset.seat!, +el.dataset.tile!, el.dataset.ambient]));
  expect(where).toEqual([[0, 21, 'cool'], [1, 16, 'warm'], [2, 27, 'base'], [3, 8, 'cool']]);
  await page.screenshot({ path: `${SHOTS}board.png` });
  // 하늘 = 배경 그림이 그대로 보이는 픽셀. 배경을 마젠타 한 색으로 바꿔 찍고 그 색을 센다(칸 속 눈·얼음·구름 그림은 하늘이 아니다)
  await page.evaluate(() => {
    (document.querySelector('.board-bg') as HTMLElement).style.visibility = 'hidden';
    (document.querySelector('.board-root') as HTMLElement).style.background = '#ff00ff';
  });
  const png = await page.screenshot({ path: `${SHOTS}board-sky.png` });
  const sky = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    // U5: 세로 피치 110 → 고리 674 가 세로 가운데, 위·아래 하늘 띠 47 은 고리 밖(사용자 결정 1건). 상한 15% 는 고리 bbox 안에서 잰다
    let n = 0, all = 0, tot = 0;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4, sky = d[i] > 230 && d[i + 1] < 40 && d[i + 2] > 230;
      if (sky) all++;
      if (y < 47 || y >= 721) continue;
      tot++; if (sky) n++;
    }
    return { ring: n / tot, screen: all / (d.length / 4) };
  }, png.toString('base64'));
  console.log('하늘 비율(고리 안)', (sky.ring * 100).toFixed(1) + '%', '· 화면 전체', (sky.screen * 100).toFixed(1) + '%');
  expect(sky.ring).toBeLessThanOrEqual(0.15);
});

test('HUD(패널 4·주사위·타이머)·이정표 판 DOM 상자 교차 0, 이름표 코드 글자 0(그림 속 이름표)', async ({ page }) => {
  await open(page, 1366, 768, true);
  await ready(page);
  const boxes = await page.evaluate(() => {
    const sr = document.querySelector('.board-stage')!.getBoundingClientRect(), k = sr.width / 1366;
    const st = (el: Element) => { const r = el.getBoundingClientRect(); return { x: (r.left - sr.left) / k, y: (r.top - sr.top) / k, w: r.width / k, h: r.height / k }; };
    return [
      ...[...document.querySelectorAll('.panel')].map((el) => ({ id: `panel${(el as HTMLElement).dataset.seat}`, box: st(el) })),
      { id: 'dice', box: st(document.querySelector('.dice')!) },
      { id: 'timer', box: st(document.querySelector('.board-timer')!) },
      ...[...document.querySelectorAll('.sign-face')].map((el) => ({ id: `sign-${(el.parentElement as HTMLElement).dataset.continent}`, box: st(el) })),
    ];
  });
  expect(boxes).toHaveLength(11);
  const bad: string[] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i].box, boxes[j].box)) bad.push(`${boxes[i].id}·${boxes[j].id}`);
  expect(bad).toEqual([]);
  expect(await page.locator('.tile-label, .tile-band, .tile-fallback').count()).toBe(0);
  expect(await page.locator('.tile img').count()).toBe(30);
  expect(await page.locator('.board-world .board-bridges .br').count()).toBe(30);
  expect(await page.locator('.board-world .sign').count()).toBe(5);
  // 판(world)과 화면(hud)은 다른 레이어: 패널·주사위는 hud 안
  expect(await page.locator('.board-hud .panel').count()).toBe(4);
  expect(await page.locator('.board-hud .dice').count()).toBe(1);
  expect(await page.locator('.board-world .bc').count()).toBe(4);
  expect(await page.locator('.board-world .bcc').count()).toBe(4); // U5 귀퉁이 전신 캐릭터(판 레이어)
  expect(await page.locator('.panel-face, .panel-face-img').count()).toBe(0); // U5 패널 초상 없음
});

test('독점 연출(§16.5): 0.2s 칸 글로우 → 0.5s 지도 마스크·이정표 자리색 → 0.6s 띠 + 색종이 → 3.0s 글로우 끔(자리색 영구)', async ({ page }) => {
  await open(page, 1366, 768, false);
  await ready(page);
  const t0 = Date.now();
  await page.evaluate(() => (window as unknown as { __board: H }).__board.monopoly('africa', 2));
  await expect(page.locator('.tile.is-glow')).toHaveCount(4);
  expect(Date.now() - t0).toBeLessThan(1500);
  await expect(page.locator('.plaza-mask[data-continent="africa"]')).toHaveClass(/is-on/);
  await expect(page.locator('.sign[data-continent="africa"]')).toHaveAttribute('data-owner', '2');
  for (const t of [16, 17, 18, 19]) await expect(page.locator(`.own[data-tile="${t}"] .own-flag img`)).toHaveAttribute('src', /FLAG-tall-3/); // U8 C2 세로 깃발
  await expect(page.locator('.mono-band')).toContainText('독점했어요!');
  await expect(page.locator('.mono-confetti')).toHaveCount(1);
  await page.waitForTimeout(450); // 띠 slide-in 300ms 뒤
  await page.screenshot({ path: `${SHOTS}monopoly.png` });
  await expect(page.locator('.tile.is-glow')).toHaveCount(0, { timeout: 4000 });
  await expect(page.locator('.mono')).toHaveCount(0);
  await expect(page.locator('.plaza-mask[data-continent="africa"]')).toHaveClass(/is-on/); // 영구
  expect(await page.locator('.plaza-mask[data-continent="africa"]').evaluate((el) => getComputedStyle(el).opacity)).toBe('0.85');
  expect(await page.locator('.sign[data-continent="africa"] .sign-face').evaluate((el) =>
    getComputedStyle(el).getPropertyValue('--face').trim() === getComputedStyle(document.documentElement).getPropertyValue('--seat-3').trim())).toBe(true);
  // 새 판(상태 monopolies 비움) → 자리색 지움(M4)
  await page.evaluate(() => (window as unknown as { __board: { patch: (f: (g: { monopolies: unknown[] }) => void) => Promise<void> } }).__board.patch((g) => { g.monopolies = []; }));
  await expect(page.locator('.plaza-mask[data-continent="africa"]')).not.toHaveClass(/is-on/);
  await expect(page.locator('.sign[data-continent="africa"]')).toHaveAttribute('data-owner', '');
});

test('독점 reduced-motion: 글로우·자리색 즉시, 띠 slide·색종이 없이 배너 2초', async ({ page }) => {
  await open(page, 1366, 768, true);
  await ready(page);
  await page.evaluate(() => (window as unknown as { __board: H }).__board.monopoly('asia', 0));
  await expect(page.locator('.tile.is-glow')).toHaveCount(5, { timeout: 300 });
  expect(await page.locator('.plaza-mask[data-continent="asia"]').evaluate((el) => getComputedStyle(el).opacity)).toBe('0.85');
  await expect(page.locator('.mono.is-static .mono-band')).toContainText('아시아를 독점했어요!');
  expect(await page.locator('.mono-band').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await expect(page.locator('.mono-confetti')).toHaveCount(0);
  await expect(page.locator('.mono')).toHaveCount(0, { timeout: 2600 });
});

test('그림 미로드 폴백: 칸 그림이 안 오면 땅 모양 + 코드 이름표, 이정표·광장도 대체 블록', async ({ page }) => {
  await page.route(/TILE-03d\.webp|UI-signpost\.webp|PLAZA-U5\.webp/, (r) => r.abort());
  await open(page, 1366, 768, true);
  await expect(page.locator('.tile[data-tile="3"] .tile-fallback')).toContainText('중국');
  await expect(page.locator('.tile .tile-fallback')).toHaveCount(1);
  await expect(page.locator('.sign-fallback')).toHaveCount(5);
  await expect(page.locator('.plaza-fallback')).toHaveCount(1);
  await expect(page.locator('.sign[data-continent="europe"] .sign-text')).toHaveText('유럽');
});

// ── R4 T-E 줌 카메라(PRD §12.4, DESIGN §16.6, S8) ──
const TE = fileURLToPath(new URL('../../harness/state/traveling-world/reports/R4-TE-shots/', import.meta.url));
type Z = { scene: (t: number, n: number, l: number) => Promise<void>; move: (s: number, p: number) => Promise<void> };
const zb = (page: Page) => page.evaluate(() => (window as unknown as { __board: Z }).__board);
const camIs = (page: Page, phase: string, timeout = 8000) =>
  page.waitForFunction((ph) => document.querySelector('.board-cam')?.getAttribute('data-cam') === ph, phase, { timeout });
async function openZ(page: Page, w: number, h: number, q = '') {
  await page.setViewportSize({ width: w, height: h });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`${BASE}/dev/board${q}`);
  await page.addScriptTag({ type: 'module', url: '/src/dev/board-harness.tsx' });
  await page.waitForFunction(() => (window as unknown as { __board?: { ready?: () => boolean } }).__board?.ready?.() === true && document.querySelectorAll('.bc').length === 4);
  await ready(page);
}
/** 화면 px 상자들: HUD(패널·타이머·주사위), world, 스테이지, 이동자 발(그림자 중심) */
const camSnap = () => {
  const r = (el: Element | null) => { const b = el!.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  const sh = document.querySelector('.bc[data-seat="0"] .bc-shadow')!.getBoundingClientRect();
  const m = getComputedStyle(document.querySelector('.board-world')!).transform;
  return {
    hud: [...document.querySelectorAll('.board-hud .panel, .board-hud .board-timer, .board-hud .dice')].map(r),
    world: r(document.querySelector('.board-world')),
    stage: r(document.querySelector('.board-stage')),
    foot: { x: sh.left + sh.width / 2, y: sh.top + sh.height / 2 },
    scale: m === 'none' ? 1 : Number(m.match(/matrix\(([^,]+)/)![1]),
    dice: Number(getComputedStyle(document.querySelector('.dice-wrap')!).opacity),
  };
};
type CamSnap = ReturnType<typeof camSnap>;
const snapCam = (page: Page): Promise<CamSnap> => page.evaluate(`(${camSnap.toString()})()`);
/** 그림 PNG 의 밝기 기울기 에너지(선명도) */
const sharp = (page: Page, png: Buffer, size?: { w: number; h: number }) => page.evaluate(async ([b64, W, H]) => {
  const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
  const cv = document.createElement('canvas'); cv.width = (W as number) || img.width; cv.height = (H as number) || img.height;
  const c = cv.getContext('2d')!; c.imageSmoothingQuality = 'high'; c.drawImage(img, 0, 0, cv.width, cv.height);
  const d = c.getImageData(0, 0, cv.width, cv.height).data, w = cv.width, h = cv.height;
  const g = (x: number, y: number) => { const i = (y * w + x) * 4; return 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; };
  let e = 0; for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) { const a = g(x + 1, y) - g(x, y), b = g(x, y + 1) - g(x, y); e += a * a + b * b; }
  return e / (w * h);
}, [png.toString('base64'), size?.w ?? 0, size?.h ?? 0] as const);

test('줌 S8: 이동 시작 → 1.8배, 이동자 화면 중앙(클램프 안 된 축 ±20), HUD 상자 불변, 주사위 숨김, 가장자리 0·10·15·25 스테이지 밖 노출 0', async ({ page }) => {
  test.setTimeout(90_000);
  await openZ(page, 1366, 768, '?hold=600000'); // 착지 뒤 줌을 붙잡는 스냅샷 모드
  await page.evaluate(() => (window as unknown as { __board: Z }).__board.scene(25, 1, 0));
  const before = await snapCam(page);
  expect(before.scale).toBe(1);
  expect(before.dice).toBe(1);
  await page.evaluate(() => (window as unknown as { __board: Z }).__board.move(0, 27)); // 왼쪽 열 가운데(y 축은 클램프 안 됨)
  await page.waitForTimeout(200);
  expect((await snapCam(page)).dice, '줌 시작 150ms 뒤 주사위 숨김').toBe(0);
  await camIs(page, 'hold');
  await page.waitForTimeout(700); // in 400 전환이 확실히 끝난 뒤
  const z = await snapCam(page);
  expect(z.scale).toBeCloseTo(1.8, 5);
  expect(Math.abs(z.foot.y - 384), `이동자 발 y ${z.foot.y}`).toBeLessThanOrEqual(20);
  expect(z.foot.x).toBeGreaterThan(0); // x 는 왼쪽 끝 클램프(스테이지 밖 노출 0)
  expect(z.hud).toEqual(before.hud);
  expect(z.dice).toBe(0);
  await page.screenshot({ path: `${TE}zoom-tile27.png` });
  const bad: string[] = [];
  for (const t of [0, 10, 15, 25]) {
    await page.evaluate((t) => (window as unknown as { __board: Z }).__board.move(0, t), t);
    await page.waitForTimeout(150);
    await camIs(page, 'hold', 12_000);
    await page.waitForTimeout(700);
    const c = await snapCam(page);
    const w = c.world, st = c.stage;
    if (w.x > st.x + 0.5 || w.y > st.y + 0.5 || w.x + w.w < st.x + st.w - 0.5 || w.y + w.h < st.y + st.h - 0.5) bad.push(`칸${t}: world ${JSON.stringify(w)} 가 스테이지를 다 덮지 않음`);
    if (Math.abs(c.scale - 1.8) > 1e-3) bad.push(`칸${t}: 배율 ${c.scale}`);
    if (c.foot.x < 0 || c.foot.x > 1366 || c.foot.y < 0 || c.foot.y > 768) bad.push(`칸${t}: 이동자가 화면 밖 ${JSON.stringify(c.foot)}`);
    expect(c.hud).toEqual(before.hud);
    await page.screenshot({ path: `${TE}zoom-edge-${t}.png` });
  }
  expect(bad).toEqual([]);
});

test('줌 선명도: 1.8배에서 칸 이름표·캐릭터 가장자리가 DPR 1.8 원본 렌더와 같은 수준(1배 확대본보다 확연히 선명)', async ({ browser }) => {
  test.setTimeout(60_000);
  const R = { name: { x: 8, y: 338, w: 116, h: 32 }, char: { x: 38, y: 262, w: 48, h: 58 } }; // 칸 27(브라질, U5 상자 y 267) 이름표 · 발 앵커 위 캐릭터(스테이지 px)
  // 기준: 줌 없이 장치 배율 1.8 로 같은 장면
  const rc = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1.8, reducedMotion: 'reduce' });
  const rp = await rc.newPage();
  await openZ(rp, 1366, 768, '?hires=0'); // U9: 장치 배율 1.8 은 hi 단계(큰 그림)를 고르므로 줌 쪽(1366·dpr1 = 기본 단계)과 같은 그림으로 맞춘다
  await rp.emulateMedia({ reducedMotion: 'reduce' });
  await rp.evaluate(() => (window as unknown as { __board: Z }).__board.scene(27, 1, 0));
  await ready(rp);
  const shot = (p: Page, r: { x: number; y: number; w: number; h: number }, name: string, k = 1, t = { x: 0, y: 0 }) =>
    p.screenshot({ clip: { x: r.x * k + t.x, y: r.y * k + t.y, width: r.w * k, height: r.h * k }, path: `${TE}${name}.png` });
  const ref = { name: await shot(rp, R.name, 'crisp-ref-name'), char: await shot(rp, R.char, 'crisp-ref-char') };
  // 줌: 1배 화면에서 칸 25 → 27 이동, 착지 뒤 붙잡기
  const zc = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  const zp = await zc.newPage();
  await openZ(zp, 1366, 768, '?hold=600000&hires=0');
  const one = { name: await shot(zp, R.name, 'crisp-1x-name'), char: await shot(zp, R.char, 'crisp-1x-char') }; // 1배(줌 전) — 비교용
  await zp.evaluate(() => (window as unknown as { __board: Z }).__board.scene(25, 1, 0));
  await zp.evaluate(() => (window as unknown as { __board: Z }).__board.move(0, 27));
  await camIs(zp, 'hold');
  await zp.waitForTimeout(800);
  const m = await zp.evaluate(() => getComputedStyle(document.querySelector('.board-world')!).transform.match(/matrix\(([^)]+)\)/)![1].split(',').map(Number));
  expect(m[0]).toBeCloseTo(1.8, 5);
  // 크롬은 큰 배율 레이어를 낮은 해상도 타일부터 그리고 고해상 타일로 바꾼다 → 고해상이 다 깔릴 때까지(≤ 4초) 다시 잰다
  const NEED = { name: { ref: 0.65, one: 1.4 }, char: { ref: 0.55, one: 1.8 } } as const; // 실측 이름표 0.72·1.58배, 캐릭터 0.68·2.3배
  const out: Record<string, number> = {};
  for (const k of ['name', 'char'] as const) {
    const size = { w: Math.round(R[k].w * 1.8), h: Math.round(R[k].h * 1.8) };
    const eRef = await sharp(zp, ref[k]), eOne = await sharp(zp, one[k], size); // 1배 그림만 1.8배로 늘려 비교(줌·기준은 원래 픽셀 그대로)
    let eZoom = 0;
    for (let i = 0; i < 8; i++) {
      eZoom = await sharp(zp, await shot(zp, R[k], `crisp-zoom-${k}`, m[0], { x: m[4], y: m[5] }));
      if (eZoom / eRef >= NEED[k].ref && eZoom > eOne * NEED[k].one) break;
      await zp.waitForTimeout(500);
    }
    out[`${k}: 줌/기준`] = eZoom / eRef;
    out[`${k}: 1배확대/기준`] = eOne / eRef;
    expect(eZoom / eRef, `${k} 줌 선명도`).toBeGreaterThanOrEqual(NEED[k].ref);
    expect(eZoom, `${k} 줌이 1배 확대본보다 선명`).toBeGreaterThan(eOne * NEED[k].one);
  }
  await zp.screenshot({ path: `${TE}crisp-zoom-full.png` });
  console.log('선명도', JSON.stringify(out));
  await rc.close();
  await zc.close();
});

test('줌 한 바퀴: in → 홉 따라감 → 착지 + 300ms → out 600ms → 1배·주사위 복귀, 그 뒤에야 onCamera(false)', async ({ page }) => {
  await openZ(page, 1366, 768);
  await page.evaluate(() => (window as unknown as { __board: Z }).__board.scene(1, 1, 0));
  const t0 = await page.evaluate(() => { (window as unknown as { __board: Z }).__board.move(0, 4); return performance.now(); });
  await page.waitForFunction(() => (window as unknown as { __cam?: boolean }).__cam === true, undefined, { timeout: 2000 });
  await camIs(page, 'out', 6000);
  const tOut = await page.evaluate(() => performance.now());
  expect((await snapCam(page)).dice).toBe(0);
  await camIs(page, 'idle', 3000);
  const tIdle = await page.evaluate(() => performance.now());
  // 3홉(340ms 간격) + hold 300 ≈ 1.3s 뒤 out, out 600ms 뒤 idle
  expect(tOut - t0).toBeGreaterThan(3 * 340 + 300 - 120);
  expect(tOut - t0).toBeLessThan(3 * 340 + 300 + 600);
  expect(tIdle - tOut).toBeGreaterThan(600 - 80);
  expect(await page.evaluate(() => (window as unknown as { __cam?: boolean }).__cam)).toBe(false);
  await page.waitForTimeout(200);
  const end = await snapCam(page);
  expect(end.scale).toBe(1);
  expect(end.dice).toBe(1);
});

test('줌 0: reduced-motion · 새로 마운트(재접속 합류)는 줌 없이 현재 위치', async ({ page }) => {
  await open(page, 1366, 768, true);
  await page.evaluate(() => (window as unknown as { __board: Z }).__board.scene(1, 1, 0));
  await page.evaluate(() => (window as unknown as { __board: Z }).__board.move(0, 5));
  for (let i = 0; i < 8; i++) {
    expect(await page.locator('.board-cam').getAttribute('data-cam')).toBe('idle');
    expect((await snapCam(page)).dice).toBe(1);
    await page.waitForTimeout(150);
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => (window as unknown as { __board: Z }).__board.scene(20, 1, 0)); // 새 Board 가 다른 칸에서 시작
  await page.waitForTimeout(500);
  expect(await page.locator('.board-cam').getAttribute('data-cam')).toBe('idle');
  expect((await snapCam(page)).scale).toBe(1);
});

test('줌 태블릿 1024×768: 스테이지 축소 배율 × 1.8 이 곱해진다', async ({ page }) => {
  await openZ(page, 1024, 768, '?hold=600000');
  await page.evaluate(() => (window as unknown as { __board: Z }).__board.scene(12, 1, 0));
  await page.evaluate(() => (window as unknown as { __board: Z }).__board.move(0, 13));
  await camIs(page, 'hold');
  await page.waitForTimeout(700);
  const c = await snapCam(page);
  const k = 1024 / 1366;
  expect(c.stage.w).toBeCloseTo(1366 * k, 1);
  expect(c.world.w).toBeCloseTo(1366 * k * 1.8, 0);
  expect(c.world.x).toBeLessThanOrEqual(c.stage.x + 0.5);
  expect(c.world.x + c.world.w).toBeGreaterThanOrEqual(c.stage.x + c.stage.w - 0.5);
  await page.screenshot({ path: `${TE}zoom-tablet-1024.png` });
});

test('홉: 땅 위 직선 + 공중 포물선, 그림자는 땅에 남아 작아지고 옅어짐, 착지 눌림 + 먼지(줌 안에서)', async ({ page }) => {
  await openZ(page, 1366, 768, '?hold=600000');
  await page.evaluate(() => (window as unknown as { __board: Z }).__board.scene(5, 1, 0));
  await page.evaluate(() => (window as unknown as { __board: Z }).__board.move(0, 7));
  await camIs(page, 'hold');
  await page.waitForTimeout(800);
  // 같은 줌에서 한 홉(7 → 8)을 프레임으로 멈춰 찍는다
  const frames: { t: number; air: number; shadow: number; shadowOp: number }[] = [];
  await page.evaluate(() => (window as unknown as { __board: Z }).__board.move(0, 8));
  for (const [t, name] of [[60, 'takeoff'], [160, 'apex'], [345, 'land']] as const) {
    await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
    await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), t === 60 ? 60 : t === 160 ? 100 : 185);
    await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
    const v = await page.evaluate(() => {
      const air = getComputedStyle(document.querySelector('.bc[data-seat="0"] .bc-air')!).transform;
      const sh = getComputedStyle(document.querySelector('.bc[data-seat="0"] .bc-shadow')!);
      const ty = air === 'none' ? 0 : Number(air.match(/matrix\(([^)]+)\)/)![1].split(',')[5]);
      const sc = sh.transform === 'none' ? 1 : Number(sh.transform.match(/matrix\(([^,]+)/)![1]);
      return { air: ty, shadow: sc, shadowOp: Number(sh.opacity) };
    });
    frames.push({ t, ...v });
    const foot = await page.evaluate(() => { const r = document.querySelector('.bc[data-seat="0"] .bc-shadow')!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.screenshot({ path: `${TE}hop-${name}.png`, clip: { x: Math.max(0, foot.x - 90), y: Math.max(0, foot.y - 150), width: 180, height: 190 } });
  }
  await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
  console.log('홉 프레임', JSON.stringify(frames));
  const apex = frames[1];
  expect(apex.air).toBeLessThan(-10); // 공중(배율 전 px)
  expect(apex.shadow).toBeLessThan(0.8); // 그림자 작아짐
  expect(apex.shadowOp).toBeLessThan(0.8); // 옅어짐
  expect(await page.locator('.bc[data-seat="0"] .bc-dust').count()).toBe(1); // 착지 먼지
});

test('줌 중 이동자가 패널 뒤로 들어오면 그 패널만 옅게(자리·크기 그대로)', async ({ page }) => {
  await openZ(page, 1366, 768, '?hold=600000');
  await page.evaluate(() => (window as unknown as { __board: Z }).__board.scene(7, 1, 0));
  const before = await snapCam(page);
  await page.evaluate(() => (window as unknown as { __board: Z }).__board.move(0, 9));
  await camIs(page, 'hold');
  await page.waitForTimeout(700);
  await expect(page.locator('.panel.is-veiled')).toHaveCount(1);
  expect(await page.locator('.panel.is-veiled').getAttribute('data-seat')).toBe('3');
  expect((await snapCam(page)).hud).toEqual(before.hud);
  await page.screenshot({ path: `${TE}zoom-veil-tile9.png` });
});

test('독점 띠 = 금 리본(결과 화면과 같은 부품), 화면 가운데', async ({ page }) => {
  await open(page, 1366, 768, false);
  await ready(page);
  await page.evaluate(() => (window as unknown as { __board: H }).__board.monopoly('asia', 0));
  await expect(page.locator('.mono-band .ribbon .ribbon-title')).toContainText('아시아를 독점했어요!');
  await page.waitForTimeout(1000);
  const b = await page.locator('.mono-ribbon').boundingBox();
  expect(Math.abs(b!.x + b!.width / 2 - 683)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: `${TE}monopoly-ribbon.png` });
});

test('규칙·저장 = 매달린 간판(§16.9.2 U5 (573,235)·(793,235) 44×44): 칸 땅덩이·패널·이정표·타이머·주사위와 교차 0, 저장은 두 번 눌러야', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dev/board?menu=1`);
  await page.addScriptTag({ type: 'module', url: '/src/dev/board-harness.tsx' });
  await page.waitForFunction(() => (window as unknown as { __board?: { ready?: () => boolean } }).__board?.ready?.() === true && document.querySelectorAll('.bc').length === 4);
  await ready(page);
  const r = await page.evaluate(() => {
    const sr = document.querySelector('.board-stage')!.getBoundingClientRect(), k = sr.width / 1366;
    const st = (el: Element) => { const b = el.getBoundingClientRect(); return { x: (b.left - sr.left) / k, y: (b.top - sr.top) / k, w: b.width / k, h: b.height / k }; };
    const signs = [...document.querySelectorAll('.gm .hang-plate')].map((el) => ({ id: el.getAttribute('title') ?? el.textContent!, box: st(el) }));
    const others = [
      ...[...document.querySelectorAll<HTMLElement>('.tile')].map((el) => { const [x, y, w, h] = el.dataset.land!.split(',').map(Number); return { id: `tile${el.dataset.tile}`, box: { x, y, w, h } }; }),
      ...[...document.querySelectorAll('.panel')].map((el) => ({ id: `panel${(el as HTMLElement).dataset.seat}`, box: st(el) })),
      ...[...document.querySelectorAll('.sign-face')].map((el) => ({ id: `sign-${(el.parentElement as HTMLElement).dataset.continent}`, box: st(el) })),
      { id: 'timer', box: st(document.querySelector('.board-timer')!) },
      { id: 'dice', box: st(document.querySelector('.dice')!) },
    ];
    const ropes = [...document.querySelectorAll('.gm .hang-rope')].map((el) => st(el));
    return { signs, others, ropes };
  });
  expect(r.signs.map((s) => s.id)).toEqual(['규칙', '멈춤']);
  const c = (b: { x: number; y: number; w: number; h: number }) => [Math.round(b.x + b.w / 2), Math.round(b.y + b.h / 2), Math.round(b.w), Math.round(b.h)];
  expect(c(r.signs[0].box)).toEqual([573, 235, 44, 44]);
  expect(c(r.signs[1].box)).toEqual([793, 235, 44, 44]);
  const bad: string[] = [];
  for (const s of r.signs) for (const o of r.others) if (hit(s.box, o.box)) bad.push(`${s.id}·${o.id}`);
  for (const rp of r.ropes) for (const o of r.others) if (o.id.startsWith('tile') && hit(rp, o.box)) bad.push(`밧줄·${o.id}`);
  expect(bad).toEqual([]);
  await page.screenshot({ path: `${TE}board-signs.png` });
  await page.screenshot({ path: `${TE}board-signs-crop.png`, clip: { x: 520, y: 160, width: 330, height: 110 } });
  const pause = page.locator('[data-act="pause"]');
  await pause.click();
  await expect(page.locator('.gm-ask')).toHaveText('잠깐 쉴까요? 한 번 더 누르면 멈춰요');
  await page.screenshot({ path: `${TE}board-signs-ask.png`, clip: { x: 600, y: 120, width: 400, height: 160 } });
  await ctx.close();
});
