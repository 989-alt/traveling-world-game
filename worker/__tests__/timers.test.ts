// 턴 타이머 (PRD §4.3): 서버 가짜 시계로 단계마다 "마감 1ms 전엔 그대로, 마감에 자동 진행".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { edit, withDice } from '../../src/engine/__tests__/helpers';
import type { GameState, LogEvent } from '../../src/shared/types';
import type { Room } from '../room';
import type { FakeCtx } from './fakes';
import { untilDeadline } from './fakes';
import { FIXTURE, advance, advanceTo, asWS, connect, game, join, newRoom, runUntil, say, setup } from './fakes';
import { SHOWN_SLACK_MS, SHOWN_WAIT_MS } from '../room';
import { CUT_RESUME_MS, CUTSCENE_MS } from '../../src/shared/protocol';
import { STEP_MS } from '../../src/shared/economy';
import { moveShowMs } from '../../src/shared/timing';

afterEach(() => { vi.useRealTimers(); });

function started() {
  const { ctx, room } = setup();
  const ws = join(room, ctx, 4); // 전원 사람: 봇이 끼어들지 않는다
  say(room, ws[0], { t: 'start' });
  return { ctx, room, ws };
}

/** 지금 단계 마감이 ms 뒤이고, ms-1 까진 아무 일 없고, ms 에 넘어간다. 새로 생긴 로그를 돌려준다 */
async function expires(room: Room, ctx: FakeCtx, step: GameState['turn']['step'], ms: number): Promise<LogEvent[]> {
  expect(game(room).turn.step).toBe(step);
  expect(room.rec!.deadlineAt! - Date.now()).toBe(ms);
  const before = JSON.stringify(game(room));
  const len = game(room).log.length;
  await advance(room, ctx, ms - 1);
  expect(JSON.stringify({ ...game(room), clock: null })).toBe(JSON.stringify({ ...JSON.parse(before), clock: null }));
  await advance(room, ctx, 1);
  expect(game(room).log.length > len || game(room).turn.step !== step || game(room).turn.seat !== JSON.parse(before).turn.seat).toBe(true);
  return game(room).log.slice(len);
}

/** 기기들이 지금 해설 카드를 다 봤다고 알린다(shown) */
const ack = (room: Room, ws: { sent: unknown[] }[]) => { for (const w of ws) say(room, w as never, { t: 'shown', stepKey: room.rec!.stepKey }); };
const lastEx = (room: Room) => game(room).log.filter((e) => e.ev === 'explanation').at(-1) as Extract<LogEvent, { ev: 'explanation' }> | undefined;

/** 상태를 바꿔 끼우고 서버가 새 단계로 알아보게 한다 */
function inject(room: Room, ws: { sent: unknown[] }, f: (d: GameState) => void) {
  room.game = edit(game(room), f);
  say(room, ws as never, { t: 'sync' });
}

describe('턴 타이머 — 가짜 시계, 전 단계', () => {
  it('주사위 15초: 안 굴리면 서버가 굴린다', async () => {
    const { ctx, room } = started();
    const ev = await expires(room, ctx, 'roll', 15_000);
    expect(ev[0]).toMatchObject({ ev: 'dice', seat: 0 });
  });

  it('도착 흐름: 문화 3 → 문항 20(무응답=오답) → 해설 전체판 7 → 참/거짓 6(null) → 행동 10 → 더블이면 다시 주사위 15', async () => {
    const { ctx, room, ws } = started();
    room.game = withDice(game(room), 1, 1); // 0 → 2 타이(첫 방문), 더블
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    await expires(room, ctx, 'culture', 3_000 + moveShowMs(0, 2)); // 문화 카드 마감 = 3초 + 이동 연출(2홉)
    const q = await expires(room, ctx, 'question', 20_000);
    expect(q[0]).toMatchObject({ ev: 'answer', seat: 0, choice: null, correct: false, ms: 20_000 });
    expect(room.rec!.deadlineAt! - Date.now()).toBe(7_000);
    await advance(room, ctx, 7_000 - SHOWN_SLACK_MS);
    ack(room, ws); // 4기기 모두 shown(6초 이후라 받음) → 기다림 없이 7초에 닫힘
    await expires(room, ctx, 'explanation', SHOWN_SLACK_MS);
    const tf = await expires(room, ctx, 'tf', 6_000);
    expect(tf.filter((e) => e.ev === 'tf_answer').map((e) => e.ev === 'tf_answer' && e.value)).toEqual([null, null, null]);
    const act = await expires(room, ctx, 'action', 10_000);
    expect(act.some((e) => e.ev === 'buy')).toBe(false); // 시간 넘기면 pass
    expect(game(room).turn.seat).toBe(0); // 더블 → 같은 자리
    await expires(room, ctx, 'roll', 15_000);
  });

  it('해설 짧은판 4초', async () => {
    const { ctx, room, ws } = started();
    inject(room, ws[0], (d) => {
      d.players[0].pos = 2;
      d.turn = { ...d.turn, step: 'explanation', tile: 2, correct: false,
        question: { qid: 'th-1-q2', cardId: 'th-1', country: 'th', level: 1, format: 'choice', answer: 1, variant: 'short', hintRemoved: [], review: false } };
    });
    expect(room.rec!.deadlineAt! - Date.now()).toBe(4_000);
    await advance(room, ctx, 4_000 - SHOWN_SLACK_MS);
    ack(room, ws);
    await expires(room, ctx, 'explanation', SHOWN_SLACK_MS);
  });

  it('통행료 10초 → 자동 지불', async () => {
    const { ctx, room, ws } = started();
    inject(room, ws[0], (d) => {
      d.tiles[2].owner = 1;
      d.players[0].pos = 2;
      d.players[0].items = ['tollHalf'];
      d.turn = { ...d.turn, step: 'toll', tile: 2, correct: false };
    });
    const ev = await expires(room, ctx, 'toll', 10_000);
    expect(ev[0]).toMatchObject({ ev: 'toll', payer: 0, owner: 1, tile: 2 });
  });

  it('인수 10초 → 인수 안 함(턴 넘김)', async () => {
    const { ctx, room, ws } = started();
    inject(room, ws[0], (d) => {
      d.tiles[2].owner = 1;
      d.players[0].pos = 2;
      d.turn = { ...d.turn, step: 'takeover', tile: 2, correct: true, takeoverCost: 100 };
    });
    const ev = await expires(room, ctx, 'takeover', 10_000);
    expect(ev.some((e) => e.ev === 'takeover')).toBe(false);
    expect(game(room).tiles[2].owner).toBe(1);
    expect(game(room).turn.seat).toBe(1);
  });

  it('방패 5초 → 자동 방어', async () => {
    const { ctx, room, ws } = started();
    inject(room, ws[0], (d) => {
      d.tiles[2].owner = 1;
      d.players[0].pos = 2;
      d.players[1].items = ['shield'];
      d.turn = { ...d.turn, step: 'shield', tile: 2, correct: true, takeoverCost: 100 };
    });
    const ev = await expires(room, ctx, 'shield', 5_000);
    expect(ev[0]).toMatchObject({ ev: 'takeover', shielded: true, cost: 0 });
    expect(game(room).players[1].items).toEqual([]);
    expect(game(room).tiles[2].owner).toBe(1);
  });

  it('미션 45초 → 실패, 이어서 관전 참/거짓 6초', async () => {
    const { ctx, room, ws } = started();
    inject(room, ws[0], (d) => {
      d.players[0].pos = 3;
      d.turn = { ...d.turn, step: 'mission', tile: 6, missionId: FIXTURE.missions[0].id };
    });
    const ev = await expires(room, ctx, 'mission', 45_000);
    expect(ev[0]).toMatchObject({ ev: 'mission', success: false, ms: 45_000 });
    await expires(room, ctx, 'tf', 6_000);
  });

  it('답 ms 는 서버가 단계 시작부터 잰 값이 상한: 부풀린 값은 잘린다', async () => {
    const { ctx, room, ws } = started();
    room.game = withDice(game(room), 1, 1);
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    await advance(room, ctx, untilDeadline(room)); // 문화 카드 3초 + 이동 연출(shared/timing) // 문항 단계 시작
    await advance(room, ctx, 2_500);
    say(room, ws[0], { t: 'act', a: { type: 'answer', choice: 0, ms: 19_000 } });
    expect(game(room).log.find((e) => e.ev === 'answer')).toMatchObject({ ms: 2_500 });
  });

  it('답 ms: 서버 값보다 짧게 보낸 값은 그대로', async () => {
    const { ctx, room, ws } = started();
    room.game = withDice(game(room), 1, 1);
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    await advance(room, ctx, untilDeadline(room)); // 문화 카드 3초 + 이동 연출(shared/timing)
    await advance(room, ctx, 5_000);
    say(room, ws[0], { t: 'act', a: { type: 'answer', choice: 0, ms: 4_200 } });
    expect(game(room).log.find((e) => e.ev === 'answer')).toMatchObject({ ms: 4_200 });
  });

  it('클라이언트 시계는 표시용: 마감은 서버 값이고 늦게 온 답은 무시', async () => {
    const { ctx, room, ws } = started();
    room.game = withDice(game(room), 1, 1);
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    await advance(room, ctx, untilDeadline(room)); // 문화 카드 3초 + 이동 연출(shared/timing) // 문항 단계로
    expect(ws[0].last('state')!.deadlineAt).toBe(room.rec!.deadlineAt);
    await advance(room, ctx, 20_000); // 마감 → 서버가 오답 처리
    const len = game(room).log.length;
    say(room, ws[0], { t: 'act', a: { type: 'answer', choice: 0, ms: 100 } }); // 늦게 온 답
    expect(game(room).log.length).toBe(len);
  });
});

describe('컷씬 뒤 문항 마감', () => {
  it('다음 도착자 문항 하나에만 남은 컷씬 시간(max(0, 세운 시각 + 4.8초 − 지금))을 더한다, 그다음 문항은 기본', async () => {
    const { ctx, room, ws } = started();
    // 자리 0 이 랜드마크를 세움(로그에 build 4) → 자리 1 차례
    inject(room, ws[0], (d) => {
      d.log.push({ ev: 'build', seat: 0, tile: 22, level: 4, cost: 1 });
      d.turn = { ...d.turn, seat: 1, step: 'roll', tile: null, question: null, tf: null };
    });
    const builtAt = Date.now();
    expect(room.rec!.cutscene).toMatchObject({ at: builtAt, seat: 0, next: 1 });
    room.game = withDice(edit(game(room), (d) => { d.players[1].pos = 0; }), 1, 1); // 0 → 2 타이 (2홉: 연출이 짧아 컷씬이 남는다)
    say(room, ws[1], { t: 'act', a: { type: 'roll' } });
    expect(game(room).turn.step).toBe('culture');
    await advance(room, ctx, untilDeadline(room)); // 문화 카드 3초 + 이동 연출(shared/timing)
    expect(game(room).turn.step).toBe('question');
    const grace = builtAt + CUTSCENE_MS - Date.now(); // 문화 카드 3초 + 이동 연출 1.58초가 지났으니 0.22초
    expect(grace).toBe(CUTSCENE_MS - STEP_MS.culture - moveShowMs(0, 2));
    expect(room.rec!.deadlineAt! - Date.now()).toBe(STEP_MS.question + grace);
    expect(room.rec!.cutscene).toBeNull(); // 한 번 쓰면 끝
    const st = ws[2].last('state')!;
    expect(st.deadlineAt! - st.stepAt).toBe(STEP_MS.question + grace); // 기기 시계 차이는 stepAt 으로 잰다
    // 기본 20초엔 아직 안 넘어가고, 20초 + 남은 컷씬에 서버가 무응답 처리
    await advance(room, ctx, STEP_MS.question);
    expect(game(room).turn.step).toBe('question');
    await advance(room, ctx, grace);
    expect(game(room).turn.step).not.toBe('question');
    expect(game(room).log.filter((e) => e.ev === 'answer').at(-1)).toMatchObject({ choice: null, ms: STEP_MS.question });

    // 그다음 문항: 컷씬 없음 → 기본
    inject(room, ws[0], (d) => { d.turn = { ...d.turn, seat: 2, step: 'roll', tile: null, question: null, tf: null }; d.players[2].pos = 29; });
    room.game = withDice(game(room), 1, 2);
    say(room, ws[2], { t: 'act', a: { type: 'roll' } });
    await advance(room, ctx, untilDeadline(room)); // 문화 카드 3초 + 이동 연출(shared/timing)
    expect(game(room).turn.step).toBe('question');
    expect(room.rec!.deadlineAt! - Date.now()).toBe(STEP_MS.question);
  });

  it('재접속 복구(DESIGN §12.3): 상태에 cutscene{tile, builder, t0} 를 시작 뒤 6초 동안 싣는다. 문항이 열려도 남고, 6초가 지나면 null', async () => {
    const { ctx, room, ws } = started();
    inject(room, ws[0], (d) => {
      d.log.push({ ev: 'build', seat: 0, tile: 22, level: 4, cost: 1 });
      d.turn = { ...d.turn, seat: 1, step: 'question', tile: 2, question: { qid: 'th-1-q1', cardId: 'th-1', country: 'th', level: 1, format: 'choice', answer: 0, variant: 'full', hintRemoved: [], review: false } };
    });
    const t0 = Date.now();
    expect(ws[0].last('state')!.cutscene).toEqual({ tile: 22, builder: 0, t0 });
    expect(room.rec!.cutscene).toBeNull(); // 마감 유예용은 이미 썼다 — 복구용은 따로 남는다
    await advance(room, ctx, CUT_RESUME_MS - 1);
    say(room, ws[2], { t: 'sync' });
    expect(ws[2].last('state')!.cutscene).toEqual({ tile: 22, builder: 0, t0 });
    await advance(room, ctx, 1);
    say(room, ws[2], { t: 'sync' });
    expect(ws[2].last('state')!.cutscene).toBeNull();
  });

  it('세운 직후 같은 처리에서 문항이 열리면 4.8초 전부, 같은 처리의 다음 정리(settle)가 다시 켜지 않는다', () => {
    const { room, ws } = started();
    inject(room, ws[0], (d) => {
      d.log.push({ ev: 'build', seat: 0, tile: 22, level: 4, cost: 1 });
      d.turn = { ...d.turn, seat: 1, step: 'question', tile: 2, question: { qid: 'th-1-q1', cardId: 'th-1', country: 'th', level: 1, format: 'choice', answer: 0, variant: 'full', hintRemoved: [], review: false } };
    });
    expect(room.rec!.deadlineAt! - Date.now()).toBe(STEP_MS.question + CUTSCENE_MS);
    expect(room.rec!.cutscene).toBeNull();
    expect(room.rec!.cutsceneScan).toBe(game(room).log.length);
  });

  it('다음 차례가 문항 없이 끝나면(미션 칸 등) 지운다: 그 뒤 문항엔 안 붙는다', async () => {
    const { ctx, room, ws } = started();
    inject(room, ws[0], (d) => {
      d.log.push({ ev: 'build', seat: 0, tile: 22, level: 4, cost: 1 });
      d.turn = { ...d.turn, seat: 1, step: 'mission', tile: 6, missionId: FIXTURE.missions[0].id };
    });
    expect(room.rec!.cutscene).toMatchObject({ seat: 0, next: 1 });
    inject(room, ws[0], (d) => { d.turn = { ...d.turn, seat: 2, step: 'roll', tile: null, missionId: null, question: null, tf: null }; d.players[2].pos = 29; });
    expect(room.rec!.cutscene).toBeNull(); // 차례가 넘어감
    room.game = withDice(game(room), 1, 2);
    say(room, ws[2], { t: 'act', a: { type: 'roll' } });
    await advance(room, ctx, untilDeadline(room)); // 문화 카드 3초 + 이동 연출(shared/timing)
    expect(game(room).turn.step).toBe('question');
    expect(room.rec!.deadlineAt! - Date.now()).toBe(STEP_MS.question);
  });

  it('컷씬 없는 보통 문항은 기본 20초', async () => {
    const { ctx, room, ws } = started();
    room.game = withDice(game(room), 1, 1);
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    await advance(room, ctx, untilDeadline(room)); // 문화 카드 3초 + 이동 연출(shared/timing)
    expect(room.rec!.deadlineAt! - Date.now()).toBe(STEP_MS.question);
  });
});

describe('해설 shown (T05c): 기기가 카드를 다 그렸다는 신호', () => {
  /** 0 → 2 타이 첫 방문, 답까지 → 해설 단계 */
  async function atExplanation(nSeats = 4) {
    const { ctx, room } = setup();
    const ws = join(room, ctx, nSeats);
    const watcher = connect(room, ctx);
    say(room, ws[0], { t: 'start' });
    room.game = withDice(game(room), 1, 1);
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    await advance(room, ctx, untilDeadline(room)); // 문화 카드 3초 + 이동 연출(shared/timing)
    say(room, ws[0], { t: 'act', a: { type: 'answer', choice: 0, ms: 1000 } });
    expect(game(room).turn.step).toBe('explanation');
    return { ctx, room, ws, watcher };
  }

  it('아무도 안 보내면 마감에 한 번만 SHOWN_WAIT_MS 더 기다리고 닫는다. 사람 자리는 false', async () => {
    const { ctx, room } = await atExplanation();
    expect(lastEx(room)).toBeUndefined(); // explanation 이벤트는 단계가 끝날 때
    await advance(room, ctx, 7_000);
    expect(game(room).turn.step).toBe('explanation');
    expect(room.rec!.deadlineAt! - Date.now()).toBe(SHOWN_WAIT_MS);
    await advance(room, ctx, SHOWN_WAIT_MS - 1);
    expect(game(room).turn.step).toBe('explanation');
    await advance(room, ctx, 1);
    expect(game(room).turn.step).toBe('tf');
    expect(lastEx(room)!.shownTo).toEqual([false, false, false, false]);
  });

  it('기다리는 중 마지막 기기 shown 이 오면 바로 닫는다. 받은 자리만 true', async () => {
    const { ctx, room, ws } = await atExplanation();
    const key = room.rec!.stepKey;
    await advance(room, ctx, 6_500);
    ack(room, ws.slice(0, 3));
    await advance(room, ctx, 500);
    expect(game(room).turn.step).toBe('explanation'); // 3번 기기를 기다림
    await advance(room, ctx, 500);
    say(room, ws[3], { t: 'shown', stepKey: key });
    expect(game(room).turn.step).toBe('tf');
    expect(lastEx(room)!.shownTo).toEqual([true, true, true, true]);
  });

  it('늦은·지어낸·다른 단계 shown 과 구경 소켓은 무시', async () => {
    const { ctx, room, ws, watcher } = await atExplanation();
    const key = room.rec!.stepKey;
    say(room, ws[1], { t: 'shown', stepKey: key.replace(/\d+$/, (n) => String(Number(n) + 1)) }); // 다른 로그 길이
    say(room, ws[2], { t: 'shown', stepKey: '3|explanation|1' });
    say(room, watcher, { t: 'shown', stepKey: key });
    expect(watcher.last('error')?.code).toBe('notSeated');
    expect(room.rec!.shown).toEqual([]);
    await advance(room, ctx, 6_000);
    ack(room, [ws[0], ws[0]]); // 같은 기기 두 번 = 한 자리
    expect(room.rec!.shown).toEqual([0]);
    await advance(room, ctx, 1_000 + SHOWN_WAIT_MS);
    expect(game(room).turn.step).toBe('tf');
    expect(lastEx(room)!.shownTo).toEqual([true, false, false, false]);
    say(room, ws[1], { t: 'shown', stepKey: key }); // 끝난 뒤 온 것
    expect(lastEx(room)!.shownTo).toEqual([true, false, false, false]);
    expect(room.rec!.shown).toEqual([0]); // 지난 단계 것 그대로(늦은 것은 더하지 않음)
    expect(game(room).log.filter((e) => e.ev === 'explanation')).toHaveLength(1);
  });

  it('끊긴 자리는 기다리지 않고 false, 봇 자리는 true', async () => {
    const { ctx, room, ws } = await atExplanation(3); // 자리 3 = 봇
    room.webSocketClose(asWS(ws[2]));
    ws[2].close();
    await advance(room, ctx, 6_000);
    ack(room, ws.slice(0, 2));
    await advance(room, ctx, 1_000);
    expect(game(room).turn.step).toBe('tf'); // 기다릴 기기 없음
    expect(lastEx(room)!.shownTo).toEqual([true, true, false, true]);
  });

  it('서버가 최소 표시 시간을 지킨다: 단계 시작 직후 shown 은 버리고(그 자리 false), 표시 시간 − 1초 뒤 shown 은 받는다', async () => {
    const { ctx, room, ws } = await atExplanation();
    const key = room.rec!.stepKey;
    await advance(room, ctx, 100);
    say(room, ws[1], { t: 'shown', stepKey: key }); // 열리자마자 보낸 기기(가짜·고장)
    await advance(room, ctx, 7_000 - SHOWN_SLACK_MS - 100 - 1);
    say(room, ws[2], { t: 'shown', stepKey: key }); // 1ms 이르다
    expect(room.rec!.shown.filter(() => room.rec!.shownKey === key)).toEqual([]);
    await advance(room, ctx, 1);
    ack(room, [ws[0], ws[2], ws[3]]); // 딱 6초: 받음
    expect(room.rec!.shown).toEqual([0, 2, 3]);
    await advance(room, ctx, SHOWN_SLACK_MS + SHOWN_WAIT_MS); // 1번은 다시 안 보냄 → 기다림 끝에 닫힘
    expect(game(room).turn.step).toBe('tf');
    expect(lastEx(room)!.shownTo).toEqual([true, false, true, true]);
  });

  it('같은 해설 단계로 돌아오면(정지·재개처럼 stepKey 가 잠깐 바뀜) 받은 shown 이 남는다', async () => {
    const { ctx, room, ws } = await atExplanation();
    const key = room.rec!.stepKey;
    await advance(room, ctx, 6_000);
    ack(room, ws.slice(0, 2));
    inject(room, ws[0], (d) => { d.phase = 'paused'; });
    expect(room.rec!.stepKey).toBe('paused');
    inject(room, ws[0], (d) => { d.phase = 'playing'; });
    expect(room.rec!.stepKey).toBe(key);
    expect(room.rec!.deadlineAt! - Date.now()).toBe(7_000); // 단계는 새로 시작
    await advance(room, ctx, 6_000);
    ack(room, ws.slice(2));
    await advance(room, ctx, 1_000);
    expect(game(room).turn.step).toBe('tf');
    expect(lastEx(room)!.shownTo).toEqual([true, true, true, true]);
  });
});

describe('이동 연출 늦춤(R4 T-E 수정 1, shared/timing)', () => {
  it('도착 단계(미션 칸 등 문화 카드가 아닌 것도) 마감 = 기본 + 이동 연출, 다음 단계는 기본', async () => {
    const { ctx, room, ws } = started();
    room.game = withDice(game(room), 2, 4); // 0 → 6 미션 칸
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    expect(game(room).turn.step).toBe('mission');
    expect(untilDeadline(room)).toBe(STEP_MS.mission + moveShowMs(0, 6));
    await advance(room, ctx, untilDeadline(room));
    // 미션 시간 초과 → 참/거짓(고정 시드). 단계를 못 박아 기본 마감 검사가 늘 돈다(R4-TE 리뷰 Minor 2)
    expect(game(room).turn.step).toBe('tf');
    expect(untilDeadline(room)).toBe(STEP_MS.tf);
  });

  it('봇 차례: 봇은 이동 연출이 끝난 뒤에 다음 행동을 한다', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 1); // 나머지 3자리 = 봇
    say(room, ws[0], { t: 'start' });
    inject(room, ws[0], (d) => { d.turn = { ...d.turn, seat: 1, step: 'roll', tile: null, question: null, tf: null }; });
    room.game = withDice(game(room), 1, 1); // 봇 0 → 2 타이
    const len = game(room).log.length;
    for (let i = 0; i < 400 && !game(room).log.slice(len).some((e) => e.ev === 'move'); i++) await advance(room, ctx, 50);
    const mv = game(room).log.slice(len).find((e) => e.ev === 'move')!;
    expect(mv).toMatchObject({ seat: 1 });
    expect(room.rec!.showUntil! - Date.now()).toBeGreaterThan(moveShowMs(0, 2) - 60);
    expect(room.rec!.botAt).toBeGreaterThanOrEqual(room.rec!.showUntil!);
    const at = game(room).log.length;
    await advance(room, ctx, moveShowMs(0, 2) - 100);
    expect(game(room).log.length).toBe(at); // 연출 중엔 봇이 아무것도 안 함
  });
});

describe('미션 실패 해설 6초 창(QA4-reveal, PRD §3.5)', () => {
  const photoM = FIXTURE.missions.find((m) => m.type === 'photo')!;
  const wrongPick = photoM.options!.findIndex((o) => !o.correct);

  /** 혼자 + 봇 3명, 자리 0 이 사진 미션을 틀리게 낸 직후(tf 시작) */
  function failedSolo() {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 1); // 나머지 3자리 = 봇
    say(room, ws[0], { t: 'start' });
    inject(room, ws[0], (d) => { d.players[0].pos = 3; d.turn = { ...d.turn, seat: 0, step: 'mission', tile: 3, missionId: photoM.id }; });
    say(room, ws[0], { t: 'act', a: { type: 'missionAnswer', selected: [wrongPick], ms: 2000 } });
    expect(game(room).turn).toMatchObject({ step: 'tf', missionSuccess: false });
    expect(untilDeadline(room)).toBe(STEP_MS.tf);
    return { ctx, room, ws, end: room.rec!.deadlineAt! };
  }
  const reveal = (room: Room) => { const m = room.stateMsg(0, 0); return m.t === 'state' ? m.game?.turn.reveal ?? null : null; };

  it('봇 3명이 먼저 다 답해도 응답만 저장, reveal 은 마감 1ms 전까지 남고 마감에 닫힌다', async () => {
    const { ctx, room, end } = failedSolo();
    const key = room.rec!.stepKey;
    // 마감 1ms 전까지 알람을 하나씩: 늘 같은 tf 단계, reveal 있음
    while (ctx.alarmAt !== null && ctx.alarmAt < end) {
      await advanceTo(room, ctx, ctx.alarmAt);
      expect(room.rec!.stepKey).toBe(key);
      expect(reveal(room)).not.toBeNull();
    }
    await advanceTo(room, ctx, end - 1);
    expect(game(room).turn.tf!.answers.map((a) => a.seat).sort()).toEqual([1, 2, 3]); // 봇 응답은 저장됨
    expect(game(room).log.some((e) => e.ev === 'tf_answer')).toBe(false);
    expect(room.rec!.deadlineAt).toBe(end); // 봇 응답이 마감을 바꾸지 않는다
    expect(room.rec!.botAt).toBeNull(); // 더 할 봇 입력 없음 → 알람은 마감
    expect(ctx.alarmAt).toBe(end);
    expect(reveal(room)).not.toBeNull();
    await advanceTo(room, ctx, end);
    expect(game(room).log.filter((e) => e.ev === 'tf_answer').map((e) => e.ev === 'tf_answer' && e.value !== null)).toEqual([true, true, true]);
    expect(game(room).turn.step).not.toBe('tf');
    expect(reveal(room)).toBeNull();
  });

  it('창 중간에 DO 재시작(hibernation 복원): 같은 마감·저장된 응답, 마감에만 닫힌다', async () => {
    const { ctx, room, end } = failedSolo();
    while (ctx.alarmAt !== null && ctx.alarmAt < end) await advanceTo(room, ctx, ctx.alarmAt);
    await advanceTo(room, ctx, end - 2_000);
    const c2 = ctx.copy();
    const copy = newRoom(c2);
    expect(copy.rec!.deadlineAt).toBe(end);
    expect(c2.alarmAt).toBe(end);
    expect(copy.game!.turn.tf!.answers).toHaveLength(3);
    await advanceTo(copy, c2, end - 1);
    expect(copy.game!.turn.step).toBe('tf');
    expect(reveal(copy)).not.toBeNull();
    await advanceTo(copy, c2, end);
    expect(copy.game!.turn.step).not.toBe('tf');
    expect(copy.game!.log.filter((e) => e.ev === 'tf_answer')).toHaveLength(3);
  });

  it('미션 성공 tf 는 봇이 다 답하면 마감 전에 넘어간다(기존대로)', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 1);
    say(room, ws[0], { t: 'start' });
    inject(room, ws[0], (d) => { d.players[0].pos = 3; d.turn = { ...d.turn, seat: 0, step: 'mission', tile: 3, missionId: photoM.id }; });
    const right = photoM.options!.flatMap((o, i) => (o.correct ? [i] : []));
    say(room, ws[0], { t: 'act', a: { type: 'missionAnswer', selected: right, ms: 2000 } });
    expect(game(room).turn).toMatchObject({ step: 'tf', missionSuccess: true });
    const end = room.rec!.deadlineAt!;
    await runUntil(room, ctx, () => game(room).turn.step !== 'tf');
    expect(Date.now()).toBeLessThan(end);
  });
});
