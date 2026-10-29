// R4-TF1 첫 화면(R2 C1~C7) e2e: 인트로 → 팝업 1 → 2a/2b → 로비, 키보드만으로 완주, 모션 줄이기 0, 그림 미로드 대체,
// 태블릿 잘림 없음, 출처 문구 0. 스크린숏은 harness/state/traveling-world/reports/R4-TF1-shots/.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { codeValue, joinCode, openMake } from './helpers/entry';
import { mkdirp, nextCode, setup, SOURCE_RE, Srv, type Built } from './helpers/room-server';

const SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/R4-TF1-shots/', import.meta.url));
const U1_SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/U1-time-shots/', import.meta.url));
const TABLET = { width: 1180, height: 820 };

let B: Built;
test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);
test.beforeAll(async () => { test.setTimeout(120_000); B = await setup('intro'); mkdirp(SHOTS); mkdirp(U1_SHOTS); });
test.afterAll(async () => { await B?.close(); });

async function open(browser: Browser, srv: Srv | null, tag: string, o: { tablet?: boolean; reduced?: boolean; block?: RegExp } = {}) {
  const ctx = await browser.newContext({ baseURL: B.base, viewport: o.tablet ? TABLET : { width: 1366, height: 768 }, hasTouch: o.tablet, reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
  if (srv) await ctx.routeWebSocket(/\/api\/rooms\/[A-Z0-9]{6}\/ws$/, (route) => srv.attach(route, tag));
  if (o.block) await ctx.route(o.block, (r) => r.abort());
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  return { ctx, page, errors };
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}${name}.png` });
const settle = (page: Page) => page.waitForLoadState('networkidle').then(() => page.waitForTimeout(500));

/** 팝업 등장 애니메이션(떨어짐·펼침)이 끝날 때까지 */
const landed = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => !(a as CSSAnimation).animationName?.startsWith('in-')).map((a) => a.finished)));

/** 요소가 화면 안에 다 들어온다(잘림 없음) */
async function inView(page: Page, sel: string) {
  const vp = page.viewportSize()!;
  for (const b of await page.locator(sel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(b.left, sel).toBeGreaterThanOrEqual(-1);
    expect(b.top, sel).toBeGreaterThanOrEqual(-1);
    expect(b.right, sel).toBeLessThanOrEqual(vp.width + 1);
    expect(b.bottom, sel).toBeLessThanOrEqual(vp.height + 1);
  }
}

test('인트로: 로고·무대·캐릭터 6+봇·시작하기·간판 2·버전, 글 칸 0, 출처 0', async ({ browser }) => {
  const { ctx, page, errors } = await open(browser, null, 'i');
  await settle(page);
  await expect(page.locator('.in-logo')).toBeVisible();
  expect(await page.locator('h1 .in-logo').getAttribute('alt')).toBe('돌아라! 지구 한 바퀴'); // 로고 그림 alt 가 제목
  await expect(page.locator('img.in-ground')).toBeVisible();
  await expect(page.locator('.in-ch')).toHaveCount(7);
  await expect(page.locator('.in-ch--bot')).toHaveCount(1);
  await expect(page.locator('.in-shadow')).toHaveCount(7); // 접지 그림자
  // 1024 그림을 쓴다(256 은 흐림)
  for (const src of await page.locator('.in-ch-img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src))) expect(src).toMatch(/@1024\.webp$/);
  const start = page.locator('[data-act="intro-start"]');
  await expect(start).toHaveText('시작하기');
  const sb = (await start.boundingBox())!;
  expect(Math.round(sb.width)).toBe(460);
  expect(Math.round(sb.height)).toBe(104);
  await expect(page.getByRole('button', { name: '소리 끄기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '규칙 보기' })).toBeVisible();
  await expect(page.locator('.in-version')).toBeVisible();
  expect(await page.locator('input').count()).toBe(0);
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(SOURCE_RE);
  await shot(page, 'e2e-intro-desktop');
  // 규칙 간판 → 규칙 창 → 닫기
  await page.getByRole('button', { name: '규칙 보기' }).click();
  await expect(page.getByRole('dialog', { name: '게임 규칙' })).toBeVisible();
  await page.getByRole('button', { name: '알겠어요' }).click();
  // 소리 간판: 누르면 '소리 켜기'로
  await page.getByRole('button', { name: '소리 끄기' }).click();
  await expect(page.getByRole('button', { name: '소리 켜기' })).toBeVisible();
  expect(errors).toEqual([]);
  await ctx.close();
});

test('팝업 1(나무판) → 2a 코드 6칸(대문자·자동 다음 칸·붙여넣기 분배·지우기) → 뒤로 → 2b → Esc', async ({ browser }) => {
  const { ctx, page, errors } = await open(browser, null, 'p');
  await page.locator('[data-act="intro-start"]').click();
  const plank = page.getByRole('dialog', { name: '어떻게 놀까?' });
  await expect(plank).toBeVisible();
  await expect(page.locator('.pp-layer')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.35)');
  await expect(page.locator('.plank-btn')).toHaveCount(2);
  const bb = (await page.locator('.plank-btn').first().boundingBox())!;
  expect([Math.round(bb.width), Math.round(bb.height)]).toEqual([280, 120]);
  await expect(page.locator('[data-act="to-join"]')).toBeFocused(); // 첫 조작에 초점
  await expect(page.locator('.intro')).toHaveAttribute('data-still', '1'); // 인트로 모션 정지
  await settle(page);
  await shot(page, 'e2e-popup1-desktop');

  await page.locator('[data-act="to-join"]').click();
  await expect(page.getByRole('dialog', { name: '친구 방 들어가기' })).toBeVisible();
  await expect(page.locator('.code-tile')).toHaveCount(6);
  await expect(page.locator('#room-code')).toBeFocused();
  await page.keyboard.type('ab2');
  expect(await codeValue(page)).toBe('AB2');
  await expect(page.locator('.code-tile').nth(3)).toBeFocused(); // 자동 다음 칸
  await page.keyboard.type('I'); // 코드에 없는 글자(I)는 거른다
  expect(await codeValue(page)).toBe('AB2');
  await page.keyboard.press('Backspace');
  expect(await codeValue(page)).toBe('AB');
  await expect(page.locator('[data-act="join"]')).toBeDisabled();
  await page.locator('#room-code').fill('xyz789'); // 붙여넣기 6자 → 6칸
  expect(await codeValue(page)).toBe('XYZ789');
  await expect(page.locator('[data-act="join"]')).toBeEnabled();
  await shot(page, 'e2e-popup2a-desktop');
  await page.getByRole('button', { name: '뒤로' }).click();
  await expect(plank).toBeVisible();

  await page.locator('[data-act="to-make"]').click();
  await expect(page.getByRole('dialog', { name: '새 방 만들기' })).toBeVisible();
  // U1·U3: 놀이 시간 40/60/80분 말뚝 3개 한 줄(기본 40, 20 삭제), "차시" 0
  await expect(page.locator('.peg')).toHaveText(['40분', '60분', '80분']);
  await expect(page.getByRole('button', { name: '40분' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('dialog', { name: '새 방 만들기' })).toContainText('얼마나 놀까요?');
  await expect(page.getByRole('dialog', { name: '새 방 만들기' })).toContainText('같은 코드로 이어서');
  expect(await page.locator('body').innerText()).not.toMatch(/차시/);
  const pegs = await page.locator('.peg').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(Math.max(...pegs) - Math.min(...pegs)).toBeLessThanOrEqual(4); // 한 줄(눌린 말뚝만 3px 내려앉음)
  // U3: 말뚝 셋을 두루마리 가운데로(빈자리를 넓혀 채우지 않음 — 폭 110, 간격 12)
  const geo = await page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.peg')];
    const r = els.map((e) => e.getBoundingClientRect()); // 두루마리는 화면에 맞춰 축소될 수 있다 → 폭은 CSS 값(offsetWidth), 간격은 비율로
    const f = document.querySelector('.pp-form')!.getBoundingClientRect();
    return { w: els.map((e) => e.offsetWidth), gapRatio: (r[1].left - r[0].right) / r[0].width, mid: (r[0].left + r[2].right) / 2, fmid: (f.left + f.right) / 2 };
  });
  expect(geo.w).toEqual([110, 110, 110]);
  expect(geo.gapRatio).toBeCloseTo(12 / 110, 2);
  expect(Math.abs(geo.mid - geo.fmid)).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: '80분' }).click();
  await expect(page.getByRole('button', { name: '80분' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '40분' })).toHaveAttribute('aria-pressed', 'false');
  await shot(page, 'e2e-popup2b-desktop');
  await page.screenshot({ path: `${U1_SHOTS}make-popup-${test.info().project.name}.png` });
  await page.keyboard.press('Escape'); // 2b → 1
  await expect(plank).toBeVisible();
  await page.keyboard.press('Escape'); // 1 → 인트로
  await expect(page.locator('.pp-layer')).toHaveCount(0);
  await expect(page.locator('[data-act="intro-start"]')).toBeFocused();
  expect(errors).toEqual([]);
  await ctx.close();
});

test('키보드만으로: 시작하기 → 새 방(놀이 시간 60분) → 로비 / 코드 입력 → 같은 방 로비', async ({ browser }) => {
  const code = nextCode('TWKB');
  const srv = new Srv(B.RoomCtor, code);
  const host = await open(browser, srv, 'h');
  let body: unknown = null;
  await host.page.route('**/api/rooms', (r) => { body = r.request().postDataJSON(); return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ code }) }); });
  const k = host.page.keyboard;
  await k.press('Tab');
  await expect(host.page.locator('[data-act="intro-start"]')).toBeFocused();
  await k.press('Enter');
  await expect(host.page.locator('[data-act="to-join"]')).toBeFocused();
  await k.press('Tab');
  await expect(host.page.locator('[data-act="to-make"]')).toBeFocused();
  await k.press('Enter');
  await expect(host.page.getByRole('button', { name: '40분' })).toBeFocused();
  await k.press('Tab'); await k.press('Enter'); // 60분
  for (let i = 0; i < 2; i++) await k.press('Tab'); // 80분 → 방 만들기
  await expect(host.page.locator('[data-act="make"]')).toBeFocused();
  await k.press('Tab'); // 대화상자 안에서 돈다: 뒤로 간판
  await expect(host.page.getByRole('button', { name: '뒤로' })).toBeFocused();
  await k.press('Shift+Tab');
  await k.press('Enter');
  await expect(host.page.locator('.code-pill')).toBeVisible();
  expect(body).toEqual({ totalMinutes: 60, touristQuiz: false });
  await expect(host.page.locator('.lobby-sub')).toContainText('분 놀이');

  const guest = await open(browser, srv, 'g');
  await guest.page.keyboard.press('Tab');
  await expect(guest.page.locator('[data-act="intro-start"]')).toBeFocused();
  await guest.page.keyboard.press('Enter');
  await expect(guest.page.locator('[data-act="to-join"]')).toBeFocused();
  await guest.page.keyboard.press('Enter'); // 친구 방 들어가기
  await expect(guest.page.locator('#room-code')).toBeFocused();
  await guest.page.keyboard.type(code.toLowerCase());
  await guest.page.keyboard.press('Enter');
  await expect(guest.page.locator('.code-pill')).toBeVisible();
  expect(host.errors.concat(guest.errors)).toEqual([]);
  srv.stop();
  await host.ctx.close(); await guest.ctx.close();
});

test('로비(E1): 슬롯 200×330 · P01 1024 반신 · 자리색 띠 · 빈자리 로봇 — 데스크톱·태블릿 스크린숏', async ({ browser }) => {
  const srv = new Srv(B.RoomCtor, nextCode('TWLB'));
  const a = await open(browser, srv, 'a');
  await joinCode(a.page, srv.code);
  await a.page.locator('.pick[data-char="1"]').click();
  await expect(a.page.locator('.lb-slot.is-me')).toHaveCount(1);
  const b = await open(browser, srv, 'b', { tablet: true });
  await joinCode(b.page, srv.code);
  await b.page.locator('.pick[data-char="3"]').click();
  await expect(a.page.locator('.lb-slot-state', { hasText: '로봇이 함께해요' })).toHaveCount(2);
  const slot = (await a.page.locator('.lb-slot').first().boundingBox())!;
  expect([Math.round(slot.width), Math.round(slot.height)]).toEqual([200, 330]);
  const srcs = await a.page.locator('.lb-slot-char').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
  expect(srcs).toHaveLength(4);
  for (const s of srcs) expect(s).toMatch(/CH\d-P01@1024\.webp$/);
  expect(srcs.filter((s) => /CH7-P01/.test(s))).toHaveLength(2); // 빈자리 = 로봇
  for (const p of [a.page, b.page]) {
    await settle(p);
    await inView(p, '.lb-slot');
    await inView(p, '[data-act="start"], .sc-note-line');
    expect(await p.evaluate(() => document.body.innerText)).not.toMatch(SOURCE_RE);
  }
  await shot(a.page, 'e2e-lobby-desktop');
  await shot(b.page, 'e2e-lobby-tablet');
  expect(a.errors.concat(b.errors)).toEqual([]);
  srv.stop();
  await a.ctx.close(); await b.ctx.close();
});

test('태블릿 1180×820: 인트로·팝업 버튼이 잘리지 않는다 + 스크린숏', async ({ browser }) => {
  const { ctx, page } = await open(browser, null, 't', { tablet: true });
  await settle(page);
  await inView(page, '[data-act="intro-start"]');
  await inView(page, '.in-logo');
  await inView(page, '.sign-btn');
  await shot(page, 'e2e-intro-tablet');
  await page.locator('[data-act="intro-start"]').tap();
  await landed(page);
  await inView(page, '.plank-btn');
  await page.waitForTimeout(500);
  await shot(page, 'e2e-popup1-tablet');
  await page.locator('[data-act="to-join"]').tap();
  await landed(page);
  await inView(page, '.code-tile');
  await inView(page, '[data-act="join"]');
  await page.getByRole('button', { name: '뒤로' }).tap();
  await page.locator('[data-act="to-make"]').tap();
  await landed(page);
  await inView(page, '.peg');
  await inView(page, '[data-act="make"]');
  await shot(page, 'e2e-popup2b-tablet');
  await ctx.close();
});

test('모션 줄이기: 숨쉬기·펄스·떨어짐 0, 캐릭터 대기 모션 없음', async ({ browser }) => {
  const { ctx, page } = await open(browser, null, 'r', { reduced: true });
  await settle(page);
  const anim = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).animationName);
  expect(await anim('.in-logo')).toBe('none');
  expect(await anim('.intro-start-face')).toBe('none');
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await openMake(page); // 떨어짐이 없어도 열린다
  await page.keyboard.press('Escape'); // 2b → 나무판
  await expect(page.locator('.plank')).toBeVisible();
  expect(await anim('.plank')).toBe('none');
  await ctx.close();
});

test('그림 미로드(로고·무대·나무판·간판·캐릭터 404): 글자 제목·CSS 대체로 끝까지 진행', async ({ browser }) => {
  const srv = new Srv(B.RoomCtor, nextCode('TWFB'));
  const { ctx, page, errors } = await open(browser, srv, 'f', { block: /\/webp\/(LOGO-v2|UI-stage|UI-plank-panel|UI-sign-small|CH\d-P(01|12)(@1024)?)\.webp$/ });
  await settle(page);
  await expect(page.locator('.in-logo-text')).toHaveText('돌아라! 지구 한 바퀴');
  await expect(page.locator('.in-ground--css')).toBeVisible();
  await expect(page.locator('[data-act="intro-start"]')).toBeVisible();
  await shot(page, 'e2e-intro-fallback');
  await page.locator('[data-act="intro-start"]').click();
  await expect(page.locator('.plank-btn')).toHaveCount(2); // 나무판 그림 없이 나무색 판
  await settle(page);
  await shot(page, 'e2e-popup1-fallback');
  await page.locator('[data-act="to-join"]').click();
  await page.locator('#room-code').fill(srv.code);
  await page.locator('[data-act="join"]').click();
  await expect(page.locator('.lb-slot')).toHaveCount(4);
  expect(errors).toEqual([]);
  srv.stop();
  await ctx.close();
});

// ── U7-device: 시작하기 첫 탭 = 전체 화면 요청(가짜 API), 나오면 나무 간판으로 다시, 거부·미지원이어도 게임 그대로 ──
/** requestFullscreen 을 가짜로: mode ok = 들어감(fullscreenElement·fullscreenchange 흉내), reject = 거부, none = API 없음(아이폰 Safari) */
const fakeFs = (mode: 'ok' | 'reject' | 'none') => ({
  fn: (m: string) => {
    const w = window as unknown as { __fs: { calls: number; locks: number; el: Element | null; exit: () => void } };
    const st = { calls: 0, locks: 0, el: null as Element | null, exit: () => { st.el = null; document.dispatchEvent(new Event('fullscreenchange')); } };
    w.__fs = st;
    Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: () => false }); // 사람 기기처럼(제품은 자동화 브라우저에선 전체 화면을 건너뛴다)
    Object.defineProperty(Document.prototype, 'fullscreenElement', { configurable: true, get: () => st.el });
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => m !== 'none' });
    const proto = Element.prototype as unknown as Record<string, unknown>;
    if (m === 'none') { proto.requestFullscreen = undefined; proto.webkitRequestFullscreen = undefined; }
    else proto.requestFullscreen = function (this: Element) {
      st.calls++;
      if (m === 'reject') return Promise.reject(new TypeError('Permissions check failed'));
      st.el = this;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
    const o = screen.orientation as unknown as Record<string, unknown>;
    if (o) o.lock = () => { st.locks++; return Promise.reject(new DOMException('not supported', 'NotSupportedError')); };
  },
  arg: mode,
});
const fs = (page: Page) => page.evaluate(() => { const s = (window as unknown as { __fs: { calls: number; locks: number; el: Element | null } }).__fs; return { calls: s.calls, locks: s.locks, full: s.el !== null }; });

for (const mode of ['ok', 'reject', 'none'] as const) {
  test(`U7 전체 화면(${mode}): 시작하기 → ${mode === 'ok' ? '요청 1번·가로 고정 시도, 나오면 간판 → 다시 들어감' : '간판 없음'} · 로비까지 정상`, async ({ browser }) => {
    const srv = new Srv(B.RoomCtor, nextCode(`TWU${({ ok: "A", reject: "B", none: "C" } as const)[mode]}`));
    const ctx = await browser.newContext({ baseURL: B.base, viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    await ctx.routeWebSocket(/\/api\/rooms\/[A-Z0-9]{6}\/ws$/, (route) => srv.attach(route, `f${mode}`));
    const f = fakeFs(mode);
    await ctx.addInitScript(f.fn, f.arg);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    const again = page.getByRole('button', { name: '전체 화면' });
    await expect(page.locator('[data-act="intro-start"]')).toBeVisible();
    await expect(again).toHaveCount(0);
    await page.locator('[data-act="intro-start"]').tap();
    await expect(page.getByRole('dialog', { name: '어떻게 놀까?' })).toBeVisible(); // 거부·미지원이어도 팝업은 뜬다
    const st = await fs(page);
    expect(st.calls).toBe(mode === 'none' ? 0 : 1); // 첫 탭 리스너와 시작하기가 겹쳐도 요청은 한 번
    expect(st.full).toBe(mode === 'ok');
    if (mode === 'ok') expect(st.locks).toBe(1); // 가로 고정 시도(거부돼도 무시)
    await expect(again).toHaveCount(0);
    await page.locator('[data-act="to-join"]').tap();
    await page.locator('#room-code').fill(srv.code);
    await page.locator('[data-act="join"]').tap();
    await expect(page.locator('.lb-slot')).toHaveCount(4); // 로비까지 정상
    await page.locator('.pick[data-char="2"]').tap();
    await expect(page.locator('.lb-slot.is-me')).toHaveCount(1);
    if (mode === 'ok') {
      await page.evaluate(() => (window as unknown as { __fs: { exit: () => void } }).__fs.exit()); // 사용자가 전체 화면에서 나옴
      await expect(again).toBeVisible();
      const b = (await again.boundingBox())!;
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44); // 휴대폰 가로에서도 누르는 칸 48
      // 왼쪽 아래 귀퉁이, 로비 슬롯·출발 버튼과 안 겹친다
      const vp = page.viewportSize()!;
      expect(b.x).toBeLessThan(80);
      expect(b.y + b.height).toBeGreaterThan(vp.height - 80);
      for (const o of await page.locator('.lb-slot, [data-act="start"], .code-pill').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
        const hit = Math.min(b.x + b.width, o.right) - Math.max(b.x, o.left) > 0 && Math.min(b.y + b.height, o.bottom) - Math.max(b.y, o.top) > 0;
        expect(hit).toBe(false);
      }
      await page.screenshot({ path: `${SHOTS.replace('R4-TF1-shots', 'U7-device-shots')}fs-button-lobby-844x390.png` });
      await again.tap();
      await expect.poll(() => fs(page)).toMatchObject({ calls: 2, full: true });
      await expect(again).toHaveCount(0);
    } else {
      await expect(again).toHaveCount(0); // 미지원·거부 기기엔 간판 없음
    }
    expect(errors).toEqual([]);
    srv.stop();
    await ctx.close();
  });
}
