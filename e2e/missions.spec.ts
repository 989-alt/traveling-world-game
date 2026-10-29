// T08 미션 5유형 e2e. 개발 하네스(src/ui/missions/harness.tsx)를 vite 개발 서버로 띄워 진짜 DOM·포인터 이벤트로 시험한다.
// desktop 프로젝트 = 마우스, tablet-touch 프로젝트 = CDP 터치(Pointer Events pointerType=touch).
import { expect, test, type Browser, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/T08-shots/', import.meta.url));
const missions = JSON.parse(readFileSync(`${ROOT}src/data/missions.json`, 'utf8')) as {
  id: string; type: string; explain: string; pairs?: { left: string; right: string }[]; steps?: string[]; options?: { text: string; correct: boolean }[];
}[];
const M = (id: string) => missions.find((m) => m.id === id)!;

let BASE = '';
let server: ViteDevServer;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  server = await createServer({
    root: ROOT,
    configFile: `${ROOT}vite.config.ts`,
    server: { port: 0 },
    optimizeDeps: { entries: ['index.html', 'src/ui/missions/harness.tsx'], include: ['preact', 'preact/hooks', 'preact/compat', 'preact/jsx-runtime'] },
    logLevel: 'error',
  });
  await server.listen();
  BASE = server.resolvedUrls!.local[0].replace(/\/$/, '');
  mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(async () => { await server?.close(); });

interface Rec { sent: { pairs?: number[][]; steps?: number[]; selected?: number[]; ms: number }[]; tf: boolean[]; reward: { index: number }[] }
const rec = (page: Page) => page.evaluate(() => (window as unknown as { __mission: Rec }).__mission);

async function open(page: Page, query: string) {
  // /dev/missions 는 index.html 을 받아 앱(main.tsx)도 띄운다. 앱 화면·CSS(T07 뒤 screens·overlays)가 하네스 배치를 흔들므로 앱은 막는다
  await page.route(/\/src\/main\.tsx(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`${BASE}/dev/missions?${query}`);
  await page.addScriptTag({ type: 'module', url: '/src/ui/missions/harness.tsx' });
  await page.waitForFunction(() => '__mission' in window);
}

const center = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
};

/** 손가락(CDP 터치)·마우스 어느 쪽이든 같은 모양으로 끈다 */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const touch = test.info().project.name === 'tablet-touch';
  if (!touch) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    return;
  }
  const c = await page.context().newCDPSession(page);
  const tp = (x: number, y: number) => [{ x, y, id: 1 }];
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(from.x, from.y) });
  for (let i = 1; i <= 10; i++) await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10) });
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await c.detach();
}

const tapEl = async (page: Page, sel: string) => {
  const { x, y } = await center(page, sel);
  if (test.info().project.name === 'tablet-touch') await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
};

/** 블록 i 를 칸 i 에 끌어다 놓는다(정답 자리) */
async function dropBlock(page: Page, i: number, slot = i) {
  await drag(page, await center(page, `[data-block="${i}"]`), await center(page, `[data-slot="${slot}"]`));
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}${name}-${test.info().project.name}.png` });
const submit = (page: Page) => page.getByRole('button', { name: '다 했어요' }).click();

// ── 파일 ──
test('지도: 파일 존재·글자 0·라이선스', () => {
  const svg = readFileSync(`${ROOT}assets/maps/world.svg`, 'utf8');
  expect(svg).not.toMatch(/<text|<tspan/);
  expect(svg).toContain('data-c="asia"');
  expect(existsSync(`${ROOT}assets/maps/LICENSE.txt`)).toBe(true);
});

// ── 블록 놓기 ──
test('블록 놓기(지도): 끌어서 모두 놓고 제출 → 번호 꾸러미', async ({ page }) => {
  await open(page, 'm=m-09');
  await expect(page.locator('.mp')).toHaveAttribute('data-type', 'block');
  expect(await page.locator('.wm').count()).toBe(1);
  const area = await page.locator('.mp-area').evaluate((e) => getComputedStyle(e).touchAction);
  expect(area).toBe('none'); // 끌기 영역만
  expect(await page.locator('.mp-submit').evaluate((e) => getComputedStyle(e).touchAction)).not.toBe('none');
  const s0 = (await page.locator('[data-slot="0"]').boundingBox())!;
  expect(Math.min(s0.width, s0.height)).toBeGreaterThanOrEqual(56); // 드롭 타깃 ≥56px
  for (let i = 0; i < 3; i++) await dropBlock(page, i);
  await shot(page, 'block-partial');
  await expect(page.getByRole('button', { name: '다 했어요' })).toBeDisabled(); // 다 채워야 누를 수 있다
  await dropBlock(page, 3);
  await shot(page, 'block-map');
  await submit(page);
  const r = await rec(page);
  expect(r.sent).toHaveLength(1);
  expect(r.sent[0].pairs).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  await expect(page.locator('.mp')).toHaveAttribute('data-locked', '1');
});

test('블록 놓기: 칸 밖에 놓으면 원위치(transform 만), 스냅은 24px 안쪽만', async ({ page }) => {
  await open(page, 'm=m-12');
  const blk = '[data-block="0"]';
  const from = await center(page, blk);
  const tray = await page.locator('.pl-tray .blk').count();
  await drag(page, from, { x: from.x + 4, y: 6 }); // 화면 맨 위 빈 곳
  await page.waitForTimeout(450);
  expect(await page.locator('.pl-tray .blk').count()).toBe(tray); // 트레이에 그대로
  expect(await page.locator(blk).evaluate((e) => getComputedStyle(e).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  // 바깥 40px → 안 붙음, 바깥 20px → 붙음
  const s = (await page.locator('[data-slot="0"]').boundingBox())!;
  await drag(page, await center(page, blk), { x: s.x + s.width + 40, y: s.y + s.height / 2 });
  await page.waitForTimeout(450);
  expect(await page.locator('[data-slot="0"] .blk').count()).toBe(0);
  await drag(page, await center(page, blk), { x: s.x + s.width + 20, y: s.y + s.height / 2 });
  expect(await page.locator('[data-slot="0"] .blk').count()).toBe(1);
});

test('블록 놓기: 탭으로 고르고 칸 탭, 칸 위 블록은 서로 바꿔 앉는다', async ({ page }) => {
  await open(page, 'm=m-12');
  await tapEl(page, '[data-block="0"]');
  await tapEl(page, '[data-slot="1"]');
  expect(await page.locator('[data-slot="1"] [data-block="0"]').count()).toBe(1);
  await dropBlock(page, 1, 1); // 칸 1 에 이미 0 이 있음 → 1 이 앉고 0 은 트레이로
  expect(await page.locator('[data-slot="1"] [data-block="1"]').count()).toBe(1);
  expect(await page.locator('.pl-tray [data-block="0"]').count()).toBe(1);
});

test('블록 놓기: 기후 구역(지도 + 칸 색)', async ({ page }) => {
  await open(page, 'm=m-11');
  expect(await page.locator('.wm[data-mode="zones"]').count()).toBe(1);
  expect(await page.locator('.wm #zones').evaluate((e) => getComputedStyle(e).display)).not.toBe('none');
  await shot(page, 'block-zones');
});

// ── 연결하기 ──
test('연결하기: 끌어서 잇고, 다시 이으면 이전 선이 사라진다', async ({ page }) => {
  await open(page, 'm=m-01');
  const m = M('m-01');
  const rightOf = (l: number) => `[data-end="r${l}"]`; // 오른쪽 id = pairs 번호(정답은 같은 번호)
  await drag(page, await center(page, '[data-end="l0"]'), await center(page, rightOf(1))); // 일부러 틀리게
  await expect(page.locator('.cn-line:not(.cn-line--live)')).toHaveCount(1);
  await drag(page, await center(page, '[data-end="l0"]'), await center(page, rightOf(0))); // 다시 잇기
  await expect(page.locator('.cn-line:not(.cn-line--live)')).toHaveCount(1);
  expect(await page.locator('.cn-line:not(.cn-line--live)').getAttribute('data-r')).toBe('0');
  await drag(page, await center(page, '[data-end="l1"]'), await center(page, rightOf(0))); // 이미 이은 오른쪽 → 앞 선 사라짐
  await expect(page.locator('.cn-line:not(.cn-line--live)')).toHaveCount(1);
  await drag(page, await center(page, '[data-end="l0"]'), await center(page, rightOf(0)));
  for (let i = 1; i < m.pairs!.length; i++) await drag(page, await center(page, `[data-end="l${i}"]`), await center(page, rightOf(i)));
  await expect(page.locator('.cn-line:not(.cn-line--live)')).toHaveCount(m.pairs!.length);
  await shot(page, 'connect');
  await submit(page);
  expect((await rec(page)).sent[0].pairs).toEqual(m.pairs!.map((_, i) => [i, i]));
});

test('연결하기: 탭 두 번으로도 잇는다', async ({ page }) => {
  await open(page, 'm=m-01');
  await tapEl(page, '[data-end="l2"]');
  await tapEl(page, '[data-end="r2"]');
  await expect(page.locator('.cn-line:not(.cn-line--live)')).toHaveCount(1);
  expect(await page.locator('.cn-line').first().getAttribute('data-l')).toBe('2');
});

// ── 순서 맞히기 ──
test('순서 맞히기: 칸 순서대로 제출', async ({ page }) => {
  await open(page, 'm=m-16');
  const n = M('m-16').steps!.length;
  for (let i = 0; i < n; i++) await dropBlock(page, i);
  await shot(page, 'order');
  await submit(page);
  expect((await rec(page)).sent[0].steps).toEqual([0, 1, 2, 3, 4]);
});

// ── 사진 고르기 ──
const optIndex = (id: string, text: string) => M(id).options!.findIndex((o) => o.text === text);
test('사진 고르기: 모두 고름 — 고른 번호 집합을 보낸다', async ({ page }) => {
  await open(page, 'm=m-23&real=1'); // 그림 있는 모습(원본 PNG)
  await expect(page.locator('.mi-img').first()).toBeVisible();
  await expect(page.locator('.ch-text')).toHaveCount(0); // 그림이 뜨면 이름 글자는 숨긴다(답 노출 방지)
  expect(await page.locator('.mi-img').first().getAttribute('alt')).toBeTruthy(); // 이름은 aria 로만
  const want = [optIndex('m-23', '히말라야산맥'), optIndex('m-23', '알프스산맥')];
  for (const i of want) await tapEl(page, `[data-opt="${i}"]`);
  await expect(page.locator('.ch-card.is-on')).toHaveCount(2);
  await shot(page, 'photo');
  await submit(page);
  expect((await rec(page)).sent[0].selected).toEqual([...want].sort((a, b) => a - b));
});

test('그림이 없거나 404 여도 글자 카드로 끝까지 진행(멈춤 0)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let notFound = 0;
  page.on('response', (r) => { if (r.url().includes('__404__')) notFound += r.status() === 404 || r.status() === 200 ? 1 : 0; });
  await open(page, 'm=m-24&bad=1');
  await expect(page.locator('.ch-card')).toHaveCount(4);
  await page.waitForTimeout(600);
  await expect(page.locator('.mi-img')).toHaveCount(0); // 로드 실패 → 그림 없이 글자 카드
  expect(notFound).toBeGreaterThan(0); // 정말 그림 주소를 요청했다
  await expect(page.locator('.ch-card .ch-text')).toHaveCount(4); // 그림 실패 → 글자 카드로 이름이 보인다
  await expect(page.locator('.ch-card .ch-text').first()).toBeVisible();
  await tapEl(page, `[data-opt="${optIndex('m-24', '사하라 사막')}"]`);
  await submit(page);
  expect((await rec(page)).sent).toHaveLength(1);
  expect(errors).toEqual([]);
  await shot(page, 'photo-404');
});

// ── 그래프 읽기 ──
test('그래프 읽기: 데이터 SVG(막대 12·선 1·1~12월·범례), 세 도시 나란히', async ({ page }) => {
  await open(page, 'm=m-35');
  await expect(page.locator('.cg-svg')).toHaveCount(3);
  for (const key of ['london', 'rome', 'seoul']) {
    const svg = page.locator(`.cg-svg[data-city="${key}"]`);
    await expect(svg.locator('.cg-bar')).toHaveCount(12);
    await expect(svg.locator('.cg-line')).toHaveCount(1);
    await expect(svg.locator('.cg-tick--x')).toHaveText(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
  }
  await expect(page.locator('.cg-legend')).toContainText('강수량(mm)');
  await expect(page.locator('.cg-legend')).toContainText('기온(℃)');
  const want = M('m-35').options!.flatMap((o, i) => (o.correct ? [i] : []));
  for (const i of want) await tapEl(page, `[data-opt="${i}"]`);
  await shot(page, 'graph');
  await submit(page);
  expect((await rec(page)).sent[0].selected).toEqual(want);
});

test('그래프 읽기: 읽는 법을 묻는 m-33 은 모양만(범례·눈금 숫자 없음)', async ({ page }) => {
  await open(page, 'm=m-33');
  await expect(page.locator('.cg-legend')).toHaveCount(0);
  await expect(page.locator('.cg-tick--l')).toHaveCount(0);
  await expect(page.locator('.cg-bar')).toHaveCount(12);
});

// ── 타이머 ──
test('타이머 만료: 지금 상태 그대로 제출(부분 정답), 이후 입력 잠금', async ({ page }) => {
  await open(page, 'm=m-12&dur=3000');
  await dropBlock(page, 0);
  await dropBlock(page, 1);
  await page.waitForFunction(() => (window as unknown as { __mission: Rec }).__mission.sent.length === 1, undefined, { timeout: 6000 });
  const r = await rec(page);
  expect(r.sent[0].pairs).toEqual([[0, 0], [1, 1]]); // 2/4 — 서버가 실패로 판정
  await expect(page.locator('.mp')).toHaveAttribute('data-locked', '1');
  await expect(page.locator('.blk').first()).toBeDisabled();
  await dropBlock(page, 2).catch(() => {}); // 잠긴 뒤 끌어도
  await page.waitForTimeout(300);
  expect((await rec(page)).sent).toHaveLength(1);
  expect(await page.locator('[data-slot="2"] .blk').count()).toBe(0);
});

// ── 관전 4 컨텍스트 ──
test('관전 3명: 읽기 전용, 끝나면 참/거짓 1탭(4 컨텍스트)', async ({ browser }) => {
  const use = test.info().project.use;
  const ctxs = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ viewport: use.viewport ?? undefined, hasTouch: use.hasTouch, isMobile: use.isMobile })));
  const pages = await Promise.all(ctxs.map((c) => c.newPage()));
  await Promise.all(pages.map((p, i) => open(p, `m=m-12&role=${i === 0 ? 'player' : 'spectator'}`)));
  for (const p of pages.slice(1)) {
    await expect(p.locator('.mp')).toHaveAttribute('data-role', 'spectator');
    await expect(p.locator('.mp-area')).toHaveAttribute('aria-disabled', 'true');
    await expect(p.locator('.mp-submit')).toHaveCount(0);
    const from = await center(p, '[data-block="0"]').catch(() => null);
    if (from) {
      const s = (await p.locator('[data-slot="0"]').boundingBox())!;
      await p.mouse.move(from.x, from.y);
      await p.mouse.down();
      await p.mouse.move(s.x + 10, s.y + 10, { steps: 5 });
      await p.mouse.up();
    }
    expect(await p.locator('[data-slot] .blk').count()).toBe(0); // 드래그 불가
  }
  await shot(pages[1], 'spectator-play');
  await Promise.all(pages.map((p) => p.evaluate(() => (window as unknown as { __mission: { finish: (b: boolean) => void } }).__mission.finish(true))));
  await expect(pages[0].locator('.tf')).toHaveCount(0); // 푼 사람은 참/거짓 안 함
  for (const p of pages.slice(1)) {
    await expect(p.locator('.tf')).toBeVisible();
    await p.getByRole('button', { name: '참', exact: true }).click();
    expect((await rec(p)).tf).toEqual([true]);
    await expect(p.getByRole('button', { name: '거짓' })).toBeDisabled(); // 1탭 뒤 잠김
  }
  await shot(pages[1], 'spectator-tf');
  await Promise.all(ctxs.map((c) => c.close()));
});

// ── 보상 ──
test('보상 선택: 하나 고르기', async ({ page }) => {
  await open(page, 'view=reward&opts=travelTile,island,doubleRoll');
  await expect(page.locator('.rw-card')).toHaveCount(3);
  await shot(page, 'reward');
  await tapEl(page, '[data-reward="island"]');
  expect((await rec(page)).reward).toEqual([{ index: 1 }]);
  await expect(page.locator('.rw-card').first()).toBeDisabled();
});

test('보상 선택: 10초(여기선 2초) 무응답이면 첫 번째, 한 번만', async ({ page }) => {
  await open(page, 'view=reward&opts=toStart,island&rdur=2000');
  await page.waitForFunction(() => (window as unknown as { __mission: Rec }).__mission.reward.length > 0, undefined, { timeout: 5000 });
  await page.waitForTimeout(600);
  expect((await rec(page)).reward).toEqual([{ index: 0 }]);
});

test('표시 목록(shown)이 없으면(옛 방) 활동 없이 기다림, 제출·자동 제출 없음, 오류 0', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, 'm=m-09&noshown=1&dur=1500');
  await expect(page.locator('.mp-foot .mp-status')).toHaveText('잠시 기다려요');
  await expect(page.locator('.mp-wait')).toBeVisible();
  await expect(page.locator('.mp-submit')).toHaveCount(0);
  await expect(page.locator('.mp [data-block], .mp [data-end]')).toHaveCount(0);
  await page.waitForTimeout(2000); // 마감이 지나도 빈 답을 보내지 않는다
  expect((await rec(page)).sent).toEqual([]);
  expect(errors).toEqual([]);
});

// ── 보드 크기에서 한 화면 ──
test('화면에 다 들어온다(가로 스크롤 없음)', async ({ page }) => {
  for (const id of ['m-09', 'm-11', 'm-16', 'm-20', 'm-27', 'm-30', 'm-35']) {
    await open(page, `m=${id}`);
    const ok = await page.evaluate(() => {
      const p = document.querySelector('.mp')!.getBoundingClientRect();
      return { fitH: p.bottom <= innerHeight + 1 && p.top >= -1, fitW: p.right <= innerWidth && p.left >= 0, noX: document.documentElement.scrollWidth <= innerWidth };
    });
    expect(ok, id).toEqual({ fitH: true, fitW: true, noX: true });
  }
});

// ── 실패 해설(PRD §3.5, QA r3): 판정 뒤 실패한 도착자 화면에만 유형별 정답 + explain ──
const RV_SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/QA3-fix-shots/', import.meta.url));
const rvShot = (page: Page, name: string) => { mkdirSync(RV_SHOTS, { recursive: true }); return page.screenshot({ path: `${RV_SHOTS}${name}-${test.info().project.name}.png` }); };
const finish = (page: Page, ok: boolean) => page.evaluate((v) => (window as unknown as { __mission: { finish: (b: boolean) => void } }).__mission.finish(v), ok);
/** 해설 띠: explain 문장 그대로, 크림 판, 글자 ≥16px, 패널이 화면 안 */
async function expectExplain(page: Page, id: string) {
  const ex = page.locator('.mp-explain-text');
  await expect(ex).toHaveText(M(id).explain);
  const st = await ex.evaluate((e) => {
    const p = document.querySelector('.mp')!.getBoundingClientRect();
    return { fs: parseFloat(getComputedStyle(e).fontSize), bg: getComputedStyle(e.parentElement!).backgroundImage, fitH: p.bottom <= innerHeight + 1, noX: document.documentElement.scrollWidth <= innerWidth };
  });
  expect(st.fs).toBeGreaterThanOrEqual(16);
  expect(st.bg).toContain('linear-gradient');
  expect(st.noX).toBe(true);
  expect(st.fitH).toBe(true); // 해설 띠까지 한 화면(1366×768·1180×820)
  await expect(page.locator('.mp-explain-tag')).toHaveText('아쉬워요! 정답을 확인해요');
  await expect(page.locator('.mp-loot')).toHaveCount(0); // 보상 띠 자리를 해설 띠가 쓴다
}

test('실패 해설 · 연결: 내 선은 남고 틀린 선은 회색 점선, 정답 쌍 초록 선이 위에 겹친다', async ({ page }) => {
  await open(page, 'm=m-01');
  const n = M('m-01').pairs!.length;
  await expect(page.locator('.mp-explain')).toHaveCount(0); // 풀이 중엔 없음
  for (let i = 0; i < n - 1; i++) await drag(page, await center(page, `[data-end="l${i}"]`), await center(page, `[data-end="r${(i + 1) % n}"]`)); // 셋 틀리게
  await drag(page, await center(page, `[data-end="l${n - 1}"]`), await center(page, `[data-end="r0"]`));
  await submit(page);
  await finish(page, false);
  await expect(page.locator('.cn-mine')).toHaveCount(n); // 내 선 그대로
  await expect(page.locator('.cn-mine.is-wrong')).toHaveCount(n);
  expect(await page.locator('.cn-mine.is-wrong .cn-line').first().evaluate((e) => getComputedStyle(e).strokeDasharray)).not.toBe('none');
  await expect(page.locator('.cn-line--key')).toHaveCount(n);
  for (let i = 0; i < n; i++) await expect(page.locator(`.cn-line--key[data-l="${i}"][data-r="${i}"]`)).toHaveCount(1); // 하네스: 정답 = 같은 번호
  // 정답 선이 내 선보다 위(나중에 그림)
  expect(await page.locator('.cn-lines').evaluate((svg) => { const g = [...svg.children]; return g.findIndex((x) => x.classList.contains('cn-key')) > g.findIndex((x) => x.classList.contains('cn-mine')); })).toBe(true);
  await expectExplain(page, 'm-01');
  await page.waitForTimeout(500);
  await rvShot(page, 'connect-fail');
});

test('실패 해설 · 블록(지도): 자리 위 정답 이름 칩, 잘못 놓은 블록 흐리게, 맞은 칸 체크', async ({ page }) => {
  await open(page, 'm=m-09');
  await dropBlock(page, 0, 1);
  await dropBlock(page, 1, 0);
  await dropBlock(page, 2, 2);
  await dropBlock(page, 3, 3);
  await submit(page);
  await finish(page, false);
  await expect(page.locator('.slot-key')).toHaveCount(2);
  await expect(page.locator('[data-slot="0"] .slot-key')).toHaveText(M('m-09').pairs![0].left);
  await expect(page.locator('[data-slot="1"] .slot-key')).toHaveText(M('m-09').pairs![1].left);
  await expect(page.locator('.blk.is-miss')).toHaveCount(2);
  await expect(page.locator('.slot-ok')).toHaveCount(2);
  await expectExplain(page, 'm-09');
  await page.waitForTimeout(500);
  await rvShot(page, 'block-map-fail');
});

test('실패 해설 · 블록(줄 칸): 시간 초과로 일부만 놓아도 빈 칸·남은 조각까지 정답 칩', async ({ page }) => {
  await open(page, 'm=m-12&dur=3000');
  await dropBlock(page, 1, 0);
  await page.waitForFunction(() => (window as unknown as { __mission: Rec }).__mission.sent.length === 1, undefined, { timeout: 6000 });
  await finish(page, false);
  await expect(page.locator('.slot-key')).toHaveCount(4);
  await expect(page.locator('.blk.is-miss')).toHaveCount(4); // 잘못 놓인 1 + 트레이에 남은 3
  await expect(page.locator('[data-slot="0"] [data-block="1"]')).toHaveCount(1); // 내 배치는 그대로
  await expectExplain(page, 'm-12');
  await page.waitForTimeout(500);
  await rvShot(page, 'block-rows-timeout');
});

test('실패 해설 · 순서: 정답 순서 한 줄, 잘못 놓은 조각 흐리게', async ({ page }) => {
  await open(page, 'm=m-16');
  const st = M('m-16').steps!;
  for (let i = 0; i < st.length; i++) await dropBlock(page, i, st.length - 1 - i); // 거꾸로
  await submit(page);
  await finish(page, false);
  await expect(page.locator('.mp-keystep span')).toHaveText(st);
  await expect(page.locator('.mp-keynum')).toHaveText(st.map((_, i) => String(i + 1)));
  await expect(page.locator('.blk.is-miss')).toHaveCount(st.length - 1); // 가운데 하나는 제자리
  await expect(page.locator('.slot-key')).toHaveCount(0); // 순서는 칩 대신 한 줄
  await expectExplain(page, 'm-16');
  await page.waitForTimeout(500);
  await rvShot(page, 'order-fail');
});

test('실패 해설 · 사진: 정답 사진 초록 테 + 체크, 내 오답 회색', async ({ page }) => {
  await open(page, 'm=m-23&real=1');
  const wrong = optIndex('m-23', '사하라 사막');
  await tapEl(page, `[data-opt="${wrong}"]`);
  await tapEl(page, `[data-opt="${optIndex('m-23', '히말라야산맥')}"]`);
  await submit(page);
  await finish(page, false);
  const keys = M('m-23').options!.flatMap((o, i) => (o.correct ? [i] : []));
  await expect(page.locator('.ch-card.is-key')).toHaveCount(keys.length);
  for (const i of keys) await expect(page.locator(`[data-opt="${i}"]`)).toHaveClass(/is-key/);
  await expect(page.locator(`[data-opt="${wrong}"]`)).toHaveClass(/is-miss/);
  await expect(page.locator(`[data-opt="${wrong}"] .ch-check`)).toHaveText('✕');
  for (const i of keys) await expect(page.locator(`[data-opt="${i}"] .ch-check`)).toHaveText('✓');
  await expectExplain(page, 'm-23');
  await page.waitForTimeout(500);
  await rvShot(page, 'photo-fail');
});

test('실패 해설 · 그래프: 정답 선지 초록, 모양만 그리던 m-33 도 눈금·범례가 켜진다', async ({ page }) => {
  await open(page, 'm=m-33');
  await expect(page.locator('.cg-legend')).toHaveCount(0);
  await tapEl(page, `[data-opt="${optIndex('m-33', '막대는 기온이에요')}"]`);
  await submit(page);
  await finish(page, false);
  await expect(page.locator('.cg-legend')).toHaveCount(1);
  await expect(page.locator('.cg-legend')).toContainText('강수량(mm)');
  expect(await page.locator('.cg-tick--l').count()).toBeGreaterThan(0);
  const keys = M('m-33').options!.flatMap((o, i) => (o.correct ? [i] : []));
  await expect(page.locator('.ch-card.is-key')).toHaveCount(keys.length);
  await expectExplain(page, 'm-33');
  await page.waitForTimeout(500);
  await rvShot(page, 'graph-fail');
});

test('성공이면 해설 없음, 관전자는 실패해도 해설 없음(참/거짓만)', async ({ browser }) => {
  const use = test.info().project.use;
  const ctxs = await Promise.all(Array.from({ length: 2 }, () => browser.newContext({ viewport: use.viewport ?? undefined, hasTouch: use.hasTouch, isMobile: use.isMobile })));
  const [me, other] = await Promise.all(ctxs.map((c) => c.newPage()));
  await open(me, 'm=m-01');
  await open(other, 'm=m-01&role=spectator');
  await finish(me, true);
  await finish(other, false);
  await expect(me.locator('.mp-status')).toHaveText('성공! 보상을 골라요');
  for (const p of [me, other]) {
    await expect(p.locator('.mp-explain, .cn-line--key, .slot-key, .mp-keyrow, .ch-card.is-key')).toHaveCount(0);
    expect(await p.locator('body').innerText()).not.toContain(M('m-01').explain);
  }
  await expect(other.locator('.tf')).toBeVisible();
  await rvShot(other, 'spectator-fail-tf');
  await Promise.all(ctxs.map((c) => c.close()));
});

export type _B = Browser;

// ── QA4: 실제 게임처럼 Stage 배율(scale) 안에서 좌표가 맞는가 ──
// 1366×768 은 배율 1 이라 어긋남이 안 보인다. 태블릿(1180×820 ≈0.86)·1024×768(0.75)에서 선 끝·끄는 블록이 손가락·항목에 붙어야 한다
const VIEWS = [{ width: 1366, height: 768 }, { width: 1180, height: 820 }, { width: 1024, height: 768 }];
const TOL = 5;
/** 선 path 의 양 끝(화면 좌표)과 이어진 항목 끝점(왼쪽 항목 오른쪽 가운데·오른쪽 항목 왼쪽 가운데)의 거리 */
const lineErrors = (page: Page, sel: string) => page.evaluate((s) => [...document.querySelectorAll<SVGPathElement>(s)].flatMap((e) => {
  const m = e.getScreenCTM()!;
  const a = e.getPointAtLength(0).matrixTransform(m), z = e.getPointAtLength(e.getTotalLength()).matrixTransform(m);
  const l = document.querySelector(`[data-end="l${e.dataset.l}"]`)!.getBoundingClientRect();
  const r = document.querySelector(`[data-end="r${e.dataset.r}"]`)!.getBoundingClientRect();
  return [Math.hypot(a.x - l.right, a.y - l.top - l.height / 2), Math.hypot(z.x - r.left, z.y - r.top - r.height / 2)];
}), sel);
const stageScale = (page: Page) => page.locator('.ov-stage').evaluate((e) => e.getBoundingClientRect().width / (e as HTMLElement).offsetWidth);

/** 누른 채 to 까지 옮기고, 떼기 전에 check 를 부른다(마우스·CDP 터치) */
async function dragHold(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, check: () => Promise<void>) {
  const touch = test.info().project.name === 'tablet-touch';
  if (!touch) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await check();
    await page.mouse.up();
    return;
  }
  const c = await page.context().newCDPSession(page);
  const tp = (x: number, y: number) => [{ x, y, id: 1 }];
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(from.x, from.y) });
  for (let i = 1; i <= 10; i++) await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10) });
  await check();
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await c.detach();
}

for (const v of VIEWS) {
  const tag = `${v.width}×${v.height}`;
  test(`배율 좌표 · 연결(${tag}): 끌기·탭 선과 끄는 중 선 끝이 항목·손가락에서 ${TOL}px 안, 실패 정답선도`, async ({ page }) => {
    await page.setViewportSize(v);
    await open(page, 'm=m-01&stage=1');
    await page.locator('[data-end="l0"]').waitFor();
    const k = await stageScale(page);
    if (v.width < 1366) expect(k).toBeLessThan(0.95); // 정말 축소 배율에서 시험한다
    const n = M('m-01').pairs!.length;
    // 끄는 중: 살아 있는 선 끝 = 손가락 자리
    const to = await center(page, `[data-end="r1"]`);
    const tgt = { x: to.x - 40, y: to.y + 10 }; // 항목 밖 빈 곳(스냅 범위 밖은 아니어도 됨 — 떼기 전에 잰다)
    await dragHold(page, await center(page, '[data-end="l0"]'), tgt, async () => {
      // 터치 마지막 pointermove 는 다음 프레임에 그려진다 → 잠깐 기다리며 잰다
      await expect.poll(async () => { const end = await page.locator('.cn-line--live').evaluate((e: SVGPathElement) => { const p = e.getPointAtLength(e.getTotalLength()).matrixTransform(e.getScreenCTM()!); return { x: p.x, y: p.y }; }); return Math.hypot(end.x - tgt.x, end.y - tgt.y); }, { timeout: 2000 }).toBeLessThan(TOL);
    });
    // 끌어서 잇기(틀리게: l i → r i+1)
    for (let i = 0; i < n - 1; i++) await drag(page, await center(page, `[data-end="l${i}"]`), await center(page, `[data-end="r${i + 1}"]`));
    // 탭 두 번으로 잇기
    await tapEl(page, `[data-end="l${n - 1}"]`);
    await tapEl(page, '[data-end="r0"]');
    await expect(page.locator('.cn-mine')).toHaveCount(n);
    const mine = await lineErrors(page, '.cn-mine .cn-line');
    expect(mine).toHaveLength(2 * n);
    expect(Math.max(...mine), `풀이 선 끝 오차 ${mine.map((e) => e.toFixed(1))}`).toBeLessThan(TOL);
    // 실패 해설: 정답선·내 선 모두
    await submit(page);
    await finish(page, false);
    await expect(page.locator('.cn-line--key')).toHaveCount(n);
    await page.waitForTimeout(400);
    const key = await lineErrors(page, '.cn-line--key');
    expect(key).toHaveLength(2 * n);
    expect(Math.max(...key), `정답선 끝 오차 ${key.map((e) => e.toFixed(1))}`).toBeLessThan(TOL);
    expect(Math.max(...(await lineErrors(page, '.cn-mine .cn-line')))).toBeLessThan(TOL);
  });

  test(`배율 좌표 · 블록 끌기(${tag}): 지도·구역·줄 칸·순서 모두 끄는 블록이 손가락 이동을 ${TOL}px 안으로 따라가고 칸에 앉는다`, async ({ page }) => {
    await page.setViewportSize(v);
    for (const id of ['m-09', 'm-11', 'm-12', 'm-16']) {
      await open(page, `m=${id}&stage=1`);
      await page.locator('[data-block="0"]').waitFor();
      if (v.width < 1366) expect(await stageScale(page)).toBeLessThan(0.95);
      const from = await center(page, '[data-block="0"]');
      const to = await center(page, '[data-slot="1"]');
      await dragHold(page, from, to, async () => {
        // 끄는 동안 블록이 화면에서 움직인 거리(translate × 배율) = 손가락이 움직인 거리. 배율을 안 나누면 0.75 배만 따라간다
        await expect.poll(async () => {
          const t = await page.locator('[data-block="0"]').evaluate((e) => { const m = new DOMMatrix(getComputedStyle(e).transform); const st = e.closest('.ov-stage') as HTMLElement; const k = st.getBoundingClientRect().width / st.offsetWidth; return { x: m.e * k, y: m.f * k }; });
          return Math.hypot(t.x - (to.x - from.x), t.y - (to.y - from.y));
        }, { message: `${id} 끄는 블록 이동 ↔ 손가락 이동`, timeout: 2000 }).toBeLessThan(TOL);
      });
      await expect(page.locator('[data-slot="1"] [data-block="0"]')).toHaveCount(1);
      // 탭으로도: 블록 1 고르고 빈 칸 0 탭
      await tapEl(page, '[data-block="1"]');
      await tapEl(page, '[data-slot="0"]');
      await expect(page.locator('[data-slot="0"] [data-block="1"]')).toHaveCount(1);
    }
  });
}

// U1 그림 카드: 그림 카드 자리(연결 양쪽·블록 왼쪽 조각)에 아이콘으로 떨어지는 항목 0, 그림이 실제로 뜬다
const U1_SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/U1-art-shots/', import.meta.url));
const allLoaded = (page: Page) => page.waitForFunction(() => {
  const imgs = [...document.querySelectorAll<HTMLImageElement>('.la--img img')];
  return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
});
test('U1 m-04 기후와 집: 냉대·얼음집 포함 8장 모두 그림 카드(아이콘 0)', async ({ page }) => {
  mkdirSync(U1_SHOTS, { recursive: true });
  await open(page, 'm=m-04');
  await expect(page.locator('.cn-pic')).toHaveCount(8);
  await expect(page.locator('.la--icon')).toHaveCount(0);
  await allLoaded(page);
  const srcOf = (label: string) => page.locator('[data-end]', { hasText: label }).locator('.la--img img').getAttribute('src');
  expect(await srcOf('냉대')).toMatch(/MC-taiga\.webp$/);
  expect(await srcOf('얼음집')).toMatch(/MC-igloo\.webp$/);
  await page.screenshot({ path: `${U1_SHOTS}m-04-connect-${test.info().project.name}.png` });
});
test('U1 연결·블록 미션 전부: 그림 카드 자리에 아이콘 0, 그림 로드 성공', async ({ page }) => {
  test.setTimeout(120_000);
  const ids = missions.filter((m) => m.type === 'connect' || m.type === 'block').map((m) => m.id);
  expect(ids).toHaveLength(15);
  for (const id of ids) {
    await open(page, `m=${id}`);
    await allLoaded(page);
    expect(await page.locator('.la--icon').count(), id).toBe(0);
  }
});
