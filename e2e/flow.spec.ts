// T07 흐름 e2e. 빌드한 번들(dist)을 vite preview 로 띄우고, 서버는 진짜 worker/room.ts(Room)를 이 프로세스 안에서 돌린다.
// 브라우저 WebSocket 은 Playwright routeWebSocket 으로 Room 에 이어 준다 — 프로토콜·판정·마감은 배포 서버와 같은 코드다.
// 장면(도착 칸·주사위·마감)은 Room 상태를 직접 고쳐 만든다(srv.do).
import { moveShowMs } from '../src/shared/timing';
import { expect, test, type Browser, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';
import { build, preview, runnerImport, type PreviewServer } from 'vite';
import type { Room } from '../worker/room';
import { nextFloat } from '../src/engine/rng';
import { landPrice } from '../src/engine/pay';

// 땅값 문구는 src/shared 값에서 뽑는다(S2 조정이 시험을 깨지 않게). 이탈리아 = 11번 칸
const IT_FULL = landPrice(11, false);
const IT_HALF = landPrice(11, true);
import type { GameState, LogEvent, Seat } from '../src/shared/types';
import { codeValue, joinCode, openJoin, openMake } from './helpers/entry';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/T07-shots/', import.meta.url));
/** 2026-10-28 U1 놀이 시간 스크린숏(방 만들기·간판·멈춤·이어 하기) */
const U1_SHOTS = fileURLToPath(new URL('../../harness/state/traveling-world/reports/U1-time-shots/', import.meta.url));
const SOURCE_RE = /지도서|교과서|\[MCP|\[6사|\[4사|pp?\.\s?[0-9]/;
const BANNED_RE = /벌금|패널티|틀렸습니다/;
const data = (f: string) => JSON.parse(readFileSync(`${ROOT}src/data/${f}.json`, 'utf8'));
const questions = data('questions') as { id: string; answer: number }[];
const missions = data('missions') as { id: string; type: string; pairs?: { left: string; right: string }[]; steps?: string[] }[];
const cards = data('cards') as { id: string; country: string; level: number; answer: string; reasons: string[] }[];

let BASE = '';
let server: PreviewServer;
// 이 spec 전용 빌드: 임시 폴더에 내고 자기 포트로 띄운다(dist·4173 을 쓰는 다른 spec 과 부딪히지 않게)
const OUT = join(tmpdir(), `tw-flow-e2e-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
// worker/room.ts 는 JSON 을 import 하므로 Node 로더 대신 vite 러너로 불러온다
let RoomCtor: typeof Room;
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);
test.beforeAll(async () => {
  test.setTimeout(120_000);
  // vite.config.ts 의 에셋 복사 플러그인은 dist 에 쓰므로 쓰지 않고, 같은 플러그인(preact)·설정만 준다
  await build({ root: ROOT, configFile: false, plugins: [preact()], publicDir: false, logLevel: 'error', build: { outDir: OUT, emptyOutDir: true } });
  for (const d of ['webp', 'audio']) symlinkSync(`${ROOT}assets/${d}`, join(OUT, d), 'dir');
  server = await preview({ root: ROOT, configFile: false, build: { outDir: OUT }, preview: { port: 0, strictPort: false }, logLevel: 'error' });
  BASE = server.resolvedUrls!.local[0].replace(/\/$/, '');
  RoomCtor = (await runnerImport<{ Room: typeof Room }>(`${ROOT}worker/room.ts`, { root: ROOT, configFile: false, logLevel: 'error' })).module.Room;
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(U1_SHOTS, { recursive: true });
});
test.afterAll(async () => { await server?.close(); rmSync(OUT, { recursive: true, force: true }); });

// ── 이 프로세스 안의 서버 ─────────────────────────────────

class FakeCtx {
  data = new Map<string, unknown>();
  alarmAt: number | null = null;
  sockets: Bridge[] = [];
  storage = {
    kv: {
      get: (k: string) => this.data.get(k),
      put: (k: string, v: unknown) => { this.data.set(k, v); },
      delete: (k: string) => this.data.delete(k),
      list: ({ prefix = '' }: { prefix?: string } = {}) => [...this.data.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)),
    },
    setAlarm: async (t: number) => { this.alarmAt = t; },
    getAlarm: async () => this.alarmAt,
    deleteAlarm: async () => { this.alarmAt = null; },
    deleteAll: async () => { this.data.clear(); },
  };
  acceptWebSocket(ws: Bridge) { this.sockets.push(ws); }
  getWebSockets() { return this.sockets.filter((s) => !s.closed); }
}

class Bridge {
  closed = false;
  private att: unknown = null;
  constructor(public route: WebSocketRoute, public tag: string) {}
  /** 이 기기로 보낸 서버 메시지(실패 해설 비공개 시험용) */
  out: string[] = [];
  send(s: string) { if (this.closed) throw new Error('closed'); this.out.push(s); this.route.send(s); }
  close(code?: number, reason?: string) { if (this.closed) return; this.closed = true; void this.route.close({ code, reason }).catch(() => {}); }
  serializeAttachment(a: unknown) { this.att = structuredClone(a); }
  deserializeAttachment() { return structuredClone(this.att); }
}

type R = Room & { run(f: WebSocket | null, b: () => void): void; act(a: unknown): boolean; dirty: boolean };

class Srv {
  ctx = new FakeCtx();
  room: R;
  got: { tag: string; msg: string }[] = [];
  private tick: ReturnType<typeof setInterval>;
  constructor(public code: string) {
    this.room = new RoomCtor(this.ctx as unknown as DurableObjectState, {}) as R;
    this.room.init(code, { totalMinutes: 40, touristQuiz: false });
    this.tick = setInterval(() => { if (this.ctx.alarmAt !== null && Date.now() >= this.ctx.alarmAt) void this.room.alarm(); }, 40);
  }
  attach(route: WebSocketRoute, tag: string) {
    const b = new Bridge(route, tag);
    route.onMessage((m) => { this.got.push({ tag, msg: String(m) }); this.room.webSocketMessage(b as unknown as WebSocket, String(m)); });
    route.onClose(() => { if (b.closed) return; b.closed = true; this.room.webSocketClose(b as unknown as WebSocket); });
    this.room.accept(b as unknown as WebSocket);
  }
  get g(): GameState { return this.room.game!; }
  /** 상태를 고치고 모두에게 방송 */
  do(f: (g: GameState) => void) { this.room.run(null, () => { f(this.g); this.room.dirty = true; }); }
  /** 지금 단계 마감을 ms 뒤로 당긴다(같은 단계라 기기 시계 차이 추정은 그대로) */
  hurry(ms: number) { this.do(() => { this.room.rec!.deadlineAt = Date.now() + ms; }); }
  /** seat 가 tile 에 도착하도록 주사위(1, k−1, 더블 아님)를 맞춰 굴린다 */
  arrive(seat: Seat, tile: number, prep?: (g: GameState) => void) {
    this.do((g) => {
      prep?.(g);
      const k = 3;
      g.players[seat].pos = (tile - k + 30) % 30; // 30칸 고리
      g.turn = { ...g.turn, seat, step: 'roll', tile: null, correct: null, discount: false, rolledDouble: false, extraRoll: false, question: null, tf: null, missionId: null, missionSuccess: false, rewardOptions: [], takeoverCost: 0 };
      g.rngState = rngFor(1, k - 1);
      this.room.act({ type: 'roll', seat });
    });
  }
  /** 서버가 tag 기기로 보낸 메시지 전부 */
  outTo(tag: string) { return this.ctx.getWebSockets().filter((b) => b.tag === tag).flatMap((b) => (b as unknown as Bridge).out); }
  sent(tag: string, re: RegExp) { return this.got.filter((x) => x.tag === tag && re.test(x.msg)).length; }
  dropSocket(tag: string) { this.ctx.getWebSockets().filter((b) => b.tag === tag).forEach((b) => { b.close(); this.room.webSocketClose(b as unknown as WebSocket); }); }
  stop() { clearInterval(this.tick); }
}

/** 첫 두 randInt(6) 이 (a, b) 가 되는 rng 상태 */
function rngFor(a: number, b: number) {
  for (let s = 1; ; s++) {
    const [v1, n1] = nextFloat(s);
    const [v2] = nextFloat(n1);
    if (1 + Math.floor(v1 * 6) === a && 1 + Math.floor(v2 * 6) === b) return s;
  }
}

let codeN = 0;
const nextCode = () => `TWAB${'CDEFGHJKMN'[codeN % 10]}${'PQRSTUVWXY'[Math.floor(codeN++ / 10) % 10]}`;

interface Who { ctx: BrowserContext; page: Page; tag: string }

async function player(browser: Browser, srv: Srv, tag: string): Promise<Who> {
  const proj = test.info().project.use;
  const ctx = await browser.newContext({ baseURL: BASE, viewport: proj.viewport ?? undefined, hasTouch: proj.hasTouch, isMobile: proj.isMobile });
  await ctx.routeWebSocket(/\/api\/rooms\/[A-Z0-9]{6}\/ws$/, (route) => srv.attach(route, tag));
  const page = await ctx.newPage();
  await page.goto('/');
  return { ctx, page, tag };
}

/** n 명 입장(0번 = 방장), 시작까지. 나머지 자리는 로봇 */
async function room(browser: Browser, n: number, start = true) {
  const srv = new Srv(nextCode());
  const ps: Who[] = [];
  for (let i = 0; i < n; i++) {
    const p = await player(browser, srv, `p${i}`);
    await joinCode(p.page, srv.code);
    await p.page.locator(`.pick[data-char="${i}"]`).click();
    await expect(p.page.locator('.lb-slot.is-me')).toHaveCount(1);
    ps.push(p);
  }
  if (start) {
    await ps[0].page.locator('[data-act="start"]').click();
    for (const p of ps) await expect(p.page.locator('.board-root')).toBeVisible();
  }
  return { srv, ps };
}

async function close(srv: Srv, ps: Who[]) {
  srv.stop();
  for (const p of ps) await p.ctx.close();
}

/** 스크린숏: 열림 애니메이션·그림·글꼴이 끝난 뒤(컷씬은 settle=false 로 그 순간) */
async function shot(page: Page, name: string, settle = true) {
  if (settle) {
    await page.evaluate(() => Promise.race([
      new Promise((r) => setTimeout(r, 2500)),
      (async () => {
        await document.fonts.ready;
        // 무한 반복(숨쉬기·반짝임)은 끝나지 않으니 열림 애니메이션만 기다린다(전엔 늘 2.5초 상한까지 기다렸다)
        await Promise.all(document.getAnimations().filter((a) => a instanceof CSSAnimation && a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})));
        await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r); })));
      })(),
    ]));
  }
  await page.screenshot({ path: `${SHOTS}${name}-${test.info().project.name}.png` });
}
const tap = async (page: Page, sel: string) => {
  const el = page.locator(sel).first();
  if (test.info().project.name === 'tablet-touch') await el.tap();
  else await el.click();
};
async function clean(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(SOURCE_RE);
  expect(text).not.toMatch(BANNED_RE);
}
const answerOf = (srv: Srv) => questions.find((q) => q.id === srv.g.turn.question!.qid)?.answer ?? srv.g.turn.question!.answer;
/** 도착자가 답을 고르고(정답/오답) 해설·참/거짓 마감을 당겨 행동 단계까지 */
async function solve(srv: Srv, page: Page, correct: boolean) {
  const ans = answerOf(srv);
  await tap(page, `.qs .ov-ans[data-choice="${correct ? ans : (ans + 1) % 4}"]`);
  await expect.poll(() => srv.g.turn.step, { timeout: 4000 }).toBe('explanation');
  srv.hurry(200);
  await expect.poll(() => srv.g.turn.step, { timeout: 4000 }).not.toBe('explanation');
  if (srv.g.turn.step === 'tf') {
    srv.hurry(200);
    await expect.poll(() => srv.g.turn.step, { timeout: 4000 }).not.toBe('tf');
  }
}
const lastLog = <K extends LogEvent['ev']>(srv: Srv, ev: K) => [...srv.g.log].reverse().find((e) => e.ev === ev) as Extract<LogEvent, { ev: K }> | undefined;

// ── 시험 ─────────────────────────────────────────────────

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const Q = '["\'`]';
/** 짝이 나란히: "왼","오" · "왼":"오" · {left:"왼",right:"오"}(JSON·객체 리터럴 모두) */
const pairRe = (l: string, r: string) => new RegExp(`${Q}${esc(l)}${Q}\\s*[,:]\\s*(${Q}?right${Q}?\\s*:\\s*)?${Q}${esc(r)}${Q}`);
/** 정답 순서 그대로 이어진 글 목록 */
const stepsRe = (st: string[]) => new RegExp(st.map((x) => `${Q}${esc(x)}${Q}`).join('\\s*,\\s*'));

test('번들에 정답 없음: 문항 answer·미션 correct·관전 참/거짓 answer·짝·정답 순서·해설 카드 글', () => {
  const js = readdirSync(join(OUT, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(OUT, 'assets', f), 'utf8')).join('\n');
  expect(js).toContain('spectatorTf'); // 미션 사본은 실려 있다
  expect(js).not.toMatch(/correct:(!0|!1|true|false)/); // 미션 선지 정답 플래그
  expect(js).not.toMatch(/stem:"[^"]*",[^}]*answer:\d|answer:\d,[^{}]*stem:/); // 문항 정답 인덱스
  expect(js).not.toMatch(/spectatorTf:\{[^}]*answer:/); // 관전 참/거짓 정답
  // 연결·블록 짝, 순서 정답: 검사식이 옛 사본 꼴(JSON·리터럴)을 실제로 잡는지 먼저 확인한 뒤 번들에 0건
  const old = JSON.stringify(missions);
  const withPairs = missions.filter((m) => m.pairs?.length), withSteps = missions.filter((m) => m.steps?.length);
  expect(withPairs.length).toBeGreaterThan(5);
  expect(withSteps.length).toBeGreaterThan(3);
  for (const src of [old, old.replace(/"(\w+)":/g, '$1:')]) {
    for (const m of withPairs) for (const p of m.pairs!) expect(src).toMatch(pairRe(p.left, p.right));
    for (const m of withSteps) expect(src).toMatch(stepsRe(m.steps!));
  }
  for (const m of withPairs) for (const p of m.pairs!) expect(js, `${m.id} ${p.left}`).not.toMatch(pairRe(p.left, p.right));
  for (const m of withSteps) expect(js, m.id).not.toMatch(stepsRe(m.steps!));
  // 해설 카드 정답 줄·까닭: 보여 주는 글(참/거짓 문장·문항·미션 사본)과 같은 글은 빼고 전부 0건. 샘플 3장은 따로 못 박는다
  const pub = readFileSync(`${ROOT}src/state/public-content.json`, 'utf8');
  const texts = cards.flatMap((c) => [c.answer, ...c.reasons]).filter((t) => !pub.includes(t));
  expect(texts.length).toBeGreaterThan(200);
  for (const t of texts) expect(js, t).not.toContain(t);
  for (const id of ['th-1', 'eg-2', 'kr-4']) for (const t of cards.find((c) => c.id === id)!.reasons) expect(js, `${id} ${t}`).not.toContain(t);
  expect(js).not.toMatch(/reasons:\[|"reasons"/);
  // 미션 실패 해설 explain(PRD §3.5): 서버가 판정 뒤 도착자에게만 보낸다 → 번들에 문장 0건
  const explains = (missions as { id: string; explain?: string }[]).map((m) => [m.id, m.explain ?? ''] as const);
  expect(explains.filter(([, e]) => e.length >= 10).length).toBe(40);
  for (const [id, e] of explains) expect(js, `${id} explain`).not.toContain(e);
  expect(js).not.toMatch(/explain:"/);
  // 지도 미션(m-09·m-10·m-11): 이름 → 지도 위치(SPOT_OF), 이름 → 기후 구역(ZONE_OF_LABEL) 표가 번들에 없다(서버가 at·zones 로 보냄).
  // 검사식이 표 꼴(따옴표 있음·없음 키)을 잡는지 먼저 확인
  const labels = [...new Set(missions.flatMap((m) => (m.pairs ?? []).flatMap((p) => [p.left, p.right])))];
  const ZONES = '(tropical|dry|temperate|cold|polar|alpine)';
  const spotRe = (k: string) => new RegExp(`(^|[^\\w가-힣])${Q}?${esc(k)}${Q}?\\s*:\\s*\\[\\s*-?\\d`);
  const zoneRe = (k: string) => new RegExp(`${Q}?${esc(k)}${Q}?\\s*:\\s*${Q}${ZONES}${Q}`);
  expect('{아시아:[95,45],"남극 대륙":[20,-80]}').toMatch(spotRe('아시아'));
  expect('{아시아:[95,45],"남극 대륙":[20,-80]}').toMatch(spotRe('남극 대륙'));
  expect('{"적도 부근":"tropical",열대기후:`dry`}').toMatch(zoneRe('적도 부근'));
  for (const k of ['아시아', '아프리카', '남아메리카', '남극 대륙', '태평양', '대서양', '인도양', '북극해', ...labels]) expect(js, k).not.toMatch(spotRe(k));
  for (const k of ['적도 부근', '비가 적은 저·중위도', '북반구 중·고위도', '극지방 부근', '열대 기후', '건조 기후', '온대 기후', '냉대 기후', '한대 기후', '고산 기후', ...labels]) expect(js, k).not.toMatch(zoneRe(k));
});

test('입장·로비: 방 만들기 → 코드 → 캐릭터 → 시작, 글 칸은 코드 하나, 게임 시작 때 그림을 미리 받는다', async ({ browser }) => {
  const code = nextCode();
  const srv = new Srv(code);
  const host = await player(browser, srv, 'h');
  await host.page.route('**/api/rooms', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ code }) }));
  expect(await host.page.locator('input').count()).toBe(0); // 첫 화면(인트로)엔 글 칸이 없다
  await openMake(host.page);
  expect(await host.page.locator('input').count()).toBe(0); // 방 만들기는 토글뿐
  await host.page.getByRole('button', { name: '60분' }).click();
  await host.page.locator('[data-act="make"]').click();
  await expect(host.page.locator('.code-box')).toHaveCount(6);
  await expect(host.page.locator('.code-pill')).toHaveAttribute('aria-label', `방 코드 ${code.split('').join(' ')}`);
  await host.page.locator('.pick[data-char="2"]').click();
  const guest = await player(browser, srv, 'g');
  await openJoin(guest.page);
  // 글 칸은 방 코드 하나뿐: 6칸(한 글자씩)이 한 묶음
  expect(await guest.page.locator('input').count()).toBe(6);
  expect(await guest.page.locator('.code-tiles input').count()).toBe(6);
  await guest.page.locator('#room-code').fill(code.toLowerCase()); // 소문자도 대문자로, 6자는 6칸에 나뉜다
  expect(await codeValue(guest.page)).toBe(code);
  await guest.page.locator('[data-act="join"]').click();
  await expect(guest.page.locator('.pick[data-char="2"]')).toBeDisabled(); // 남이 고른 캐릭터
  await guest.page.locator('.pick[data-char="4"]').click();
  await expect(host.page.locator('.lb-slot')).toHaveCount(4);
  await expect(host.page.locator('.lb-slot-state', { hasText: '로봇이 함께해요' })).toHaveCount(2);
  await expect(guest.page.locator('[data-act="start"]')).toHaveCount(0); // 방장만 시작
  await clean(host.page);
  await shot(host.page, 'lobby');
  const lm = host.page.waitForRequest(/\/webp\/LM-\d+\.webp$/); // gameStartKeys 의 랜드마크 배지
  await host.page.locator('[data-act="start"]').click();
  await lm;
  await expect(guest.page.locator('.board-root')).toBeVisible();
  await expect(guest.page.locator('.tile')).toHaveCount(30); // R4 30칸 고리(PRD §3.6)
  await close(srv, [host, guest]);
});

test('도착 흐름 4명: 문화 카드(첫 방문 3초·뱃지) → 문항(잠금·관전) → 해설 전체판 4명 → 참/거짓 → 행동', async ({ browser }) => {
  const { srv, ps } = await room(browser, 4);
  const [a, ...others] = ps;
  srv.arrive(0, 11); // 이탈리아: 맛보기 뱃지 있음, 첫 방문
  for (const p of ps) await expect(p.page.locator('.cc')).toBeVisible();
  await expect(a.page.locator('.cc')).toHaveAttribute('data-first', '1');
  await expect(a.page.locator('.cc-badge')).toBeVisible();
  await tap(a.page, '.cc'); // 첫 방문 탭은 무시
  await a.page.waitForTimeout(300);
  expect(srv.sent('p0', /"ack"/)).toBe(0);
  expect(srv.g.turn.step).toBe('culture');
  await a.page.screenshot({ path: `${SHOTS}culture-card-${test.info().project.name}.png` }); // 3초 안이라 기다리지 않고

  // 3초 뒤 서버가 넘김 → 문항
  for (const p of ps) await expect(p.page.locator('.qs')).toBeVisible({ timeout: 6000 });
  await expect(a.page.locator('.qs')).toHaveAttribute('data-role', 'player');
  for (const p of others) {
    await expect(p.page.locator('.qs')).toHaveAttribute('data-role', 'spectator');
    await expect(p.page.locator('.qs-watch')).toBeVisible();
    await expect(p.page.locator('.qs .ov-ans').first()).toBeDisabled();
  }
  // 같은 문항을 읽기 전용으로
  expect(await others[0].page.locator('.qs-stem').innerText()).toBe(await a.page.locator('.qs-stem').innerText());
  // 터치 타깃 ≥44, 선지 간격 ≥8
  const boxes = await a.page.locator('.qs .ov-ans').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  for (const b of boxes) expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
  expect(boxes[1].left - boxes[0].right).toBeGreaterThanOrEqual(8);
  expect(boxes[2].top - boxes[0].bottom).toBeGreaterThanOrEqual(8);
  await clean(a.page);
  await shot(a.page, 'quiz');
  await shot(others[0].page, 'quiz-spectator');

  // 오답을 두 번 빠르게: 한 번만 간다
  const right = answerOf(srv);
  const wrong = (right + 1) % 4;
  await a.page.locator(`.qs .ov-ans[data-choice="${wrong}"]`).dblclick();
  await expect.poll(() => srv.g.log.filter((e) => e.ev === 'answer').length).toBe(1);
  expect(srv.sent('p0', /"type":"answer"/)).toBe(1);

  // 해설 전체판: 4명 모두, 닫기 버튼 없음. 7초를 다 그린 4기기가 shown 을 보내 서버 로그 shownTo 4(기기 신호, T05c)
  const exQid = srv.g.turn.question!.qid;
  for (const p of ps) await expect(p.page.locator('.ex')).toHaveAttribute('data-variant', 'full');
  for (const p of ps) await expect(p.page.locator('.ex button')).toHaveCount(0);
  expect(lastLog(srv, 'explanation')).toBeUndefined(); // 해설이 끝날 때 남긴다
  await clean(others[1].page);
  await shot(others[0].page, 'explain-full');
  await expect.poll(() => lastLog(srv, 'explanation')?.qid, { timeout: 12_000 }).toBe(exQid);
  expect(lastLog(srv, 'explanation')!.shownTo).toEqual([true, true, true, true]);
  for (const p of ps) expect(srv.sent(p.tag, /"t":"shown"/), p.tag).toBe(1);

  // 7초 뒤 참/거짓: 도착자 화면엔 버튼 없음, 3명은 한 번 누르면 잠김, 무응답은 아무것도 안 보냄
  for (const p of others) await expect(p.page.locator('.ex-tf-btn')).toHaveCount(2, { timeout: 9000 });
  await expect(a.page.locator('.ex-tf-btn')).toHaveCount(0);
  await expect(a.page.locator('.ex-tf--wait')).toBeVisible();
  await shot(others[0].page, 'truefalse');
  await tap(others[0].page, '.ex-tf-btn[data-tf="true"]');
  await expect(others[0].page.locator('.ex-tf-btn[data-tf="false"]')).toBeDisabled();
  await tap(others[1].page, '.ex-tf-btn[data-tf="false"]');
  // p3 은 누르지 않는다
  await expect.poll(() => srv.g.log.filter((e) => e.ev === 'tf_answer').length, { timeout: 9000 }).toBe(3);
  expect(srv.sent('p3', /tfAnswer/)).toBe(0);
  const nullAns = srv.g.log.filter((e) => e.ev === 'tf_answer' && e.seat === 3)[0] as Extract<LogEvent, { ev: 'tf_answer' }>;
  expect(nullAns.value).toBeNull();
  expect(srv.sent('p1', /tfAnswer/)).toBe(1);

  // 행동: 빈 땅 + 오답 → '땅값 {IT_FULL} · 다음엔 반값에 도전'
  await expect(a.page.locator('.ap[data-kind="buy"]')).toBeVisible();
  await expect(a.page.locator('.ap[data-kind="buy"]')).toContainText(`땅값 ${IT_FULL} · 다음엔 반값에 도전`);
  await expect(others[0].page.locator('.ap[data-kind="buy"] [data-act="buy"]')).toBeDisabled();
  await shot(a.page, 'action-buy-wrong');
  await tap(a.page, '[data-act="buy"]');
  await expect.poll(() => srv.g.tiles[11].owner).toBe(0);
  await close(srv, ps);
});

test('다시 온 나라: 탭으로 넘김, 뱃지 없으면 빈 자리 없음, 짧은판 4초, 시간 초과 문구, 정답 할인 문구', async ({ browser }) => {
  const { srv, ps } = await room(browser, 2);
  const [a, b] = ps;
  // 타이: 두 번째 방문(로그에 앞 방문 1건) → 2단계 카드, 이미 공개 → 복습 + 짧은판
  srv.arrive(0, 2, (g) => {
    g.seenCountries.push('th');
    g.log.push({ ev: 'culture_card', seat: 1, country: 'th', firstVisit: true, badgeShown: false });
    g.revealedCards.push('th-2');
  });
  // 문화 카드 3초 마감이 스크린숏·관전자 탭 확인과 겨루지 않게 마감만 늦춘다(같은 단계). 아래는 탭으로만 넘어가는지 본다
  srv.hurry(30_000);
  await expect(a.page.locator('.cc')).toHaveAttribute('data-first', '0');
  await expect(a.page.locator('.cc-badge')).toHaveCount(0);
  const cap = await a.page.locator('.cc-cap').evaluate((e) => getComputedStyle(e).gridTemplateColumns);
  expect(cap.split(' ').filter((x) => x !== '0px')).toHaveLength(1); // 뱃지 칸이 0 폭
  await shot(a.page, 'culture-revisit-nobadge');
  await tap(b.page, '.cc'); // 남은 넘길 수 없다
  await b.page.waitForTimeout(200);
  expect(srv.sent('p1', /"ack"/)).toBe(0);
  await tap(a.page, '.cc');
  await expect(a.page.locator('.qs')).toBeVisible({ timeout: 1500 }); // 마감 전에 탭으로 넘어감
  await expect(a.page.locator('.ov-chip--review')).toBeVisible();
  // 시간 초과: 마감을 당긴다
  srv.hurry(1200);
  await expect(a.page.locator('.ex-result')).toHaveText('시간이 다 됐어요. 정답을 같이 봐요', { timeout: 3000 });
  const exAt = Date.now();
  await expect(b.page.locator('.ex-result')).toContainText('시간이 다 됐어요');
  expect(srv.sent('p0', /"type":"answer"/)).toBe(0);
  await a.page.screenshot({ path: `${SHOTS}quiz-timeout-${test.info().project.name}.png` });
  await expect(b.page.locator('.ex')).toHaveAttribute('data-variant', 'short', { timeout: 4000 });
  await expect(b.page.locator('.ex-reasons')).toHaveCount(0);
  await b.page.waitForTimeout(700);
  await b.page.screenshot({ path: `${SHOTS}explain-short-${test.info().project.name}.png` });
  await expect(b.page.locator('.ex-tf, .ap')).toBeVisible({ timeout: 7000 });
  expect(Date.now() - exAt).toBeGreaterThan(3000); // 짧은판 4초 동안은 그대로
  await close(srv, ps);
});

test('행동: 정답 할인·인수 가능 / 오답이면 인수 꺼짐 / 방패 5초 자동 방어', async ({ browser }) => {
  const { srv, ps } = await room(browser, 2);
  const [a, owner] = ps;
  // 통행료 아이템 → 통행료 패널 → 인수 패널: 앞 패널의 잠금이 다음 패널로 새지 않는다
  srv.arrive(0, 3, (g) => { g.tiles[3] = { owner: 1, level: 1, festivalTarget: false }; g.seenCountries.push('cn'); g.players[0].items = ['tollHalf']; });
  await expect(a.page.locator('.qs')).toBeVisible({ timeout: 6000 });
  await solve(srv, a.page, true);
  await expect(a.page.locator('.ap[data-kind="toll"]')).toBeVisible({ timeout: 4000 });
  await tap(a.page, '.ap[data-kind="toll"] [data-act="pay"]');
  await expect(a.page.locator('.ap[data-kind="takeover"]')).toBeVisible({ timeout: 4000 });
  await expect(a.page.locator('.ap[data-kind="takeover"] [data-act="takeover"]')).toBeEnabled();
  await expect(a.page.locator('.ap[data-kind="takeover"] [data-act="takeover"]')).toBeFocused(); // 주 버튼에 초점
  await tap(a.page, '.ap[data-kind="takeover"] [data-act="pass"]');
  await expect.poll(() => srv.g.turn.seat).not.toBe(0);
  // 정답 + 남의 땅(필리핀, 집) → 인수 단계
  srv.arrive(0, 1, (g) => { g.tiles[1] = { owner: 1, level: 1, festivalTarget: false }; g.seenCountries.push('ph'); g.players[1].items = ['shield']; g.players[0].items = []; });
  await expect(a.page.locator('.qs')).toBeVisible({ timeout: 6000 });
  await solve(srv, a.page, true);
  await expect(a.page.locator('.ap[data-kind="takeover"]')).toBeVisible({ timeout: 4000 });
  const toll = lastLog(srv, 'toll')!;
  await expect(a.page.locator('.ap[data-kind="takeover"]')).toContainText(`통행료 ${Math.round(toll.base * toll.multiplier)} → 정답 할인 ${toll.paid} · 사들일 수 있어요`);
  await expect(a.page.locator('[data-act="takeover"]')).toBeEnabled();
  await shot(a.page, 'action-takeover');
  await tap(a.page, '[data-act="takeover"]');
  // 주인에게 방패 팝업, 5초 무응답 → 자동 방어
  await expect(owner.page.locator('.ap--shield')).toBeVisible();
  await expect(a.page.locator('.ov-wait')).toContainText('방패');
  await shot(owner.page, 'shield');
  await expect.poll(() => lastLog(srv, 'takeover')?.shielded, { timeout: 8000 }).toBe(true);
  expect(srv.g.tiles[1].owner).toBe(1);

  // 오답 + 남의 땅 → 통행료만, 인수 버튼 꺼짐 + '인수는 정답일 때'
  srv.arrive(0, 4, (g) => { g.tiles[4] = { owner: 1, level: 0, festivalTarget: false }; g.seenCountries.push('np'); });
  await expect(a.page.locator('.qs')).toBeVisible({ timeout: 6000 });
  await solve(srv, a.page, false);
  const notice = owner.page.locator('.ap[data-kind="toll-notice"]');
  await expect(notice).toBeVisible({ timeout: 4000 });
  const t2 = lastLog(srv, 'toll')!;
  await expect(notice).toContainText(`통행료 ${Math.round(t2.base * t2.multiplier)} · 정답을 맞혀야 사들일 수 있어요`);
  await expect(notice.locator('[data-act="takeover"]')).toBeDisabled();
  await shot(owner.page, 'action-toll-wrong');

  // 정답 + 빈 땅 → '땅값 {IT_FULL} → 정답 할인 {IT_HALF}'
  srv.arrive(0, 11, (g) => { g.seenCountries.push('it'); });
  await expect(a.page.locator('.qs')).toBeVisible({ timeout: 6000 });
  await solve(srv, a.page, true);
  await expect(a.page.locator('.ap[data-kind="buy"]')).toContainText(`땅값 ${IT_FULL} → 정답 할인 ${IT_HALF}`, { timeout: 4000 });
  await shot(a.page, 'action-buy-correct');
  await close(srv, ps);
});

test('4단계 해설은 자료 2개 나란히', async ({ browser }) => {
  const { srv, ps } = await room(browser, 1);
  srv.arrive(0, 18, (g) => { g.tiles[18] = { owner: 0, level: 3, festivalTarget: false }; g.seenCountries.push('tz'); }); // 탄자니아 4단계: 그래프 2개(한국은 이제 출발 칸)
  await expect(ps[0].page.locator('.qs')).toBeVisible({ timeout: 6000 });
  await tap(ps[0].page, `.qs .ov-ans[data-choice="${answerOf(srv)}"]`);
  const ex = ps[0].page.locator('.ex');
  await expect(ex).toHaveAttribute('data-two', '1');
  await expect(ex.locator('.ex-fig')).toHaveCount(2);
  const [f1, f2] = await ex.locator('.ex-fig').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  expect(Math.abs(f1.top - f2.top)).toBeLessThan(2); // 같은 줄
  expect(f2.left).toBeGreaterThan(f1.right);
  await shot(ps[0].page, 'explain-level4');
  // 그래프가 아닌 둘째 자료는 card.<id>.b 그림
  srv.arrive(0, 1, (g) => { g.tiles[1] = { owner: 0, level: 3, festivalTarget: false }; g.seenCountries.push('ph'); });
  await expect(ps[0].page.locator('.qs')).toBeVisible({ timeout: 6000 });
  await tap(ps[0].page, `.qs .ov-ans[data-choice="${answerOf(srv)}"]`);
  await expect(ex).toHaveAttribute('data-card', 'ph-4');
  await expect(ex.locator('.ex-fig').nth(1).locator('img')).toHaveAttribute('src', /ph_compare_plain\.webp$/);
  await expect(ex.locator('.ex-alt')).toHaveCount(0);
  await shot(ps[0].page, 'explain-level4-picture');
  await close(srv, ps);
});

test('컷씬: 랜드마크 건설 → 전원 재생·탭 스킵 / 그림 404 면 배너만, 멈춤 없음 / 이벤트 카드', async ({ browser }) => {
  const { srv, ps } = await room(browser, 2);
  const [a, b] = ps;
  srv.arrive(0, 16, (g) => { g.tiles[16] = { owner: 0, level: 3, festivalTarget: false }; g.seenCountries.push('eg'); g.players[0].coin = 20000; });
  await expect(a.page.locator('.qs')).toBeVisible({ timeout: 6000 });
  await solve(srv, a.page, true);
  await expect(a.page.locator('.ap[data-kind="build"]')).toBeVisible({ timeout: 4000 });
  await tap(a.page, '[data-act="build"]');
  for (const p of ps) await expect(p.page.locator('.cut')).toBeVisible();
  await expect(a.page.locator('.cut')).toHaveAttribute('data-mode', 'play', { timeout: 3000 });
  await expect(b.page.locator('.cut')).toHaveAttribute('data-mode', 'play', { timeout: 3000 });
  await a.page.waitForTimeout(2350); // 임팩트 직후
  await shot(a.page, 'cutscene-mid', false);
  // 움직이는 속성: transform·opacity·clip-path 만
  const props = await a.page.evaluate(() => [...new Set(document.getAnimations().flatMap((an) => ((an.effect as KeyframeEffect)?.getKeyframes() ?? []).flatMap((k) => Object.keys(k)))
    .filter((k) => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)))]);
  expect(props.every((p) => ['transform', 'opacity', 'clipPath'].includes(p))).toBe(true);
  await tap(b.page, '.cut'); // 건너뛰기
  await expect(b.page.locator('.cut')).toHaveCount(0);
  await expect(a.page.locator('.cut')).toHaveCount(0, { timeout: 5000 }); // 4.0 + 0.8초 뒤 스스로 닫힘

  // 그림 404 → 배너만 2초
  await a.page.route(/\/webp\/(CUT|LM)-.*\.webp$/, (r) => r.fulfill({ status: 404 }));
  srv.arrive(0, 24, (g) => { g.tiles[24] = { owner: 0, level: 3, festivalTarget: false }; g.seenCountries.push('mx'); g.players[0].coin = 20000; });
  await expect(a.page.locator('.qs')).toBeVisible({ timeout: 6000 });
  await solve(srv, a.page, true);
  await tap(a.page, '[data-act="build"]');
  await expect(a.page.locator('.cut')).toHaveAttribute('data-mode', 'banner', { timeout: 3000 });
  await expect(a.page.locator('.cut-banner')).toContainText('멕시코에 랜드마크를 세웠어요!');
  await expect(a.page.locator('.cut')).toHaveCount(0, { timeout: 4000 });

  // 이벤트 카드: 무인도(기금 칸은 없어졌다)
  srv.arrive(0, 10);
  for (const p of ps) await expect(p.page.locator('.evc[data-event="island"]')).toBeVisible();
  await clean(b.page);
  await shot(b.page, 'event-card');
  await tap(b.page, '.evc');
  await expect(b.page.locator('.evc')).toHaveCount(0);
  await close(srv, ps);
});

test('알림 줄: 같은 칸 컷씬 연달아·전체 다시 받기면 비움·도착 카드는 알림 뒤에·모르는 메시지 무시', async ({ browser }) => {
  const { srv, ps } = await room(browser, 1);
  const a = ps[0];
  const errors: string[] = [];
  a.page.on('pageerror', (e) => errors.push(String(e)));
  // 같은 칸 랜드마크가 두 번(재건설) → 컷씬 두 번, 앞의 것이 뒤의 것을 막지 않는다
  srv.do((g) => { g.log.push({ ev: 'build', seat: 0, tile: 16, level: 4, cost: 1 }, { ev: 'build', seat: 0, tile: 16, level: 4, cost: 1 }); });
  await expect(a.page.locator('.cut')).toBeVisible();
  const first = (await a.page.locator('.cut').elementHandle())!;
  // 키 처리기는 마운트 뒤 effect 에서 붙는다: 부하가 크면 '보임'이 먼저 와 Enter 가 허공에 간다(QA4-reveal 전체 실행에서 3/3 첫 시도 실패). 로딩이 끝난 뒤 누른다
  await expect(a.page.locator('.cut')).not.toHaveAttribute('data-mode', 'loading');
  await a.page.keyboard.press('Enter'); // 키보드로 건너뛰기
  await expect.poll(() => first.evaluate((e) => e.isConnected)).toBe(false);
  await expect(a.page.locator('.cut')).toBeVisible(); // 두 번째(새로 마운트)
  await tap(a.page, '.cut');
  await expect(a.page.locator('.cut')).toHaveCount(0);
  // 이벤트 알림 둘이 쌓인 뒤 전체 다시 받기 → 알림 비움
  srv.do((g) => { g.log.push({ ev: 'event', seat: 0, kind: 'fund', payload: { received: 300 } }, { ev: 'event', seat: 0, kind: 'fund', payload: { received: 300 } }); });
  await expect(a.page.locator('.evc')).toBeVisible();
  await a.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(a.page.locator('.evc')).toHaveCount(0, { timeout: 1500 });
  // 통행료 알림이 떠 있는 동안 다음 도착의 문화 카드는 기다렸다가 뜬다(알림은 1초로 줄어듦)
  srv.do((g) => { g.log.push({ ev: 'toll', payer: 1, owner: 0, tile: 2, base: 66, multiplier: 1, discounted: false, paid: 66 }); });
  await expect(a.page.locator('.ap[data-kind="toll-notice"]')).toBeVisible();
  srv.arrive(0, 13); // 10 → 13 (주사위 1+2)
  await a.page.waitForTimeout(150);
  await expect(a.page.locator('.cc')).toHaveCount(0);
  // 줌 카메라(R4 T-E): 이동 연출(shared/timing — 서버도 문화 카드 마감을 그만큼 늦춘다)이 끝난 뒤 알림 1초 → 카드
  await expect(a.page.locator('.cc')).toBeVisible({ timeout: moveShowMs(10, 13) + 1000 + 1500 });
  await expect(a.page.locator('.ap[data-kind="toll-notice"]')).toHaveCount(0);
  // 모르는 메시지·깨진 JSON 은 무시
  const b = srv.ctx.getWebSockets().find((x) => x.tag === 'p0')!;
  b.route.send(JSON.stringify({ t: 'brandNew', x: 1 }));
  b.route.send('{깨짐');
  await a.page.waitForTimeout(300);
  await expect(a.page.locator('.board-root')).toBeVisible();
  expect(errors).toEqual([]);
  await close(srv, ps);
});

test('해설 카드가 알림에 덮인 시간은 본 시간으로 안 센다: 덮인 채 7초가 지나면 shown 없음 → false', async ({ browser }) => {
  const { srv, ps } = await room(browser, 2); // 자리 2·3 = 봇
  srv.arrive(0, 2);
  await expect.poll(() => srv.g.turn.step, { timeout: 6000 }).toBe('question');
  // 답과 같은 처리에서 이벤트 알림 2장(3.2초 × 2)을 남긴다 → 두 기기 모두 해설 카드 위에 6.4초 동안 알림
  srv.do(() => {
    srv.room.act({ type: 'answer', seat: 0, choice: 0, ms: 1000 });
    srv.g.log.push({ ev: 'event', seat: 1, kind: 'fund', payload: { received: 300 } }, { ev: 'event', seat: 1, kind: 'fund', payload: { received: 300 } });
  });
  expect(srv.g.turn.step).toBe('explanation');
  const key = srv.room.rec!.stepKey;
  for (const p of ps) { await expect(p.page.locator('.ex')).toBeVisible(); await expect(p.page.locator('.evc')).toBeVisible(); }
  // 7초 + 기다림 2초 안에 '보인 7초'를 못 채운다
  await expect.poll(() => srv.g.turn.step, { timeout: 12_000 }).not.toBe('explanation');
  expect(lastLog(srv, 'explanation')!.shownTo).toEqual([false, false, true, true]);
  for (const p of ps) expect(srv.sent(p.tag, new RegExp(`"stepKey":"${key.replace(/\|/g, '\\|')}"`)), p.tag).toBe(0);
  await close(srv, ps);
});

test('글꼴 서버가 막혀도(끊김·무응답) 첫 화면이 1초 안에 시스템 글꼴로 뜬다', async ({ browser }) => {
  for (const mode of ['abort', 'hang'] as const) {
    const ctx = await browser.newContext({ baseURL: BASE });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => (mode === 'abort' ? route.abort() : new Promise(() => {}))); // hang: 응답 없음
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto('/', { waitUntil: 'commit' });
    await expect(page.locator('[data-act="intro-start"]')).toBeVisible({ timeout: 1000 });
    const ms = Date.now() - t0;
    console.log(`[T15] fonts ${mode}: 첫 화면 ${ms}ms`);
    expect(ms, mode).toBeLessThan(1000);
    await ctx.close();
  }
});

test('해설 중 새로고침(재접속)한 기기도 7초를 다 보면 shown 이 서버에 받아져 shownTo true', async ({ browser }) => {
  const { srv, ps } = await room(browser, 2); // 자리 2·3 = 봇
  srv.arrive(0, 2);
  await expect.poll(() => srv.g.turn.step, { timeout: 6000 }).toBe('question');
  srv.do(() => { srv.room.act({ type: 'answer', seat: 0, choice: 0, ms: 1000 }); });
  expect(srv.g.turn.step).toBe('explanation');
  const key = srv.room.rec!.stepKey;
  // 새로고침: accept → state(logFrom=N, 로그 없음) → welcome → state(0) 순서로 다시 받는다
  await ps[1].page.reload();
  await expect(ps[1].page.locator('.ex')).toBeVisible();
  // 서버가 기다리는 2초 안에 7초를 채울 수 있게 마감만 늦춘다(같은 단계라 stepKey 그대로)
  srv.hurry(9_000);
  await expect.poll(() => srv.sent('p1', /"t":"shown"/), { timeout: 12_000 }).toBe(1);
  expect(srv.sent('p1', new RegExp(`"stepKey":"${key.replace(/\|/g, '\\|')}"`))).toBe(1); // 옛(로그 0) 키가 아니라 지금 해설 단계 키
  await expect.poll(() => lastLog(srv, 'explanation')?.shownTo, { timeout: 12_000 }).toEqual([true, true, true, true]); // 봇 자리는 늘 true
  await close(srv, ps);
});

test('미션 칸: 도착 → T08 미션 패널(푸는 사람·관전)', async ({ browser }) => {
  const { srv, ps } = await room(browser, 2);
  srv.arrive(0, 6);
  await expect(ps[0].page.locator('.mp')).toHaveAttribute('data-role', 'player');
  await expect(ps[1].page.locator('.mp')).toHaveAttribute('data-role', 'spectator');
  expect(srv.g.turn.step).toBe('mission');
  await close(srv, ps);
});

test('미션 실패 해설(QA r3): 도착자 화면에만 정답 선 + explain, 관전자 화면·메시지엔 없음, 풀이 중엔 누구에게도 없음', async ({ browser }) => {
  const { srv, ps } = await room(browser, 2);
  const [a, b] = ps;
  const m = missions.find((x) => x.id === 'm-01')! as (typeof missions)[number] & { explain: string };
  srv.arrive(0, 6, (g) => { g.usedMissionIds = missions.filter((x) => x.id !== m.id).map((x) => x.id); });
  await expect(a.page.locator('.mp')).toHaveAttribute('data-mission', m.id);
  await expect(b.page.locator('.mp')).toHaveAttribute('data-mission', m.id);
  await expect(a.page.locator('.mp [data-end^="r"]')).toHaveCount(m.pairs!.length);
  const sm = srv.room.stateMsg(0);
  const shown = sm.t === 'state' ? sm.game!.turn.mission! : null;
  // 전부 틀리게: 왼쪽 i 를 정답 오른쪽의 다음 자리에
  const n = shown!.left.length;
  for (let i = 0; i < n; i++) {
    const r = (shown!.right.indexOf(m.pairs!.find((p) => p.left === shown!.left[i])!.right) + 1) % n;
    await tap(a.page, `.mp [data-end="l${i}"]`);
    await tap(a.page, `.mp [data-end="r${r}"]`);
  }
  const before = srv.outTo('p0').length;
  for (const tag of ['p0', 'p1']) expect(srv.outTo(tag).join('\n'), `${tag} 풀이 중`).not.toContain(m.explain);
  await tap(a.page, '.mp-submit');
  await expect.poll(() => lastLog(srv, 'mission')?.success, { timeout: 4000 }).toBe(false);
  // 도착자: 내 선(회색 점선) + 정답 초록 선 + explain
  await expect(a.page.locator('.mp-explain-text')).toHaveText(m.explain);
  await expect(a.page.locator('.cn-mine.is-wrong')).toHaveCount(n);
  for (const pr of m.pairs!) await expect(a.page.locator(`.cn-line--key[data-l="${shown!.left.indexOf(pr.left)}"][data-r="${shown!.right.indexOf(pr.right)}"]`)).toHaveCount(1);
  expect(srv.outTo('p0').slice(before).join('\n')).toContain(m.explain);
  // 관전자: 참/거짓만, 정답 선·해설 없음, 받은 메시지에 explain 0건
  await expect(b.page.locator('.mp .tf')).toBeVisible();
  await expect(b.page.locator('.mp-explain, .cn-line--key')).toHaveCount(0);
  expect(srv.outTo('p1').join('\n')).not.toContain(m.explain);
  expect(srv.outTo('p1').join('\n')).not.toContain('"reveal":{');
  const qa3 = fileURLToPath(new URL('../../harness/state/traveling-world/reports/QA3-fix-shots/', import.meta.url));
  await a.page.waitForTimeout(600);
  await a.page.screenshot({ path: `${qa3}game-arriver-${test.info().project.name}.png` });
  await b.page.screenshot({ path: `${qa3}game-spectator-${test.info().project.name}.png` });
  await close(srv, ps);
});

test('미션 실패 해설 6초 창(QA4-reveal): 혼자 + 봇 3명, m-01 전부 틀림 → 봇이 먼저 다 답해도 정답·해설이 5.8초 넘게 보인다', async ({ browser }) => {
  const { srv, ps } = await room(browser, 1); // 자리 1~3 = 봇
  const [a] = ps;
  const m = missions.find((x) => x.id === 'm-01')! as (typeof missions)[number] & { explain: string };
  srv.arrive(0, 6, (g) => { g.usedMissionIds = missions.filter((x) => x.id !== m.id).map((x) => x.id); });
  await expect(a.page.locator('.mp')).toHaveAttribute('data-mission', m.id);
  await expect(a.page.locator('.mp [data-end^="r"]')).toHaveCount(m.pairs!.length);
  const sm = srv.room.stateMsg(0, 0);
  const shown = sm.t === 'state' ? sm.game!.turn.mission! : null;
  const n = shown!.left.length;
  for (let i = 0; i < n; i++) {
    const r = (shown!.right.indexOf(m.pairs!.find((p) => p.left === shown!.left[i])!.right) + 1) % n;
    await tap(a.page, `.mp [data-end="l${i}"]`);
    await tap(a.page, `.mp [data-end="r${r}"]`);
  }
  // 해설이 화면에 붙은 순간·떨어진 순간을 기기 시계로 잰다(폴링 지연 없이)
  await a.page.evaluate(() => {
    const w = window as unknown as { __rv: { on?: number; off?: number } };
    w.__rv = {};
    new MutationObserver(() => {
      const el = document.querySelector('.mp-explain-text');
      if (el && w.__rv.on === undefined) w.__rv.on = performance.now();
      if (!el && w.__rv.on !== undefined && w.__rv.off === undefined) w.__rv.off = performance.now();
    }).observe(document.body, { childList: true, subtree: true });
  });
  await tap(a.page, '.mp-submit');
  await expect(a.page.locator('.mp-explain-text')).toHaveText(m.explain);
  // 봇 3명이 마감 전에 다 답했는데도 단계는 그대로 tf(응답만 저장)
  await expect.poll(() => srv.g.turn.tf?.answers.length ?? -1, { timeout: 5_000 }).toBe(3);
  expect(srv.g.turn.step).toBe('tf');
  await expect(a.page.locator('.mp-explain-text')).toHaveCount(1);
  await expect(a.page.locator('.mp-explain-text')).toHaveCount(0, { timeout: 10_000 });
  const rv = await a.page.evaluate(() => (window as unknown as { __rv: { on?: number; off?: number } }).__rv);
  expect(rv.on).toBeDefined();
  expect(rv.off! - rv.on!).toBeGreaterThanOrEqual(5_800);
  expect(lastLog(srv, 'tf_answer')).toBeDefined();
  expect(srv.g.log.filter((e) => e.ev === 'tf_answer' && e.value !== null)).toHaveLength(3);
  await close(srv, ps);
});

/** 화면의 블록 → 이름(블록 그림 아이콘은 빼고, R4-TF2 그림 카드) */
const blockNames = (page: Page) => page.locator('.mp [data-block]').evaluateAll((els) =>
  els.map((e) => (e.querySelector('.blk-name') ?? e).textContent!.trim()));

/** 화면의 연결 끝(data-end) → 글 */
const ends = (page: Page, side: 'l' | 'r') => page.locator(`.mp [data-end^="${side}"]`).evaluateAll((els) =>
  els.map((e) => [(e as HTMLElement).dataset.end!, (e.querySelector('.cn-label') ?? e).textContent!.trim()] as [string, string]));

test('미션 표시 순서: 서버가 섞은 목록을 두 기기가 같게 보고, 표시 번호로 답하면 서버가 되돌려 성공 판정', async ({ browser }) => {
  for (const id of ['m-01', 'm-18', 'm-09', 'm-11']) {
    const { srv, ps } = await room(browser, 2);
    const [a, b] = ps;
    const m = missions.find((x) => x.id === id)!;
    srv.arrive(0, 6, (g) => { g.usedMissionIds = missions.filter((x) => x.id !== id).map((x) => x.id); }); // 이 미션만 남김
    await expect(a.page.locator('.mp')).toHaveAttribute('data-mission', id);
    await expect(b.page.locator('.mp')).toHaveAttribute('data-mission', id); // 기기마다 줌 카메라가 따로 풀린다(R4 T-E)
    const sm = srv.room.stateMsg(0);
    const shown = sm.t === 'state' ? sm.game!.turn.mission : null;
    expect(shown).not.toBeNull();
    if (m.type === 'connect') {
      for (const p of [a, b]) await expect(p.page.locator('.mp [data-end^="r"]')).toHaveCount(shown!.right!.length); // 패널이 다 그려진 뒤
      const L = await ends(a.page, 'l'), R = await ends(a.page, 'r');
      expect(L.map(([, t]) => t)).toEqual(shown!.left);
      expect(R.map(([, t]) => t)).toEqual(shown!.right);
      expect(await ends(b.page, 'r')).toEqual(R); // 관전자도 같은 순서
      for (const [le, lt] of L) {
        const rt = m.pairs!.find((p) => p.left === lt)!.right;
        await tap(a.page, `.mp [data-end="${le}"]`);
        await tap(a.page, `.mp [data-end="${R.find(([, t]) => t === rt)![0]}"]`);
      }
    } else if (m.type === 'order') {
      const blocks = await blockNames(a.page);
      expect(blocks).toEqual(shown!.steps);
      expect(blocks).not.toEqual(m.steps); // 처음 보이는 순서는 정답 순서가 아니다
    } else {
      // 블록(지도): 블록 = 서버 왼쪽 목록, 칸 = 서버 오른쪽 목록. 지도 위치(at)·구역(zones)은 서버 값으로 그린다
      const blocks = await blockNames(a.page);
      expect(blocks).toEqual(shown!.left);
      if (id === 'm-09') {
        expect(shown!.at).toHaveLength(4);
        await expect(a.page.locator('.mp .wm[data-mode="spots"]')).toHaveCount(1);
        await expect(b.page.locator('.mp .wm[data-mode="spots"]')).toHaveCount(1);
      } else {
        expect(shown!.zones).toEqual(shown!.right.map((r) => ({ '적도 부근': 'tropical', '비가 적은 저·중위도': 'dry', '북반구 중·고위도': 'cold', '극지방 부근': 'polar' } as Record<string, string>)[r]));
        await expect(a.page.locator('.mp .wm[data-mode="zones"]')).toHaveAttribute('data-zones', shown!.zones!.join(' '));
      }
    }
    if (m.type === 'connect') {
      await tap(a.page, '.mp-submit');
      await expect.poll(() => lastLog(srv, 'mission')?.success, { timeout: 4000 }).toBe(true);
      const sent = srv.got.filter((x) => x.tag === 'p0' && /missionAnswer/.test(x.msg)).map((x) => JSON.parse(x.msg).a.pairs as [number, number][]);
      expect(sent).toHaveLength(1);
      // 보낸 번호는 표시 번호: 원래 pairs 번호와 다르게 섞여 있다
      expect(sent[0].every(([l, r]) => shown!.left[l] && m.pairs!.find((p) => p.left === shown!.left[l])!.right === shown!.right[r])).toBe(true);
      await expect(b.page.locator('.mp')).toHaveAttribute('data-phase', 'tf');
    }
    await close(srv, ps);
  }
});

test('멈춤·이어 하기(U1): 방장 멈춤 간판 → 멈춤 화면(남은 시간·PIN 화면 폭 20% 이상·순위 한 줄) → 여기까지 왔어요(순위·땅·공개 카드) → 남은 시간 그대로 재개', async ({ browser }) => {
  const { srv, ps } = await room(browser, 2);
  srv.do((g) => {
    g.tiles[2] = { owner: 0, level: 2, festivalTarget: false }; g.tiles[12] = { owner: 1, level: 0, festivalTarget: false }; g.revealedCards.push('th-1', 'fr-1');
    g.tiles[16] = { owner: 0, level: 4, festivalTarget: false };
    g.log.push({ ev: 'dice', seat: 0, d1: 1, d2: 2 }, { ev: 'build', seat: 0, tile: 16, level: 4, cost: 1 }, { ev: 'stamp', seat: 0, country: 'eg', level: 3 });
  });
  const host = ps[0].page;
  const proj = test.info().project.name;
  // 간판: 모래시계 + mm:ss, "차시" 없음. 방장만 멈춤 간판
  await expect(host.locator('.board-timer')).toHaveText(/^\d\d:\d\d$/);
  await expect(host.locator('.board-timer svg')).toHaveCount(1);
  await expect(ps[1].page.locator('[data-act="pause"]')).toHaveCount(0);
  await host.locator('[data-act="pause"]').click();
  await expect(host.locator('.gm-ask')).toContainText('잠깐 쉴까요?');
  await clean(host);
  await host.screenshot({ path: `${U1_SHOTS}pause-ask-${proj}.png` });
  await host.locator('[data-act="pause"]').click(); // 두 번 눌러야 멈춤
  await expect(host.locator('.save')).toBeVisible({ timeout: 4000 });
  const left = srv.g.clock.remainingMs;
  expect(srv.g.phase).toBe('paused');
  expect(left).toBeGreaterThan(39 * 60_000);
  await expect(host.locator('.save-title')).toHaveText('잠깐 쉬어요. 다음에 이어서 해요');
  const mm = String(Math.floor(Math.ceil(left / 1000) / 60)).padStart(2, '0');
  await expect(host.locator('[data-k="time-left"]')).toContainText(`${mm}:`);
  const pin = srv.room.rec!.seats[0].pin;
  await expect(host.locator('.save-pin')).toHaveText(pin);
  const w = await host.locator('.save-pin').evaluate((e) => e.getBoundingClientRect().width / innerWidth);
  expect(w).toBeGreaterThanOrEqual(0.2);
  // 자기 자리 PIN 하나만(방장도, 자리 2·3 은 시작부터 봇 — PRD §8-11 QA8). '새 친구' 안내 없음
  for (const p of ps) await expect(p.page.locator('[data-pin]')).toHaveCount(1);
  await expect(ps[1].page.locator('.save-pin')).toHaveText(srv.room.rec!.seats[1].pin);
  await expect(host.locator('.save-others')).toHaveCount(0);
  expect(await host.locator('.save').innerText()).not.toMatch(/새 친구|로봇 자리/);
  await expect(host.locator('.save-lead')).toContainText('사진');
  // 다른 기기 복귀에 필요한 방 코드도 사진에 남는다(QA r9)
  for (const p of ps) await expect(p.page.locator('[data-k="room-code"] b')).toHaveText(srv.room.rec!.code);
  await expect(host.locator('.pause-rank-item')).toHaveCount(4); // 옛 중간 결과의 순위 한 줄
  await expect(host.locator('.rs')).toHaveCount(0); // 중간 결과 화면은 없다
  expect(await host.locator('body').innerText()).not.toMatch(/차시/);
  await clean(host);
  await shot(host, 'pause-save');
  await shot(host, `../U1-time-shots/pause-${proj}`);
  await host.getByRole('button', { name: '사진 찍었어요' }).click();
  await expect(host.locator('.resume .save-title')).toHaveText('여기까지 왔어요');
  await expect(host.locator('.rank-row')).toHaveCount(4);
  await expect(host.locator('.rank-row[data-seat="0"] .land-chip').first()).toContainText('타이 · 시장');
  await expect(host.locator('.rc')).toHaveCount(2);
  expect(await host.locator('body').innerText()).not.toMatch(/차시/);
  await clean(host);
  await shot(host, 'resume');
  await shot(host, `../U1-time-shots/resume-${proj}`);
  await host.locator('[data-act="resume"]').click();
  await expect(host.locator('.board-root')).toBeVisible();
  expect(srv.g.phase).toBe('playing');
  expect(srv.g.clock.remainingMs).toBeLessThanOrEqual(left);
  expect(srv.g.clock.remainingMs).toBeGreaterThan(left - 10_000); // 멈춘 동안은 안 줄었다
  await close(srv, ps);
});

test('놀이 시간 간판(U1): 막판 5분은 붉은 간판 + "통행료 ×1.5" 칩, 시계는 받은 뒤 1초씩 줄어 보인다', async ({ browser }) => {
  const { srv, ps } = await room(browser, 2);
  const host = ps[0].page;
  const proj = test.info().project.name;
  await expect(host.locator('.board-timer-sign')).not.toHaveClass(/is-last/);
  await expect(host.locator('.board-timer-chip')).toHaveCount(0);
  await host.locator('.board-timer').screenshot({ path: `${U1_SHOTS}sign-normal-${proj}.png` });
  await host.screenshot({ path: `${U1_SHOTS}board-${proj}.png` });
  srv.do((g) => { g.clock.remainingMs = 4 * 60_000 + 30_000; });
  await expect(host.locator('.board-timer-sign')).toHaveClass(/is-last/);
  await expect(host.locator('.board-timer-chip')).toHaveText('통행료 ×1.5');
  const a = await host.locator('.board-timer b').innerText();
  expect(a).toMatch(/^04:[23]\d$/);
  await expect.poll(() => host.locator('.board-timer b').innerText(), { timeout: 4000 }).not.toBe(a); // 서버 갱신 없이도 줄어든다
  await host.locator('.board-timer-sign').screenshot({ path: `${U1_SHOTS}sign-last-${proj}.png` });
  await host.screenshot({ path: `${U1_SHOTS}board-last-${proj}.png` });
  await close(srv, ps);
});

test('빈자리 봇(U2): 사람 1명이 출발하면 봇 3이 판을 돌리고, 끝나면 4인 결과 — 별도 모드 문구 없음', async ({ browser }) => {
  test.setTimeout(180_000);
  const MODE_RE = /솔로|혼자 모드|연습 모드|봇 난이도/;
  const { srv, ps } = await room(browser, 1, false);
  const [a] = ps;
  await expect(a.page.locator('.lb-slot-state', { hasText: '로봇이 함께해요' })).toHaveCount(3);
  await expect(a.page.locator('[data-act="start"]')).toBeVisible(); // 혼자여도 방장은 출발할 수 있다
  expect(await a.page.locator('body').innerText()).not.toMatch(MODE_RE);
  await a.page.locator('[data-act="start"]').click();
  await expect(a.page.locator('.board-root')).toBeVisible();
  expect(srv.g.seats.map((x) => x.isBot)).toEqual([false, true, true, true]);
  await expect(a.page.locator('.panel-bot')).toHaveCount(3);
  // 정답률: 40분 판 범위(BOT_ACCURACY[40])에서 자리마다
  for (const x of srv.room.rec!.botAccuracy) expect(x).toBeGreaterThanOrEqual(0.6), expect(x).toBeLessThan(0.7);
  // 판이 돈다: 사람 차례 마감만 당기고, 봇 셋이 각자 주사위를 굴린다
  await expect.poll(() => {
    if (srv.g.turn.seat === 0 || srv.g.turn.step === 'tf') srv.hurry(100);
    return new Set(srv.g.log.filter((e) => e.ev === 'dice' && e.seat !== 0).map((e) => (e as { seat: number }).seat)).size;
  }, { timeout: 150_000, intervals: [500] }).toBe(3);
  expect(srv.g.log.some((e) => e.ev === 'dice' && e.seat === 0)).toBe(true);
  expect(await a.page.locator('body').innerText()).not.toMatch(MODE_RE);
  srv.do((g) => { g.clock.remainingMs = 1_000; });
  await expect.poll(() => {
    if (srv.g.phase === 'playing') srv.hurry(100);
    return srv.g.phase;
  }, { timeout: 30_000, intervals: [500] }).toBe('finished');
  await expect(a.page.locator('.rs[data-kind="final"] .rs-title')).toHaveText('최종 결과');
  await expect(a.page.locator('[data-k="rank"] li')).toHaveCount(4);
  expect(await a.page.locator('body').innerText()).not.toMatch(MODE_RE);
  await shot(a.page, 'u2-one-human-final');
  await close(srv, ps);
});

test('최종 결과: 놀이 시간이 다 되면 → 게임 끝 → 결과 화면(순위·학습 카드·마그넷)', async ({ browser }) => {
  const { srv, ps } = await room(browser, 2);
  const [host, b] = ps;
  srv.do((g) => {
    g.clock.remainingMs = 1_500; // 곧 끝(주사위 대기 중이면 바로 최종 결과)
    g.tiles[1] = { owner: 1, level: 4, festivalTarget: false };
    g.log.push(
      { ev: 'dice', seat: 1, d1: 1, d2: 2 }, { ev: 'build', seat: 1, tile: 1, level: 4, cost: 1 }, { ev: 'stamp', seat: 1, country: 'ph', level: 2 },
      { ev: 'question', seat: 1, qid: 'ph-1-q1', country: 'ph', level: 1, kind: 'initial', topics: ['3.1'], mTags: ['M1'], review: false },
      { ev: 'answer', seat: 1, qid: 'ph-1-q1', choice: 1, correct: false, ms: 900, isBot: false, chosenMTags: ['M1'] },
    );
  });
  await expect.poll(() => srv.g.phase, { timeout: 6000 }).toBe('finished');
  expect(lastLog(srv, 'clock')).toMatchObject({ kind: 'end', by: 'timeout' });
  void host;
  for (const p of ps) await expect(p.page.locator('.rs[data-kind="final"] .rs-title')).toHaveText('최종 결과');
  await expect(b.page.locator('[data-k="rank"] li')).toHaveCount(4);
  const res = lastLog(srv, 'result')!;
  await expect(b.page.locator('[data-k="rank"] li').first()).toHaveAttribute('data-seat', String(res.finalRanks[0]));
  // 2번 자리(나) 탭: 헷갈린 번호 M1(고른 선지 태그), 필리핀 마그넷, 도장 핀
  await expect(b.page.locator('[data-k="mtags"]')).toContainText('M1');
  await expect(b.page.locator('[data-k="magnet"][data-country="ph"]')).toContainText(cards.find((c) => c.id === 'ph-1')!.answer);
  await expect(b.page.locator('[data-k="pin"]')).toHaveCount(1);
  expect(await b.page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await clean(b.page);
  await shot(b.page, 'final-results');
  await close(srv, ps);
});

test('재접속: 소켓 강제 종료 → 2초 안에 자동 복귀 / 다른 기기는 PIN / 탭 복귀 때 서버 상태로', async ({ browser }) => {
  const { srv, ps } = await room(browser, 2);
  const [a, b] = ps;
  srv.dropSocket('p1');
  const t0 = Date.now();
  await expect.poll(() => srv.sent('p1', /"t":"rejoin"/), { timeout: 3000 }).toBe(1);
  expect(Date.now() - t0).toBeLessThan(2000);
  await expect(b.page.locator('.game')).toHaveAttribute('data-seat', '1');
  await expect(b.page.locator('.net-banner')).toHaveCount(0);
  expect(srv.room.rec!.seats[1].connected).toBe(true);

  // 다른 기기: 저장 없음 → PIN 입력 화면. 틀리면 안내, 맞으면 그 자리로
  const other = await player(browser, srv, 'x');
  await joinCode(other.page, srv.code);
  await expect(other.page.locator('.pin-box')).toBeVisible();
  expect(await other.page.locator('input[type="text"]').count()).toBe(1);
  const pin = srv.room.rec!.seats[1].pin;
  await other.page.locator('.pin-seat').nth(1).click();
  await other.page.locator('#seat-pin').fill(pin === '0000' ? '1111' : '0000');
  await other.page.getByRole('button', { name: '돌아가기' }).click();
  await expect(other.page.locator('.sc-msg')).toContainText('번호가 맞지 않아요');
  await other.page.locator('#seat-pin').fill(pin);
  await other.page.getByRole('button', { name: '돌아가기' }).click();
  await expect(other.page.locator('.game')).toHaveAttribute('data-seat', '1');
  await expect(b.page.locator('.sc-note')).toContainText('다른 기기에서'); // 원래 기기는 멈춘다(자리 뺏기 반복 없음)
  await b.page.waitForTimeout(1500);
  expect(srv.room.rec!.seats[1].connected).toBe(true);
  expect(srv.sent('p1', /"t":"rejoin"/)).toBe(1);

  // 탭이 숨었다가 돌아오면 sync → 서버 단계와 같다
  srv.arrive(0, 2);
  await a.page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => srv.sent('p0', /"t":"sync"/)).toBeGreaterThan(0);
  await expect(a.page.locator('.game')).toHaveAttribute('data-step', srv.g.turn.step);
  await close(srv, [...ps, other]);
});

test('독점승(§16.5): 실제 판에서 대륙 마지막 칸을 사면 보드에 독점 연출 → 3초 뒤 결과, 재접속은 바로 결과', async ({ browser }) => {
  const { srv, ps } = await room(browser, 2);
  const [a, b] = ps;
  // 아시아 1~4 를 자리 0 이 갖고 있고, 5(사우디아라비아) 행동 단계 — 사면 독점 성립 = 엔진이 같은 갱신에서 판을 끝낸다
  srv.do((g) => {
    for (const t of [1, 2, 3, 4]) g.tiles[t] = { owner: 0, level: 0, festivalTarget: false };
    g.players[0].pos = 5;
    g.players[0].coin = 5000;
    g.turn = { ...g.turn, seat: 0, step: 'action', tile: 5, correct: false, discount: false, question: null, tf: null };
  });
  await expect(a.page.locator('[data-act="buy"]')).toBeVisible();
  await tap(a.page, '[data-act="buy"]');
  await expect.poll(() => srv.g.phase).toBe('finished');
  expect(srv.g.monopolies).toEqual([{ continent: 'asia', seat: 0 }]);
  for (const p of ps) {
    // 결과로 바로 넘어가지 않고 보드에서 연출: 칸 글로우·지도 자리색·이정표·띠
    await expect(p.page.locator('.app[data-mono-hold="1"] .board-root')).toBeVisible();
    await expect(p.page.locator('.tile.is-glow')).toHaveCount(5);
    await expect(p.page.locator('.mono-band')).toContainText('아시아를 독점했어요!');
    await expect(p.page.locator('.plaza-mask[data-continent="asia"]')).toHaveClass(/is-on/);
    await expect(p.page.locator('.sign[data-continent="asia"]')).toHaveAttribute('data-owner', '0');
    await expect(p.page.locator('.rs[data-kind="final"]')).toHaveCount(0);
    await expect(p.page.locator('.ov-layer--menu, .evc')).toHaveCount(0); // 메뉴·알림 카드 없이 보드만
  }
  await shot(a.page, 'monopoly-real', false);
  for (const p of ps) await expect(p.page.locator('.rs[data-kind="final"]')).toBeVisible({ timeout: 5000 });
  // 끝난 판에 다시 들어오면(새로고침) 연출 없이 바로 결과
  await b.page.reload();
  await expect(b.page.locator('.rs[data-kind="final"]')).toBeVisible({ timeout: 8000 });
  await expect(b.page.locator('.board-root')).toHaveCount(0);
  await close(srv, ps);
});
