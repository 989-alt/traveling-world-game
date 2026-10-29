// QA4-css: 앱 전체 CSS(진짜 번들: 로비·보드·캐릭터·결과 CSS 까지)를 실은 진짜 게임 화면(Room 연결)에서 미션 40개를 1366×768 로 잰다.
// 미션 하네스는 미션 CSS 만 실어서 로비 .slot·캐릭터 .ch 같은 전역 규칙이 새어 드는 것을 못 잡았다(QA r4 무효 라운드 실측).
// 미션마다: 패널이 스테이지 안 · 선택지·조각·칸이 다 스테이지 안이고 그 자리를 누르면 그 요소가 맞는다(elementFromPoint)
//          → 진짜 클릭으로 일부러 틀리게 풀어 제출 → 실패 해설(정답 표시 + explain)이 스테이지 안.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MissionShown } from '../src/shared/protocol';
import { joinCode } from './helpers/entry';
import { mkdirp, nextCode, ROOT, setup, Srv, type Built } from './helpers/room-server';

const SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/QA4-css-shots/', import.meta.url));
interface M { id: string; type: string; explain: string; pairs?: { left: string; right: string }[]; steps?: string[]; options?: { text: string; correct: boolean }[] }
const missions = JSON.parse(readFileSync(`${ROOT}src/data/missions.json`, 'utf8')) as M[];
const MISSION_TILE = 6;

let B: Built;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { test.setTimeout(180_000); B = await setup('gamemis'); mkdirp(SHOTS); });
test.afterAll(async () => { await B?.close(); });

/** 스테이지(.ov-stage) 안에 다 들어오고, 가운데를 누르면 그 요소(또는 그 안)가 맞는다 */
async function fits(page: Page, sel: string, o: { hit?: boolean; min?: number } = {}) {
  const r = await page.evaluate(({ sel, hit }) => {
    const st = document.querySelector('.ov-stage')!.getBoundingClientRect();
    const s = { l: Math.max(st.left, 0), t: Math.max(st.top, 0), r: Math.min(st.right, innerWidth), b: Math.min(st.bottom, innerHeight) };
    return [...document.querySelectorAll(sel)].map((el) => {
      const b = el.getBoundingClientRect();
      const inside = b.width > 0 && b.height > 0 && b.left >= s.l - 1 && b.top >= s.t - 1 && b.right <= s.r + 1 && b.bottom <= s.b + 1;
      const at = hit ? document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) : null;
      const ok = !hit || (!!at && (at === el || el.contains(at)));
      return { what: `${sel}[${(el as HTMLElement).dataset.end ?? (el as HTMLElement).dataset.block ?? (el as HTMLElement).dataset.slot ?? (el as HTMLElement).dataset.opt ?? ''}]`, inside, ok, box: [b.left, b.top, b.width, b.height].map(Math.round).join(','), at: at ? `${at.tagName}.${at.getAttribute('class')}` : '' };
    });
  }, { sel, hit: !!o.hit });
  expect(r.length, `${sel} 개수`).toBeGreaterThanOrEqual(o.min ?? 1);
  for (const x of r) {
    expect(x.inside, `${x.what} 스테이지 안 (${x.box})`).toBe(true);
    expect(x.ok, `${x.what} 누르면 맞음 (맞은 것: ${x.at})`).toBe(true);
  }
}

/** 유형별 조작 대상(선택지·조각·칸) */
const TARGETS: Record<string, string[]> = {
  connect: ['.mp [data-end]'],
  block: ['.mp [data-block]', '.mp [data-slot]'],
  order: ['.mp [data-block]', '.mp [data-slot]'],
  photo: ['.mp .ch-card'],
  graph: ['.mp .ch-card'],
};
/** 실패 해설에서 보이는 정답 표시 */
const REVEAL: Record<string, string> = {
  connect: '.mp .cn-line--key',
  block: '.mp .slot-key, .mp .slot-ok',
  order: '.mp .mp-keyrow',
  photo: '.mp .ch-card.is-key',
  graph: '.mp .ch-card.is-key',
};

/** 진짜 클릭으로 일부러 틀리게 푼다(모든 칸·선을 채워야 '다 했어요'가 켜진다) */
async function solveWrong(page: Page, m: M, sh: MissionShown) {
  const click = (sel: string) => page.locator(sel).click({ timeout: 3000 });
  if (m.type === 'connect') {
    const n = sh.left!.length;
    for (let i = 0; i < n; i++) {
      const good = sh.right!.indexOf(m.pairs!.find((p) => p.left === sh.left![i])!.right);
      await click(`.mp [data-end="l${i}"]`);
      await click(`.mp [data-end="r${(good + 1) % n}"]`);
    }
  } else if (m.type === 'block') {
    const n = sh.left!.length;
    for (let b = 0; b < n; b++) {
      const good = sh.right!.indexOf(m.pairs!.find((p) => p.left === sh.left![b])!.right);
      await click(`.mp [data-block="${b}"]`);
      await click(`.mp [data-slot="${(good + 1) % n}"]`);
    }
  } else if (m.type === 'order') {
    const st = sh.steps!, n = st.length;
    // 칸 k 에 정답 k+1 번째 조각을 놓는다(한 칸씩 밀림 = 전부 틀림)
    for (let k = 0; k < n; k++) {
      await click(`.mp [data-block="${st.indexOf(m.steps![(k + 1) % n])}"]`);
      await click(`.mp [data-slot="${k}"]`);
    }
  } else {
    const wrong = m.options!.findIndex((o) => !o.correct);
    await click(`.mp .ch-card[data-opt="${wrong}"]`);
    await expect(page.locator(`.mp .ch-card[data-opt="${wrong}"]`)).toHaveAttribute('aria-checked', 'true');
  }
}

test('미션 40개: 앱 전체 CSS 를 실은 게임 화면에서 패널·선택지·조각·칸이 스테이지 안이고 눌리며, 실패 해설도 스테이지 안', async ({ browser }) => {
  test.skip(test.info().project.name !== 'desktop', '1366×768 데스크톱 한 번만');
  test.setTimeout(600_000);
  const srv = new Srv(B.RoomCtor, nextCode('TWGM'));
  const ctx = await browser.newContext({ baseURL: B.base, viewport: { width: 1366, height: 768 } });
  await ctx.routeWebSocket(/\/api\/rooms\/[A-Z0-9]{6}\/ws$/, (route) => srv.attach(route, 'a'));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await joinCode(page, srv.code);
  await page.locator('.pick[data-char="1"]').click();
  await page.locator('[data-act="start"]').click();
  await expect(page.locator('.board-root')).toBeVisible();
  // 앱 전체 CSS 가 실렸는지: 로비·캐릭터 규칙이 이 문서에 있어야 이 시험이 뜻이 있다
  const sheets = await page.evaluate(() => [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText); } catch { return []; } }).join('\n'));
  for (const sel of ['.lobby-seats', '.bc-sprite', '.mp-explain', '.rs-stage']) expect(sheets, `번들 CSS 에 ${sel}`).toContain(sel);

  for (const m of missions) {
    await test.step(m.id, async () => {
      srv.do((g) => { g.usedMissionIds = missions.filter((x) => x.id !== m.id).map((x) => x.id); }); // 이 미션만 남김
      srv.arrive(0, MISSION_TILE);
      const mp = page.locator('.mp');
      await expect(mp).toHaveAttribute('data-mission', m.id, { timeout: 10_000 });
      await expect(mp).toHaveAttribute('data-role', 'player');
      await expect(mp).toHaveAttribute('data-phase', 'play');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(450); // 패널 여는 애니메이션
      const sm = srv.room.stateMsg(0);
      const sh = (sm.t === 'state' ? sm.game!.turn.mission : null) as MissionShown;
      await fits(page, '.mp');
      for (const sel of TARGETS[m.type]) await fits(page, sel, { hit: true, min: 2 });
      await solveWrong(page, m, sh);
      await page.locator('.mp-submit').click({ timeout: 3000 });
      await expect(page.locator('.mp-explain-text')).toHaveText(m.explain, { timeout: 5000 });
      await expect(mp).toHaveClass(/is-reveal/);
      await page.waitForTimeout(300);
      await fits(page, '.mp');
      await fits(page, '.mp-explain');
      await fits(page, REVEAL[m.type]);
      for (const sel of TARGETS[m.type]) await fits(page, sel, { min: 2 });
      if (['m-09', 'm-16', 'm-25', 'm-33'].includes(m.id)) await page.screenshot({ path: `${SHOTS}${m.id}-fail.png` });
    });
  }
  expect(errors).toEqual([]);
  srv.stop();
  await ctx.close();
});
