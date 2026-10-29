// 로그 → 결과 화면 데이터(PRD §9.3). 순수 함수: LogEvent[] 와 여행지 메타만 읽는다.
// 정답 자체는 모른다. 맞았는지는 로그의 correct 가 알려 준다.
import { BOARD } from '../shared/board';
import type { LogEvent, Seat } from '../shared/types';

/** 여행지 카드 메타. climate·magnet·pin 은 콘텐츠가 주는 값(없으면 해당 칸만 비운다) */
export interface CountryMeta {
  climate?: string;
  magnet?: { terrain: string; scenery: string; life: string };
  /** 세계 지도 위 위치, 지도 가로·세로의 % */
  pin?: { x: number; y: number };
}
export type MetaMap = Record<string, CountryMeta | undefined>;

export interface Rate { ok: number; n: number }
export interface TfRate extends Rate { none: number } // n = 답한 수(value≠null), none = 무응답
export interface Row { key: string; arrive: Rate; tf: TfRate }
export interface Stamp { country: string; level: number }
export interface Magnet { country: string; terrain: string; scenery: string; life: string }

export interface SeatReport {
  seat: Seat;
  /** 봇 자리: 학습 기록을 모으지 않는다 */
  isBot: boolean;
  /** 대번호별(2~5, 7~10, B …). 4단계는 여기 넣지 않고 level4 에 따로 센다. 첫 출제(복습 아님)만 */
  rows: Row[];
  level4: Row;
  /** 첫 장 전체 합계: answer·tf_answer 이벤트당 1회(대번호 둘인 문항도 1회). 4단계 포함, 복습·봇 대행 제외 (2026-10-30 QA10) */
  total: { arrive: Rate; tf: TfRate };
  /** 복습 출제(그 나라 문항을 다 쓴 뒤) 합계 */
  review: Rate;
  wrongM: string[];
  stamps: Stamp[];
  /** 같은 기후에서 도장 2곳 이상인 묶음만 */
  climateGroups: { climate: string; stamps: Stamp[] }[];
  gains: { discountedBuys: number; takeovers: number; tollSaved: number };
  landmarks: number[];
  magnets: Magnet[];
}

export interface Report {
  /** 한 턴(주사위)도 없음 */
  empty: boolean;
  /** 끝난 판이면 result 이벤트의 순위·자산, 아니면 null */
  final: { ranks: Seat[]; assets: number[] } | null;
  seats: SeatReport[];
  /** 성립한 대륙 독점(로그의 event monopoly, 성립 순) — 결과 화면 지도·이정표 자리색 (2026-10-26) */
  monopolies: { continent: string; seat: Seat }[];
}

const SEATS: Seat[] = [0, 1, 2, 3];
const rate = (): Rate => ({ ok: 0, n: 0 });
const row = (key: string): Row => ({ key, arrive: rate(), tf: { ok: 0, n: 0, none: 0 } });

/** "8.1" → "8", "B2.1" → "B" */
export const majorOf = (topic: string) => (topic.startsWith('B') ? 'B' : topic.split('.')[0]);
const majorOrder = (a: string, b: string) => (a === 'B' ? 1 : b === 'B' ? -1 : Number(a) - Number(b));
const mNum = (m: string) => Number(m.slice(1));
const stampOrder = (c: string) => { const i = BOARD.findIndex((t) => t.country === c); return i < 0 ? 99 : i; };

export function buildReport(log: LogEvent[], meta: MetaMap = {}, bots: boolean[] = []): Report {
  // 1) 색인: 문항·참/거짓 문장·카드 단계
  const question = new Map<string, Extract<LogEvent, { ev: 'question' }>>();
  const cardLevel = new Map<string, number>();
  const human = new Set<number>();
  const botSeen = new Set<number>();
  let final: Report['final'] = null;
  const monopolies: Report['monopolies'] = [];
  for (const e of log) {
    if (e.ev === 'event' && e.kind === 'monopoly') monopolies.push({ continent: String(e.payload.continent), seat: e.seat });
    if (e.ev === 'question') question.set(e.qid, e);
    else if (e.ev === 'explanation') { const q = question.get(e.qid); if (q) cardLevel.set(e.cardId, q.level); }
    else if (e.ev === 'answer' || e.ev === 'tf_answer') (e.isBot ? botSeen : human).add(e.seat);
    else if (e.ev === 'result') final = { ranks: e.finalRanks, assets: e.assets };
  }

  // 2) 자리별 집계
  const seats: SeatReport[] = SEATS.map((seat) => {
    const isBot = !human.has(seat) && (botSeen.has(seat) || !!bots[seat]);
    const rows = new Map<string, Row>();
    const get = (k: string) => { let r = rows.get(k); if (!r) rows.set(k, (r = row(k))); return r; };
    const level4 = row('4');
    const review = rate();
    const total = { arrive: rate(), tf: { ok: 0, n: 0, none: 0 } as TfRate };
    const wrong = new Set<string>();
    const best = new Map<string, number>();
    const gains = { discountedBuys: 0, takeovers: 0, tollSaved: 0 };
    const landmarks: number[] = [];

    // 같은 qid 를 복습으로 다시 낼 수 있어서, 답을 센 순간까지 본 가장 최근 출제로 판정한다
    const qNow = new Map<string, Extract<LogEvent, { ev: 'question' }>>();
    const tNow = new Map<string, Extract<LogEvent, { ev: 'tf' }>>();
    let botAnswered = false; // 이 자리의 직전 응답을 봇이 대신 했다 → 그 도장·할인·인수·통행료 할인은 학생 증거가 아니다(§9.3)
    for (const e of log) {
      if (e.ev === 'answer' && e.seat === seat) botAnswered = !!e.isBot;
      if (e.ev === 'question') qNow.set(e.qid, e);
      else if (e.ev === 'tf') tNow.set(e.stmtId, e);
      else if (e.ev === 'answer' && e.seat === seat && !e.isBot) {
        const q = qNow.get(e.qid);
        if (!q) continue;
        if (q.review) { review.n++; if (e.correct) review.ok++; }
        else {
          total.arrive.n++; if (e.correct) total.arrive.ok++;
          for (const r of q.level === 4 ? [level4] : [...new Set(q.topics.map(majorOf))].map(get)) { r.arrive.n++; if (e.correct) r.arrive.ok++; }
        }
        e.chosenMTags?.forEach((m) => wrong.add(m)); // 고른 선지의 태그만(정답 [], 무응답 null)
      } else if (e.ev === 'tf_answer' && e.seat === seat && !e.isBot) {
        const t = tNow.get(e.stmtId);
        if (!t) continue;
        if (t.review) { if (e.value !== null && !e.correct && t.mTag) wrong.add(t.mTag); continue; } // 다시 낸 문장: 첫 정답률에서 뺀다(틀린 M번호는 남김)
        if (e.value === null) total.tf.none++;
        else { total.tf.n++; if (e.correct) total.tf.ok++; }
        const targets = cardLevel.get(t.cardId) === 4 ? [level4] : [...new Set(t.topics.map(majorOf))].map(get);
        for (const r of targets) {
          if (e.value === null) r.tf.none++;
          else { r.tf.n++; if (e.correct) r.tf.ok++; }
        }
        if (e.value !== null && !e.correct && t.mTag) wrong.add(t.mTag);
      } else if (e.ev === 'stamp' && e.seat === seat && !botAnswered) best.set(e.country, Math.max(best.get(e.country) ?? 0, e.level));
      else if (e.ev === 'buy' && e.seat === seat && e.discounted && !botAnswered) gains.discountedBuys++;
      else if (e.ev === 'takeover' && e.seat === seat && e.correct && !e.shielded && !botAnswered) gains.takeovers++;
      else if (e.ev === 'toll' && e.payer === seat && e.discounted && !botAnswered) gains.tollSaved += Math.max(0, Math.round(e.base * e.multiplier - e.paid));
      else if (e.ev === 'build' && e.seat === seat && e.level === 4) landmarks.push(e.tile);
      else if (e.ev === 'sold' && e.seat === seat && e.levelBefore === 4 && landmarks.includes(e.tile)) landmarks.splice(landmarks.indexOf(e.tile), 1);
    }

    const stamps = [...best].map(([country, level]) => ({ country, level })).sort((a, b) => stampOrder(a.country) - stampOrder(b.country));
    const byClimate = new Map<string, Stamp[]>();
    for (const s of stamps) { const c = meta[s.country]?.climate; if (c) byClimate.set(c, [...(byClimate.get(c) ?? []), s]); }
    const magnets = landmarks.flatMap((tile) => {
      const country = BOARD[tile]?.country;
      const m = country && meta[country]?.magnet;
      return m ? [{ country, ...m }] : [];
    });
    return {
      seat, isBot,
      rows: [...rows.values()].sort((a, b) => majorOrder(a.key, b.key)),
      level4, total, review,
      wrongM: [...wrong].sort((a, b) => mNum(a) - mNum(b)),
      stamps,
      climateGroups: [...byClimate].filter(([, s]) => s.length >= 2).map(([climate, s]) => ({ climate, stamps: s })).sort((a, b) => a.climate.localeCompare(b.climate, 'ko')),
      gains, landmarks, magnets,
    };
  });

  return { empty: !log.some((e) => e.ev === 'dice'), final, seats, monopolies };
}
