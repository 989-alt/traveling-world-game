// T09 결과 화면 e2e. 개발 하네스(src/ui/results/harness.tsx)를 vite 개발 서버로 띄워 진짜 DOM 으로 시험한다.
// 2026-10-31 U12: 결과 화면 = 엔딩(DESIGN §19 — 기념사진 + 여권). §19.7 검증을 여기서 한다.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/U12-end-shots/', import.meta.url));
const SHOTS13 = fileURLToPath(new URL('../../harness/state/traveling-world/reports/U13-end-shots/', import.meta.url));

let BASE = '';
const GAEGU = 'https://fonts.googleapis.com/css2?family=Jua&family=Noto+Sans+KR:wght@400;500;700;800&family=Gaegu:wght@400;700&display=swap';
let server: ViteDevServer;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  server = await createServer({
    root: ROOT,
    configFile: `${ROOT}vite.config.ts`,
    server: { port: 0 },
    optimizeDeps: { entries: ['index.html', 'src/ui/results/harness.tsx'], include: ['preact', 'preact/hooks', 'preact/compat', 'preact/jsx-runtime'] },
    logLevel: 'error',
  });
  await server.listen();
  BASE = server.resolvedUrls!.local[0].replace(/\/$/, '');
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(SHOTS13, { recursive: true });
});
test.afterAll(async () => { await server?.close(); });

async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${BASE}/dev/results?${query}`);
  await page.addStyleTag({ url: GAEGU }).catch(() => {}); // 하네스 페이지는 index.html 링크가 없다 — 같은 Google Fonts 주소(망이 막혀도 시험은 계산값만 본다)
  await page.addScriptTag({ type: 'module', url: '/src/ui/results/harness.tsx' });
  await page.waitForSelector('.rs');
  await page.waitForSelector('.end-done', { state: 'attached', timeout: 5000 }).catch(() => {}); // 빈 기록은 사진이 없다
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(450); // 마지막 장면 페이드 0.4초
  return errors;
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}${name}-${test.info().project.name}.png` });

/** 한 화면: 문서가 뷰포트보다 길지 않고, 글 그릇 안에서 잘린 내용도 없다 */
async function fits(page: Page) {
  const r = await page.evaluate(() => ({
    doc: document.documentElement.scrollHeight, vh: innerHeight,
    clipped: [...document.querySelectorAll<HTMLElement>('.rs-learn, .rs-side, .rs-magnets, .end-lines li, .end-name, .end-owner')]
      .filter((e) => e.offsetParent !== null && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)).map((e) => `${e.className}:${e.textContent}`),
  }));
  expect(r.doc).toBeLessThanOrEqual(r.vh);
  expect(r.clipped).toEqual([]);
}

test('final: 엔딩 요소 전부 + 둘째 장 학습 기록(S9)', async ({ page }) => {
  const errors = await open(page, 'kind=final');
  // U13: 제목은 틀 그림(END-photo-frame-v2) 안 — 코드 제목 0, 그림 alt 로만
  await expect(page.locator('.end-frame')).toHaveAttribute('alt', '세계 여행 끝!');
  await expect(page.locator('.end-fb-title')).toHaveCount(0);
  await expect(page.locator('[data-k="rank"] li')).toHaveCount(4);
  await expect(page.locator('[data-k="rank"] li').first()).toHaveAttribute('data-seat', '0');
  await expect(page.locator('[data-k="tab"]')).toHaveCount(4);
  await expect(page.locator('[data-k="tab"][data-seat="0"]')).toHaveAttribute('aria-selected', 'true');
  // 첫 장 여권: 학습 도장 4 · 3줄 · 스티커 틀 3 · 나라 도장 격자 9칸(10곳 → 8 + '+2')
  await expect(page.locator('[data-k="learn"]')).toHaveAttribute('data-owner', '0');
  await expect(page.locator('[data-k="medals"] li')).toHaveCount(4);
  await expect(page.locator('[data-k="lines"] li')).toHaveCount(3);
  await expect(page.locator('.end-sticker')).toHaveCount(3);
  await expect(page.locator('[data-k="map"] li')).toHaveCount(9);
  await expect(page.locator('[data-k="pin"]')).toHaveCount(8);
  await expect(page.locator('[data-k="pin-more"]')).toHaveAttribute('data-n', '2');
  await expect(page.locator('[data-k="rates"]')).toBeHidden();
  await page.locator('[data-k="detail"]').click(); // 자세히 보기(둘째 장)
  await expect(page.locator('[data-k="detail-page"]')).toBeVisible();
  // 1번 자리(나): 대번호 행 · 4단계 · 헷갈린 번호 · 얻은 것 · 도장
  await expect(page.locator('[data-k="row"]').first()).toBeVisible();
  await expect(page.locator('[data-k="level4"]')).toHaveCount(1);
  await expect(page.locator('[data-k="level4"] [data-col="arrive"]')).toContainText('(1/1)');
  await expect(page.locator('[data-k="mtags"] .rs-chip').first()).toBeVisible();
  await expect(page.locator('[data-k="gains"]')).toContainText('1곳 싸게 샀어요');
  await expect(page.locator('[data-k="gains"]')).toContainText('200원 아꼈어요');
  await expect(page.locator('[data-k="stamps"] li')).toHaveCount(10);
  await expect(page.locator('[data-k="climate"]', { hasText: '같은 열대 기후: 필리핀, 타이' })).toHaveCount(1);
  // 마그넷 글(카드 정답 줄)은 번들에 없고 서버가 정지·끝 때 보낸다(T05b). 하네스는 서버 카드가 없으니 0줄.
  // 실제 흐름의 마그넷은 flow.spec '저장·중간 결과·재개'·'최종 결과' 가 본다
  await expect(page.locator('[data-k="magnet"]')).toHaveCount(0);
  // 탭을 바꾸면 그 자리 기록 + 첫 장 여권 주인도 같이 바뀐다(§19.5)
  await page.locator('[data-k="tab"][data-seat="1"]').click();
  await expect(page.locator('[data-k="pin"]')).toHaveCount(2);
  await expect(page.locator('[data-k="stamps"] li')).toHaveCount(2);
  await expect(page.locator('[data-k="learn"]')).toHaveAttribute('data-owner', '1');
  await page.locator('[data-k="tab"][data-seat="3"]').click();
  await expect(page.locator('[data-k="bot-note"]')).toBeVisible();
  await expect(page.locator('[data-k="rates"]')).toHaveCount(0);
  await page.locator('[data-k="tab"][data-seat="0"]').click();
  await page.locator('[data-k="detail"]').click(); // 돌아가기
  await expect(page.locator('.end-book')).toBeVisible();
  expect(errors).toEqual([]);
});

test('final: 한 화면에 들어가고(스크롤 없음) 글자 ≥ 14px, 출처·쪽수 문구가 없다', async ({ page }) => {
  await open(page, 'kind=final');
  const w = page.viewportSize()!;
  for (const seat of [0, 1, 2, 3]) {
    if (seat) await page.locator(`.end-cp[data-seat="${seat}"]`).click();
    await expect(page.locator('[data-k="learn"]')).toHaveAttribute('data-owner', String(seat));
    await page.waitForTimeout(400);
    await fits(page);
    // 첫 장 글자는 전부 14px 이상(§19.7)
    const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.end-photo *, .end-book *, .end-closed *, .end-more *')]
      .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && e.offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 14)
      .map((e) => `${e.className}:${getComputedStyle(e).fontSize}`));
    expect(small, `seat ${seat}`).toEqual([]);
  }
  await page.locator('.end-cp[data-seat="0"]').click();
  await page.waitForTimeout(400);
  await shot(page, 'final-human1st');
  // 둘째 장(자세히): 탭마다 잘림 없음
  await page.locator('[data-k="detail"]').click();
  for (const seat of [0, 1, 2, 3]) {
    await page.locator(`[data-k="tab"][data-seat="${seat}"]`).click();
    await fits(page);
  }
  await page.locator('[data-k="tab"][data-seat="0"]').click();
  await shot(page, 'detail');
  await page.locator('[data-k="detail"]').click(); // 돌아가기
  await expect(page.locator('.end-book')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(w.height);
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/지도서|교과서|\[MCP|\[6사|\[4사|pp?\.\s?[0-9]/);
});

// §19.7: svg 0 · END-* 그림 · 로제트 x = 발 x ±4 · 목 메달 = chest 앵커 ±4 · 1위·2위 머리 위 y 차 ≤ 12 · 랜드마크 필터 0 · results.css gradient 0
test('U12 §19.7 → U13: 그림 에셋 엔딩 — svg 0, 로제트 x = 발 x, 코드 목 메달 0', async ({ page }) => {
  await open(page, 'kind=final');
  const r = await page.evaluate(() => {
    const c = (e: Element) => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; };
    const imgs = [...document.querySelectorAll<HTMLImageElement>('.rs img')];
    const broken = imgs.filter((i) => i.offsetParent !== null && !(i.complete && i.naturalWidth > 0)).map((i) => i.src);
    const end = new Set(imgs.filter((i) => /\/webp\/(hi\/)?(END-|CH\d-P2[01])/.test(i.src) && i.naturalWidth > 0).map((i) => i.src.replace(/.*\/webp\/(hi\/)?/, '')));
    const people = [...document.querySelectorAll<HTMLElement>('.end-person')].map((li) => {
      const foot = c(li.querySelector('.end-foot')!), ro = c(li.querySelector('.end-rosette')!);
      return { seat: li.dataset.seat, dx: Math.abs(foot.x - ro.x), neck: li.querySelectorAll('.end-neck').length };
    });
    const lmFilter = [...document.querySelectorAll<HTMLElement>('.end-lm, .end-sticker-lm')].map((e) => getComputedStyle(e).filter);
    return { svgs: document.querySelectorAll('.rs svg').length, broken, end: [...end], people, lmFilter };
  });
  expect(r.svgs).toBe(0);
  expect(r.broken).toEqual([]);
  // 사진 배경·틀·펼친 여권·세운 여권 3·로제트 4·테이프 4·도장 테 2·메달 포즈 4·탭
  expect(r.end.length).toBeGreaterThanOrEqual(20);
  for (const p of r.people) {
    expect(p.dx, `로제트 x 자리 ${p.seat}`).toBeLessThanOrEqual(4);
    expect(p.neck, `코드 목 메달 0(메달은 포즈 그림) 자리 ${p.seat}`).toBe(0);
  }
  // (2026-11-01 시안 배치: 키 350 한 줄, 트로피가 창 위로 나가면 1위만 줄임 — 트로피 위끝은 U13 시험에서 본다)
  expect(r.lmFilter.length).toBeGreaterThan(0);
  expect(r.lmFilter.every((f) => f === 'none')).toBe(true);
  const css = readFileSync(`${ROOT}src/styles/results.css`, 'utf8');
  expect(css).not.toMatch(/gradient\(/);
});

// U12 사용자 지적(2026-10-31): 로봇 입(분홍)이 마젠타로 키잉돼 배경이 비쳤다. 그림 안쪽 반투명 픽셀(투명·그림 테두리에서 먼 곳) 검사 — 포즈 14 + END 25
test('U12 키잉: 포즈·엔딩 그림 안쪽에 뚫린(반투명) 곳 없음', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', '그림 검사는 한 번');
  await page.goto(`${BASE}/dev/results?kind=final`);
  const files = [...[1, 2, 3, 4, 5, 6, 7].flatMap((n) => [`CH${n}-P20@1024`, `CH${n}-P21@1024`]),
    'END-photo-frame', 'END-passport-wide', 'END-stamp-ring-red', 'END-stamp-ring-blue',
    ...[1, 2, 3, 4].flatMap((n) => [`END-passport-open-${n}`, `END-passport-closed-${n}`, `END-tape-${n}`]),
    ...['gold', 'silver', 'bronze', 'plain'].map((m) => `END-medal-neck-${m}`),
    // U13 56: 메달 포즈 40 · 로제트 4 · 펼친 여권 v2 4 · 세운 여권 4 · 탭 2 · 틀 v2 · 열기구
    ...[1, 2, 3, 4, 5, 6].flatMap((n) => [`CH${n}-P20-gold`, `CH${n}-P21-silver`, `CH${n}-P21-bronze`, `CH${n}-P21-plain`]),
    ...[1, 2, 3, 4].flatMap((n) => [`CH7-P20-gold-s${n}`, `CH7-P21-silver-s${n}`, `CH7-P21-bronze-s${n}`, `CH7-P21-plain-s${n}`, `END-rosette-${n}`, `END-passport-open-${n}-v2`, `END-passport-stand-${n}`]),
    'END-photo-frame-v2', 'END-balloon', 'END-tab-more', 'END-tab-back']
  const bad = await page.evaluate(async (fs) => {
    const out: Record<string, number> = {};
    for (const f of fs) {
      const img = new Image();
      img.src = `/webp/${f}.webp`;
      await img.decode();
      const W = img.naturalWidth, H = img.naturalHeight;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d')!; cx.drawImage(img, 0, 0);
      const a = cx.getImageData(0, 0, W, H).data;
      const r = Math.max(4, Math.round(Math.max(W, H) / 170));
      const near = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (x < r || y < r || x >= W - r || y >= H - r) near[y * W + x] = 1;
        if (a[(y * W + x) * 4 + 3] < 8) for (let dy = -r; dy <= r; dy += r) for (let dx = -r; dx <= r; dx += r) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H) near[Y * W + X] = 1; }
      }
      let n = 0;
      for (let p = 0; p < W * H; p++) { const al = a[p * 4 + 3]; if (al >= 8 && al < 248 && !near[p]) n++; }
      out[f] = n / (W * H);
    }
    return out;
  }, files);
  for (const [f, v] of Object.entries(bad)) expect(v, f).toBeLessThan(0.001); // 키잉 전(전역 거리) CH6-P21 1.7%·CH7-P21 0.35%
});

test('U12: 닫힌 여권 누르면 주인이 바뀌고, Tab 순서 = 순위', async ({ page }) => {
  await open(page, 'kind=final'); // 순위 0·1·3·2, 나 = 0
  const ranks = await page.locator('[data-k="rank"] li').evaluateAll((ls) => ls.map((l) => (l as HTMLElement).dataset.seat));
  expect(ranks).toEqual(['0', '1', '3', '2']);
  await expect(page.locator('.end-cp')).toHaveCount(3);
  expect(await page.locator('.end-cp').evaluateAll((ls) => ls.map((l) => (l as HTMLElement).dataset.seat))).toEqual(['1', '3', '2']);
  // 키보드: 첫 Tab 들 = 닫힌 여권 순위 차례
  const seen: string[] = [];
  for (let i = 0; i < 6 && seen.length < 3; i++) {
    await page.keyboard.press('Tab');
    const s = await page.evaluate(() => (document.activeElement as HTMLElement)?.closest('.end-cp')?.getAttribute('data-seat'));
    if (s) seen.push(s);
  }
  expect(seen).toEqual(['1', '3', '2']);
  // 누르기 → 펼친 여권 = 그 사람(초상·표지·수치), 내 것은 닫혀 순위 자리로
  const before = await page.locator('.end-portrait-face').getAttribute('src');
  await page.locator('.end-cp[data-seat="1"]').click();
  await expect(page.locator('[data-k="learn"]')).toHaveAttribute('data-owner', '1');
  expect(await page.locator('.end-portrait-face').getAttribute('src')).not.toBe(before);
  await expect(page.locator('[data-k="medals"] li').first()).toHaveAttribute('aria-label', '다녀온 곳 2곳');
  expect(await page.locator('.end-cp').evaluateAll((ls) => ls.map((l) => (l as HTMLElement).dataset.seat))).toEqual(['0', '3', '2']);
  await expect(page.locator('.end-book-img')).toHaveAttribute('src', /END-passport-open-2/);
});

test('U12→U13: 사람이 4위여도 내 여권이 펼쳐진다(하트 링 없음, 테이프 같은 크기) · 관전자는 1위가 나', async ({ page }) => {
  await open(page, 'ranks=1,3,2,0&me=0');
  const me = page.locator('.end-person.is-me');
  await expect(me).toHaveAttribute('data-seat', '0');
  await expect(me).toHaveAttribute('data-rank', '4');
  // 2026-11-01 사용자 "자신의 캐릭터를 표시하는 하트는 없었으면 해" — 하트 링 0, 테이프는 넷 다 같은 크기(시안)
  await expect(page.locator('.end-heart, img[src*="END-heart-ring"]')).toHaveCount(0);
  const tw = await page.locator('.end-tape').evaluateAll((ts) => ts.map((t) => (t as HTMLElement).offsetWidth));
  expect(Math.max(...tw)).toBe(Math.min(...tw));
  await expect(page.locator('[data-k="learn"]')).toHaveAttribute('data-owner', '0');
  await shot(page, 'final-human4th');
  // 관전자(자리 없음): 내 여권 주인 = 1위
  await open(page, 'me=none&ranks=3,1,2,0');
  await expect(page.locator('.end-person.is-me')).toHaveAttribute('data-seat', '3');
  await expect(page.locator('.end-heart')).toHaveCount(0);
  await expect(page.locator('[data-k="learn"]')).toHaveAttribute('data-owner', '3');
  await shot(page, 'spectator');
});

test('U12: 2인 게임 가운데 정렬(간격 유지) · 도장 12곳 +n · 기록 빈 1위는 열기구(U13)', async ({ page }) => {
  await open(page, 'n=2&ranks=1,0');
  await expect(page.locator('[data-k="rank"] li')).toHaveCount(2);
  const xs = await page.locator('.end-foot').evaluateAll((fs) => fs.map((f) => f.getBoundingClientRect().left));
  const k = await page.evaluate(() => { const s = document.querySelector<HTMLElement>('.rs-stage')!; return s.getBoundingClientRect().width / s.offsetWidth; });
  expect(Math.abs(Math.abs(xs[0] - xs[1]) / k - 171.5)).toBeLessThan(2); // 슬롯 간격 172(시안, cos 4.4° 포함 ≈ 171.5)
  await expect(page.locator('.end-cp')).toHaveCount(1);
  await shot(page, 'two-players');
  await open(page, 'stamps=12');
  await expect(page.locator('[data-k="pin"]')).toHaveCount(8);
  await expect(page.locator('[data-k="pin-more"]')).toContainText('+4');
  const st = await page.locator('.end-stamp-t').evaluateAll((ts) => ts.map((t) => {
    const ring = t.parentElement!.querySelector('.end-stamp-ring')!.getBoundingClientRect();
    return { t: t.textContent, f: parseFloat(getComputedStyle(t).fontSize), w: t.getBoundingClientRect().width, ring: ring.width };
  }));
  for (const s of st) {
    expect(s.f, s.t!).toBeGreaterThanOrEqual(14);
    expect(s.w, s.t!).toBeLessThan(s.ring - 2);
  }
  await shot(page, 'stamps12');
  await open(page, 'bare=1&ranks=0,1,2,3');
  await expect(page.locator('.end-lm:not(.end-balloon)')).toHaveCount(0); // U13: 랜드마크 0 → 열기구
  await expect(page.locator('.end-balloon')).toBeVisible();
  const broken = await page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.rs img')].filter((i) => i.offsetParent !== null && !(i.complete && i.naturalWidth > 0)).length);
  expect(broken).toBe(0);
});

test('U12: 그림 미로드(END-·엔딩 포즈 404) — 흰 틀·F00 얼굴·글자, S9 셀렉터 전부', async ({ page }) => {
  await page.route(/\/webp\/(hi\/)?(END-|CH\d-P2[01])/, (r) => r.fulfill({ status: 404, body: '' }));
  const errors = await open(page, 'kind=final');
  await expect(page.locator('.end-fb-frame')).toBeVisible();
  await expect(page.locator('.end-face')).toHaveCount(4);
  await expect(page.locator('.end-fb-title')).toBeVisible(); // 틀 그림이 없을 때만 코드 손글씨 제목
  await expect(page.locator('.end-fb-n')).toHaveCount(4); // 로제트 그림이 없을 때만 코드 숫자
  await expect(page.locator('.end-name').first()).toBeVisible();
  for (const sel of ['[data-k="rank"]', '[data-k="learn"]', '[data-k="rates"]', '[data-k="row"]', '[data-k="level4"]', '[data-k="mtags"]', '[data-k="stamps"]', '[data-k="gains"]', '[data-k="magnets"]', '[data-k="map"]', '[data-k="tab"]', '[data-k="pin"]']) {
    expect(await page.locator(sel).count(), sel).toBeGreaterThanOrEqual(1);
  }
  await shot(page, 'fallback');
  expect(errors).toEqual([]);
});

test('U12 §19.6: 움직임 줄이기 = 1초 안에 전부, 기본 = 약 6초 소개 뒤 정지', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${BASE}/dev/results?kind=final`);
  // 한 번 띄워 그림을 받아 둔다(첫 요청엔 개발 서버 변환 시간이 섞인다)
  await page.addScriptTag({ type: 'module', url: '/src/ui/results/harness.tsx' });
  await page.waitForSelector('.end-done');
  await page.waitForLoadState('networkidle');
  await page.reload();
  const t0 = Date.now();
  await page.addScriptTag({ type: 'module', url: '/src/ui/results/harness.tsx' });
  await page.waitForSelector('.end-calm.end-done');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.end-stage')!).opacity === '1' && getComputedStyle(document.querySelector('.end-cp')!).opacity === '1');
  expect(Date.now() - t0).toBeLessThan(1000);
  // 기본: 소개 중(end-intro) → 7초 뒤 정지 장면(end-done), 하트 링 맥동
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await page.addScriptTag({ type: 'module', url: '/src/ui/results/harness.tsx' });
  await page.waitForSelector('.end-intro');
  expect(await page.locator('.end-cp').first().evaluate((e) => getComputedStyle(e).opacity)).toBe('0'); // 닫힌 여권은 맨 끝(6초)
  await page.waitForSelector('.end-done', { timeout: 9000 });
  expect(await page.locator('.end-cp').first().evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
});

test('U12 hi: 1920×1080 dpr1 — 사진 배경·틀·포즈·여권이 hi, 배율비 ≥ 1', async ({ browser }) => {
  test.skip(test.info().project.name !== 'desktop', 'PC 1920 만');
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dev/results?kind=final`);
  await page.addScriptTag({ type: 'module', url: '/src/ui/results/harness.tsx' });
  await page.waitForSelector('.end-done');
  await page.waitForLoadState('networkidle');
  const r = await page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.end-bg, .end-hero, .end-frame, .end-book-img')].map((i) => {
    const b = i.getBoundingClientRect(); // 회전 상자라 조금 크게 잰다(보수적)
    return { src: i.currentSrc.replace(/.*\/webp\//, ''), nw: i.naturalWidth, dev: Math.round(b.width * devicePixelRatio), ratio: i.naturalWidth / (b.width * devicePixelRatio) };
  }));
  const bg = r.find((x) => /END-photo-bg/.test(x.src))!;
  expect(bg.src).toBe('hi/END-photo-bg.webp');
  expect(bg.nw).toBe(2048);
  expect(bg.dev).toBeLessThanOrEqual(2048);
  for (const x of r) {
    expect(x.src, x.src).toMatch(/^hi\//);
    expect(x.ratio, x.src).toBeGreaterThanOrEqual(1);
  }
  await ctx.close();
});

test('빈 로그: 빈 상태 문구, 예외 0', async ({ page }) => {
  const errors = await open(page, 'scenario=empty');
  await expect(page.locator('[data-k="empty"]')).toContainText('아직 한 번도 주사위를 굴리지 않았어요');
  await expect(page.locator('[data-k="tab"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ── U13 §19.9.6: 혼자 + 봇 3(사용자 반려 캡처와 같은 판) — 표본 16 으로 그리는 경로 ──
const groupBox = (sel: string) => `(() => { const out = []; for (const e of document.querySelectorAll('${sel}')) { let x = 0, y = 0, n = e; while (n && !n.classList.contains('end-photo')) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; } out.push({ x, y, w: e.offsetWidth, h: e.offsetHeight }); } return out; })()`;

test('U13 시안 배치: 혼자+봇3 — 메달 포즈·그림 글자·손글씨(Gaegu ≥16 multiply)·발 기준선·아래 테', async ({ page }) => {
  const errors = await open(page, 'solo=1');
  // 포즈 = 메달 그린 그림(1위 봇 자리 2 금+트로피, 2위 자리 1 은, 3위 자리 3 동, 4위 나 CH4 크림), 코드 목 메달 0
  const heroes = await page.locator('.end-hero').evaluateAll((is) => is.map((i) => (i as HTMLImageElement).src.replace(/.*\/webp\/(hi\/)?/, '')));
  expect(heroes).toEqual(['CH7-P20-gold-s2.webp', 'CH7-P21-silver-s1.webp', 'CH7-P21-bronze-s3.webp', 'CH4-P21-plain.webp']);
  await expect(page.locator('.end-neck')).toHaveCount(0);
  // 그림 글자: 로제트 숫자 4 · 틀 제목 · 여권 v2 · 탭 — 코드 숫자·제목 0
  expect(await page.locator('.end-ro-img').evaluateAll((is) => is.map((i) => (i as HTMLImageElement).src.replace(/.*\//, '')))).toEqual(['END-rosette-1.webp', 'END-rosette-2.webp', 'END-rosette-3.webp', 'END-rosette-4.webp']);
  await expect(page.locator('.end-frame')).toHaveAttribute('src', /END-photo-frame-v2/);
  await expect(page.locator('.end-book-img')).toHaveAttribute('src', /END-passport-open-4-v2/);
  await expect(page.locator('.end-fb-title, .end-fb-n')).toHaveCount(0);
  await expect(page.locator('.end-fb-label').first()).toBeHidden();
  // 랜드마크 0 → 열기구, 깨진 그림 0, 세운 여권 3
  await expect(page.locator('.end-balloon')).toBeVisible();
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.rs img')].filter((i) => i.offsetParent !== null && !(i.complete && i.naturalWidth > 0)).length)).toBe(0);
  await expect(page.locator('.end-cp')).toHaveCount(3);
  // 첫 장 코드 글자 전수: Gaegu · ≥ 16px · 700 · multiply(자기 또는 손글씨 조상)
  const bad = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.end-photo *, .end-book *, .end-closed *')]
    .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden')
    .map((e) => { const cs = getComputedStyle(e); const ink = e.closest<HTMLElement>('.end-hand, .end-name') ?? e; return { t: e.textContent!.trim().slice(0, 10), fam: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), size: parseFloat(cs.fontSize), w: cs.fontWeight, blend: getComputedStyle(ink).mixBlendMode }; })
    .filter((x) => x.fam !== 'Gaegu' || x.size < 16 || x.w !== '700' || x.blend !== 'multiply'));
  expect(bad).toEqual([]);
  // 시안 배치(2026-11-01): 발 기준선 한 줄(그룹 y 차 ≤ 3) · 사람 키 350 · 로봇 = 0.63배(아이와 덩치 비슷) · 트로피 위끝 ≥ 창 위 + 10 · 하트 링 0
  const feet = await page.locator('.end-foot').evaluateAll((fs) => fs.map((f) => ({ seat: (f as HTMLElement).closest('li')!.dataset.seat, body: Number((f as HTMLElement).dataset.body), top: Number((f as HTMLElement).dataset.top), y: parseFloat((f as HTMLElement).style.top) })));
  expect(Math.max(...feet.map((f) => f.y)) - Math.min(...feet.map((f) => f.y))).toBeLessThanOrEqual(3);
  expect(feet.find((f) => f.seat === '3')!.body).toBe(350);
  for (const f of feet.filter((x) => x.seat !== '3')) expect(f.body).toBe(Math.round(350 * 0.63));
  for (const f of feet) expect(f.top).toBeGreaterThanOrEqual(38);
  await expect(page.locator('.end-heart')).toHaveCount(0);
  // 아래 테(그룹 좌표): 로제트 → 테이프 → 제목(틀 그림) 순서로 겹침 0, 테이프 아래변 ≤ 630
  const ros = await page.evaluate(groupBox('.end-rosette')) as { y: number; h: number }[];
  const tapes = await page.evaluate(groupBox('.end-tape')) as { y: number; h: number }[];
  for (const t of tapes) expect(t.y + t.h).toBeLessThanOrEqual(632);
  expect(Math.max(...ros.map((r) => r.y + r.h))).toBeLessThanOrEqual(Math.min(...tapes.map((t) => t.y)));
  // 세운 여권(시안처럼 아래로 조금 나감 — 얼굴 창은 화면 안)·탭이 오른쪽 띠 안, 펼친 여권이 사진 오른쪽 끝에 걸침
  const k = await page.evaluate(() => { const s = document.querySelector<HTMLElement>('.rs-stage')!; const b = s.getBoundingClientRect(); return { k: b.width / s.offsetWidth, x: b.left, y: b.top }; });
  const st = await page.locator('.end-cp, .end-tab').evaluateAll((es) => es.map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right }; }));
  for (const b of st) {
    expect((b.r - k.x) / k.k).toBeLessThanOrEqual(1366);
    expect((b.l - k.x) / k.k).toBeGreaterThanOrEqual(760);
  }
  const wins = await page.locator('.end-cp .end-cp-win').evaluateAll((es) => es.map((e) => e.getBoundingClientRect().top));
  for (const t of wins) expect((t - k.y) / k.k).toBeLessThan(768 - 40);
  const overlap = await page.evaluate(() => document.querySelector('.end-book')!.getBoundingClientRect().left < document.querySelector('.end-frame')!.getBoundingClientRect().right);
  expect(overlap).toBe(true);
  await fits(page);
  await page.screenshot({ path: `${SHOTS13}sample-solo-bots-${test.info().project.name}.png` });
  // 탭: 접근성 이름 · 클릭 → 둘째 장 → 돌아가기 → 첫 장 · Enter 도 같음
  const tab = page.getByRole('button', { name: '자세히 보기' });
  await expect(tab).toHaveClass(/end-tab/);
  await tab.click();
  await expect(page.locator('[data-k="detail-page"]')).toBeVisible();
  await page.locator('[data-k="detail"]').click();
  await expect(page.locator('[data-k="detail-page"]')).toBeHidden();
  await page.getByRole('button', { name: '자세히 보기' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-k="detail-page"]')).toBeVisible();
  await page.locator('[data-k="detail"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.end-book')).toBeVisible();
  expect(errors).toEqual([]);
});

test('U13: 이름 7자(형용사+동물)가 테이프 안에 22px(넘치면 20px) — 말줄임 0', async ({ page }) => {
  for (const name of ['씩씩한 고슴도치', '명랑한 너구리']) {
    await open(page, `solo=1&name=${encodeURIComponent(name)}`);
    const r = await page.locator('.end-person.is-me .end-name').evaluate((e) => ({ f: parseFloat(getComputedStyle(e).fontSize), over: e.scrollWidth > e.clientWidth + 1, ell: getComputedStyle(e).textOverflow, t: e.textContent }));
    expect(r.t).toBe(name);
    expect(r.f).toBeGreaterThanOrEqual(20);
    expect(r.over, name).toBe(false);
    expect(r.ell).not.toBe('ellipsis');
  }
});
