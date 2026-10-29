import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODE_RE, PIN_TRY_MS } from '../../src/shared/protocol';
import { MAX_CODE_TRIES, createRoom, randomCode } from '../create';
import { OFFLINE_BOT_MS, PIN_LOCK_MS, Room } from '../room';
import { BOT_ACCURACY } from '../../src/shared/economy';
import { TOTAL_MINUTES } from '../../src/shared/types';
import { withDice } from '../../src/engine/__tests__/helpers';
import { FakeCtx, SETTINGS, advance, asWS, connect, count, game, join, runUntil, say, setup, newRoom } from './fakes';

afterEach(() => { vi.useRealTimers(); });

/** 이름 → DO 하나. 진짜 namespace 처럼 같은 이름이면 같은 방 */
function fakeNamespace() {
  const rooms = new Map<string, Room>();
  const get = (name: string) => {
    if (!rooms.has(name)) rooms.set(name, newRoom(new FakeCtx()));
    return rooms.get(name)!;
  };
  const ns = {
    idFromName: (name: string) => name,
    get: (name: string) => ({ fetch: (url: string, init: RequestInit) => get(name).fetch(new Request(url, init)) }),
  };
  return { ns: ns as unknown as DurableObjectNamespace, get };
}

describe('방 코드', () => {
  it('6자리, 혼동 글자(0 O 1 I) 없음', () => {
    for (let i = 0; i < 2000; i++) {
      const c = randomCode();
      expect(c).toMatch(CODE_RE);
      expect(c).not.toMatch(/[0O1I]/);
    }
  });

  it('충돌하면 다시 뽑는다, 5번 다 충돌하면 503', async () => {
    const { ns, get } = fakeNamespace();
    get('AAAAAA').init('AAAAAA', SETTINGS);
    get('BBBBBB').init('BBBBBB', SETTINGS);
    const seq = ['AAAAAA', 'BBBBBB', 'CCCCCC'];
    const res = await createRoom(ns, SETTINGS, () => seq.shift()!);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ code: 'CCCCCC' });
    expect(get('CCCCCC').rec?.code).toBe('CCCCCC');

    let tries = 0;
    const res2 = await createRoom(ns, SETTINGS, () => { tries++; return 'AAAAAA'; });
    expect(res2.status).toBe(503);
    expect(tries).toBe(MAX_CODE_TRIES);
  });

  it('잘못된 설정·코드는 방을 만들지 않는다', async () => {
    const room = newRoom(new FakeCtx());
    const bad = await room.fetch(new Request('https://room/init', { method: 'POST', body: JSON.stringify({ code: 'ABCDEF', settings: { totalMinutes: 30 } }) }));
    expect(bad.status).toBe(400);
    const twenty = await room.fetch(new Request('https://room/init', { method: 'POST', body: JSON.stringify({ code: 'ABCDEF', settings: { totalMinutes: 20, touristQuiz: false } }) }));
    expect(twenty.status).toBe(400); // 2026-10-28 U3: 20분 삭제
    expect(room.init('ABCDE0', SETTINGS)).toBe(false);
    expect(room.rec).toBeNull();
  });
});

describe('입장', () => {
  it('4자리가 차면 5번째는 full, 시작 뒤 새 입장은 started', () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 4);
    ws.forEach((w, i) => {
      expect(w.last('welcome')).toEqual({ t: 'welcome', seat: i, pin: expect.stringMatching(/^[0-9]{4}$/) });
    });
    const fifth = join(room, ctx, 1)[0];
    expect(fifth.last('error')).toEqual({ t: 'error', code: 'full' });

    const { ctx: c2, room: r2 } = setup();
    const [host] = join(r2, c2, 1);
    say(r2, host, { t: 'start' });
    const late = join(r2, c2, 1)[0];
    expect(late.last('error')).toEqual({ t: 'error', code: 'started' });
    expect(late.of('welcome')).toHaveLength(0);
  });

  it('같은 캐릭터를 둘이 고르면 먼저 온 사람이 갖고, 뒤는 비어 있는 첫 번호', () => {
    const { ctx, room } = setup();
    const ws = [connect(room, ctx), connect(room, ctx), connect(room, ctx)];
    say(room, ws[0], { t: 'hello', charId: 2 });
    say(room, ws[1], { t: 'hello', charId: 2 }); // 같은 순간 → DO 는 차례로 처리
    say(room, ws[2], { t: 'hello', charId: 0 });
    expect(room.rec!.seats.slice(0, 3).map((s) => s.charId)).toEqual([2, 0, 1]);
    const st = ws[0].last('state')!; // 결과는 평소처럼 방송된다
    expect(st.seats.slice(0, 3).map((s) => s.charId)).toEqual([2, 0, 1]);
    // 시작부터 봇인 자리는 PIN 으로 넘겨받지 못한다(PRD §8-15 QA8) — 사람 자리 캐릭터는 그대로
    say(room, ws[0], { t: 'start' });
    const kid = connect(room, ctx);
    say(room, kid, { t: 'rejoin', seat: 3, pin: room.rec!.seats[3].pin });
    expect(kid.last('error')?.code).toBe('pin');
    expect(room.rec!.seats.slice(0, 3).map((s) => s.charId)).toEqual([2, 0, 1]);
  });

  it('방장만 시작, 빈 자리는 봇. 별명은 번호 둘이고 서로 다르다', () => {
    const { ctx, room } = setup();
    const [host, guest] = join(room, ctx, 2);
    say(room, guest, { t: 'start' });
    expect(guest.last('error')?.code).toBe('notHost');
    say(room, host, { t: 'start' });
    expect(game(room).seats.map((s) => s.isBot)).toEqual([false, false, true, true]);
    const nicks = host.last('state')!.seats.filter((s) => s.taken).map((s) => s.nick.join());
    expect(new Set(nicks).size).toBe(2);
  });

  it('시작부터 봇인 자리는 PIN 이 맞아도 새 소켓이 못 앉는다(PRD §8-15 QA8)', async () => {
    const { ctx, room } = setup();
    const [host] = join(room, ctx, 1);
    say(room, host, { t: 'start' });
    say(room, host, { t: 'pause' });
    const pin3 = room.rec!.seats[3].pin;
    const kid = connect(room, ctx);
    say(room, kid, { t: 'rejoin', seat: 3, pin: pin3 });
    expect(kid.last('error')?.code).toBe('pin');
    expect(kid.last('welcome')).toBeUndefined();
    expect(game(room).seats[3].isBot).toBe(true);
    expect(room.rec!.seats[3].claimed).toBe(false);
    expect(room.rec!.seats[3].badPins).toBe(0); // 실패로 세지 않는다(주인 없는 자리 잠금 무의미)
  });

  it('끊겨서 30초 대체 봇이 된 사람 자리는 그 사람 PIN 으로 복귀한다', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 2);
    say(room, ws[0], { t: 'start' });
    const pin1 = room.rec!.seats[1].pin;
    room.webSocketClose(asWS(ws[1]));
    ws[1].close();
    await advance(room, ctx, 30_000);
    expect(game(room).seats[1].isBot).toBe(true);
    expect(room.rec!.seats[1].claimed).toBe(true);
    const back = connect(room, ctx);
    say(room, back, { t: 'rejoin', seat: 1, pin: pin1 });
    expect(back.last('welcome')).toEqual({ t: 'welcome', seat: 1, pin: pin1 });
  });

  it('PIN 실패는 자리 단위: 소켓을 바꿔도 이어 세고, 5번이면 그 자리 60초 잠금', async () => {
    const { ctx, room } = setup();
    join(room, ctx, 1);
    const right = room.rec!.seats[0].pin;
    const wrong = right === '0000' ? '1111' : '0000';
    for (let i = 0; i < 4; i++) {
      const ws = connect(room, ctx); // 매번 새 소켓
      say(room, ws, { t: 'rejoin', seat: 0, pin: wrong });
      expect(ws.last('error')?.code).toBe('pin');
    }
    expect(room.rec!.seats[0].badPins).toBe(4);
    const fifth = connect(room, ctx);
    say(room, fifth, { t: 'rejoin', seat: 0, pin: wrong });
    expect(room.rec!.seats[0].lockedUntil).toBe(Date.now() + PIN_LOCK_MS);
    expect(room.rec!.seats[0].tryAt).toBe(Date.now() + PIN_TRY_MS);
    // 잠긴 동안 새 소켓을 한꺼번에 열어도 PIN_TRY_MS 에 비교는 한 번뿐(맞는 PIN 이어도 창 안이면 비교 없이 locked)
    const burst = (pin: string) => { const w = connect(room, ctx); say(room, w, { t: 'rejoin', seat: 0, pin }); return w.last('error')?.code ?? 'welcome'; };
    expect([burst(right), burst(wrong), burst(wrong)]).toEqual(['locked', 'locked', 'locked']);
    vi.setSystemTime(Date.now() + PIN_TRY_MS);
    expect(Array.from({ length: 20 }, () => burst(wrong))).toEqual(['pin', ...Array(19).fill('locked')]); // 20번 중 1번만 비교
    expect(room.rec!.seats[0].badPins).toBe(1); // 비교한 것만 센다
    // 틀린 비교가 5번 쌓이면 잠금이 늘어난다(3초에 한 번씩)
    for (let i = 0; i < 4; i++) { vi.setSystemTime(Date.now() + PIN_TRY_MS); expect(burst(wrong)).toBe('pin'); }
    expect(room.rec!.seats[0].lockedUntil).toBe(Date.now() + PIN_LOCK_MS);
    // 남이 잠근 직후 주인: 창 안이면 locked, PIN_TRY_MS 뒤 다시 보내면(클라 자동) 통과, 잠금·실패 수 풀림
    const owner = connect(room, ctx);
    say(room, owner, { t: 'rejoin', seat: 0, pin: right });
    expect(owner.last('error')?.code).toBe('locked');
    vi.setSystemTime(Date.now() + PIN_TRY_MS);
    say(room, owner, { t: 'rejoin', seat: 0, pin: right });
    expect(owner.last('welcome')?.seat).toBe(0);
    expect(room.rec!.seats[0]).toMatchObject({ badPins: 0, lockedUntil: 0, tryAt: 0 });
  });

  it('다른 자리로 rejoin 하면 앞 자리는 끊김 처리(30초 뒤 봇)', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 3);
    say(room, ws[0], { t: 'start' });
    const pin2 = room.rec!.seats[2].pin; // 사람이 앉은 자리로만 옮길 수 있다(시작부터 봇 자리는 거부, QA8)
    say(room, ws[1], { t: 'rejoin', seat: 2, pin: pin2 });
    expect(ws[1].last('welcome')?.seat).toBe(2);
    expect(room.rec!.seats[1].connected).toBe(false);
    expect(game(room).seats[1].connected).toBe(false);
    expect(room.rec!.seats[1].offSince).toBe(Date.now());
  });
});

describe('중복·지연·남의 턴', () => {
  it('같은 행동 두 번 → 두 번째 무시 + 그 기기에 상태 재전송, 남의 턴 행동 → 무시', () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 4);
    say(room, ws[0], { t: 'start' });
    const before = ws[1].sent.length;
    const host0 = ws[0].sent.length;
    say(room, ws[1], { t: 'act', a: { type: 'roll' } }); // 자리 0 차례
    expect(count(room, 'dice')).toBe(0);
    expect(ws[1].sent.length).toBe(before + 1);
    expect(ws[1].sent.at(-1)!.t).toBe('state');
    expect(ws[0].sent.length).toBe(host0); // 방송 없음

    room.game = withDice(game(room), 2, 3); // 더블 아님 → 굴린 뒤 roll 단계가 아니다
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    expect(count(room, 'dice')).toBe(1);
    expect(game(room).turn.step).not.toBe('roll');
    const n0 = ws[0].sent.length;
    const n2 = ws[2].sent.length;
    say(room, ws[0], { t: 'act', a: { type: 'roll' } }); // 늦게 온 두 번째 굴림
    expect(count(room, 'dice')).toBe(1);
    expect(ws[0].sent.length).toBe(n0 + 1);
    expect(ws[0].sent.at(-1)!.t).toBe('state'); // 재전송
    expect(ws[2].sent.length).toBe(n2); // 남에겐 방송 없음
  });

  it('자리 없는 소켓의 행동은 notSeated', () => {
    const { ctx, room } = setup();
    const [host] = join(room, ctx, 1);
    say(room, host, { t: 'start' });
    const w = connect(room, ctx);
    say(room, w, { t: 'act', a: { type: 'roll' } });
    expect(w.last('error')?.code).toBe('notSeated');
  });
});

describe('빈자리 봇 (PRD §4.5 2026-10-28 U2)', () => {
  it.each([1, 2, 3])('사람 %i명이 출발하면 남은 자리는 봇, 사람 자리는 사람', (n) => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, n);
    say(room, ws[0], { t: 'start' });
    expect(game(room).phase).toBe('playing');
    expect(game(room).seats.map((s) => s.isBot)).toEqual([0, 1, 2, 3].map((i) => i >= n));
  });

  it.each(TOTAL_MINUTES)('%i분 판: 자리마다 정답률을 그 길이 범위에서 뽑아 저장(사람 자리도 값이 있다)', (m) => {
    const [lo, hi] = BOT_ACCURACY[m];
    const { ctx, room } = setup({ totalMinutes: m, touristQuiz: false });
    const ws = join(room, ctx, 1);
    say(room, ws[0], { t: 'start' });
    expect(room.rec!.botAccuracy).toHaveLength(4);
    for (const a of room.rec!.botAccuracy) expect(a).toBeGreaterThanOrEqual(lo), expect(a).toBeLessThan(hi);
    expect(new Set(room.rec!.botAccuracy).size).toBe(4); // 자리마다 따로 뽑힌다
  });

  it('끊김 대체 봇은 그 판 길이 범위에서 새로 뽑는다(80분)', async () => {
    const { ctx, room } = setup({ totalMinutes: 80, touristQuiz: false });
    const ws = join(room, ctx, 2);
    say(room, ws[0], { t: 'start' });
    room.rec!.botAccuracy[1] = 0.999; // 뽑힌 값을 표시해 두고
    room.webSocketClose(asWS(ws[1])); ws[1].close();
    await advance(room, ctx, OFFLINE_BOT_MS);
    expect(game(room).seats[1].isBot).toBe(true);
    const a = room.rec!.botAccuracy[1];
    expect(a).not.toBe(0.999);
    expect(a).toBeGreaterThanOrEqual(BOT_ACCURACY[80][0]);
    expect(a).toBeLessThan(BOT_ACCURACY[80][1]);
  });
});

describe('봇', () => {
  it('봇 4명 방이 사람 입력 없이 놀이 시간을 끝까지 돈다(방장 기기는 켜 둔 채 — 전원 끊기면 60초 뒤 멈추므로)', async () => {
    const { ctx, room } = setup({ totalMinutes: 40, touristQuiz: false });
    const [host] = join(room, ctx, 1);
    say(room, host, { t: 'start' });
    room.game!.seats[0].isBot = true; // 방장 자리도 봇이 둔다(연결은 살아 있음)
    await advance(room, ctx, 1_000);
    expect(game(room).seats.every((s) => s.isBot)).toBe(true);
    await runUntil(room, ctx, () => game(room).phase !== 'playing');
    const g = game(room);
    expect(g.phase).toBe('finished');
    expect(g.log.some((e) => e.ev === 'clock' && e.kind === 'pause')).toBe(false);
    expect(count(room, 'dice')).toBeGreaterThan(20);
    expect(count(room, 'answer')).toBeGreaterThan(0);
    expect(g.log.filter((e) => e.ev === 'answer').every((e) => e.ev === 'answer' && e.isBot)).toBe(true);
    // 정답률은 자리마다 40분 범위(0.60~0.70, PRD §4.5 U2)에서 한 번 뽑혀 저장돼 있다
    expect(room.rec!.botAccuracy).toHaveLength(4);
    for (const a of room.rec!.botAccuracy) expect(a).toBeGreaterThanOrEqual(BOT_ACCURACY[40][0]), expect(a).toBeLessThan(BOT_ACCURACY[40][1]);
    if (g.winner?.kind === 'assets') expect(Date.now() - room.rec!.createdAt).toBeGreaterThanOrEqual(40 * 60_000);
  }, 60_000);
});
