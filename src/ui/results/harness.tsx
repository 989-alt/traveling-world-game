// 시험용 하네스(앱 라우트 아님). e2e 가 /dev/results 를 연 뒤 이 모듈을 주입한다. 주소 인자:
//   scenario=full|empty   — 로그는 아래에서 합성한다. (중간 결과는 2026-10-28 U1 에 없어졌다)
import { render } from 'preact';
import type { LogEvent, Seat } from '../../shared/types';
import { Results, type SeatInfo } from './Results';
import '../../styles/tokens.css';
import '../../styles/base.css';
import '../../styles/screens.css';
import '../../styles/overlays.css';

const q = new URLSearchParams(location.search);
const MAJORS = ['2.1', '3.1', '4.1', '5.1', '7.1', '8.1', '9.1', '10.1', 'B2.1', '12.2'];

function fullLog(): LogEvent[] {
  const log: LogEvent[] = [{ ev: 'clock', kind: 'start', remainingMs: 40 * 60_000, by: 'host' }, { ev: 'dice', seat: 0, d1: 3, d2: 4 }];
  let n = 0;
  const ask = (seat: Seat, topic: string, level: 1 | 2 | 3 | 4, correct: boolean, isBot = false, review = false) => {
    const qid = `q${n++}`;
    log.push({ ev: 'question', seat, qid, country: 'th', level, kind: review ? 'review' : 'initial', topics: [topic], mTags: ['M7', 'M14', 'M3'], review });
    log.push({ ev: 'answer', seat, qid, choice: correct ? 0 : 1, correct, ms: 900, isBot });
    log.push({ ev: 'explanation', qid, cardId: `th-${level}`, variant: 'full', shownTo: [true, true, true, true], shownMs: 1 });
    const stmtId = `s${n}`;
    log.push({ ev: 'tf', cardId: `th-${level}`, stmtId, mTag: 'M9', topics: [topic] });
    for (const s of [0, 1, 2, 3] as Seat[]) if (s !== seat) log.push({ ev: 'tf_answer', seat: s, stmtId, value: s === 2 && n % 3 === 0 ? null : n % 2 === 0, correct: n % 2 === 0 && s !== 2, isBot: s === 3 });
  };
  // 사람 3명이 번갈아 도착, 봇 자리 3 도 도착
  MAJORS.forEach((t, i) => { for (const s of [0, 1, 2] as Seat[]) ask(s, t, 1, (i + s) % 3 !== 0); ask(3, t, 1, true, true); });
  ask(0, '9.1', 4, true); ask(1, '9.1', 4, false); ask(0, '8.1', 1, false, false, true);
  for (const [c, lv] of [['ph', 1], ['th', 3], ['sa', 2], ['eg', 4], ['kr', 2], ['no', 1], ['ca', 3], ['ec', 2], ['br', 1], ['mx', 2]] as const) log.push({ ev: 'stamp', seat: 0, country: c, level: lv });
  for (const [c, lv] of [['it', 1], ['fr', 2]] as const) log.push({ ev: 'stamp', seat: 1, country: c, level: lv });
  log.push({ ev: 'buy', seat: 0, tile: 1, price: 1, discounted: true }, { ev: 'takeover', seat: 0, tile: 2, correct: true, shielded: false, cost: 1 });
  log.push({ ev: 'toll', payer: 0, owner: 1, tile: 12, base: 400, multiplier: 2, discounted: true, paid: 600 });
  for (const t of [1, 2, 6, 8, 11]) log.push({ ev: 'build', seat: 0, tile: t, level: 4, cost: 1 });
  log.push({ ev: 'build', seat: 1, tile: 12, level: 4, cost: 1 });
  log.push({ ev: 'result', finalRanks: [0, 1, 3, 2], assets: [9800, 7400, 3100, 5200] });
  return log;
}

const seats: SeatInfo[] = [
  { seat: 0, charId: 1, name: '용감한 호랑이', isBot: false },
  { seat: 1, charId: 2, name: '느긋한 거북이', isBot: false },
  { seat: 2, charId: 3, name: '빠른 토끼', isBot: false },
  { seat: 3, charId: 7, name: '로봇 4', isBot: true },
];
const log = q.get('scenario') === 'empty' ? [] : fullLog();
render(<Results log={log} seats={seats} mySeat={0} />, document.getElementById('app')!);
