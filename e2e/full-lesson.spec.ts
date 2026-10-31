// T12 통합 e2e (PRD §6 S5·S6·S9 + 멈춤·이어 하기·재접속). 사람 4명(브라우저 컨텍스트 4개)이 한 방에서 40분 놀이를 끝까지 논다
// (2026-10-28 U1: 앞 20분 → 방장 멈춤 → 같은 코드로 이어 하기 → 남은 20분이 다 되면 최종 결과).
// 서버는 진짜 worker/room.ts 를 이 프로세스에서 돌리고 시계만 SPEED 배(12)로 주입한다(helpers/room-server.ts). 장면 조작 없음:
// 화면 버튼을 누르는 자동 손(브라우저 안 setInterval)과 서버 마감만으로 진행한다. 문항 답만 Node 가 정한다(정답 60%).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { clock, nextCode, seedRandom, setup, SOURCE_RE, Srv, type Built } from './helpers/room-server';
import { joinCode } from './helpers/entry';
import { apply } from '../src/engine/engine';
import { nextFloat } from '../src/engine/rng';
import type { LogEvent, Seat } from '../src/shared/types';

const BANNED_RE = /벌금|패널티|틀렸습니다/;
// 서버 시계 배율. 해설 shown 허용 창(서버 6초 ~ 9초)이 실제 시간으로 (9 − 보내는 시각)/SPEED 로 줄어든다.
// 20배일 때 기기 지연 여유가 약 117 ms 라 CPU 가 잠깐만 밀려도 한 해설의 shown 이 전부 창 밖으로 나갔다(R4-TG 실측 aq-s1-q1 [false×4], T15 ru-1-q1).
// 12배 + 보내는 시각 0.9(서버 6.3초) → 여유 약 225 ms. 앞 20분은 실제 약 100초
const SPEED = 12;
const SHOWN_AT = 0.9; // 해설 최소 표시 시간 중 기기가 shown 을 보내는 비율(서버는 표시 시간 − 1초 전에 온 것을 버린다 → 0.857 초과)
// 무작위 전부(서버 PIN·별명·주사위 시드·봇, Node 의 답 고르기, 기기 자동 손)가 이 시드에서 나온다. 실패한 판은 TW_SEED=<값> 으로 다시 돌린다
// (타이밍은 실제 시간이라 같은 판이 바이트 단위로 되풀이되지는 않는다)
const SEED = Number(process.env.TW_SEED ?? Math.floor(Math.random() * 2 ** 31));
const fnv = (x: string) => { let h = 2166136261; for (const c of x) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
function rng(seed: number) { let st = seed >>> 0; return () => { const [v, n] = nextFloat(st); st = n; return v; }; }

let B: Built;
test.describe.configure({ mode: 'serial' });
// 러너의 trace 는 끈다: 컨텍스트 여러 개가 같은 이름으로 기록돼 저장 때 ENOENT 로 깨진다(실측). 대신 기기마다 이름을 달리해 직접 기록하고 실패 때만 첨부
test.use({ trace: 'off' });
// 데스크톱 프로젝트에서만(4개 컨텍스트 × 두 프로젝트를 겹쳐 돌리면 서로 CPU 를 뺏는다. 자동 손은 터치·마우스와 무관)
const ONLY = 'desktop-solo'; // playwright.config: 다른 spec 과 겹치지 않게 혼자 도는 프로젝트
test.beforeAll(async () => { if (test.info().project.name !== ONLY) return; test.setTimeout(180_000); B = await setup('full', { uiScale: SHOWN_AT / SPEED }); });
// 서버 시계가 SPEED 배라 해설 단계는 실제 7/SPEED 초다. 기기 쪽 시간(해설 최소 표시·알림 줄·컷씬)도 이 빌드에서만 SHOWN_AT/SPEED 로 줄인다
// (해설 전체판 = 서버 6.3초). 서버는 표시 시간 − 1초(서버 6초) 전 shown 은 버리고, 마감 + 2초(서버 9초)까지 기다린다
test.afterAll(async () => { await B?.close(); });

interface Who { ctx: BrowserContext; page: Page; tag: string; errors: string[] }
const live: Who[] = [];
/** 실패하면 열려 있는 모든 기기 화면을 첨부한다(trace 는 use 가 붙인다) */
async function snapAll() {
  const info = test.info();
  for (const w of live) {
    if (!w.page.isClosed()) {
      const path = info.outputPath(`fail-${w.tag}.png`);
      await w.page.screenshot({ path }).catch(() => {});
      await info.attach(`fail-${w.tag}`, { path, contentType: 'image/png' }).catch(() => {});
    }
    const trace = info.outputPath(`trace-${w.tag}.zip`);
    await w.ctx.tracing.stop({ path: trace }).then(() => info.attach(`trace-${w.tag}`, { path: trace, contentType: 'application/zip' })).catch(() => {});
  }
}

/** 화면 버튼을 누르는 자동 손 + 화면 글 수집. 문항 답은 Node(__twPick)에게 묻는다 */
function autoplay(seed: number) {
  type W = Window & { __tw: { on: boolean; samples: number; hits: string[]; banned: string[]; seen: Record<string, number>; exSeen: string[]; pressing: number; sent: number }; __twPick(): Promise<string | null>; __twEnds(t: 'build' | 'buy' | 'takeover'): Promise<boolean> };
  const w = window as unknown as W;
  if (w.__tw) return;
  w.__tw = { on: true, samples: 0, hits: [], banned: [], seen: {}, exSeen: [], pressing: 0, sent: 0 };
  // 시드 난수(mulberry32) — 기기마다 다른 시드
  let st = seed >>> 0;
  const rand = () => { st = (st + 0x6d2b79f5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // 보낸 소켓 메시지 수: 서버가 받은 수와 같아지면 날아가는 중인 입력이 없다
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (this: WebSocket, d: string) { w.__tw.sent++; return send.call(this, d); };
  const SRC = /지도서|교과서|\[MCP|\[6사|\[4사|pp?\.\s?[0-9]/;
  const BAN = /벌금|패널티|틀렸습니다/;
  const done = new WeakSet<Element>();
  const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T & HTMLElement>(s);
  const once = (el: Element | null) => { if (!el || done.has(el)) return false; done.add(el); return true; };
  let last = '';
  setInterval(() => {
    // 화면 글: 바뀔 때마다 검사(보드·오버레이·저장·재개·결과 전부)
    const text = document.body.innerText;
    if (text !== last) {
      last = text;
      w.__tw.samples++;
      const m = text.match(SRC);
      if (m) w.__tw.hits.push(text.slice(Math.max(0, m.index! - 40), m.index! + 40));
      const b = text.match(BAN);
      if (b) w.__tw.banned.push(text.slice(Math.max(0, b.index! - 40), b.index! + 40));
    }
    for (const k of ['.cc', '.qs', '.ex', '.ex-tf', '.ap', '.evc', '.mp', '.cut', '.save', '.resume', '.rs']) if ($(k)) w.__tw.seen[k] = (w.__tw.seen[k] ?? 0) + 1;
    const ex = $('.ex');
    if (ex && !w.__tw.exSeen.includes(ex.dataset.card!)) w.__tw.exSeen.push(ex.dataset.card!);
    if (!w.__tw.on) return;
    // 주사위: 키보드로 누르고 뗀다(포인터 캡처 없이)
    const dice = $<HTMLButtonElement>('.dice-btn:not([disabled])');
    if (dice && once(dice.closest('.dice'))) {
      w.__tw.pressing++;
      dice.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      setTimeout(() => { dice.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })); done.delete(dice.closest('.dice')!); w.__tw.pressing--; }, 80 + rand() * 400);
    }
    const cc = $('.cc[data-first="0"]');
    if (cc && once(cc)) cc.click();
    const qs = $('.qs[data-role="player"][data-locked="0"]');
    if (qs && $('.qs .ov-ans:not([disabled])') && once(qs)) {
      void w.__twPick().then((c) => {
        const btn = (c !== null && $<HTMLButtonElement>(`.qs .ov-ans[data-choice="${c}"]:not([disabled])`)) || $<HTMLButtonElement>('.qs .ov-ans:not([disabled])');
        btn?.click();
      });
    }
    const tf = $('.ex-tf-btn:not([disabled])');
    if (tf && once(tf.closest('.ex'))) {
      if (rand() < 0.75) $<HTMLButtonElement>(`.ex-tf-btn[data-tf="${rand() < 0.5}"]`)?.click(); // 1/4 은 무응답
    }
    const ap = $('.ap');
    if (ap && once(ap)) {
      void (async () => {
        let pick: HTMLButtonElement | null = null;
        for (const a of ['build', 'buy', 'takeover', 'pay', 'pass']) {
          const b = ap.querySelector<HTMLButtonElement>(`[data-act="${a}"]:not([disabled])`);
          if (b && !(a !== 'pay' && a !== 'pass' && await w.__twEnds(a as 'build' | 'buy' | 'takeover'))) { pick = b; break; }
        }
        if (pick) setTimeout(() => pick!.click(), 50);
        else done.delete(ap);
      })();
    }
  }, 60);
}

async function player(browser: Browser, srv: Srv, tag: string): Promise<Who> {
  // SPEED 배 가속 서버 시계: 화면의 실시간 연출(줌 카메라 0.9s + 홉×0.34s, R4 T-E)이 단계 창(문항 20s → 1.7s)을 다 먹는다 → 줌 없이(reduced-motion) 흐름만 본다
  const ctx = await browser.newContext({ baseURL: B.base, viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  await ctx.routeWebSocket(/\/api\/rooms\/[A-Z0-9]{6}\/ws$/, (route) => srv.attach(route, tag));
  await ctx.tracing.start({ name: tag, screenshots: true, snapshots: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  // 문항 답: 서버가 아는 정답으로 60% 정답, 나머지는 다른 선지
  const pickRand = rng(SEED ^ fnv(`pick:${tag}`));
  await page.exposeFunction('__twPick', () => {
    const q = srv.g?.turn.step === 'question' ? srv.g.turn.question : null;
    if (!q) return null;
    if (pickRand() < 0.6) return String(q.answer);
    return typeof q.answer === 'boolean' ? String(!q.answer) : String(((q.answer as number) + 1 + Math.floor(pickRand() * 3)) % 4);
  });
  // 사기·인수로 판이 끝나면(한 대륙 독점) 멈춤·이어 하기 장면을 못 본다(규칙상 가능한 승리, 시드·타이밍에 따라 앞 절반에 나왔다 — T15 실측).
  // 자동 손은 판을 끝낼 사기·인수·건설(4칸 대륙 ㉒)만 건너뛴다(엔진으로 미리 적용해 본다). 규칙·서버는 그대로
  await page.exposeFunction('__twEnds', (type: 'build' | 'buy' | 'takeover') => { // 4칸 대륙은 건설로도 독점(㉒)
    const g = srv.g;
    return !!g && g.phase === 'playing' && apply(g, { type, seat: g.turn.seat }, srv.room.content).phase === 'finished';
  });
  await page.addInitScript(autoplay, SEED ^ fnv(`hand:${tag}`));
  await page.goto('/');
  const w = { ctx, page, tag, errors };
  live.push(w);
  return w;
}

const tw = (p: Page) => p.evaluate(() => (window as unknown as { __tw: { samples: number; hits: string[]; banned: string[]; seen: Record<string, number>; exSeen: string[] } }).__tw);
/** 자동 손을 멈춘 뒤: 눌린 주사위가 다 떼어지고, 기기가 보낸 메시지를 서버가 다 받을 때까지 */
async function settled(srv: Srv, ps: Who[]) {
  for (const p of ps) {
    await p.page.waitForFunction(() => (window as unknown as { __tw: { pressing: number } }).__tw.pressing === 0);
    const sent = await p.page.evaluate(() => (window as unknown as { __tw: { sent: number } }).__tw.sent);
    await expect.poll(() => srv.got.filter((x) => x.tag === p.tag).length).toBe(sent);
  }
}
const setAuto = (ps: Who[], on: boolean) => Promise.all(ps.map((p) => p.page.evaluate((v) => { (window as unknown as { __tw: { on: boolean } }).__tw.on = v; }, on)));
type Ev<K extends LogEvent['ev']> = Extract<LogEvent, { ev: K }>;

/** S5: 해설마다 shownTo 4명 전부 + 도착자 뺀 3명의 tf_answer(null 포함) */
function s5(log: LogEvent[]) {
  const bad: string[] = [];
  let n = 0;
  log.forEach((e, i) => {
    if (e.ev !== 'explanation') return;
    n++;
    const arriver = ([...log.slice(0, i)].reverse().find((x) => x.ev === 'answer') as Ev<'answer'>).seat;
    const end = log.findIndex((x, j) => j > i && (x.ev === 'dice' || x.ev === 'explanation' || x.ev === 'mission' || x.ev === 'clock'));
    const tfa = log.slice(i + 1, end < 0 ? undefined : end).filter((x): x is Ev<'tf_answer'> => x.ev === 'tf_answer');
    const seats = tfa.map((x) => x.seat).sort();
    const want = ([0, 1, 2, 3] as Seat[]).filter((s) => s !== arriver);
    if (e.shownTo.length !== 4 || !e.shownTo.every(Boolean)) bad.push(`${e.qid} shownTo=${JSON.stringify(e.shownTo)}`);
    if (JSON.stringify(seats) !== JSON.stringify(want)) bad.push(`${e.qid} tf_answer seats=${JSON.stringify(seats)} want=${JSON.stringify(want)}`);
  });
  return { n, bad };
}

const SHOWN = (p: Page) => p.locator('.game').getAttribute('data-step');

/** 다음에 새로 뜨는 해설 카드(해설 단계)를 그리자마자 이 탭을 가린다(visibilityState hidden + visibilitychange). 그 카드 id 를 돌려준다 */
const hideOnNextExplain = (p: Page) => p.evaluate(() => new Promise<string>((done) => {
  const before = document.querySelector('.ex');
  const h = setInterval(() => {
    const ex = document.querySelector<HTMLElement>('.game[data-step="explanation"] .ex');
    if (!ex || ex === before) return;
    clearInterval(h);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    done(ex.dataset.card!);
  }, 4);
}));
const unhide = (p: Page) => p.evaluate(() => {
  delete (document as unknown as Record<string, unknown>).visibilityState;
  delete (document as unknown as Record<string, unknown>).hidden;
  document.dispatchEvent(new Event('visibilitychange'));
});

test('40분 놀이 전체: 사람 4명 동시 입장 → 가속 시계 → 앞 20분 S5 · 방장 멈춤 PIN · 다른 기기 PIN 복귀 · 이어 하기(남은 시간 그대로) · 재접속 · 30초 봇 · 시간 끝 최종 결과 S9 · 출처 0', async ({ browser }) => {
  test.skip(test.info().project.name !== ONLY, '데스크톱에서만');
  test.setTimeout(600_000);
  clock.setRate(1);
  console.log(`[T12] TW_SEED=${SEED}`);
  test.info().annotations.push({ type: 'seed', description: `TW_SEED=${SEED}` });
  seedRandom(SEED);
  const srv = new Srv(B.RoomCtor, nextCode('TWFL'));
  const ps: Who[] = [];
  try {
    // ── 입장: 4개 컨텍스트가 동시에 들어온다 → 자리 4개 정확히 ──
    const tags = ['p0', 'p1', 'p2', 'p3'];
    const joined = await Promise.all(tags.map(async (tag, i) => {
      const p = await player(browser, srv, tag);
      await joinCode(p.page, srv.code);
      await p.page.locator(`.pick[data-char="${i}"]`).click();
      await expect(p.page.locator('.lb-slot.is-me')).toHaveCount(1);
      return p;
    }));
    ps.push(...joined);
    const seatOf = new Map(ps.map((p) => [p.tag, srv.seatOf(p.tag)!]));
    expect([...seatOf.values()].sort()).toEqual([0, 1, 2, 3]);
    expect(srv.room.rec!.seats.every((s) => s.claimed)).toBe(true);
    const host = ps.find((p) => seatOf.get(p.tag) === 0)!;
    for (const p of ps) await expect(p.page.locator('.lb-slot')).toHaveCount(4);
    await expect(host.page.locator('.lb-slot-state', { hasText: '로봇이 함께해요' })).toHaveCount(0); // 빈 자리 없음 = 봇 0

    // ── 시작 → 앞 20분을 SPEED 배 시계로(약 100초) ──
    await host.page.locator('[data-act="start"]').click();
    for (const p of ps) await expect(p.page.locator('.board-root')).toBeVisible();
    expect(srv.g.seats.every((s) => !s.isBot)).toBe(true);
    expect(srv.g.clock.remainingMs).toBeGreaterThan(39 * 60_000); // 40분 놀이(시작 직후 몇 초 흐름)
    const t0 = Date.now();
    clock.setRate(SPEED);
    await expect.poll(() => srv.g.clock.remainingMs <= 20 * 60_000 || srv.g.phase !== 'playing', { timeout: 240_000, intervals: [500] }).toBe(true);
    expect(srv.g.phase).toBe('playing');
    // ── 방장 멈춤(수업 종): 손을 멈추고 주사위 단계에서 시계를 세운 뒤 간판 두 번(확인 1탭) → 바로 멈춤 ──
    await setAuto(ps, false);
    await settled(srv, ps);
    await expect.poll(() => { if (srv.g.turn.step !== 'roll') return false; clock.setRate(0); return true; }, { timeout: 30_000, intervals: [5] }).toBe(true);
    await settled(srv, ps);
    const lessonMs = Date.now() - t0;
    await expect(host.page.locator('.ov-layer.is-dim')).toHaveCount(0, { timeout: 10_000 });
    await host.page.locator('[data-act="pause"]').click();
    await host.page.locator('[data-act="pause"]').click();
    await expect.poll(() => srv.g.phase, { timeout: 10_000 }).toBe('paused');
    const leftAtPause = srv.g.clock.remainingMs;
    expect(leftAtPause).toBeGreaterThan(0);
    expect(leftAtPause).toBeLessThanOrEqual(20 * 60_000);
    expect(lessonMs).toBeLessThan(240_000);
    const log1 = [...srv.g.log];
    expect(log1.filter((e) => e.ev === 'clock' && e.kind === 'pause')).toEqual([{ ev: 'clock', kind: 'pause', remainingMs: leftAtPause, by: 'host' }]);
    // 멈춘 동안은 시계가 안 준다(서버 시계를 돌려도)
    clock.setRate(SPEED);
    await new Promise((res) => setTimeout(res, 1000));
    clock.setRate(1);
    expect(srv.g.clock.remainingMs).toBe(leftAtPause);
    await setAuto(ps, true);

    // S5: 앞 절반의 해설 전수
    const r5 = s5(log1);
    const answers = log1.filter((e): e is Ev<'answer'> => e.ev === 'answer');
    const stats = {
      lessonRealMs: lessonMs, dice: log1.filter((e) => e.ev === 'dice').length, explanations: r5.n,
      answers: answers.length, answeredByUi: answers.filter((a) => a.choice !== null).length, correct: answers.filter((a) => a.correct).length,
      tfAnswered: log1.filter((e) => e.ev === 'tf_answer' && e.value !== null).length, tfAll: log1.filter((e) => e.ev === 'tf_answer').length,
      missions: log1.filter((e) => e.ev === 'mission').length, buys: log1.filter((e) => e.ev === 'buy').length, builds: log1.filter((e) => e.ev === 'build').length,
      botAnswers: answers.filter((a) => a.isBot).length,
    };
    console.log('[T12] lesson1', JSON.stringify(stats));
    console.log('[T12] S5', `${r5.n - new Set(r5.bad.map((b) => b.split(' ')[0])).size}/${r5.n}`, r5.bad.slice(0, 10).join(' | '));
    expect(r5.n).toBeGreaterThanOrEqual(8);
    expect(r5.bad).toEqual([]);
    // shownTo 는 기기 신호(shown)로만 true 가 된다(사람 자리). 기기마다 해설 수만큼 보냈다
    const acks = Object.fromEntries(ps.map((p) => [p.tag, srv.sent(p.tag, /"t":"shown"/)]));
    console.log('[T05c] shown acks', JSON.stringify(acks), 'explanations', r5.n);
    for (const p of ps) expect(acks[p.tag], p.tag).toBeGreaterThanOrEqual(r5.n);
    expect(stats.botAnswers).toBe(0); // 사람 4명
    expect(stats.answeredByUi).toBeGreaterThan(0); // 화면 버튼으로 실제로 답이 갔다

    // ── 멈춤 화면: 4명 모두 자기 PIN + 남은 시간 + 순위 한 줄, "차시" 없음 ──
    for (const p of ps) {
      await expect(p.page.locator('.save')).toBeVisible({ timeout: 15_000 });
      await expect(p.page.locator('.save-pin')).toHaveText(srv.room.rec!.seats[seatOf.get(p.tag)!].pin);
      await expect(p.page.locator('.pause-rank-item')).toHaveCount(4);
      await expect(p.page.locator('[data-k="time-left"]')).toBeVisible();
      expect(await p.page.locator('body').innerText()).not.toMatch(/차시/);
    }
    // ── 한 기기를 닫고 새 기기에서 PIN 으로 복귀 → 재개 화면에 공개 카드 ≥ 1 ──
    const gone = ps.find((p) => p !== host)!;
    const goneSeat = seatOf.get(gone.tag)!;
    await gone.ctx.close();
    live.splice(live.indexOf(gone), 1);
    await expect.poll(() => srv.room.rec!.seats[goneSeat].connected).toBe(false);
    const fresh = await player(browser, srv, `${gone.tag}b`);
    await joinCode(fresh.page, srv.code);
    await expect(fresh.page.locator('.pin-box')).toBeVisible();
    await fresh.page.locator('.pin-seat').nth(goneSeat).click();
    await fresh.page.locator('#seat-pin').fill(srv.room.rec!.seats[goneSeat].pin);
    await fresh.page.getByRole('button', { name: '돌아가기' }).click();
    await expect(fresh.page.locator('.resume')).toBeVisible();
    const rc = await fresh.page.locator('.rc').count();
    expect(rc).toBeGreaterThanOrEqual(1);
    expect(rc).toBe(srv.g.revealedCards.length);
    ps.splice(ps.indexOf(gone), 1, fresh);
    seatOf.set(fresh.tag, goneSeat);
    expect(srv.seatOf(fresh.tag)).toBe(goneSeat);

    // 방장: 사진 찍었어요 → 여기까지 왔어요(중간 결과 없음) → 이어서 하기 — 남은 시간 그대로
    await host.page.getByRole('button', { name: '사진 찍었어요' }).click();
    await expect(host.page.locator('.resume .save-title')).toHaveText('여기까지 왔어요');
    await expect(host.page.locator('.rs')).toHaveCount(0);
    await host.page.locator('[data-act="resume"]').click();
    for (const p of ps) await expect(p.page.locator('.board-root')).toBeVisible();
    expect(srv.g.phase).toBe('playing');
    expect(srv.g.clock.remainingMs).toBe(leftAtPause);
    expect(srv.g.log.filter((e) => e.ev === 'clock').at(-1)).toEqual({ ev: 'clock', kind: 'resume', remainingMs: leftAtPause, by: 'host' });

    // ── 재접속: 시계를 멈추고(마감·봇 0) 자동 손도 멈춘 채 소켓을 끊는다 → 10초 안에 복귀, 상태 그대로 ──
    clock.setRate(0);
    await setAuto(ps, false);
    await settled(srv, ps);
    const dropW = ps.find((p) => p !== host)!;
    const dropSeat = seatOf.get(dropW.tag)!;
    const snap = () => JSON.stringify({ players: srv.g.players, tiles: srv.g.tiles, turn: srv.g.turn, log: srv.g.log.length });
    await expect.poll(async () => (await SHOWN(dropW.page)) === srv.g.turn.step).toBe(true);
    const before = snap();
    const rejoins = srv.sent(dropW.tag, /"t":"rejoin"/);
    srv.dropSocket(dropW.tag);
    const td = Date.now();
    await expect.poll(() => srv.sent(dropW.tag, /"t":"rejoin"/), { timeout: 10_000 }).toBe(rejoins + 1);
    const backMs = Date.now() - td;
    expect(backMs).toBeLessThan(10_000);
    expect(srv.room.rec!.seats[dropSeat].connected).toBe(true);
    expect(srv.g.seats[dropSeat].isBot).toBe(false);
    expect(snap()).toBe(before);
    await expect(dropW.page.locator('.game')).toHaveAttribute('data-seat', String(dropSeat));
    await expect(dropW.page.locator('.game')).toHaveAttribute('data-step', srv.g.turn.step);
    await expect(dropW.page.locator('.net-banner')).toHaveCount(0);

    // ── 30초 넘게 끊김 → 봇 대체 + 다른 기기에 '봇' 표시. 다시 이으면 사람으로 ──
    const botW = ps.find((p) => p !== host && p !== dropW)!;
    const botSeat = seatOf.get(botW.tag)!;
    srv.blocked.add(botW.tag);
    const tb = clock.now(); // 끊는 순간의 서버 시각(시계는 아직 멈춤)
    srv.dropSocket(botW.tag);
    expect(srv.room.rec!.seats[botSeat].offSince).toBe(tb);
    clock.setRate(SPEED);
    await setAuto(ps, true);
    // 10초쯤: 아직 사람 자리
    await expect.poll(() => clock.now() - tb, { intervals: [20] }).toBeGreaterThanOrEqual(10_000);
    expect(srv.g.seats[botSeat].isBot).toBe(false);
    await expect(host.page.locator('.panel-bot')).toHaveCount(0);
    await expect.poll(() => srv.g.seats[botSeat].isBot, { timeout: 15_000, intervals: [20] }).toBe(true);
    const tBot = clock.now() - tb;
    console.log('[T12] bot after (server ms)', tBot);
    expect(tBot).toBeGreaterThanOrEqual(30_000);
    expect(tBot).toBeLessThan(30_000 + 2_000); // 알람 틱(20 ms × SPEED 배)·폴링 여유
    await expect(host.page.locator('.panel-bot')).toHaveCount(1, { timeout: 5000 });
    await expect(host.page.locator(`[aria-label*="(봇)"]`).first()).toBeVisible();
    srv.blocked.delete(botW.tag);
    await expect.poll(() => srv.room.rec!.seats[botSeat].connected, { timeout: 20_000 }).toBe(true);
    await expect.poll(() => srv.g.seats[botSeat].isBot, { timeout: 30_000 }).toBe(false); // 자기 턴이 아닐 때 사람으로
    await expect(host.page.locator('.panel-bot')).toHaveCount(0, { timeout: 5000 });

    // ── S5 음성 대조: 한 기기가 해설 카드를 띄운 직후 탭을 가리면 shown 을 보내지 않고, 그 자리만 false 로 남는다 ──
    const hid = ps.find((p) => p !== host)!;
    const hidSeat = seatOf.get(hid.tag)!;
    const from = srv.g.log.length;
    const hidCard = await hideOnNextExplain(hid.page);
    const exHid = () => srv.g.log.slice(from).find((e): e is Ev<'explanation'> => e.ev === 'explanation' && e.cardId === hidCard);
    await expect.poll(() => !!exHid(), { timeout: 15_000 }).toBe(true);
    await unhide(hid.page);
    console.log('[T05c] hidden', hid.tag, hidCard, JSON.stringify(exHid()!.shownTo));
    expect(exHid()!.shownTo[hidSeat]).toBe(false);
    expect(exHid()!.shownTo.filter((_, i) => i !== hidSeat)).toEqual([true, true, true]);
    // 그 해설 단계의 stepKey(자리|explanation|로그 길이 — 이벤트는 단계 끝에 그 자리에 남는다)로 가린 기기가 보낸 shown 0
    const at = srv.g.log.indexOf(exHid()!);
    const arriver = ([...srv.g.log.slice(0, at)].reverse().find((e) => e.ev === 'answer') as Ev<'answer'>).seat;
    expect(srv.sent(hid.tag, new RegExp(`"stepKey":"${arriver}\\|explanation\\|${at}"`))).toBe(0);
    expect(srv.got.filter((x) => x.tag !== hid.tag && x.msg.includes(`"${arriver}|explanation|${at}"`)).length).toBe(3); // 나머지 3기기는 보냄

    // 측정(단언 아님): SHOWN_WAIT_MS 기다림이 걸린 해설 수, 가린 탭 말고 false 가 남은 해설(끊긴 자리 = botSeat 는 30초 시험 때문)
    const allEx = srv.g.log.flatMap((e, i) => (e.ev === 'explanation' ? [{ e, i }] : []));
    const holdKeys = [...srv.holds.keys()];
    const extra = [...srv.holds.values()].flatMap((h) => (h.end === undefined ? [] : [h.end - h.start])).sort((a, b) => a - b);
    console.log('[T05c] measure', JSON.stringify({
      explanations: allEx.length, firstHalf: r5.n, holds: holdKeys.length, firstHalfHolds: holdKeys.filter((k) => Number(k.split('|')[2]) < log1.length).length,
      // 기다림이 실제로 늘린 서버 시간(ms): 중앙값·최댓값, 2초를 다 기다린 수
      extraMedian: extra[Math.floor(extra.length / 2)] ?? 0, extraMax: extra.at(-1) ?? 0, fullWaits: extra.filter((x) => x >= 2000).length,
      botSeat, hidSeat, falseOther: allEx.filter(({ e }) => e !== exHid() && e.shownTo.some((v) => !v)).map(({ e, i }) => `${i}:${e.shownTo.map(Number).join('')}`),
    }));

    // ── 남은 놀이 시간이 다 되면 그 턴을 마치고 최종 결과 ──
    // (멈춤 간판 누르기는 위 앞 절반 끝에서. 메뉴는 어둡게 덮는 카드 아래 층이라 가속 시계 중엔 손을 멈추고 주사위 단계에서 눌렀다 — T15 실측)
    clock.setRate(SPEED);
    await setAuto(ps, true);
    await expect.poll(() => srv.g.phase, { timeout: 240_000, intervals: [500] }).toBe('finished');
    clock.setRate(1);
    expect(srv.g.log.filter((e) => e.ev === 'clock').at(-1)).toMatchObject({ kind: 'end', by: 'timeout', remainingMs: 0 });
    for (const p of ps) await expect(p.page.locator('.rs[data-kind="final"]')).toBeVisible({ timeout: 10_000 });
    await setAuto(ps, false);

    // S9: 4명 각자 학습 카드(자기 탭) — 셀렉터 목록 고정
    const S9 = ['[data-k="rank"]', '[data-k="learn"]', '[data-k="rates"]', '[data-k="row"]', '[data-k="row"] [data-col="arrive"]', '[data-k="row"] [data-col="tf"]',
      '[data-k="level4"]', '[data-k="mtags"]', '[data-k="stamps"]', '[data-k="gains"]', '[data-k="magnets"]', '[data-k="map"]'];
    const fin = srv.g.log;
    for (const p of ps) {
      const seat = seatOf.get(p.tag)!;
      await expect(p.page.locator(`[data-k="tab"][data-seat="${seat}"]`)).toHaveAttribute('aria-selected', 'true');
      await expect(p.page.locator('[data-k="rank"] li')).toHaveCount(4);
      for (const sel of S9) expect(await p.page.locator(sel).count(), `${p.tag} ${sel}`).toBeGreaterThanOrEqual(1);
      // 도장·지도 핀: 로그의 정답 도장 나라 수와 같다(자기 자리, 사람 답만)
      // 직전 응답을 봇이 대신 한 도장은 학생 증거가 아니라 결과에서 뺀다(report.ts §9.3) — '30초 봇' 구간에 봇이 새 나라 도장을 받으면 어긋났다
      const stamps = new Set<string>();
      let botAns = false;
      for (const e of fin) {
        if (e.ev === 'answer' && e.seat === seat) botAns = !!e.isBot;
        else if (e.ev === 'stamp' && e.seat === seat && !botAns) stamps.add(e.country);
      }
      await expect(p.page.locator('[data-k="stamps"] li')).toHaveCount(stamps.size);
      // U12: 지도 핀 → 여권 나라 도장 격자 9칸(9곳 넘으면 8칸 + 마지막 칸 '+n')
      await expect(p.page.locator('[data-k="pin"]')).toHaveCount(stamps.size > 9 ? 8 : stamps.size);
      if (stamps.size > 9) await expect(p.page.locator('[data-k="pin-more"]')).toHaveAttribute('data-n', String(stamps.size - 8));
      // 마그넷 줄: 그 자리 랜드마크 나라 수(최대 4줄)
      const lm = fin.filter((e): e is Ev<'build'> => e.ev === 'build' && e.seat === seat && e.level === 4).length;
      if (lm) expect(await p.page.locator('[data-k="magnet"]').count()).toBeGreaterThanOrEqual(1);
    }
    // 방장 화면에서 탭 4개 전부: 각 자리 학습 카드가 그려진다
    await host.page.locator('[data-k="detail"]').click(); // 자세한 학습 기록은 둘째 장(자세히 보기)
    for (const s of [0, 1, 2, 3]) {
      await host.page.locator(`[data-k="tab"][data-seat="${s}"]`).click();
      await expect(host.page.locator('[data-k="rates"]')).toBeVisible();
      await expect(host.page.locator('[data-k="level4"]')).toHaveCount(1);
      await expect(host.page.locator('[data-k="gains"]')).toBeVisible();
    }
    const res = [...fin].reverse().find((e) => e.ev === 'result') as Ev<'result'>;
    await expect(host.page.locator('[data-k="rank"] li').first()).toHaveAttribute('data-seat', String(res.finalRanks[0]));

    // ── S6: 모든 화면 글(자동 손이 바뀔 때마다 모은 것) + 결과 화면 + 번들 ──
    for (const p of ps) {
      const t = await tw(p.page);
      console.log(`[T12] ${p.tag} samples=${t.samples} seen=${JSON.stringify(t.seen)} exSeen=${t.exSeen.length}`);
      expect(t.samples).toBeGreaterThan(20);
      expect(t.hits, `${p.tag} 출처`).toEqual([]);
      expect(t.banned, `${p.tag} 금지어`).toEqual([]);
      for (const k of ['.qs', '.ex', p === fresh ? '.resume' : '.save', '.rs']) expect(t.seen[k] ?? 0, `${p.tag} ${k} 본 적 있음`).toBeGreaterThan(0);
      const body = await p.page.locator('body').innerText();
      expect(body).not.toMatch(SOURCE_RE);
      expect(body).not.toMatch(BANNED_RE);
    }
    const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? (['webp', 'audio'].includes(f) ? [] : files(join(d, f))) : [join(d, f)]));
    const texts = files(B.out).filter((f) => /\.(js|css|html|json|txt|svg)$/.test(f));
    expect(texts.length).toBeGreaterThan(1);
    for (const f of texts) expect(readFileSync(f, 'utf8'), f).not.toMatch(SOURCE_RE);

    for (const p of ps) expect(p.errors).toEqual([]);
  } catch (e) {
    console.log('[T12] server step', srv.g?.phase, srv.g?.turn.step, 'log', srv.g?.log.length);
    await snapAll();
    throw e;
  } finally {
    clock.setRate(1);
    srv.stop();
    for (const p of [...live]) await p.ctx.close().catch(() => {});
    live.length = 0;
  }
});

test('같은 캐릭터 동시 선택: 두 기기가 같은 캐릭터를 같은 순간 누름 → 자리 둘은 다르고, 캐릭터는 한 명만 갖는다', async ({ browser }) => {
  test.skip(test.info().project.name !== ONLY, '데스크톱에서만');
  test.setTimeout(60_000);
  // 앱 결함(T12 fix 1 실측): 서버 hello 가 charId 중복을 막지 않아 두 자리 모두 캐릭터 2 가 된다(worker/room.ts hello). 고치면 이 줄을 지운다
  clock.setRate(1);
  seedRandom(SEED ^ 0x5eed);
  const srv = new Srv(B.RoomCtor, nextCode('TWDC'));
  try {
    const ps = await Promise.all(['a', 'b'].map(async (tag) => {
      const p = await player(browser, srv, tag);
      await p.page.evaluate(() => { (window as unknown as { __tw: { on: boolean } }).__tw.on = false; });
      await joinCode(p.page, srv.code);
      await expect(p.page.locator('.pick[data-char="2"]')).toBeEnabled();
      return p;
    }));
    // 같은 순간 = 두 hello 가 모두 서버에 닿은 뒤 처리. 서버 처리를 잠시 쌓아 두지 않으면, 먼저 처리된 hello 의 방송이 뒤 기기에 닿아
    // 그 버튼이 꺼진 뒤 DOM click 이 가서 hello 가 아예 안 나간다(T15 실측: 부하가 클 때 자리 1개)
    srv.held = [];
    await Promise.all(ps.map((p) => p.page.evaluate(() => document.querySelector<HTMLButtonElement>('.pick[data-char="2"]')!.click())));
    await expect.poll(() => srv.held!.filter((x) => x.msg.includes('"hello"')).length).toBe(2);
    srv.release();
    await expect.poll(() => srv.room.rec!.seats.filter((s) => s.claimed).length).toBe(2);
    const seats = ps.map((p) => srv.seatOf(p.tag));
    expect(new Set(seats).size).toBe(2);
    const chars = srv.room.rec!.seats.filter((s) => s.claimed).map((s) => s.charId);
    console.log('[T12] same-char', JSON.stringify({ seats, chars }));
    expect(chars.filter((c) => c === 2), '캐릭터 2 를 가진 자리 수').toHaveLength(1);
  } catch (e) {
    await snapAll();
    throw e;
  } finally {
    srv.stop();
    for (const p of [...live]) await p.ctx.close().catch(() => {});
    live.length = 0;
  }
});

// ── QA7(PRD §6 S5 "표시"): 세로 안내 덮개(RotateGuard)가 카드를 덮은 시간은 표시로 세지 않는다 ──
/** 다음 해설 카드가 뜬 뒤 delay ms 지나면 이 화면을 세로로 보이게 한다(innerWidth·innerHeight 덮어쓰기 + resize). 카드가 뜬 시각·덮은 시각(performance.now) */
const portraitOnNextExplain = (p: Page, delay: number) => p.evaluate((d) => new Promise<{ card: number; cover: number }>((done) => {
  const before = document.querySelector('.ex');
  const h = setInterval(() => {
    const ex = document.querySelector('.game[data-step="explanation"] .ex');
    if (!ex || ex === before) return;
    clearInterval(h);
    const card = performance.now();
    setTimeout(() => {
      // innerWidth·innerHeight 는 창 객체 자신의 속성이라 지우면 사라진다 → 원래 설명자를 두었다가 되돌린다
      const own = (k: string) => Object.getOwnPropertyDescriptor(window, k) ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), k);
      (window as unknown as { __twSize: unknown }).__twSize = { innerWidth: own('innerWidth'), innerHeight: own('innerHeight') };
      Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => 768 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => 1024 });
      dispatchEvent(new Event('resize'));
      done({ card, cover: performance.now() });
    }, d);
  }, 2);
}), delay);
/** 덮어쓴 창 크기를 원래대로 되돌리고 resize(실제 뷰포트 크기로 돌아감). 그 시각 */
const realSize = (p: Page) => p.evaluate(() => {
  const saved = (window as unknown as { __twSize: Record<string, PropertyDescriptor | undefined> }).__twSize;
  for (const k of ['innerWidth', 'innerHeight']) {
    delete (window as unknown as Record<string, unknown>)[k];
    if (saved[k] && !(k in window)) Object.defineProperty(window, k, saved[k]!);
  }
  dispatchEvent(new Event('resize'));
  return performance.now();
});

test('S5 세로 안내 덮개(QA7): 세로로 시작 → shown 안 보냄 · 해설 도중 세로로 회전 → shownTo=false · 다시 가로면 남은 시간부터 이어 센다', async ({ browser }) => {
  test.skip(test.info().project.name !== ONLY, '데스크톱에서만');
  test.setTimeout(120_000);
  clock.setRate(1);
  seedRandom(SEED ^ 0x707);
  const srv = new Srv(B.RoomCtor, nextCode('TWRT'));
  // 처음부터 세로(768×1024) 기기 1대 + 봇 3
  const ctx = await browser.newContext({ baseURL: B.base, viewport: { width: 768, height: 1024 }, reducedMotion: 'reduce' });
  const w: Who = { ctx, page: await ctx.newPage(), tag: 'rt', errors: [] };
  live.push(w);
  const { page } = w;
  try {
    await ctx.routeWebSocket(/\/api\/rooms\/[A-Z0-9]{6}\/ws$/, (route) => srv.attach(route, 'rt'));
    page.on('pageerror', (e) => w.errors.push(e.message));
    // 기기가 shown 을 보낸 시각(performance.now)
    await page.addInitScript(() => {
      const ws = WebSocket.prototype.send;
      const sends: number[] = [];
      (window as unknown as { __twShown: number[] }).__twShown = sends;
      WebSocket.prototype.send = function (d) { if (typeof d === 'string' && d.includes('"t":"shown"')) sends.push(performance.now()); return ws.call(this, d); };
    });
    await page.goto('/');
    await joinCode(page, srv.code);
    await page.locator('.pick[data-char="1"]').click();
    await expect(page.locator('.lb-slot.is-me')).toHaveCount(1);
    await page.locator('[data-act="start"]').click();
    await expect(page.locator('.board-rotate')).toBeVisible();
    const me = srv.seatOf('rt')!;
    expect(srv.g.seats.filter((s) => s.isBot)).toHaveLength(3);
    const sent = () => srv.sent('rt', /"t":"shown"/);
    const exLog = () => srv.g.log.filter((e): e is Ev<'explanation'> => e.ev === 'explanation');
    /** me 가 tile(출발을 안 지나는 3~5 — 월급 알림이 카드를 덮지 않게)에 도착 → 문화 카드 등은 넘기고 문항에 정답 → 해설 단계 */
    const toExplain = (tile: number) => {
      srv.arrive(me, tile);
      for (let i = 0; i < 4 && srv.g.turn.step !== 'question'; i++) srv.do(() => srv.room.act({ type: 'timeout' }));
      expect(srv.g.turn.step).toBe('question');
      srv.do(() => srv.room.act({ type: 'answer', seat: me, choice: srv.g.turn.question!.answer, ms: 500 }));
      expect(srv.g.turn.step).toBe('explanation');
      return srv.g.turn.question!.variant;
    };
    /** 해설 단계가 서버에서 끝날 때까지(SPEED 배 시계) → 그 해설 로그. 끝나면 시계를 세운다(다음 장면 전에 봇 차례가 흐르지 않게) */
    const finish = async (n: number) => {
      clock.setRate(SPEED);
      await expect.poll(() => exLog().length, { timeout: 20_000, intervals: [20] }).toBe(n + 1);
      clock.setRate(0);
      return exLog()[n];
    };
    // 기기 쪽 최소 표시 시간(이 빌드는 SHOWN_AT/SPEED 배)
    const shownMs = (v: 'full' | 'short') => (v === 'full' ? 7000 : 4000) * SHOWN_AT / SPEED;

    // ① 처음부터 세로: 카드가 덮개 뒤에만 있었다 → shown 0, shownTo[me]=false
    clock.setRate(0);
    let n = exLog().length;
    toExplain(3);
    await page.locator('.game[data-step="explanation"] .ex').waitFor({ state: 'attached' });
    await expect(page.locator('.board-rotate')).toBeVisible();
    let ex = await finish(n);
    console.log('[QA7] portrait-start', JSON.stringify({ shownTo: ex.shownTo, sent: sent() }));
    expect(sent(), '세로 덮개 뒤 해설에 shown 을 보냄').toBe(0);
    expect(ex.shownTo[me]).toBe(false);

    // ② 가로에서 해설이 뜨자마자 세로로 회전 → 그 단계 안에 못 채움 → shownTo[me]=false
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(page.locator('.board-rotate')).toHaveCount(0);
    n = exLog().length;
    const rot = portraitOnNextExplain(page, 0);
    toExplain(4);
    await rot;
    await page.setViewportSize({ width: 768, height: 1024 }); // 실제 뷰포트도 세로로(덮어쓴 값과 같아진 뒤 지운다)
    await realSize(page);
    await expect(page.locator('.board-rotate')).toBeVisible();
    ex = await finish(n);
    console.log('[QA7] rotate-mid', JSON.stringify({ shownTo: ex.shownTo, sent: sent() }));
    expect(sent(), '회전 뒤 덮개 아래에서 shown 을 보냄').toBe(0);
    expect(ex.shownTo[me]).toBe(false);

    // ③ 멈춘 뒤 이어 세기: 서버 시계를 세운 채(해설 단계 유지) 카드 절반쯤 보인 뒤 세로 → 오래 기다려도 안 보냄 → 가로로 돌리면 남은 시간만큼 뒤에 보냄
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(page.locator('.board-rotate')).toHaveCount(0);
    n = exLog().length;
    const sends0 = sent();
    // 다음 문항의 variant 를 미리 모르므로 짧은 판(최소) 기준 절반 보인 뒤 덮는다
    const rot3 = portraitOnNextExplain(page, Math.round(shownMs('short') * 0.5));
    const variant = toExplain(5);
    const { card, cover } = await rot3;
    await expect(page.locator('.board-rotate')).toBeVisible();
    await page.waitForTimeout(Math.round(shownMs(variant) * 3)); // 표시 시간의 3배 넘게 덮어 둔다
    const coveredSends = await page.evaluate(() => (window as unknown as { __twShown: number[] }).__twShown.length);
    expect(coveredSends, '덮인 동안 shown 을 보냄').toBe(0);
    expect(sent()).toBe(sends0);
    const back = await realSize(page);
    await expect(page.locator('.board-rotate')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __twShown: number[] }).__twShown.length), { timeout: 5_000 }).toBe(1);
    const at = await page.evaluate(() => (window as unknown as { __twShown: number[] }).__twShown[0]);
    const before = cover - card;
    const after = at - back;
    console.log('[QA7] resume', JSON.stringify({ variant, shownMs: shownMs(variant), before: Math.round(before), after: Math.round(after) }));
    // 덮이기 전 + 다시 보인 뒤 = 최소 표시 시간(덮인 시간은 안 셈). 처음부터 다시 세지 않는다(after < 전체)
    expect(before + after).toBeGreaterThanOrEqual(shownMs(variant) - 20);
    expect(after).toBeLessThan(shownMs(variant) - before * 0.5);
    await expect.poll(() => sent(), { timeout: 5_000 }).toBe(sends0 + 1);
    await finish(n);
    expect(w.errors).toEqual([]);
  } catch (e) {
    await snapAll();
    throw e;
  } finally {
    clock.setRate(1);
    srv.stop();
    for (const p of [...live]) await p.ctx.close().catch(() => {});
    live.length = 0;
  }
});
