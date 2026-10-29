// T12 e2e 공용: 이 spec 전용 빌드(임시 outDir·자기 포트) + spec 프로세스 안의 진짜 worker/room.ts(Room).
// flow.spec.ts 와 같은 방식(가짜 DO 저장소 + Playwright routeWebSocket). flow.spec 은 그대로 두고 여기 사본을 쓴다.
// 다른 점: 서버 시계를 주입한다. Room 이 읽는 Date.now() 를 이 러너에서만 clock.now() 로 바꿔 불러온다(제품 코드 수정 0).
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebSocketRoute } from '@playwright/test';
import preact from '@preact/preset-vite';
import { build, preview, runnerImport, type PreviewServer } from 'vite';
import type { Room } from '../../worker/room';
import { nextFloat } from '../../src/engine/rng';
import type { GameState, Seat, Settings } from '../../src/shared/types';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** 서버 시계: 실제 시간 × rate. rate 를 바꿔도 시각은 이어진다(뛰지 않음) */
export const clock = {
  base: Date.now(),
  realBase: Date.now(),
  rate: 1,
  now() { return this.base + (Date.now() - this.realBase) * this.rate; },
  setRate(r: number) { this.base = this.now(); this.realBase = Date.now(); this.rate = r; },
};
(globalThis as { __twClock?: () => number }).__twClock = () => clock.now();

/** worker 모듈별 주입 자리 수(Date.now() · crypto.getRandomValues). room.ts 가 바뀌면 이 표를 같이 고친다 */
const INJECT_SITES: Record<string, { now: number; rnd: number }> = { 'room.ts': { now: 10, rnd: 3 }, 'reveal.ts': { now: 0, rnd: 0 } };

/** 서버 난수: seedRandom(s) 뒤로는 mulberry32 로 결정적(재현용). 그 전에는 진짜 crypto */
let rngState: number | null = null;
export function seedRandom(seed: number) { rngState = seed >>> 0; }
(globalThis as { __twRandomValues?: <T extends ArrayBufferView>(a: T) => T }).__twRandomValues = (a) => {
  if (rngState === null) return crypto.getRandomValues(a as unknown as Uint8Array) as unknown as typeof a;
  const view = a as unknown as Uint8Array | Uint16Array | Uint32Array;
  const max = 2 ** (view.BYTES_PER_ELEMENT * 8);
  for (let i = 0; i < view.length; i++) { const [v, n] = nextFloat(rngState); rngState = n; view[i] = Math.floor(v * max); }
  return a;
};

export interface Built { base: string; out: string; RoomCtor: typeof Room; close(): Promise<void> }

/** 기기 쪽 시간(해설 최소 표시 시간·알림 줄·컷씬)이 정해진 곳. uiScale 빌드에서 이 값들에 배율을 곱한다 */
const UI_TIMES: [RegExp, RegExp][] = [
  [/ui\/overlays\/ExplainCard\.tsx$/, /\bSTEP_MS\.explanation(?:Full|Short)\b/g],
  [/ui\/screens\/Game\.tsx$/, /\b(?:TOLL_NOTICE_MS|HELD_NOTICE_MS) = \d+/g],
  [/ui\/overlays\/EventCard\.tsx$/, /\bEVENT_MS = \d+/g],
  [/ui\/cutscene\/Cutscene\.tsx$/, /\bBANNER_ONLY_MS = \d+/g],
  [/shared\/protocol\.ts$/, /\b(?:CUT_MS|HOLD_MS) = \d+/g], // 컷씬 길이(Cutscene.tsx 가 여기서 가져온다)
];

/** 임시 폴더에 빌드 → preview(포트 0) → Room 을 시계 주입 러너로 불러온다.
 *  uiScale: 이 빌드에서만 기기 쪽 시간(UI_TIMES)에 배율을 곱한다 — 서버 시계를 빠르게 돌릴 때 기기 쪽도 같은 빠르기로 맞춘다.
 *  안 맞추면 실제 3초짜리 알림이 서버로는 60초가 돼 다음 해설 카드를 덮는다(시험 인공물) */
export async function setup(tag: string, o: { uiScale?: number } = {}): Promise<Built> {
  const out = join(tmpdir(), `tw-${tag}-e2e-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  const uiSwapped = new Set<number>();
  const shownPlugin = {
    name: 'tw-test-ui-time',
    transform(code: string, id: string) {
      const k = o.uiScale === undefined ? -1 : UI_TIMES.findIndex(([f]) => f.test(id));
      if (k < 0) return null;
      const next = code.replace(UI_TIMES[k][1], (m) => {
        uiSwapped.add(k);
        const n = m.match(/= (\d+)$/);
        return n ? m.replace(/\d+$/, String(Math.round(Number(n[1]) * o.uiScale!))) : `(${m} * ${o.uiScale})`;
      });
      return { code: next, map: null };
    },
  };
  // vite.config.ts 의 에셋 복사 플러그인은 dist 에 쓰므로 쓰지 않고, 같은 플러그인(preact)만 준다
  await build({ root: ROOT, configFile: false, plugins: [shownPlugin, preact()], publicDir: false, logLevel: 'error', build: { outDir: out, emptyOutDir: true } });
  if (o.uiScale !== undefined && uiSwapped.size !== UI_TIMES.length) throw new Error(`기기 시간 주입 실패: ${UI_TIMES.length}개 파일 중 ${uiSwapped.size}개만 바뀜`);
  for (const d of ['webp', 'audio']) symlinkSync(`${ROOT}assets/${d}`, join(out, d), 'dir');
  const server: PreviewServer = await preview({ root: ROOT, configFile: false, build: { outDir: out }, preview: { port: 0, strictPort: false }, logLevel: 'error' });
  // 시계·난수 주입: 러너가 불러오는 worker/** 모듈 전부(테스트 제외). 바꾼 곳 수는 파일별로 정확히 맞아야 하고,
  // 바꾼 뒤에 시간(Date·performance.now)·난수(crypto·Math.random)를 읽는 곳이 하나라도 남으면 실패한다
  const seen = new Map<string, { now: number; rnd: number; left: string[] }>();
  const clockPlugin = {
    name: 'tw-test-clock',
    transform(code: string, id: string) {
      const m = id.match(/\/worker\/(?!__tests__\/)(.+\.ts)$/);
      if (!m) return null;
      const st = { now: 0, rnd: 0, left: [] as string[] };
      const next = code
        .replace(/\bDate\.now\(\)/g, () => { st.now++; return 'globalThis.__twClock()'; })
        .replace(/\bcrypto\.getRandomValues\(/g, () => { st.rnd++; return 'globalThis.__twRandomValues('; });
      st.left = next.split('\n').filter((l) => /\bDate\b|performance\.now|crypto\.|Math\.random/.test(l)).map((l) => l.trim());
      seen.set(m[1], st);
      return { code: next, map: null };
    },
  };
  const RoomCtor = (await runnerImport<{ Room: typeof Room }>(`${ROOT}worker/room.ts`, { root: ROOT, configFile: false, logLevel: 'error', plugins: [clockPlugin] })).module.Room;
  const got = Object.fromEntries([...seen].map(([f, x]) => [f, { now: x.now, rnd: x.rnd }]));
  if (JSON.stringify(got) !== JSON.stringify(INJECT_SITES)) throw new Error(`시계·난수 주입 자리 수가 다름: ${JSON.stringify(got)} ≠ ${JSON.stringify(INJECT_SITES)}`);
  const left = [...seen].flatMap(([f, x]) => x.left.map((l) => `${f}: ${l}`));
  if (left.length) throw new Error(`주입 뒤에도 시간·난수를 직접 읽는 곳:\n${left.join('\n')}`);
  return {
    base: server.resolvedUrls!.local[0].replace(/\/$/, ''), out, RoomCtor,
    async close() { await server.close(); rmSync(out, { recursive: true, force: true }); },
  };
}

export class FakeCtx {
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

export class Bridge {
  closed = false;
  private att: unknown = null;
  constructor(public route: WebSocketRoute, public tag: string) {}
  send(s: string) { if (this.closed) throw new Error('closed'); this.route.send(s); }
  close(code?: number, reason?: string) { if (this.closed) return; this.closed = true; void this.route.close({ code, reason }).catch(() => {}); }
  serializeAttachment(a: unknown) { this.att = structuredClone(a); }
  deserializeAttachment() { return structuredClone(this.att); }
}

type R = Room & { run(f: WebSocket | null, b: () => void): void; act(a: unknown): boolean; dirty: boolean };

let codeN = 0;
export const nextCode = (p: string) => `${p}${'CDEFGHJKMN'[codeN % 10]}${'PQRSTUVWXY'[Math.floor(codeN++ / 10) % 10]}`;

export class Srv {
  ctx = new FakeCtx();
  room: R;
  got: { tag: string; msg: string; at: number }[] = [];
  /** 이 태그의 새 연결은 받지 않는다(끊긴 채로 두기) */
  blocked = new Set<string>();
  /** 배열이면 기기→서버 메시지를 처리하지 않고 쌓아 둔다(release 로 순서대로 처리). '동시에 보낸' 입력을 서버가 둘 다 받은 뒤 처리하게 할 때 */
  held: { tag: string; msg: string; b: Bridge }[] | null = null;
  private tick: ReturnType<typeof setInterval>;
  constructor(RoomCtor: typeof Room, public code: string, settings: Settings = { totalMinutes: 40, touristQuiz: false }) {
    this.room = new RoomCtor(this.ctx as unknown as DurableObjectState, {}) as R;
    this.room.init(code, settings);
    this.tick = setInterval(() => { if (this.ctx.alarmAt !== null && clock.now() >= this.ctx.alarmAt) void this.room.alarm().then(() => this.noteHold()); }, 20);
  }
  attach(route: WebSocketRoute, tag: string) {
    if (this.blocked.has(tag)) { void route.close({ code: 1011, reason: 'blocked' }).catch(() => {}); return; }
    const b = new Bridge(route, tag);
    route.onMessage((m) => {
      this.got.push({ tag, msg: String(m), at: Date.now() });
      if (this.held) { this.held.push({ tag, msg: String(m), b }); return; }
      this.room.webSocketMessage(b as unknown as WebSocket, String(m)); this.noteHold();
    });
    route.onClose(() => { if (b.closed) return; b.closed = true; this.room.webSocketClose(b as unknown as WebSocket); });
    this.room.accept(b as unknown as WebSocket);
  }
  /** 해설 마감에 shown 이 덜 와서 SHOWN_WAIT_MS 기다림이 걸린 단계 키 → 서버 시각(시작·끝). 측정용 */
  holds = new Map<string, { start: number; end?: number }>();
  private noteHold() {
    const r = this.room.rec as { shownWait?: boolean; stepKey: string } | null;
    if (!r) return;
    if (r.shownWait && !this.holds.has(r.stepKey)) this.holds.set(r.stepKey, { start: clock.now() });
    for (const [k, h] of this.holds) if (h.end === undefined && k !== r.stepKey) h.end = clock.now();
  }
  get g(): GameState { return this.room.game!; }
  do(f: (g: GameState) => void) { this.room.run(null, () => { f(this.g); this.room.dirty = true; }); }
  /** seat 가 tile 에 도착하도록 주사위(a, b — 더블 아님)를 맞춰 굴린다 */
  arrive(seat: Seat, tile: number, a = 1, b = 2) {
    this.do((g) => {
      g.players[seat].pos = (tile - (a + b) + 30) % 30; // 30칸 고리
      g.turn = { ...g.turn, seat, step: 'roll', tile: null, correct: null, discount: false, rolledDouble: false, extraRoll: false, question: null, tf: null, missionId: null, missionSuccess: false, rewardOptions: [], takeoverCost: 0 };
      g.rngState = rngFor(a, b);
      this.room.act({ type: 'roll', seat });
    });
  }
  /** 태그별 자리(소켓 attachment) */
  seatOf(tag: string): Seat | null {
    const b = this.ctx.getWebSockets().find((x) => x.tag === tag);
    return b ? ((b.deserializeAttachment() as { seat: Seat | null } | null)?.seat ?? null) : null;
  }
  sent(tag: string, re: RegExp) { return this.got.filter((x) => x.tag === tag && re.test(x.msg)).length; }
  dropSocket(tag: string) { this.ctx.getWebSockets().filter((b) => b.tag === tag).forEach((b) => { b.close(); this.room.webSocketClose(b as unknown as WebSocket); }); }
  release() {
    const q = this.held ?? [];
    this.held = null;
    for (const x of q) { this.room.webSocketMessage(x.b as unknown as WebSocket, x.msg); this.noteHold(); }
  }
  stop() { clearInterval(this.tick); }
}

/** 첫 두 randInt(6) 이 (a, b) 가 되는 rng 상태 */
export function rngFor(a: number, b: number) {
  for (let s = 1; ; s++) {
    const [v1, n1] = nextFloat(s);
    const [v2] = nextFloat(n1);
    if (1 + Math.floor(v1 * 6) === a && 1 + Math.floor(v2 * 6) === b) return s;
  }
}

export const SOURCE_RE = /지도서|교과서|\[MCP|\[6사|\[4사|pp?\.\s?[0-9]/;
export const mkdirp = (p: string) => mkdirSync(p, { recursive: true });
