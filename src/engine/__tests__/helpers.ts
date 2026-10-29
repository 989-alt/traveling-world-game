// 테스트 공용: 전 여행지 합성 콘텐츠, 주사위 고정, 상태 손질.
import type { CountryId, CultureCountryId, ExplanationCard, Level, Question, TfStatement, CultureCard, Mission } from '../../shared/content-types';
import type { Action, Content, GameState, Seat } from '../../shared/types';
import { apply, createGame } from '../engine';
import { BOARD_SIZE } from '../../shared/board';
import { nextFloat } from '../rng';
import cards from '../../data/cards.json';
import questions from '../../data/questions.json';
import tf from '../../data/tf.json';
import culture from '../../data/culture-cards.json';
import missions from '../../data/missions.json';

export const sample = { cards, questions, tf, culture, missions } as unknown as Content;

const COUNTRIES: CountryId[] = ['ph', 'th', 'sa', 'np', 'cn', 'kr', 'it', 'fr', 'ch', 'no', 'ru', 'cd', 'tz', 'et', 'eg', 'mx', 'us', 'ca', 'gl', 'ec', 'br', 'cl', 'ar'];

function makeContent(): Content {
  const c: Content = { cards: [], questions: [], tf: [], culture: [], missions: [] };
  const addCard = (id: string, country: CountryId, level: Level) => {
    c.cards.push({ id, country, level, answer: `${id} 정답`, reasons: ['a', 'b'], image: `${id}.png`, topics: [`${level}.1`], mTags: [] } as ExplanationCard);
    (['initial', 'review', 'review'] as const).forEach((kind, i) => {
      c.questions.push({
        id: `${id}-q${i + 1}`, cardId: id, kind, level, stem: '?', answer: i as 0 | 1 | 2,
        choices: [0, 1, 2, 3].map((j) => (j === i ? { text: 'ok' } : { text: 'no', mTags: [`M${j + 1}`] })) as Question['choices'],
        topics: [`${level}.${i}`],
      });
    });
    c.tf.push({ id: `${id}-t1`, cardId: id, text: '참', answer: true, mTags: [], topics: ['t'] } as TfStatement);
    c.tf.push({ id: `${id}-t2`, cardId: id, text: '거짓', answer: false, mTags: ['M9'], topics: ['t'] } as TfStatement);
  };
  for (const k of COUNTRIES) for (const lv of [1, 2, 3, 4] as Level[]) addCard(`${k}-${lv}`, k, lv);
  addCard('aq-s1', 'aq', 1);
  addCard('aq-s2', 'aq', 1);
  for (const k of [...COUNTRIES, 'au'] as CultureCountryId[]) {
    c.culture.push({ id: `cc-${k}`, country: k, name: k, continent: 'asia', intro: '.', image: '.',
      ...(k === 'th' ? { badge: { id: 'b', name: 'b', kind: 'food', image: '.', origin: 'guide' } } : {}) } as CultureCard);
  }
  c.missions.push({ id: 'm-1', type: 'connect', title: '', prompt: '', explain: '', analytic: true, pairs: [{ left: 'a', right: '1' }, { left: 'b', right: '2' }],
    spectatorTf: { text: '', answer: false, mTags: ['M14'] }, topics: ['8.1'], mTags: ['M14'] } as Mission);
  c.missions.push({ id: 'm-2', type: 'order', title: '', prompt: '', explain: '', analytic: false, steps: ['x', 'y', 'z'],
    spectatorTf: { text: '', answer: true, mTags: [] }, topics: ['7.2'], mTags: [] } as Mission);
  return c;
}
export const full = makeContent();

/** 다음 주사위가 (d1, d2) 가 되도록 rngState 를 고른다. 엔진에 뒷문 없이 시드만 바꾼다 */
export function withDice(s: GameState, d1: number, d2: number): GameState {
  for (let st = 1; st < 1_000_000; st++) {
    const [a, s1] = nextFloat(st);
    const [b] = nextFloat(s1);
    if (1 + Math.floor(a * 6) === d1 && 1 + Math.floor(b * 6) === d2) return { ...s, rngState: st };
  }
  throw new Error('dice not found');
}

export const edit = (s: GameState, f: (d: GameState) => void): GameState => {
  const d = structuredClone(s);
  f(d);
  return d;
};

export const newGame = (seed = 1, bots = [false, false, false, false]) =>
  createGame({ seed, bots, settings: { totalMinutes: 40, touristQuiz: false } });

export function run(s: GameState, actions: Action[], content: Content = full): GameState {
  return actions.reduce((acc, a) => apply(acc, a, content), s);
}

/** seat 을 tile 에서 steps(비더블) 만큼 굴려 도착시킨다.
 *  순간이동 고정물이라 tile 1~4 로 가며 출발을 지나도 바퀴(laps, §3.3 바퀴 하한)로는 세지 않는다(월급은 준다).
 *  출발 칸(0) 도착은 그 자체가 바퀴라 센다. 바퀴 하한은 rules.test '바퀴 하한' 이 직접 본다 */
export function arrive(s: GameState, seat: Seat, tile: number, content: Content = full): GameState {
  const from = (tile - 5 + BOARD_SIZE) % BOARD_SIZE;
  const laps = s.players[seat].laps;
  s = edit(s, (d) => { d.players[seat].pos = from; d.turn.seat = seat; d.turn.step = 'roll'; });
  s = apply(withDice(s, 2, 3), { type: 'roll', seat }, content);
  return tile > 0 && tile < 5 ? edit(s, (d) => { d.players[seat].laps = laps; }) : s;
}

export const evs = (s: GameState, ev: string) => s.log.filter((e) => e.ev === ev);
export const last = (s: GameState, ev: string) => evs(s, ev).at(-1);

/** 문항 단계까지 진행된 상태에서 정답/오답 → 해설 → 참/거짓 timeout 까지 */
export function answerAndSkip(s: GameState, correct: boolean, content: Content = full): GameState {
  const q = s.turn.question!;
  const choice = q.format === 'tf' ? (correct ? q.answer : !q.answer) : correct ? (q.answer as number) : ((q.answer as number) + 1) % 4;
  s = apply(s, { type: 'answer', seat: s.turn.seat, choice, ms: 1000 }, content);
  s = apply(s, { type: 'timeout' }, content); // 해설
  if (s.turn.step === 'tf') s = apply(s, { type: 'timeout' }, content);
  return s;
}

/** 도착 → 문화 카드 → 문항 → 해설 → 참/거짓 까지 */
export function landAndAnswer(s: GameState, seat: Seat, tile: number, correct: boolean, content: Content = full): GameState {
  s = arrive(s, seat, tile, content);
  if (s.turn.step === 'culture') s = apply(s, { type: 'timeout' }, content);
  if (s.turn.step !== 'question') return s;
  return answerAndSkip(s, correct, content);
}
