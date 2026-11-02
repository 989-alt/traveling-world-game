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

// ── U14 멈춤 · 끝내기 · 나가기 (PRD §3.7 §9.4, 계약 U14-pause edge_cases) ──────────────
describe('U14 즉시 멈춤 · Δ 보정', () => {
  /** 사람 n 명(0 = 방장), 0번 자리가 타이(2) 첫 방문 → 문화 카드 마감까지 → 문항 단계 */
  async function atQuestion(n = 2) {
    const { ctx, room } = setup();
    const ws = join(room, ctx, n);
    say(room, ws[0], { t: 'start' });
    room.game = withDice(game(room), 1, 1);
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    await advance(room, ctx, room.rec!.deadlineAt! - Date.now());
    expect(game(room).turn).toMatchObject({ seat: 0, step: 'question' });
    return { ctx, room, ws };
  }

  it('문항 남은 12초에 멈춤 → 8초 뒤 계속하기: deadlineAt +8초, 남은 마감 12초, 놀이 시계 변화 ≤ 1초, 그 사이 입력 거부', async () => {
    const { ctx, room, ws } = await atQuestion();
    await advance(room, ctx, 8_000);
    expect(room.rec!.deadlineAt! - Date.now()).toBe(12_000);
    const dl = room.rec!.deadlineAt!;
    const stepAt = room.rec!.stepAt;
    say(room, ws[0], { t: 'pause' });
    const clock = game(room).clock.remainingMs;
    expect(game(room).phase).toBe('paused');
    expect(game(room).turn.step).toBe('question');
    // 모든 기기가 멈춘 상태를 받는다(멈춘 순간의 마감 그대로) + 자리마다 PIN
    for (const w of ws) expect(w.last('state')).toMatchObject({ phase: 'paused', deadlineAt: dl });
    for (const w of ws) expect(w.last('pins')).toBeTruthy();
    await advance(room, ctx, 8_000);
    say(room, ws[0], { t: 'act', a: { type: 'answer', choice: 0, ms: 100 } }); // 멈춘 동안 답은 거부
    expect(game(room).log.some((e) => e.ev === 'answer')).toBe(false);
    expect(game(room).phase).toBe('paused');
    say(room, ws[0], { t: 'resume' });
    expect(game(room).phase).toBe('playing');
    expect(room.rec!.deadlineAt).toBe(dl + 8_000);
    expect(room.rec!.stepAt).toBe(stepAt + 8_000);
    expect(room.rec!.deadlineAt! - Date.now()).toBe(12_000);
    expect(Math.abs(game(room).clock.remainingMs - clock)).toBeLessThanOrEqual(1_000);
    for (const w of ws) expect(w.last('state')).toMatchObject({ phase: 'playing', deadlineAt: dl + 8_000 });
    // 재개 뒤 답 ms 는 멈춘 시간을 빼고 잰다(단계 시작 stepAt 도 밀렸다)
    await advance(room, ctx, 1_000);
    say(room, ws[0], { t: 'act', a: { type: 'answer', choice: 0, ms: 600_000 } });
    const ans = game(room).log.find((e) => e.ev === 'answer');
    expect(ans).toMatchObject({ ev: 'answer', seat: 0, ms: 9_000 });
  });

  it('봇 차례(botAt 예정) 중 멈춤: 멈춘 동안 봇이 안 움직이고, 재개 뒤 botAt 도 Δ 만큼 밀려 남은 지연 그대로', async () => {
    const { ctx, room } = setup();
    const [host] = join(room, ctx, 1); // 1~3 봇
    say(room, host, { t: 'start' });
    say(room, host, { t: 'act', a: { type: 'roll' } });
    await runUntil(room, ctx, () => game(room).turn.seat !== 0 && room.rec!.botAt !== null && room.rec!.botAt > Date.now());
    const left = room.rec!.botAt! - Date.now();
    const botAt = room.rec!.botAt!;
    const len = game(room).log.length;
    say(room, host, { t: 'pause' });
    await advance(room, ctx, 120_000);
    expect(game(room).log.length).toBe(len + 1); // clock pause 하나뿐
    expect(room.rec!.botAt).toBe(botAt); // 멈춘 동안 그대로
    say(room, host, { t: 'resume' });
    expect(room.rec!.botAt).toBe(botAt + 120_000);
    expect(room.rec!.botAt! - Date.now()).toBe(left);
    await advance(room, ctx, left - 1);
    expect(game(room).log.length).toBe(len + 2); // 아직(clock resume 만)
    await advance(room, ctx, 1);
    expect(game(room).log.length).toBeGreaterThan(len + 2); // 예정대로 봇이 움직임
  });

  it('컷씬(lastCut 4초 안) 중 멈춤 → 재개: lastCut.at·컷씬 유예가 Δ 밀려 재개 상태에 남은 컷씬(t0 밀림)이 실린다', async () => {
    const { ctx, room, ws } = await atQuestion();
    // 랜드마크 세움 로그를 넣고 서버가 알아보게(컷씬 시작 = 지금)
    room.game = { ...game(room), log: [...game(room).log, { ev: 'build', seat: 0, tile: 2, level: 4, cost: 0 }] };
    say(room, ws[0], { t: 'sync' });
    const t0 = Date.now();
    expect(room.rec!.lastCut).toEqual({ tile: 2, seat: 0, at: t0 });
    await advance(room, ctx, 1_500);
    say(room, ws[0], { t: 'pause' });
    expect(ws[1].last('state')!.cutscene).toBeNull(); // 멈춘 동안은 싣지 않는다(판은 멈춘 프레임)
    await advance(room, ctx, 20_000);
    say(room, ws[0], { t: 'resume' });
    expect(room.rec!.lastCut!.at).toBe(t0 + 20_000);
    const st = ws[1].last('state')!;
    expect(st.cutscene).toEqual({ tile: 2, builder: 0, t0: t0 + 20_000 }); // 기기: 남은 부분(1.5초 뒤)부터
    expect(st.now - st.cutscene!.t0).toBe(1_500);
  });

  it('멈춤 중 사람 자리가 끊김: 30초 봇 대체는 재개 순간부터 다시 센다(멈춘 시간을 먹지 않음)', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 2);
    say(room, ws[0], { t: 'start' });
    say(room, ws[0], { t: 'pause' });
    room.webSocketClose(asWS(ws[1])); ws[1].close();
    await advance(room, ctx, 120_000);
    expect(game(room).seats[1].isBot).toBe(false);
    say(room, ws[0], { t: 'resume' });
    expect(room.rec!.seats[1].offSince).toBe(Date.now());
    await advance(room, ctx, OFFLINE_BOT_MS - 1);
    expect(game(room).seats[1].isBot).toBe(false);
    await advance(room, ctx, 1);
    expect(game(room).seats[1].isBot).toBe(true);
  });

  it('옛 저장본(clock.pauseBy, pausedAt 없음): pausedAt=null 로 보정, 멈춰 있던 판은 재개 때 Δ=0(그 단계 마감을 새로)', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 2);
    say(room, ws[0], { t: 'start' });
    say(room, ws[0], { t: 'pause' });
    // 옛 꼴로 되돌린 저장본: v7, clock.pauseBy, stepKey 'paused'(옛 서버는 멈춘 단계 키를 'paused' 로 두었다)
    const raw = JSON.parse(ctx.data.get('room') as string);
    raw.v = 7;
    raw.stepKey = 'paused';
    raw.game.clock = { remainingMs: raw.game.clock.remainingMs, pauseBy: null };
    // 진행 중이던 판의 '턴 끝 멈춤 대기'도 버린다
    ctx.data.set('room', JSON.stringify(raw));
    const c2 = ctx.copy();
    const r2 = newRoom(c2);
    expect(r2.rec!.v).toBe(8);
    expect(r2.game!.clock).toEqual({ remainingMs: raw.game.clock.remainingMs, pausedAt: null });
    expect('pauseBy' in r2.game!.clock).toBe(false);
    await advance(r2, c2, 3_600_000);
    const h = connect(r2, c2);
    say(r2, h, { t: 'rejoin', seat: 0, pin: r2.rec!.seats[0].pin });
    say(r2, h, { t: 'resume' });
    expect(r2.game!.phase).toBe('playing');
    expect(r2.rec!.deadlineAt! - Date.now()).toBe(15_000); // 주사위 단계 마감 새로(Δ 보정 없음)
    // 진행 중 판 + pauseBy:'host' 옛 저장본: 그냥 진행(멈춤 대기 없음)
    raw.game.phase = 'playing';
    raw.game.clock = { remainingMs: 1_000_000, pauseBy: 'host' };
    const c3 = new FakeCtx();
    c3.data = new Map(ctx.data);
    c3.data.set('room', JSON.stringify(raw));
    const r3 = newRoom(c3);
    expect(r3.game!.clock).toEqual({ remainingMs: 1_000_000, pausedAt: null });
    expect(r3.game!.phase).toBe('playing');
  });
});

describe('U14 끝내기(end)', () => {
  it('방장 끝내기: 전원 ended → 4001 → 저장본·알람 삭제. 두 번째 end 는 상태 없음(gone 1008)', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 3);
    const watcher = connect(room, ctx); // 자리 없는 구경 소켓(PIN 입력 화면 등)도 함께
    say(room, ws[0], { t: 'start' });
    await advance(room, ctx, 5_000);
    say(room, ws[0], { t: 'end' });
    for (const w of [...ws, watcher]) {
      expect(w.last('ended')).toEqual({ t: 'ended', by: 'host' });
      expect(w.closed).toBe(true);
      expect(w.closeCode).toBe(4001);
    }
    expect(room.rec).toBeNull();
    expect(room.game).toBeNull();
    await Promise.resolve();
    expect(ctx.data.size).toBe(0); // 로그 조각까지 전부
    expect(ctx.alarmAt).toBeNull();
    // 같은 소켓으로 두 번째 end(빠른 두 번 누름) → 방이 없다
    const late = connect(room, ctx); // 끝난 뒤 같은 코드로 들어온 연결
    say(room, late, { t: 'end' });
    expect(late.closeCode).toBe(1008);
    expect(late.closeReason).toBe('gone');
    // DO 가 다시 떠도 방이 없다(같은 코드 → 없는 방)
    const again = newRoom(ctx.copy());
    expect(again.rec).toBeNull();
    const res = await again.fetch(new Request('https://room/ws', { headers: { Upgrade: 'websocket' } }));
    expect(res.status).toBe(404);
  });

  it('방장 아닌 자리의 end 는 notHost, 상태 변화 0', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 2);
    say(room, ws[0], { t: 'start' });
    const before = JSON.stringify(room.rec);
    say(room, ws[1], { t: 'end' });
    expect(ws[1].last('error')?.code).toBe('notHost');
    expect(JSON.stringify(room.rec)).toBe(before);
    expect(ws[0].of('ended')).toHaveLength(0);
    void ctx;
  });

  it('멈춘 판에서도 끝낼 수 있다(P-H → C-E → 네)', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 2);
    say(room, ws[0], { t: 'start' });
    say(room, ws[0], { t: 'pause' });
    say(room, ws[0], { t: 'end' });
    expect(room.rec).toBeNull();
    expect(ws[1].last('ended')).toBeTruthy();
    void ctx;
  });
});

describe('U14 나가기(leave)', () => {
  it('학생이 자기 차례 문항 중 나가기: 즉시 봇, 남은 마감 안에 봇이 답함(answer.isBot), 소켓 4002, 방장 화면엔 봇 표시', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 2);
    say(room, ws[0], { t: 'start' });
    say(room, ws[0], { t: 'act', a: { type: 'roll' } }); // 0번 차례를 넘긴다
    await runUntil(room, ctx, () => game(room).turn.seat === 1 && game(room).turn.step === 'roll');
    room.game = withDice(game(room), 1, 1);
    say(room, ws[1], { t: 'act', a: { type: 'roll' } });
    await runUntil(room, ctx, () => game(room).turn.step === 'question' || game(room).turn.seat !== 1);
    expect(game(room).turn).toMatchObject({ seat: 1, step: 'question' });
    const dl = room.rec!.deadlineAt!;
    const acc = room.rec!.botAccuracy[1];
    const len = game(room).log.length;
    say(room, ws[1], { t: 'leave' });
    expect(ws[1].closed).toBe(true);
    expect(ws[1].closeCode).toBe(4002);
    expect(game(room).seats[1].isBot).toBe(true);
    expect(room.rec!.seats[1]).toMatchObject({ claimed: true, connected: false, offSince: null, returning: false });
    expect(room.rec!.botAccuracy[1]).not.toBe(acc); // 새로 뽑음(§4.5)
    expect(ws[0].last('state')!.seats[1]).toMatchObject({ isBot: true, connected: false, taken: true });
    expect(room.rec!.botAt).not.toBeNull();
    expect(room.rec!.botAt!).toBeLessThan(dl);
    await runUntil(room, ctx, () => game(room).log.slice(len).some((e) => e.ev === 'answer'));
    expect(Date.now()).toBeLessThan(dl);
    expect(game(room).log.slice(len).find((e) => e.ev === 'answer')).toMatchObject({ seat: 1, isBot: true });
  });

  it('나간 학생이 같은 PIN 으로 돌아오면 복귀(returning) → 다음 차례부터 사람. 시작부터 봇 자리는 여전히 거부', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 2);
    say(room, ws[0], { t: 'start' });
    const pin1 = room.rec!.seats[1].pin;
    say(room, ws[1], { t: 'leave' });
    expect(game(room).seats[1].isBot).toBe(true);
    const back = connect(room, ctx);
    say(room, back, { t: 'rejoin', seat: 1, pin: pin1 });
    expect(back.last('welcome')).toEqual({ t: 'welcome', seat: 1, pin: pin1 });
    expect(game(room).seats[1].isBot).toBe(false); // 지금 그 자리 차례가 아니면 바로 사람
    const kid = connect(room, ctx);
    say(room, kid, { t: 'rejoin', seat: 3, pin: room.rec!.seats[3].pin });
    expect(kid.last('error')?.code).toBe('pin'); // QA8: claimed=false 자리는 거부
    // 자기 차례 중에 나갔다 돌아오면 그 차례는 봇, 다음 차례부터 사람
    await runUntil(room, ctx, () => game(room).turn.seat === 1 && game(room).turn.step === 'roll');
    say(room, back, { t: 'leave' });
    const back2 = connect(room, ctx);
    say(room, back2, { t: 'rejoin', seat: 1, pin: pin1 });
    expect(room.rec!.seats[1].returning).toBe(true);
    expect(game(room).seats[1].isBot).toBe(true);
    await runUntil(room, ctx, () => game(room).turn.seat !== 1);
    expect(game(room).seats[1].isBot).toBe(false);
  });

  it('멈춘 판에서 나가기: 자리는 봇, 판은 멈춘 채', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 3);
    say(room, ws[0], { t: 'start' });
    say(room, ws[0], { t: 'pause' });
    say(room, ws[2], { t: 'leave' });
    expect(game(room).phase).toBe('paused');
    expect(game(room).seats[2].isBot).toBe(true);
    expect(ws[2].closeCode).toBe(4002);
    expect(ws[0].last('state')!.seats[2].isBot).toBe(true);
    void ctx;
  });
});
