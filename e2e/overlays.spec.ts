// R4 T-F2 진행 화면(R2 T-D D1~D8) e2e. 개발 하네스(src/dev/overlay-harness.tsx)를 vite 개발 서버로 띄워 진짜 DOM 으로 잰다.
// 스크린숏은 harness/state/traveling-world/reports/R4-TF2-shots/ 에(v3 02·03 과 사람이 나란히 대조).
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/R4-TF2-shots/', import.meta.url));

let BASE = '';
let server: ViteDevServer;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  server = await createServer({
    root: ROOT,
    configFile: `${ROOT}vite.config.ts`,
    server: { port: 0 },
    optimizeDeps: { entries: ['index.html', 'src/dev/overlay-harness.tsx'], include: ['preact', 'preact/hooks', 'preact/compat', 'preact/jsx-runtime'] },
    logLevel: 'error',
  });
  await server.listen();
  BASE = server.resolvedUrls!.local[0].replace(/\/$/, '');
  mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(async () => { await server?.close(); });

async function open(page: Page, query: string, reduced = false) {
  await page.route(/\/src\/main\.tsx(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.goto(`${BASE}/dev/overlay?${query}`);
  await page.addScriptTag({ type: 'module', url: '/src/dev/overlay-harness.tsx' });
  await page.waitForFunction(() => '__ov' in window);
  // 그림이 다 오고 여는 애니메이션(350ms)이 끝난 뒤
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 15_000 });
  await page.waitForTimeout(700);
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}${name}.png` });
const box = (page: Page, sel: string) => page.locator(sel).first().boundingBox().then((b) => b!);

/** 화면 안에 다 들어오는가(태블릿 배율 잘림 없음) */
async function inside(page: Page, sel: string) {
  const v = page.viewportSize()!;
  const b = await box(page, sel);
  expect(b.x, `${sel} 왼쪽`).toBeGreaterThanOrEqual(0);
  expect(b.y, `${sel} 위`).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width, `${sel} 오른쪽`).toBeLessThanOrEqual(v.width + 0.5);
  expect(b.y + b.height, `${sel} 아래`).toBeLessThanOrEqual(v.height + 0.5);
}

for (const vp of [{ name: 'desktop', width: 1366, height: 768 }, { name: 'tablet', width: 1180, height: 820 }]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`문항 두루마리 D1~D4·D6 (${vp.name})`, async ({ page }) => {
      await open(page, 'view=question');
      await shot(page, `question-${vp.name}`);
      // D1 막대 44(배율 반영), 손잡이·금 캡이 종이 밖으로
      const k = (await box(page, '.ov-stage')).width / 1366;
      const bar = await box(page, '.qs-bar--top');
      expect(bar.height / k).toBeCloseTo(44, 0);
      const paper = await box(page, '.qs-paper');
      const knob = await page.locator('.qs-bar--top .sp-cap--l').evaluate((e) => { const r = e.getBoundingClientRect(); const a = getComputedStyle(e, '::after'); return r.left - parseFloat(a.width); });
      expect((paper.x - knob) / k).toBeGreaterThanOrEqual(20);
      expect((paper.x - knob) / k).toBeLessThanOrEqual(30);
      // D2 스톱워치 크라운 + 막대 중심선 위로 60%
      await expect(page.locator('.qs-timer .tm-crown')).toHaveCount(1);
      const tm = await box(page, '.qs-timer .tm');
      const mid = bar.y + bar.height / 2;
      expect((mid - tm.y) / tm.height).toBeCloseTo(0.6, 1);
      // D3 격자 없음, 스케치 2 (opacity .35)
      expect(await page.locator('.qs-paper').evaluate((e) => getComputedStyle(e).backgroundImage)).not.toContain('repeating-linear-gradient');
      await expect(page.locator('.qs-sketch')).toHaveCount(2);
      expect(await page.locator('.qs-sketch').first().evaluate((e) => getComputedStyle(e).opacity)).toBe('0.35');
      // D4 답 버튼 radius 20
      expect(await page.locator('.qs .ov-ans').first().evaluate((e) => getComputedStyle(e).borderRadius)).toBe('20px');
      // D6 문항 중 P13 → 4초 뒤 P10
      await expect(page.locator('.qs-peek')).toHaveAttribute('data-pose', 'p13');
      await expect(page.locator('.qs-peek')).toHaveAttribute('data-pose', 'p10', { timeout: 5000 });
      for (const s of ['.qs', '.qs-grid']) await inside(page, s);
      // 정답·카드 id 는 문항 단계에 없다
      const html = await page.content();
      expect(html).not.toContain('data-card');
      expect(html).not.toContain('나일강을 따라 넓은 평야');
    });

    test(`건설 미리보기 D5 (${vp.name})`, async ({ page }) => {
      await open(page, 'view=build&level=1&role=spectator');
      await shot(page, `build-${vp.name}`);
      const k = (await box(page, '.ov-stage')).width / 1366;
      const b = await box(page, '.qs-bld');
      expect(Math.round(b.width / k)).toBeGreaterThanOrEqual(238);
      await expect(page.locator('.qs-bld-fig--now img')).toHaveAttribute('src', /BLD-\d\d-1/);
      await expect(page.locator('.qs-bld-fig--next img')).toHaveAttribute('src', /BLD-\d\d-2/);
      await expect(page.locator('.qs-bld-cost')).toContainText(/\d/);
      await expect(page.locator('.qs-watch')).toBeVisible(); // 관전자도 미리보기를 본다
      for (const s of ['.qs', '.qs-bld']) await inside(page, s);
      // 4단계 앞이면 다음 = 랜드마크
      await open(page, 'view=build&level=3');
      await expect(page.locator('.qs-bld-fig--next img')).toHaveAttribute('src', /LM-\d\d/);
      await shot(page, `build-lm-${vp.name}`);
    });

    test(`문화 카드 빼꼼 P19 D7 (${vp.name})`, async ({ page }) => {
      await open(page, 'view=culture&tile=4&char=1');
      await shot(page, `culture-${vp.name}`);
      await expect(page.locator('.cc-peek')).toHaveAttribute('src', /CH1-P19/);
      // 손(뒤집힌 그림의 오른쪽)이 카드 왼쪽 테 위에 걸친다
      const c = await box(page, '.cc');
      const p = await box(page, '.cc-peek');
      expect(p.x).toBeLessThan(c.x);
      expect(p.x + p.width).toBeGreaterThan(c.x);
      await inside(page, '.cc');
      await open(page, 'view=culture&tile=16&char=7');
      await expect(page.locator('.cc-peek')).toHaveAttribute('src', /CH7-P19/);
      await shot(page, `culture-bot-${vp.name}`);
    });

    test(`해설 뒤 포즈 D6 (${vp.name})`, async ({ page }) => {
      await open(page, 'view=explain&correct=1');
      await expect(page.locator('.qs-peek')).toHaveAttribute('data-pose', 'p12');
      await shot(page, `explain-correct-${vp.name}`);
      await open(page, 'view=explain&correct=0');
      await expect(page.locator('.qs-peek')).toHaveAttribute('data-pose', 'p13');
    });
  });
}

test('모션 줄이기: 포즈 교대·여는 애니메이션 없음', async ({ page }) => {
  await open(page, 'view=question', true);
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  await page.waitForTimeout(4300);
  await expect(page.locator('.qs-peek')).toHaveAttribute('data-pose', 'p13');
});

const MISSIONS = (JSON.parse(readFileSync(`${ROOT}src/data/missions.json`, 'utf8')) as { id: string; type: string }[]);

for (const vp of [{ name: 'desktop', width: 1366, height: 768 }, { name: 'tablet', width: 1180, height: 820 }]) {
  test.describe(`미션 ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`미션 패널 D8 + 그림 카드·퍼즐 조각 (${vp.name})`, async ({ page }) => {
      for (const [m, name] of [['m-04', 'connect'], ['m-09', 'blocks'], ['m-12', 'rows'], ['m-18', 'order'], ['m-08', 'connect-countries'], ['m-11', 'zones']] as const) {
        await open(page, `view=mission&m=${m}`);
        await page.screenshot({ path: `${SHOTS}mission-${name}-${vp.name}.png` });
        // 엠블럼 머리 날개 2장(의사 요소, 금 그라데이션), 보상 띠 금테 2px, 제목 리본이 위 테에 걸침
        const wing = await page.locator('.mp-crest').evaluate((e) => [getComputedStyle(e, '::before').backgroundImage, getComputedStyle(e, '::after').backgroundImage]);
        for (const w of wing) expect(w).toContain('gradient');
        expect(await page.locator('.mp-foot').evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe('2px');
        await expect(page.locator('.mp-timer .tm-crown')).toHaveCount(1);
        await inside(page, '.mp');
      }
      // 연결: 글자 줄이 아니라 그림 카드(그림 또는 아이콘 판 + 18px 이상 글자)
      await open(page, 'view=mission&m=m-04');
      const cards = page.locator('.cn-item');
      await expect(cards).toHaveCount(8);
      expect(await page.locator('.cn-item .la').count()).toBe(8);
      const fs = await page.locator('.cn-label').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      const k = (await box(page, '.ov-stage')).width / 1366;
      expect(fs).toBeGreaterThanOrEqual(18);
      expect((await box(page, '.mp')).width / k).toBeLessThanOrEqual(640);
      await expect(page.locator('.cn-hand')).toHaveCount(1);
      for (const [l, r] of [[0, 0], [1, 1], [2, 2]]) { await page.locator(`[data-end="l${l}"]`).click(); await page.locator(`[data-end="r${r}"]`).click(); }
      await expect(page.locator('.cn-line:not(.cn-line--live)')).toHaveCount(3);
      await expect(page.locator('.cn-hand')).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}mission-connect-linked-${vp.name}.png` });
      // 블록: 퍼즐 조각(그림 + 이름), 입체 대륙 필터, 랜드마크
      await open(page, 'view=mission&m=m-09');
      expect(await page.locator('.pl-tray .blk--art .la').count()).toBe(4);
      expect(await page.locator('.wm g#land').evaluate((e) => getComputedStyle(e).filter)).toContain('wm-raise');
      expect(await page.locator('.wm-mark').count()).toBeGreaterThan(0);
      await expect(page.locator('.pl-hand')).toHaveCount(1);
      await page.locator('[data-block="0"]').click();
      await page.locator('[data-slot="0"]').click();
      await expect(page.locator('[data-slot="0"] .blk.is-snap')).toHaveCount(1);
      await expect(page.locator('.pl-hand')).toHaveCount(0);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}mission-blocks-placed-${vp.name}.png` });
    });

    test(`미션 40개 전부 판(스테이지) 안에 들어온다 (${vp.name})`, async ({ page }) => {
      test.setTimeout(240_000);
      const over: string[] = [];
      for (const m of MISSIONS) {
        await open(page, `view=mission&m=${m.id}`);
        const st = await box(page, '.ov-stage');
        for (const sel of ['.mp', '.mp-crest', '.mp-timer']) {
          const b = await box(page, sel);
          if (b.y < Math.max(0, st.y) - 0.5 || b.y + b.height > Math.min(vp.height, st.y + st.height) + 0.5 || b.x < -0.5 || b.x + b.width > vp.width + 0.5)
            over.push(`${m.id} ${sel} y${Math.round(b.y)}~${Math.round(b.y + b.height)}`);
        }
      }
      expect(over).toEqual([]);
    });
  });
}

// QA r2 4번: 한국 4단계 세 도시 비교(서울·런던·로마)는 같은 폭 세 칸, 1366×768 에서 눈금 글자 실측 13px 이상(문항·해설 카드 모두)
test('한국 4단계 세 도시 그래프: 같은 폭 세 칸, 눈금 ≥ 13px, 월 글자 안 겹침 (1366)', async ({ page }) => {
  const measure = async (root: string) => {
    await page.waitForFunction((r) => document.querySelector(`${r} .cg[data-fit="1"]`), root);
    const svgs = page.locator(`${root} svg[data-city]`);
    await expect(svgs).toHaveCount(3);
    expect(await svgs.evaluateAll((es) => es.map((e) => e.getAttribute('data-city')))).toEqual(['seoul', 'london', 'rome']);
    // 세 칸이 한 줄(같은 부모), 폭이 같다
    expect(await svgs.evaluateAll((es) => new Set(es.map((e) => e.parentElement)).size)).toBe(1);
    const ws = await svgs.evaluateAll((es) => es.map((e) => e.getBoundingClientRect().width));
    expect(Math.max(...ws) - Math.min(...ws)).toBeLessThan(1);
    const px = await page.locator(`${root} .cg-tick`).evaluateAll((es) => es.map((e) => parseFloat(getComputedStyle(e).fontSize) * (e as SVGGraphicsElement).getScreenCTM()!.a));
    expect(Math.min(...px), `${root} 눈금 글자 px`).toBeGreaterThanOrEqual(13);
    // 가로축 월 글자끼리 겹치지 않는다
    const overlap = await svgs.evaluateAll((es) => es.some((s) => {
      const r = [...s.querySelectorAll('.cg-tick--x')].map((t) => t.getBoundingClientRect()).sort((a, b) => a.left - b.left);
      return r.some((b, i) => i > 0 && b.left < r[i - 1].right);
    }));
    expect(overlap).toBe(false);
    return Math.min(...px);
  };
  await page.setViewportSize({ width: 1366, height: 768 }); // 기준이 1366×768 실측(QA r2). tablet-touch 프로젝트(1180×820, 배율 0.86)에서도 같은 화면으로 잰다
  await open(page, 'view=question&q=kr-4-q1&tile=0');
  await measure('.qs');
  await inside(page, '.qs');
  await shot(page, 'kr4-question-desktop');
  await open(page, 'view=explain&q=kr-4-q1&tile=0');
  await measure('.ex');
  await inside(page, '.ex');
  await shot(page, 'kr4-explain-desktop');
});

// U5(DESIGN §4.2 해설 카드 행, lang-review-10): 4단계 비교 카드 까닭 2줄 앞 색 꼬리표 — 같은 점(초록 answer.c)·다른 점(주황 answer.b), 14px bold, 높이 22, 글자 머리말 없음
test('해설 카드 4단계 비교: 까닭 앞 같은 점·다른 점 색 꼬리표, 1~3단계엔 없음', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await open(page, 'view=explain&q=kr-4-q1&tile=0');
  const tags = page.locator('.ex-reasons .ex-kind');
  await expect(tags).toHaveCount(2);
  await expect(tags.nth(0)).toHaveText('같은 점');
  await expect(tags.nth(1)).toHaveText('다른 점');
  const st = await tags.evaluateAll((els) => els.map((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, fs: c.fontSize, fw: c.fontWeight, h: Math.round(el.getBoundingClientRect().height / (document.querySelector('.ov-stage')!.getBoundingClientRect().width / 1366)) }; }));
  const tok = await page.evaluate(() => { const p = document.createElement('i'); document.body.append(p); const v = (n: string) => { p.style.color = `var(${n})`; return getComputedStyle(p).color; }; const r = [v('--answer-c'), v('--answer-b')]; p.remove(); return r; });
  expect(st.map((x) => x.bg)).toEqual(tok);
  for (const x of st) { expect(x.fw).toBe('700'); expect(x.h).toBe(22); }
  expect(await page.locator('.ex-reasons li').allTextContents()).not.toContainEqual(expect.stringMatching(/공통점:|차이점:/));
  await page.locator('.ex').screenshot({ path: `${SHOTS}u5-explain-kinds.png` });
  await open(page, 'view=explain&q=kr-2-q1&tile=0');
  await expect(page.locator('.ex-reasons li')).toHaveCount(2);
  await expect(page.locator('.ex-kind')).toHaveCount(0);
});
