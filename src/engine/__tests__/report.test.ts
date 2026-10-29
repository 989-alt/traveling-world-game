import { describe, expect, it } from 'vitest';
import type { LogEvent, Seat } from '../../shared/types';
import { buildReport, majorOf, type MetaMap } from '../report';

const meta: MetaMap = {
  th: { climate: '열대 기후', magnet: { terrain: '강', scenery: '수상 시장', life: '고상 가옥' } },
  ph: { climate: '열대 기후' },
  sa: { climate: '건조 기후' },
  eg: { climate: '건조 기후' },
  kr: { climate: '온대 기후' },
};
const Q = (seat: Seat, qid: string, level: 1 | 2 | 3 | 4, topics: string[], mTags: string[], review = false): LogEvent =>
  ({ ev: 'question', seat, qid, country: 'th', level, kind: review ? 'review' : 'initial', topics, mTags, review });
/** chosen: 고른 선지의 태그(정답이면 []) */
const A = (seat: Seat, qid: string, correct: boolean, isBot = false, chosen: string[] | null = []): LogEvent =>
  ({ ev: 'answer', seat, qid, choice: chosen === null ? null : correct ? 0 : 1, correct, ms: 1000, isBot, chosenMTags: chosen });
const X = (qid: string, cardId: string): LogEvent => ({ ev: 'explanation', qid, cardId, variant: 'full', shownTo: [true, true, true, true], shownMs: 1 });
const T = (cardId: string, stmtId: string, topics: string[], mTag: string | null): LogEvent => ({ ev: 'tf', cardId, stmtId, mTag, topics });
const TA = (seat: Seat, stmtId: string, value: boolean | null, correct: boolean, isBot = false): LogEvent => ({ ev: 'tf_answer', seat, stmtId, value, correct, isBot });
const dice: LogEvent = { ev: 'dice', seat: 0, d1: 1, d2: 2 };

// 좌석 0 = 사람, 좌석 3 = 봇
const log: LogEvent[] = [
  dice,
  Q(0, 'q1', 1, ['8.1', '3.3'], ['M7']), A(0, 'q1', true), X('q1', 'th-1'),
  T('th-1', 's1', ['8.1'], 'M9'), TA(0, 's1', true, true), TA(1, 's1', false, false), TA(2, 's1', null, false), TA(3, 's1', true, true, true),
  Q(0, 'q2', 2, ['8.1'], ['M7', 'M14']), A(0, 'q2', false, false, ['M14']), X('q2', 'th-2'),
  T('th-2', 's2', ['B2.1'], 'M3'), TA(0, 's2', false, false), TA(1, 's2', null, false),
  Q(0, 'q3', 4, ['9.1'], ['M4']), A(0, 'q3', false, false, ['M4']), X('q3', 'th-4'),
  T('th-4', 's3', ['9.1'], 'M2'), TA(0, 's3', true, true), TA(1, 's3', true, false), // 1번은 참이라 하고 틀림
  Q(0, 'q4', 1, ['8.1'], ['M20'], true), A(0, 'q4', false, false, ['M20']), // 복습: 첫 출제 정답률에서 제외
  Q(3, 'q5', 1, ['8.1'], ['M5']), A(3, 'q5', false, true, ['M5']),
  Q(2, 'q6', 1, ['8.1'], ['M6', 'M8']), A(2, 'q6', false, false, null), // 무응답: 분모엔 들어가고 태그는 없음
  { ev: 'buy', seat: 0, tile: 2, price: 100, discounted: true },
  { ev: 'buy', seat: 0, tile: 4, price: 100, discounted: false },
  { ev: 'takeover', seat: 0, tile: 5, correct: true, shielded: false, cost: 100 },
  { ev: 'takeover', seat: 0, tile: 6, correct: false, shielded: false, cost: 100 },
  { ev: 'toll', payer: 0, owner: 1, tile: 7, base: 100, multiplier: 2, discounted: true, paid: 150 },
  { ev: 'toll', payer: 0, owner: 1, tile: 7, base: 100, multiplier: 1, discounted: false, paid: 100 },
  { ev: 'stamp', seat: 0, country: 'th', level: 1 }, { ev: 'stamp', seat: 0, country: 'th', level: 3 },
  { ev: 'stamp', seat: 0, country: 'ph', level: 2 }, { ev: 'stamp', seat: 0, country: 'sa', level: 1 },
  { ev: 'build', seat: 0, tile: 2, level: 4, cost: 1 }, { ev: 'build', seat: 0, tile: 1, level: 3, cost: 1 },
  { ev: 'build', seat: 0, tile: 8, level: 4, cost: 1 }, { ev: 'sold', seat: 0, tile: 8, levelBefore: 4 }, // 판 랜드마크는 빠진다
  { ev: 'sold', seat: 0, tile: 1, levelBefore: 3 }, { ev: 'sold', seat: 1, tile: 2, levelBefore: 4 }, // 남의 매각·호텔은 상관없음
  { ev: 'result', finalRanks: [0, 1, 2, 3], assets: [9, 8, 7, 6] },
];

describe('buildReport', () => {
  const r = buildReport(log, meta);
  const me = r.seats[0];
  const row = (k: string) => me.rows.find((x) => x.key === k)!;

  it('대번호: 첫 출제만, 번호 순(B 마지막), 4단계는 따로', () => {
    expect(me.rows.map((x) => x.key)).toEqual(['3', '8', 'B']); // 9.1 은 4단계라 level4 로
  });
  it('도착자 문항과 참/거짓을 따로 센다', () => {
    expect(row('8').arrive).toEqual({ ok: 1, n: 2 });
    expect(row('8').tf).toEqual({ ok: 1, n: 1, none: 0 });
    expect(row('B').tf).toEqual({ ok: 0, n: 1, none: 0 });
  });
  it('4단계는 도착자·참/거짓 모두 따로, 복습은 합계만', () => {
    expect(me.level4.arrive).toEqual({ ok: 0, n: 1 });
    expect(me.level4.tf).toEqual({ ok: 1, n: 1, none: 0 });
    expect(me.review).toEqual({ ok: 0, n: 1 });
  });
  it('무응답은 분모에서 빼고 따로 센다', () => {
    expect(r.seats[2].rows[0].tf).toEqual({ ok: 0, n: 0, none: 1 });
    expect(r.seats[1].level4.tf).toEqual({ ok: 0, n: 1, none: 0 });
  });
  it('틀린 M번호: 오답 문항에서 고른 선지 태그(chosenMTags) + 참/거짓 오답 태그의 합집합, 번호 순', () => {
    expect(me.wrongM).toEqual(['M3', 'M4', 'M14', 'M20']); // q2 는 M14 를 골랐다: 안 고른 오답 선지 M7 은 없음
    expect(r.seats[2].wrongM).toEqual([]); // 무응답은 오답 태그를 얹지 않는다
  });
  it('봇: 학생 집계에서 빠지고 isBot 표시', () => {
    expect(r.seats[3].isBot).toBe(true);
    expect(r.seats[3].rows).toEqual([]);
    expect(r.seats[3].wrongM).toEqual([]);
    expect(r.seats.filter((s) => !s.isBot).length).toBe(3);
    expect(buildReport([dice], {}, [false, false, false, true]).seats[3].isBot).toBe(true);
  });
  it('도장: 여행지별 최고 단계, 같은 기후 2곳 이상만 묶음', () => {
    expect(me.stamps).toEqual([{ country: 'ph', level: 2 }, { country: 'th', level: 3 }, { country: 'sa', level: 1 }]);
    expect(me.climateGroups).toEqual([{ climate: '열대 기후', stamps: [{ country: 'ph', level: 2 }, { country: 'th', level: 3 }] }]);
  });
  it('정답으로 얻은 것', () => {
    expect(me.gains).toEqual({ discountedBuys: 1, takeovers: 1, tollSaved: 50 });
  });
  it('마그넷: 랜드마크 세운 여행지마다(매각으로 잃은 랜드마크는 빼고)', () => {
    expect(me.landmarks).toEqual([2]);
    // 잃은 뒤 다시 세우면 다시 들어간다
    const again = buildReport([...log, { ev: 'build', seat: 0, tile: 8, level: 4, cost: 1 }], meta).seats[0];
    expect(again.landmarks).toEqual([2, 8]);
    expect(me.magnets).toEqual([{ country: 'th', terrain: '강', scenery: '수상 시장', life: '고상 가옥' }]);
  });
  it('봇이 대신 답한 응답의 도장은 학생 도감·기후 묶음에서 뺀다(사람 자리라도, §9.3). 다음 사람 응답 도장은 다시 센다', () => {
    const l: LogEvent[] = [
      dice,
      Q(0, 'h', 1, ['4.1'], []), A(0, 'h', false),
      Q(0, 'b', 4, ['3.3'], []), A(0, 'b', true, true), { ev: 'stamp', seat: 0, country: 'ph', level: 4 },
      Q(0, 'c', 2, ['8.1'], []), A(0, 'c', true), { ev: 'stamp', seat: 0, country: 'th', level: 2 },
    ];
    const s = buildReport(l, meta).seats[0];
    expect(s.isBot).toBe(false);
    expect(s.stamps).toEqual([{ country: 'th', level: 2 }]);
    expect(s.climateGroups).toEqual([]);
  });
  it('봇이 대신 답한 응답으로 얻은 할인 구매·인수·통행료 할인은 "정답으로 얻은 것"에서 뺀다(§9.3). 다음 사람 정답은 다시 센다', () => {
    const l: LogEvent[] = [
      dice,
      Q(0, 'h', 1, ['4.1'], []), A(0, 'h', false),
      Q(0, 'b', 1, ['3.3'], []), A(0, 'b', true, true),
      { ev: 'buy', seat: 0, tile: 1, price: 100, discounted: true },
      { ev: 'toll', payer: 0, owner: 1, tile: 4, base: 100, multiplier: 1, paid: 50, discounted: true },
      { ev: 'takeover', seat: 0, tile: 4, correct: true, shielded: false, cost: 100 },
      Q(0, 'c', 1, ['8.1'], []), A(0, 'c', true),
      { ev: 'buy', seat: 0, tile: 2, price: 100, discounted: true },
    ];
    expect(buildReport(l, meta).seats[0].gains).toEqual({ discountedBuys: 1, takeovers: 0, tollSaved: 0 });
  });
  it('방패로 막힌 인수는 "사들였어요"에 안 센다', () => {
    const l: LogEvent[] = [dice, { ev: 'takeover', seat: 0, tile: 5, correct: true, shielded: true, cost: 0 }];
    expect(buildReport(l).seats[0].gains.takeovers).toBe(0);
  });
  it('순위는 result 이벤트에서', () => {
    expect(r.final).toEqual({ ranks: [0, 1, 2, 3], assets: [9, 8, 7, 6] });
    expect(buildReport(log.slice(0, 5)).final).toBeNull();
  });
  it('로그가 비었거나 한 턴도 없으면 빈 상태, 예외 없음', () => {
    for (const l of [[], [{ ev: 'clock', kind: 'start', remainingMs: 2_400_000, by: 'host' } as LogEvent]]) {
      const e = buildReport(l);
      expect(e.empty).toBe(true);
      expect(e.seats).toHaveLength(4);
      expect(e.seats[0].rows).toEqual([]);
    }
    expect(r.empty).toBe(false);
  });
  it('같은 qid 를 복습으로 다시 내도 먼저 푼 답은 첫 출제로 센다', () => {
    const l: LogEvent[] = [dice, Q(0, 'r1', 1, ['8.1'], []), A(0, 'r1', true), Q(0, 'r1', 1, ['8.1'], [], true), A(0, 'r1', false)];
    const s = buildReport(l).seats[0];
    expect(s.rows.find((x) => x.key === '8')!.arrive).toEqual({ ok: 1, n: 1 });
    expect(s.review).toEqual({ ok: 0, n: 1 });
  });
  it('다시 낸 관전 문장(tf.review)은 참/거짓 첫 정답률에서 빠진다. 틀린 M번호는 남는다', () => {
    const l: LogEvent[] = [dice, T('th-1', 's1', ['8.1'], 'M9'), TA(0, 's1', true, true),
      { ev: 'tf', cardId: 'th-1', stmtId: 's1', mTag: 'M9', topics: ['8.1'], review: true }, TA(0, 's1', true, false), TA(1, 's1', null, false)];
    const s = buildReport(l).seats;
    expect(s[0].rows.find((x) => x.key === '8')!.tf).toEqual({ ok: 1, n: 1, none: 0 }); // 첫 출제 답만
    expect(s[0].wrongM).toEqual(['M9']);
    expect(s[1].rows).toEqual([]); // 다시 낸 문장의 무응답도 세지 않는다
  });
  it('첫 장 합계: 대번호 둘인 문항·문장도 이벤트당 1회 (QA10)', () => {
    const l: LogEvent[] = [dice,
      Q(0, 'm1', 1, ['2.3', '5.1'], []), A(0, 'm1', true), X('m1', 'no-1'),
      T('no-1', 'ms1', ['2.3', '5.1'], null), TA(0, 'ms1', true, true),
      Q(0, 'm2', 1, ['B2.1'], []), A(0, 'm2', false),
      T('ph-1', 'ms2', ['B2.1'], null), TA(0, 'ms2', false, false)];
    const s = buildReport(l).seats[0];
    const rw = (k: string) => s.rows.find((x) => x.key === k)!;
    expect(rw('2').arrive).toEqual({ ok: 1, n: 1 });
    expect(rw('5').arrive).toEqual({ ok: 1, n: 1 });
    expect(rw('2').tf).toEqual({ ok: 1, n: 1, none: 0 });
    expect(rw('5').tf).toEqual({ ok: 1, n: 1, none: 0 });
    expect(s.total.arrive).toEqual({ ok: 1, n: 2 });
    expect(s.total.tf).toEqual({ ok: 1, n: 2, none: 0 });
    const one = buildReport([dice, Q(0, 'm1', 1, ['2.3', '5.1'], []), A(0, 'm1', true), T('no-1', 'ms1', ['2.3', '5.1'], null), TA(0, 'ms1', true, true)]).seats[0];
    expect(one.total.arrive).toEqual({ ok: 1, n: 1 });
    expect(one.total.tf).toEqual({ ok: 1, n: 1, none: 0 });
  });
  it('첫 장 합계: 4단계 포함, 복습·봇 대행 제외, 무응답은 none', () => {
    expect(me.total.arrive).toEqual({ ok: 1, n: 3 }); // q1·q2·q3(4단계), q4 복습 제외
    expect(me.total.tf).toEqual({ ok: 2, n: 3, none: 0 });
    expect(r.seats[2].total.tf).toEqual({ ok: 0, n: 0, none: 1 });
    expect(r.seats[3].total.arrive).toEqual({ ok: 0, n: 0 });
  });
  it('majorOf', () => {
    expect([majorOf('8.1'), majorOf('B2.1'), majorOf('10.5')]).toEqual(['8', 'B', '10']);
  });
});
