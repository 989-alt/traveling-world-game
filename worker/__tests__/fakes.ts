// 가짜 Durable Object: 동기 KV(SQLite 백엔드와 같은 API), 알람 하나, Hibernation 소켓.
import { vi } from 'vitest';
import { Room } from '../room';
import { nextFloat } from '../../src/engine/rng';
import type { ServerMsg } from '../../src/shared/protocol';
import type { Content, GameState, Settings } from '../../src/shared/types';
import cards from './fixtures/cards.json';
import questions from './fixtures/questions.json';
import tf from './fixtures/tf.json';
import culture from './fixtures/culture-cards.json';
import missions from './fixtures/missions.json';

/** src/data 를 복사해 둔 고정 문항 풀(th-1, m-sample-*). T04 가 src/data 를 바꿔도 테스트는 그대로 */
export const FIXTURE = { cards, questions, tf, culture, missions } as unknown as Content;

/** 픽스처 문항 풀을 쓰는 Room (DO 가 새로 뜬 것과 같다) */
export function newRoom(ctx: FakeCtx) {
  const room = new Room(ctx as unknown as DurableObjectState, {});
  room.content = FIXTURE;
  return room;
}

export class FakeWS {
  sent: ServerMsg[] = [];
  closed = false;
  private att: unknown = null;
  send(s: string) { if (this.closed) throw new Error('closed'); this.sent.push(JSON.parse(s)); }
  close() { this.closed = true; }
  serializeAttachment(a: unknown) { this.att = structuredClone(a); }
  deserializeAttachment() { return structuredClone(this.att); }
  of<T extends ServerMsg['t']>(t: T) { return this.sent.filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[]; }
  last<T extends ServerMsg['t']>(t: T) { return this.of(t).at(-1); }
}

export class FakeCtx {
  data = new Map<string, unknown>();
  alarmAt: number | null = null;
  sockets: FakeWS[] = [];
  storage = {
    kv: {
      get: (k: string) => this.data.get(k),
      put: (k: string, v: unknown) => { this.data.set(k, v); },
      delete: (k: string) => this.data.delete(k),
      list: ({ prefix = '' }: { prefix?: string } = {}) =>
        [...this.data.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)),
    },
    setAlarm: async (t: number) => { this.alarmAt = t; },
    getAlarm: async () => this.alarmAt,
    deleteAlarm: async () => { this.alarmAt = null; },
    deleteAll: async () => { this.data.clear(); },
  };
  acceptWebSocket(ws: FakeWS) { this.sockets.push(ws); }
  getWebSockets() { return this.sockets.filter((s) => !s.closed); }
  /** 저장소만 복사한 새 ctx (DO 재시작 = 메모리 날아감) */
  copy() { const c = new FakeCtx(); c.data = new Map(this.data); c.alarmAt = this.alarmAt; return c; }
}

export const SETTINGS: Settings = { totalMinutes: 40, touristQuiz: false }; // U3: 20 삭제
export const T0 = Date.UTC(2026, 9, 22, 9, 0, 0);

/** 서버 난수(PIN·별명·판 시드)를 시드 고정으로. 진짜 crypto 면 판마다 달라 드물게(약 1%) 봇이 놀이 시간 안에 일찍 독점승을 해
 *  알람이 14일 만료로 건너뛰고 방이 지워진다(T15 실측) — 시험이 시드에 따라 흔들리지 않게 한다 */
export function seedCrypto(seed = 0x5eed) {
  let st = seed >>> 0;
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(((v: Uint8Array | Uint16Array | Uint32Array) => {
    const max = 2 ** (v.BYTES_PER_ELEMENT * 8);
    for (let i = 0; i < v.length; i++) { const [f, n] = nextFloat(st); st = n; v[i] = Math.floor(f * max); }
    return v;
  }) as typeof crypto.getRandomValues);
}

export function setup(settings = SETTINGS) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  seedCrypto();
  const ctx = new FakeCtx();
  const room = newRoom(ctx);
  room.init('ABCDEF', settings);
  return { ctx, room };
}

export const asWS = (w: FakeWS) => w as unknown as WebSocket;
export const say = (room: Room, ws: FakeWS, m: unknown) => room.webSocketMessage(asWS(ws), JSON.stringify(m));

export function connect(room: Room, ctx: FakeCtx) {
  const ws = new FakeWS();
  room.accept(asWS(ws));
  return ws;
}

/** n 명 입장(자리 0 = 방장). 소켓 배열 */
export function join(room: Room, ctx: FakeCtx, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const ws = connect(room, ctx);
    say(room, ws, { t: 'hello', charId: i });
    return ws;
  });
}

/** 가짜 시계를 target 까지: 그 사이 알람을 차례로 울린다 */
export async function advanceTo(room: Room, ctx: FakeCtx, target: number, maxAlarms = 100_000) {
  for (let i = 0; i < maxAlarms && ctx.alarmAt !== null && ctx.alarmAt <= target; i++) {
    vi.setSystemTime(Math.max(Date.now(), ctx.alarmAt));
    await room.alarm();
  }
  vi.setSystemTime(target);
}
export const advance = (room: Room, ctx: FakeCtx, ms: number) => advanceTo(room, ctx, Date.now() + ms);

/** 조건이 될 때까지 알람을 울린다(가짜 시계). 못 되면 throw */
export async function runUntil(room: Room, ctx: FakeCtx, ok: () => boolean, maxAlarms = 200_000) {
  for (let i = 0; i < maxAlarms; i++) {
    if (ok()) return;
    if (ctx.alarmAt === null) break;
    vi.setSystemTime(Math.max(Date.now(), ctx.alarmAt));
    await room.alarm();
  }
  if (!ok()) throw new Error('runUntil: 조건 못 맞춤');
}

export const game = (room: Room) => room.game as GameState;
export const count = (room: Room, ev: string) => game(room).log.filter((e) => e.ev === ev).length;

/** 지금 단계 마감까지 남은 ms(가짜 시계) — 문화 카드 마감에 이동 연출 시간이 붙어서 3초 고정이 아니다 */
export const untilDeadline = (room: { rec: { deadlineAt: number | null } | null }) => room.rec!.deadlineAt! - Date.now();
