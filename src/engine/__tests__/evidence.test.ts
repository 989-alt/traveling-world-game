// 로그 이벤트 필드가 PRD §9.2 표와 1:1 인지 검사한다.
import { describe, expect, it } from 'vitest';
import { apply } from '../engine';
import type { GameState, LogEvent } from '../../shared/types';
import { answerAndSkip, arrive, edit, full, landAndAnswer, newGame, run } from './helpers';

const T = { type: 'timeout' } as const;
const num = 'number', bool = 'boolean', str = 'string', arr = 'array', obj = 'object';

// PRD §9.2 그대로. 값은 typeof (배열은 'array')
const SCHEMA: Record<string, Record<string, string | string[]>> = {
  dice: { seat: num, d1: num, d2: num },
  move: { seat: num, from: num, to: num, via: ['dice', 'travel', 'mission'] },
  culture_card: { seat: num, country: str, firstVisit: bool, badgeShown: bool },
  question: { seat: num, qid: str, country: str, level: num, kind: ['initial', 'review'], topics: arr, mTags: arr, review: bool },
  answer: { seat: num, qid: str, choice: 'any', correct: bool, ms: num, isBot: bool, chosenMTags: 'any' },
  explanation: { qid: str, cardId: str, variant: ['full', 'short'], shownTo: arr, shownMs: num },
  tf: { cardId: str, stmtId: str, mTag: 'any', topics: arr, review: bool }, // §9.2 확장: 다시 낸 관전 문장
  tf_answer: { seat: num, stmtId: str, value: 'any', correct: bool, isBot: bool },
  buy: { seat: num, tile: num, price: num, discounted: bool },
  build: { seat: num, tile: num, level: num, cost: num },
  sold: { seat: num, tile: num, levelBefore: num }, // §9.2 확장: 매각으로 잃은 칸
  toll: { payer: num, owner: num, tile: num, base: num, multiplier: num, discounted: bool, paid: num },
  takeover: { seat: num, tile: num, correct: bool, shielded: bool, cost: num },
  mission: { seat: num, missionId: str, type: str, topics: arr, mTags: arr, analytic: bool, success: bool, ms: num },
  stamp: { seat: num, country: str, level: num },
  event: { seat: num, kind: ['island', 'travel', 'festival', 'fund', 'climate', 'antarctic', 'korea', 'tourist', 'monopoly'], payload: obj },
  clock: { kind: ['start', 'pause', 'resume', 'end'], remainingMs: num, by: ['host', 'auto', 'timeout'] },
  result: { finalRanks: arr, assets: arr },
};

function check(e: LogEvent) {
  const spec = SCHEMA[e.ev];
  expect(spec, e.ev).toBeDefined();
  const rec = e as unknown as Record<string, unknown>;
  expect(Object.keys(rec).sort(), e.ev).toEqual(['ev', ...Object.keys(spec)].sort());
  for (const [k, t] of Object.entries(spec)) {
    const v = rec[k];
    if (Array.isArray(t)) expect(t, `${e.ev}.${k}`).toContain(v);
    else if (t === arr) expect(Array.isArray(v), `${e.ev}.${k}`).toBe(true);
    else if (t !== 'any') expect(typeof v, `${e.ev}.${k}`).toBe(t);
  }
}

/** 한 판에서 18가지 이벤트가 모두 나오게 짠 시퀀스 */
function script(): GameState {
  let s = newGame(7, [false, false, false, true]);
  s = landAndAnswer(s, 0, 2, true); // 타이: culture_card question answer stamp explanation tf tf_answer
  s = apply(s, { type: 'buy', seat: 0 }, full); // buy
  s = landAndAnswer(s, 1, 2, true); // 남의 땅: toll(discounted) → takeover
  s = apply(s, { type: 'takeover', seat: 1 }, full); // takeover
  s = landAndAnswer(s, 1, 2, true); // 내 땅 → build
  s = apply(s, { type: 'build', seat: 1 }, full);
  s = edit(s, (d) => { d.tiles[1] = { owner: 0, level: 1, festivalTarget: false }; d.tiles[5] = { owner: 1, level: 2, festivalTarget: false }; d.players[0].coin = 0; });
  s = landAndAnswer(s, 0, 5, false); // 1번 땅에 통행료(출발 칸 안 지남) → 집을 팔아 냄: sold
  if (s.turn.step === 'toll') s = apply(s, T, full);
  s = arrive(s, 2, 6); // mission
  s = run(s, [{ type: 'missionAnswer', seat: 2, answer: {}, ms: 3000 }, T]);
  s = arrive(s, 3, 10); // event island
  s = edit(s, (d) => { d.clock.remainingMs = 1; });
  return apply(s, { type: 'tick', ms: 1 }, full); // clock end + result
}

describe('evidence: 로그 스키마 = PRD §9.2', () => {
  const s = script();

  it('모든 이벤트가 스키마와 1:1', () => {
    s.log.forEach(check);
  });

  it('18가지 이벤트가 모두 나온다', () => {
    expect(new Set(s.log.map((e) => e.ev))).toEqual(new Set(Object.keys(SCHEMA)));
  });

  it('question.topics[]·mTags[] — 오답 선지 M 태그 모음', () => {
    const q = s.log.find((e) => e.ev === 'question')!;
    expect(q).toMatchObject({ qid: 'th-1-q1', topics: ['1.0'], mTags: ['M2', 'M3', 'M4'] });
  });

  it('explanation.shownTo 길이 4, toll.discounted, takeover.correct/shielded, buy.discounted, answer.isBot', () => {
    const ex = s.log.find((e) => e.ev === 'explanation') as { shownTo: boolean[] };
    expect(ex.shownTo).toEqual([false, false, false, true]); // shown 을 보낸 기기 없음 → 봇 자리만
    expect(s.log.find((e) => e.ev === 'toll')).toMatchObject({ discounted: true });
    expect(s.log.find((e) => e.ev === 'takeover')).toMatchObject({ correct: true, shielded: false });
    expect(s.log.find((e) => e.ev === 'buy')).toMatchObject({ discounted: true });
    const tfa = s.log.filter((e) => e.ev === 'tf_answer') as { seat: number; isBot: boolean }[];
    expect(tfa.find((e) => e.seat === 3)!.isBot).toBe(true);
    expect(s.log.find((e) => e.ev === 'answer')).toMatchObject({ isBot: false });
  });

  it('answer.chosenMTags: 정답 [], 오답이면 고른 선지 태그만, 무응답 null, 참/거짓 형식 오답은 문장 태그', () => {
    expect(s.log.find((e) => e.ev === 'answer')).toMatchObject({ correct: true, chosenMTags: [] });
    // 합성 콘텐츠: q1 정답 0, 오답 선지 j 의 태그는 M(j+1)
    let g = apply(arrive(newGame(), 0, 2), T, full);
    g = apply(g, { type: 'answer', seat: 0, choice: 2, ms: 1 }, full);
    expect(g.log.find((e) => e.ev === 'answer')).toMatchObject({ correct: false, choice: 2, chosenMTags: ['M3'] });
    g = apply(apply(arrive(newGame(), 0, 2), T, full), T, full); // 무응답
    expect(g.log.find((e) => e.ev === 'answer')).toMatchObject({ choice: null, chosenMTags: null });
    // 참/거짓 형식(복습 소진): 거짓 문장에 true 로 답함 → 그 문장 태그
    g = edit(arrive(newGame(), 0, 2), (d) => { d.turn.step = 'question'; d.turn.question = { qid: 'th-1-t2', cardId: 'th-1', country: 'th', level: 1, format: 'tf', answer: false, variant: 'short', hintRemoved: [], review: false }; });
    g = apply(g, { type: 'answer', seat: 0, choice: true, ms: 1 }, full);
    expect(g.log.find((e) => e.ev === 'answer')).toMatchObject({ correct: false, chosenMTags: ['M9'] });
  });

  it('tf.mTag 는 거짓 문장이면 M 번호, 참 문장이면 null', () => {
    const tfs = s.log.filter((e) => e.ev === 'tf') as { stmtId: string; mTag: string | null }[];
    for (const t of tfs) {
      const st = full.tf.find((x) => x.id === t.stmtId);
      if (st) expect(t.mTag).toBe(st.mTags[0] ?? null);
    }
  });

  it('shownTo = 해설을 닫을 때 받은 shown 자리 + 봇. 연결 상태로 채우지 않는다. explanation 은 해설이 끝날 때 남는다', () => {
    let g = apply(newGame(1, [false, false, false, true]), { type: 'setConnected', seat: 2, connected: false }, full);
    g = apply(apply(arrive(g, 0, 2), T, full), { type: 'answer', seat: 0, choice: 0, ms: 1 }, full);
    expect(g.turn.step).toBe('explanation');
    expect(g.log.some((e) => e.ev === 'explanation')).toBe(false); // 답한 순간엔 아직 없다
    g = apply(g, { type: 'timeout', shown: [0, 2] }, full);
    const ex = g.log.filter((e) => e.ev === 'explanation').at(-1) as { shownTo: boolean[] };
    expect(ex.shownTo).toEqual([true, false, true, true]); // 1 = 사람인데 shown 없음, 2 = 끊겼다고 표시됐어도 shown 이 왔으면 true, 3 = 봇
    expect(g.log.at(-1)).toBe(ex); // tf 단계는 이벤트 없이 열리고 explanation 이 마지막
  });
});
