// QA5-minor: 미션 그래프 눈금 글자가 SVG viewBox 축소 + 스테이지 배율로 두 번 줄던 결함(m-35 13px → 1024×768 에서 7.09px).
// 그래프 미션 전부를 화면 3종에서 띄워 눈금 화면 글자 크기 ≥ 13px × 스테이지 배율, 월 글자 안 겹침, 패널·그래프가 스테이지 안인지 잰다.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GRAPHS = (JSON.parse(readFileSync(`${ROOT}src/data/missions.json`, 'utf8')) as { id: string; type: string }[])
  .filter((m) => m.type === 'graph').map((m) => m.id);
const SIZES = [{ width: 1366, height: 768 }, { width: 1180, height: 820 }, { width: 1024, height: 768 }];
const TICK_PX = 13;

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
});
test.afterAll(async () => { await server?.close(); });

async function open(page: Page, id: string) {
  await page.route(/\/src\/main\.tsx(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.goto(`${BASE}/dev/overlay?view=mission&m=${id}`);
  await page.addScriptTag({ type: 'module', url: '/src/dev/overlay-harness.tsx' });
  // fit 그래프는 칸을 잰 뒤(data-fit 0→1) 다시 그린다
  await page.waitForFunction(() => !!document.querySelector('.mp .cg-tick') && document.querySelector('.mp .cg')?.getAttribute('data-fit') !== '0', null, { timeout: 15_000 });
  await page.waitForTimeout(500);
}

for (const size of SIZES) {
  test(`미션 그래프 눈금 ≥ ${TICK_PX}px × 스테이지 배율 · 월 안 겹침 · 스테이지 안 (${size.width}×${size.height})`, async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', '화면 크기를 시험 안에서 바꾼다: desktop 에서만');
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    expect(GRAPHS.length).toBeGreaterThanOrEqual(8);
    for (const id of GRAPHS) {
      await open(page, id);
      const r = await page.evaluate(() => {
        const st = document.querySelector('.ov-stage') as HTMLElement;
        const sb = st.getBoundingClientRect();
        const scale = sb.width / st.offsetWidth;
        const s = { l: Math.max(sb.left, 0), t: Math.max(sb.top, 0), r: Math.min(sb.right, innerWidth), b: Math.min(sb.bottom, innerHeight) };
        const inStage = (el: Element) => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.height > 0 && b.left >= s.l - 1 && b.top >= s.t - 1 && b.right <= s.r + 1 && b.bottom <= s.b + 1;
        };
        const ticks = [...document.querySelectorAll('.mp .cg-tick')] as SVGGraphicsElement[];
        const px = ticks.map((e) => { const m = e.getScreenCTM()!; return parseFloat(getComputedStyle(e).fontSize) * Math.hypot(m.a, m.b); });
        // 월 글자: 그래프마다 이웃끼리 화면 상자가 겹치지 않는다
        let overlap = '';
        for (const svg of document.querySelectorAll('.mp .cg-svg')) {
          const xs = [...svg.querySelectorAll('.cg-tick--x')].map((e) => e.getBoundingClientRect()).sort((a, b) => a.left - b.left);
          for (let i = 1; i < xs.length; i++) if (xs[i].left < xs[i - 1].right - 0.5) overlap ||= `${svg.getAttribute('data-city')} ${i}번째`;
        }
        return {
          scale, n: ticks.length, min: Math.min(...px),
          months: [...document.querySelectorAll('.mp .cg-svg')].map((v) => v.querySelectorAll('.cg-tick--x').length),
          overlap,
          out: ['.mp', '.mp .cg', '.mp .cg-svg', '.mp .ch-card', '.mp .mp-foot'].flatMap((sel) =>
            [...document.querySelectorAll(sel)].filter((el) => !inStage(el)).map(() => sel)),
        };
      });
      const need = TICK_PX * r.scale;
      expect(r.n, `${id} 눈금 개수`).toBeGreaterThan(0);
      expect(r.min, `${id} 눈금 최소 화면 크기 ${r.min.toFixed(2)}px ≥ ${need.toFixed(2)}px (배율 ${r.scale.toFixed(3)})`).toBeGreaterThanOrEqual(need - 0.05);
      for (const k of r.months) expect([6, 12], `${id} 월 글자 수`).toContain(k);
      expect(r.overlap, `${id} 월 글자 겹침`).toBe('');
      expect(r.out, `${id} 스테이지 밖 요소`).toEqual([]);
    }
  });
}
