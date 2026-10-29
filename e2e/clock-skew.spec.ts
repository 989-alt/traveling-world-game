// QA5-skew: 문항 중 새로고침(전체 다시 받기, logFrom 0)에서도 서버-기기 시계 차이를 보정한다.
// 기기 시계를 서버보다 ±60초 틀리게 한 채 새로고침 → 저장된 자리로 자동 복귀 →
//   답 버튼 4개가 켜져 있고, 남은 시간 표시가 서버 남은 시간 ±1초, 실제로 눌러서 서버가 받는다.
import { expect, test } from '@playwright/test';
import { joinCode } from './helpers/entry';
import { clock, nextCode, setup, Srv, type Built } from './helpers/room-server';

let B: Built;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { test.setTimeout(120_000); B = await setup('skew'); });
test.afterAll(async () => { await B?.close(); });

for (const off of [60_000, -60_000]) {
  test(`문항 중 새로고침, 기기 시계 ${off > 0 ? '+' : ''}${off / 1000}초 — 버튼 켜짐·남은 시간 = 서버 ±1초`, async ({ browser }) => {
    const srv = new Srv(B.RoomCtor, nextCode('TWSK'));
    const ctx = await browser.newContext({ baseURL: B.base, viewport: { width: 1366, height: 768 } });
    await ctx.routeWebSocket(/\/api\/rooms\/[A-Z0-9]{6}\/ws$/, (route) => srv.attach(route, 'a'));
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto('/');
      await joinCode(page, srv.code);
      await page.locator('.pick').first().click();
      await page.locator('[data-act="start"]').click();
      await expect(page.locator('.board-root')).toBeVisible();
      srv.arrive(0, 1);
      srv.do(() => { srv.room.act({ type: 'timeout' }); }); // 문화 카드 건너뛰고 문항으로
      await expect(page.locator('.qs[data-role="player"]')).toBeVisible({ timeout: 10_000 });
      expect(srv.g.turn.step).toBe('question');

      await page.addInitScript((d) => { const real = Date.now; Date.now = () => real() + d; }, off);
      await page.reload();
      await expect(page.locator('.qs[data-role="player"]')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(500);

      const deadlineAt = (srv.room.rec as { deadlineAt: number }).deadlineAt;
      const shown = Number(await page.locator('.qs .tm').getAttribute('data-sec'));
      const serverLeft = (deadlineAt - clock.now()) / 1000;
      expect(serverLeft, '서버엔 시간이 남아 있다').toBeGreaterThan(10);
      expect(await page.locator('.qs [data-choice]:enabled').count(), '답 버튼 4개 켜짐').toBe(4);
      await expect(page.locator('.qs')).toHaveAttribute('data-locked', '0');
      await expect(page.locator('.qs-status')).not.toHaveText('시간이 다 됐어요');
      // 표시는 정수 초(올림)이고 200ms 마다 갱신 → 서버 남은 시간도 같은 올림 초로 비교. 시계 차이를 못 고치면 60초가 어긋난다
      expect(Math.abs(shown - Math.ceil(serverLeft)), `표시 ${shown}초 vs 서버 ${serverLeft.toFixed(2)}초`).toBeLessThanOrEqual(1);

      // 실제로 눌러서 서버가 받는다(문항 → 해설)
      await page.locator('.qs [data-choice]:enabled').first().click();
      await expect.poll(() => srv.g.turn.step, { timeout: 5_000 }).not.toBe('question');
      expect(errors).toEqual([]);
    } finally {
      srv.stop();
      await ctx.close();
    }
  });
}
