// T09 결과 화면 e2e. 개발 하네스(src/ui/results/harness.tsx)를 vite 개발 서버로 띄워 진짜 DOM 으로 시험한다.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/U6-results-shots/', import.meta.url));

let BASE = '';
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
});
test.afterAll(async () => { await server?.close(); });

async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${BASE}/dev/results?${query}`);
  await page.addScriptTag({ type: 'module', url: '/src/ui/results/harness.tsx' });
  await page.waitForSelector('.rs');
  await page.waitForLoadState('networkidle');
  return errors;
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}${name}-${test.info().project.name}.png` });

/** 한 화면: 문서가 뷰포트보다 길지 않고, 카드 안에서 잘린 내용도 없다 */
async function fits(page: Page) {
  const r = await page.evaluate(() => ({
    doc: document.documentElement.scrollHeight, vh: innerHeight,
    clipped: [...document.querySelectorAll<HTMLElement>('.rs-learn, .rs-side, .rs-rank, .rs-magnets, .rs-rank-row, .rs-summary, .rs-detail')].filter((e) => e.scrollHeight > e.clientHeight + 1).map((e) => e.className),
  }));
  expect(r.doc).toBeLessThanOrEqual(r.vh);
  expect(r.clipped).toEqual([]);
}

for (const kind of ['final'] as const) { // 중간 결과는 2026-10-28 U1 에 없어졌다
  test(`${kind}: 학습 카드 요소 전부`, async ({ page }) => {
    const errors = await open(page, `kind=${kind}`);
    await expect(page.locator('.rs-title')).toHaveText('최종 결과');
    await expect(page.locator('[data-k="rank"] li')).toHaveCount(4);
    await expect(page.locator('[data-k="tab"]')).toHaveCount(4);
    // 첫 장: 금 도장 4·지도·한 줄 칩 3·랜드마크 기념품 3
    await expect(page.locator('[data-k="medals"] li')).toHaveCount(4);
    await expect(page.locator('[data-k="lines"] li')).toHaveCount(3);
    await expect(page.locator('.rs-souv-slot')).toHaveCount(3);
    await expect(page.locator('[data-k="rates"]')).toBeHidden();
    await page.locator('[data-k="detail"]').click(); // 자세히 보기(둘째 장)
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
    // 지도 핀 수 = 도장 수, 탭을 바꾸면 그 자리 도장으로
    await expect(page.locator('[data-k="pin"]')).toHaveCount(10);
    await page.locator('[data-k="tab"][data-seat="1"]').click();
    await expect(page.locator('[data-k="pin"]')).toHaveCount(2);
    await expect(page.locator('[data-k="stamps"] li')).toHaveCount(2);
    await page.locator('[data-k="tab"][data-seat="3"]').click();
    await expect(page.locator('[data-k="bot-note"]')).toBeVisible();
    await expect(page.locator('[data-k="rates"]')).toHaveCount(0);
    await page.locator('[data-k="tab"][data-seat="0"]').click();
    expect(errors).toEqual([]);
  });

  test(`${kind}: 한 화면에 들어가고(스크롤 없음) 출처·쪽수 문구가 없다`, async ({ page }) => {
    await open(page, `kind=${kind}`);
    const w = page.viewportSize()!;
    for (const seat of [0, 1, 2, 3]) {
      await page.locator(`[data-k="tab"][data-seat="${seat}"]`).click();
      if (seat === 0) await shot(page, `${kind}`);
      await fits(page);
      // 첫 장 글자는 전부 14px 이상(R4-TF1 검토)
      const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.rs-banner *, .rs-rank *, .rs-head *, .rs-summary *, .rs-action *')]
        .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && e.offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 14)
        .map((e) => `${e.className}:${getComputedStyle(e).fontSize}`));
      expect(small, `seat ${seat}`).toEqual([]);
    }
    await page.locator('[data-k="tab"][data-seat="0"]').click();
    await shot(page, 'summary');
    // 둘째 장(자세히): 같은 두루마리가 넓어지고, 탭마다 잘림 없음
    await page.locator('[data-k="detail"]').click();
    for (const seat of [0, 1, 2, 3]) {
      await page.locator(`[data-k="tab"][data-seat="${seat}"]`).click();
      await fits(page);
    }
    await page.locator('[data-k="tab"][data-seat="0"]').click();
    await shot(page, 'detail');
    await page.locator('[data-k="detail"]').click(); // 돌아가기
    await expect(page.locator('.rs-summary')).toBeVisible();
    const png = await page.screenshot();
    expect(png.length).toBeGreaterThan(1000);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(w.height);
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toMatch(/지도서|교과서|\[MCP|\[6사|\[4사|pp?\.\s?[0-9]/);
  });
}

// U6(DESIGN §16.7.4): 코드 도형 0 — <svg> 는 세계 지도 하나, 그림은 전부 result.* 에셋, 랜드마크는 필터 0(원본색), 캐릭터 발이 섬 윗면에
test('U6: 그림 에셋 결과 화면 — svg 는 지도뿐, 랜드마크 원본색, 발이 섬 위', async ({ page }) => {
  await open(page, 'kind=final');
  const r = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll('.rs svg')].filter((e) => !e.closest('.wm'));
    const imgs = [...document.querySelectorAll<HTMLImageElement>('.rs img')];
    const broken = imgs.filter((i) => i.offsetParent !== null && !(i.complete && i.naturalWidth > 0)).map((i) => i.src);
    const rs = imgs.filter((i) => /\/webp\/RS-/.test(i.src)).map((i) => i.src.replace(/.*\/webp\//, ''));
    const lmFilter = [...document.querySelectorAll<HTMLElement>('.rs-lm')].map((e) => getComputedStyle(e).filter);
    const feet = [...document.querySelectorAll<HTMLElement>('.rs-place')].map((li) => {
      const isle = li.querySelector('.rs-isle')!.getBoundingClientRect();
      const hero = li.querySelector('.rs-hero')!.getBoundingClientRect();
      return (hero.bottom - isle.top) / isle.height;
    });
    return { svgs: svgs.length, broken, rs: new Set(rs).size, lmFilter, feet };
  });
  expect(r.svgs).toBe(0);
  expect(r.broken).toEqual([]);
  expect(r.rs).toBeGreaterThanOrEqual(20); // 섬 4·이름표 4·메달 4·트로피·배너·두루마리·도장 4·지도판·핀·칩·점·버튼·고리 4·받침
  expect(r.lmFilter.every((f) => f === 'none')).toBe(true);
  // 발 앵커(§16.7.2): 섬 상자 높이의 39·46·51·56% (±3%)
  r.feet.forEach((f, i) => expect(Math.abs(f - [0.39, 0.46, 0.51, 0.56][i])).toBeLessThan(0.03));
  await page.locator('[data-k="detail"]').click();
  const wide = await page.evaluate(() => getComputedStyle(document.querySelector('.rs-scroll')!).borderImageSource);
  expect(wide).toContain('RS-scroll-wide');
});

test('빈 로그: 빈 상태 문구, 예외 0', async ({ page }) => {
  const errors = await open(page, 'scenario=empty');
  await expect(page.locator('[data-k="empty"]')).toContainText('아직 한 번도 주사위를 굴리지 않았어요');
  await expect(page.locator('[data-k="tab"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
