#!/usr/bin/env node
// 봇 4명 자동 대국 시뮬 (PRD §6 S1~S3). 엔진만 쓴다, 시드 고정, 실시간 아님.
// 사용: sim.mjs --games N --seed S [--minutes 40|60|80] [--zero-bot] [--humans k --human-acc p] [--bot-acc lo-hi]
//              [--content <폴더>] [--json] [--assert "a,b"] [--confirm N:M]
//   --confirm N:M (2026-10-29 QA7, PRD §6 표본 규칙) = 비율형 assert(zero-win-rate·human-win·gap-top2 의 F·tie-top2) 중 하나라도 --games 판 값이
//     경계 ±M 안이면 같은 시드로 N 판을 돌려 그 값으로 모든 assert 를 다시 판정한다(종료 코드도). report.confirm 에 처음·확정 값
//   --minutes = 놀이 시간(2026-10-28 U1, 기본 40). 옛 2차시×35분 설정은 없어졌다. U3: 20 은 종료 코드 2.
//   (2026-10-28 U2, PRD §6 S12) --humans k = 사람 대리 k명(0~3, 기본 0): 봇 정책 + 고정 정답률(--human-acc, 기본 0.70) + 같은 무응답 5%.
//     사람 자리는 판마다 돌린다(자리 순서 편향 제거). 나머지는 봇, 정답률은 그 길이의 BOT_ACCURACY 범위(--bot-acc 로 덧씌움).
//   assert: zero-win-rate<=X · bankrupt-firsthalf<=K:F(놀이 시간 절반 시점 파산 ≤K 인 판 비율 ≥F) · monopoly-4v5<=Mx(4칸 대륙 평균 ÷ 5칸 대륙 평균, 독점승 ≥10판일 때만)
//           · takeovers-per-game>=X · coverage-majors>=F(2~5·7~10 을 모두 만난 판 비율, 만남 = 도착 문항·참/거짓·미션 topics 합산 — QA6) · repeat==N
//           · (U1 길이별, PRD §4.4) salary-all>=F(네 명 모두 월급 ≥1회인 판 비율) · buys-per-player>=X · tolls-per-game>=X(실제 낸 통행료 > 0)
//             · tie-top2<=F(1·2위 자산 동점 판 비율) · alive-end>=K:F(끝에 생존 ≥K 인 판 비율 ≥F) · bankrupt-end<=F(파산승으로 끝난 판 비율)
//           · (U2) human-win>=F · human-win<=F(사람 대리 중 하나가 1등인 판 비율, --humans 와 함께) · gap-top2>=G:F(1·2위 최종 자산 차 ≥G 인 판 비율 ≥F)
import fs from 'node:fs';
import path from 'node:path';
import nodeModule from 'node:module'; // 기본 import — 이름 import 는 옛 Node 에서 링크 단계에 죽어 아래 안내가 안 나온다
import { fileURLToPath, pathToFileURL } from 'node:url';

// 엔진 TS 를 그대로 불러오려면 registerHooks + 플래그 없는 타입 제거(Node 22.18+)가 필요하다
if (typeof nodeModule.registerHooks !== 'function' || !process.features.typescript) {
  console.error(`sim 은 Node 22.18+ 필요 (현재 ${process.version})`);
  process.exit(2);
}
// 타입 제거 실험 경고만 끈다(--json 파이프 소음). 다른 경고는 그대로
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...r) =>
  (w?.name ?? r[0]?.type ?? r[0]) === 'ExperimentalWarning' ? undefined : emitWarning.call(process, w, ...r);

// 엔진 TS 는 확장자 없는 import 를 쓴다(번들러 방식). 이 훅이 .ts 로 풀어 준다
nodeModule.registerHooks({
  resolve(spec, ctx, next) {
    try { return next(spec, ctx); } catch (e) {
      if (spec.startsWith('.') && !path.extname(spec)) return next(spec + '.ts', ctx);
      throw e;
    }
  },
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => pathToFileURL(path.join(HERE, '../src', p)).href;
const { createGame, metMajors, COVERAGE_MAJORS } = await import(src('engine/engine.ts'));
const { drawAccuracy, playBotGame, seededRand } = await import(src('engine/bot.ts'));
const { BOARD, BOARD_SIZE, CONTINENTS, ISLAND_TILE, continentTiles } = await import(src('shared/board.ts'));
const { BOT_ACCURACY } = await import(src('shared/economy.ts'));

const a = process.argv.slice(2);
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const GAMES = Number(arg('--games', 200));
const SEED = Number(arg('--seed', 1));
const ZERO = a.includes('--zero-bot');
const JSON_OUT = a.includes('--json');
const ASSERT = arg('--assert', '');
const MINUTES = Number(arg('--minutes', 40));
if (![40, 60, 80].includes(MINUTES)) { console.error('--minutes 는 40·60·80 중 하나(2026-10-28 U3: 20 삭제)'); process.exit(2); }
const HUMANS = Number(arg('--humans', 0));
const HUMAN_ACC = Number(arg('--human-acc', 0.7));
const BOT_ACC_ARG = arg('--bot-acc', '');
if (!Number.isInteger(HUMANS) || HUMANS < 0 || HUMANS > 3) { console.error('--humans 는 0~3'); process.exit(2); }
if (!(HUMAN_ACC >= 0 && HUMAN_ACC <= 1)) { console.error('--human-acc 는 0~1'); process.exit(2); }
if (ZERO && HUMANS > 0) { console.error('--zero-bot 과 --humans 는 함께 못 쓴다'); process.exit(2); }
let BOT_RANGE = BOT_ACCURACY[MINUTES];
if (BOT_ACC_ARG) {
  const m = BOT_ACC_ARG.match(/^([0-9.]+)-([0-9.]+)$/);
  const r = m ? [Number(m[1]), Number(m[2])] : [];
  if (!m || !(r[0] >= 0 && r[0] <= r[1] && r[1] <= 1)) { console.error('--bot-acc 는 lo-hi (0 ≤ lo ≤ hi ≤ 1)'); process.exit(2); }
  BOT_RANGE = r;
}
/** 봇 자리 정답률: 덧씌움이 없으면 엔진 drawAccuracy(서버와 같은 함수), 있으면 그 범위에서 균일 */
const botAcc = (rand) => (BOT_ACC_ARG ? BOT_RANGE[0] + (BOT_RANGE[1] - BOT_RANGE[0]) * rand() : drawAccuracy(rand, MINUTES));
const CONTENT_DIR = arg('--content', path.join(HERE, '../src/data'));
const TURN_MS = 56_000; // PRD §4.3 턴 ≈ 56초
const TIMEOUT_P = 0.05; // 무응답(타이머 만료) 경로
const MAJORS = [...COVERAGE_MAJORS]; // 2~5·7~10 (엔진과 같은 출처)
if (!(GAMES > 0) || !Number.isFinite(SEED)) { console.error('--games N(>0) --seed S 필요'); process.exit(2); }
// --confirm N:M (PRD §6 표본 규칙, 2026-10-29 QA7): 비율형 assert 가 --games 판에서 경계 ±M 안이면 같은 시드 N 판으로 판정을 확정한다
const CONFIRM_ARG = arg('--confirm', '');
let CONFIRM = null;
if (CONFIRM_ARG) {
  const m = CONFIRM_ARG.match(/^(\d+):([0-9.]+)$/);
  CONFIRM = m ? { games: Number(m[1]), margin: Number(m[2]) } : null;
  if (!CONFIRM || !(CONFIRM.games > GAMES) || !(CONFIRM.margin >= 0 && CONFIRM.margin < 1)) { console.error('--confirm 은 N:M (N > --games, 0 ≤ M < 1)'); process.exit(2); }
  if (!ASSERT) { console.error('--confirm 은 --assert 와 함께'); process.exit(2); }
}

// ── 콘텐츠 ──
const read = (f) => JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8'));
const content = {
  cards: read('cards.json'), questions: read('questions.json'), tf: read('tf.json'),
  culture: read('culture-cards.json'), missions: read('missions.json'),
};
// 카드가 없는 나라는 빈 자리표(주제 없음)로 채운다. 경제는 "도착하면 늘 퀴즈"(§3.3)를 전제하므로.
// 자리표 주제는 [] 라 출제 커버리지를 부풀리지 않는다. 진짜 풀(T04)이 들어오면 0개가 된다.
// 일부만 쓴 나라는 자리표와 섞지 않고 멈춘다(빌림 순서가 섞여 수치가 왜곡된다).
const placeholderCountries = [];
const placeholderIds = new Set();
const partial = [];
for (const country of [...new Set(BOARD.filter((t) => t.kind === 'country').map((t) => t.country)), 'aq']) {
  const ids = country === 'aq' ? [['aq-s1', 1], ['aq-s2', 1]] : [1, 2, 3, 4].map((l) => [`${country}-${l}`, l]);
  const missing = ids.filter(([id]) => !content.cards.some((x) => x.id === id));
  if (missing.length === 0) continue;
  if (missing.length < ids.length) { partial.push(`${country}: ${missing.map(([id]) => id).join(' ')} 없음`); continue; }
  placeholderCountries.push(country);
  for (const [id] of ids) for (const k of ['q1', 'q2', 'q3', 't1', 't2']) placeholderIds.add(`${id}-${k}`);
  for (const [id, level] of ids) {
    content.cards.push({ id, country, level, answer: '', reasons: ['', ''], image: '', topics: [], mTags: [] });
    ['initial', 'review', 'review'].forEach((kind, i) => content.questions.push({
      id: `${id}-q${i + 1}`, cardId: id, kind, level, stem: '', answer: 0, topics: [],
      choices: [{ text: '' }, { text: '' }, { text: '' }, { text: '' }],
    }));
    [true, false].forEach((answer, i) => content.tf.push({ id: `${id}-t${i + 1}`, cardId: id, text: '', answer, mTags: [], topics: [] }));
  }
}
if (partial.length) { console.error(`카드 단계가 빠진 나라 (나라마다 4단계, 남극 2장):\n  ${partial.join('\n  ')}`); process.exit(2); }

// ── 한 판 ──
function playGame(g) {
  const rand = seededRand((SEED * 1_000_003 + g * 7919) >>> 0);
  const zeroSeat = ZERO ? g % 4 : -1; // 자리 순서 편향을 없애려고 돌린다
  const humanSeats = Array.from({ length: HUMANS }, (_, j) => (g + j) % 4); // 사람 대리도 돌린다
  const acc = [0, 1, 2, 3].map((i) => (i === zeroSeat ? 0 : humanSeats.includes(i) ? HUMAN_ACC : botAcc(rand)));
  const state = createGame({ seed: Math.floor(rand() * 2 ** 32), bots: [true, true, true, true], settings: { totalMinutes: MINUTES, touristQuiz: false } });
  const { state: s, bankruptHalf } = playBotGame({ state, content, rand, accuracy: acc, turnMs: TURN_MS, timeoutP: TIMEOUT_P });
  return { ...summarize(s, zeroSeat, bankruptHalf), humanWon: humanSeats.includes(s.winner.seat) };
}

/** 월급(출발 통과·도착) 받은 횟수를 로그에서 센다. 엔진은 moveBy 에서만 준다: 주사위 = from + 합 ≥ 30, 세계여행·미션 이동 = to ≤ from.
 *  무인도로 보내기(더블 3번·미션 보상)는 moveBy 를 안 거친다(월급 없음) */
function salaries(log) {
  const n = [0, 0, 0, 0];
  let dice = 0;
  log.forEach((e, i) => {
    if (e.ev === 'dice') dice = e.d1 + e.d2;
    if (e.ev !== 'move') return;
    const sentToIsland = e.to === ISLAND_TILE && log[i + 1]?.ev === 'event' && log[i + 1].kind === 'island' &&
      (e.via === 'mission' || (e.from + dice) % BOARD_SIZE !== ISLAND_TILE);
    if (sentToIsland) return;
    if (e.via === 'dice' ? e.from + dice >= BOARD_SIZE : e.to <= e.from) n[e.seat]++;
  });
  return n;
}

function summarize(s, zeroSeat, bankruptHalf) {
  // S3 '만남'(PRD §6, 2026-10-29 QA6) = 도착 문항 + 참/거짓 + 미션 topics 합산. 엔진 미션 고르기와 같은 함수
  const majors = metMajors(s.log);
  const qMajors = new Set(); // 참고: 옛 정의(도착 문항만)
  const seen = new Set();
  let repeats = 0, reviewRepeats = 0, buys = 0, takeovers = 0, placeholderDrawn = 0, drawn = 0, tolls = 0;
  for (const e of s.log) {
    if (e.ev === 'toll' && e.paid > 0) tolls++;
    if (e.ev === 'question') {
      e.topics.forEach((t) => qMajors.add(String(t).split('.')[0]));
      drawn++;
      if (placeholderIds.has(e.qid)) placeholderDrawn++;
      if (e.review) reviewRepeats++;
      else if (seen.has(e.qid)) repeats++;
      else seen.add(e.qid);
    } else if (e.ev === 'buy') buys++;
    else if (e.ev === 'takeover' && !e.shielded) takeovers++;
  }
  const w = s.winner;
  // 독점승 대륙 = 엔진의 독점 성립 로그(event monopoly). 4칸 대륙은 건설로도 성립한다(㉒)
  const monopoly = w.kind === 'monopoly' ? s.log.filter((e) => e.ev === 'event' && e.kind === 'monopoly').map((e) => e.payload.continent) : [];
  const result = s.log.findLast((e) => e.ev === 'result');
  const top2 = result.finalRanks.slice(0, 2).map((x) => result.assets[x]);
  const gapTop2 = top2[0] - (top2[1] ?? 0);
  return {
    winner: w, zeroWon: w.seat === zeroSeat, bankruptHalf, monopoly, tolls, gapTop2,
    salaryAll: salaries(s.log).every((x) => x >= 1), salaryPlayers: salaries(s.log).filter((x) => x >= 1).length, tieTop2: w.kind === 'assets' && top2[0] === top2[1],
    alive: s.players.filter((p) => !p.bankrupt).length, turns: s.log.filter((e) => e.ev === 'dice').length,
    covered: MAJORS.every((m) => majors.has(m)), coveredQ: MAJORS.every((m) => qMajors.has(m)), majors: [...majors], repeats, reviewRepeats, buys, takeovers, placeholderDrawn, drawn,
  };
}

// ── 집계 ──
/** 판 결과 rs 로 보고서를 만든다(rs.length 판) */
function aggregate(rs) {
  const n = rs.length;
  const count = (f) => rs.filter(f).length;
  const kinds = (xs) => Object.fromEntries(['bankruptcy', 'monopoly', 'assets'].map((k) => [k, xs.filter((r) => r.winner.kind === k).length]));
  const monopolyByContinent = Object.fromEntries(CONTINENTS.map((k) => [k, count((r) => r.monopoly.includes(k))]));
  const zeroWins = rs.filter((r) => r.zeroWon);
  const majorHits = Object.fromEntries(MAJORS.map((m) => [m, count((r) => r.majors.includes(m))]));
  return {
    games: n, seed: SEED, minutes: MINUTES, zeroBot: ZERO,
    humans: HUMANS, humanAcc: HUMANS ? HUMAN_ACC : null, botAcc: BOT_RANGE, botAccOverride: !!BOT_ACC_ARG,
    humanWinRate: HUMANS ? count((r) => r.humanWon) / n : null,
    gapTop2Ge480Rate: count((r) => r.gapTop2 >= 480) / n,
    gapTop2Median: [...rs.map((r) => r.gapTop2)].sort((x, y) => x - y)[Math.floor(n / 2)],
    /** 하위 20% 판의 1·2위 차 — "차 ≥ G 인 판 ≥ 80%" 가 성립하는 가장 큰 G */
    gapTop2P20: [...rs.map((r) => r.gapTop2)].sort((x, y) => x - y)[Math.floor(n * 0.2)],
    winKinds: kinds(rs),
    zeroBotWinRate: ZERO ? zeroWins.length / n : null,
    zeroBotWinKinds: ZERO ? kinds(zeroWins) : null,
    monopolyPath: ZERO && zeroWins.length > 0 && kinds(zeroWins).monopoly * 2 > zeroWins.length,
    monopolyByContinent,
    bankruptHalf: Object.fromEntries([0, 1, 2, 3].map((k) => [k, count((r) => r.bankruptHalf === k)])),
    bankruptHalfLe1Rate: count((r) => r.bankruptHalf <= 1) / n,
    salaryAllRate: count((r) => r.salaryAll) / n,
    salaryPlayerRate: rs.reduce((x, r) => x + r.salaryPlayers, 0) / (n * 4),
    buysPerPlayer: rs.reduce((x, r) => x + r.buys, 0) / (n * 4),
    tollsPerGame: rs.reduce((x, r) => x + r.tolls, 0) / n,
    tieTop2Rate: count((r) => r.tieTop2) / n,
    aliveEnd: Object.fromEntries([1, 2, 3, 4].map((k) => [k, count((r) => r.alive === k)])),
    bankruptEndRate: count((r) => r.winner.kind === 'bankruptcy') / n,
    dicePerGame: rs.reduce((x, r) => x + r.turns, 0) / n,
    coverageMajors: count((r) => r.covered) / n,
    /** 참고: 옛 정의(도착 문항만) — QA r6 76.5% 와 비교용 */
    coverageMajorsQuestionOnly: count((r) => r.coveredQ) / n,
    majorHitGames: majorHits,
    repeats: rs.reduce((x, r) => x + r.repeats, 0),
    reviewRepeats: rs.reduce((x, r) => x + r.reviewRepeats, 0),
    buys: rs.reduce((x, r) => x + r.buys, 0),
    takeovers: rs.reduce((x, r) => x + r.takeovers, 0),
    placeholderCountries,
    placeholderQuestionsDrawn: rs.reduce((x, r) => x + r.placeholderDrawn, 0),
    questionsDrawn: rs.reduce((x, r) => x + r.drawn, 0),
  };
}

/** §6 표본 규칙(2026-10-29 QA7)의 비율형 판정: --confirm 이 경계 거리를 보는 항목 */
const RATIO_KEYS = new Set(['zero-win-rate', 'human-win', 'gap-top2', 'tie-top2']);

// ── 판정 ──
/** rs 로 --assert 를 판정한다. values = assert 원문 → 수치, ratios = 비율형 항목의 { raw, value, threshold } */
function judge(rs) {
  const n = rs.length;
  const count = (f) => rs.filter(f).length;
  const report = aggregate(rs);
  const fails = [];
  const lines = [];
  const values = {};
  const ratios = [];
  for (const raw of ASSERT.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = raw.match(/^([a-z0-9-]+)(<=|>=|==)(.+)$/);
    if (!m) { fails.push(`해석 불가: ${raw}`); continue; }
    const [, key, op, val] = m;
    let ok, got, threshold = Number(val);
    const cmp = (x, y) => (op === '<=' ? x <= y : op === '>=' ? x >= y : x === y);
    if (key === 'human-win') {
      if (!HUMANS) { fails.push('human-win 은 --humans 와 함께'); continue; }
      got = report.humanWinRate; ok = cmp(got, Number(val));
    } else if (key === 'gap-top2') {
      const [g, f] = val.split(':').map(Number);
      got = count((r) => r.gapTop2 >= g) / n; ok = got >= f; threshold = f;
    } else if (key === 'zero-win-rate') {
      if (!ZERO) { fails.push('zero-win-rate 는 --zero-bot 과 함께'); continue; }
      got = report.zeroBotWinRate; ok = got <= Number(val);
    } else if (key === 'bankrupt-firsthalf') {
      const [k, f] = val.split(':').map(Number);
      got = count((r) => r.bankruptHalf <= k) / n; ok = got >= f;
    } else if (key === 'salary-all') {
      got = report.salaryAllRate; ok = got >= Number(val);
    } else if (key === 'buys-per-player') {
      got = report.buysPerPlayer; ok = got >= Number(val);
    } else if (key === 'tolls-per-game') {
      got = report.tollsPerGame; ok = got >= Number(val);
    } else if (key === 'tie-top2') {
      got = report.tieTop2Rate; ok = got <= Number(val);
    } else if (key === 'alive-end') {
      const [k, f] = val.split(':').map(Number);
      got = count((r) => r.alive >= k) / n; ok = got >= f;
    } else if (key === 'bankrupt-end') {
      got = report.bankruptEndRate; ok = got <= Number(val);
    } else if (key === 'monopoly-4v5') {
      const total = report.winKinds.monopoly;
      if (total < 10) { lines.push(`PASS ${raw} (표본 부족: 독점승 ${total}판 < 10)`); values[raw] = null; continue; } // PRD S2 표본 하한
      const avgOf = (c) => {
        const ks = CONTINENTS.filter((k) => continentTiles(k).length === c);
        return ks.reduce((x, k) => x + report.monopolyByContinent[k], 0) / Math.max(1, ks.length);
      };
      const four = avgOf(4), five = avgOf(5);
      got = `4칸 대륙 평균 ${four} vs 5칸 대륙 평균 ${five}`;
      ok = four <= parseFloat(val) * five;
      if (!ok) got += " — '건물 1개 이상' 같은 규칙 변경은 하지 말고 사용자에게 보고";
    } else if (key === 'takeovers-per-game') {
      got = report.takeovers / n; ok = got >= Number(val);
    } else if (key === 'coverage-majors') {
      got = report.coverageMajors; ok = got >= Number(val);
    } else if (key === 'repeat') {
      got = report.repeats; ok = got === Number(val);
    } else { fails.push(`모르는 판정: ${key}`); continue; }
    values[raw] = got;
    if (RATIO_KEYS.has(key)) ratios.push({ raw, value: got, threshold });
    if (key === 'zero-win-rate' && !ok) got += ` (승리 유형 ${JSON.stringify(report.zeroBotWinKinds)}${report.monopolyPath ? ', monopoly-path' : ''})`;
    if (key === 'coverage-majors' && !ok && placeholderCountries.length) got += ` (PENDING-T04: 자리표 나라 ${placeholderCountries.length}개)`;
    if (key === 'repeat' && placeholderCountries.length) got += ` (PENDING-T04: 출제 ${report.questionsDrawn}개 중 자리표 문항 ${report.placeholderQuestionsDrawn}개 — 자리표는 재출제 0 이 거의 당연, 진짜 풀로 다시 확인)`;
    (ok ? lines : fails).push(`${ok ? 'PASS' : 'FAIL'} ${raw} — ${got}`);
  }
  return { report, lines, fails, values, ratios };
}

const results = Array.from({ length: GAMES }, (_, g) => playGame(g));
const first = judge(results);
let { report, lines, fails } = first;
if (CONFIRM) {
  // §6 표본 규칙: 비율형 하나라도 경계 ±M 안이면 같은 시드로 N 판(처음 GAMES 판 + 이어서 GAMES..N−1 — 판 g 는 시드·g 로만 정해져 --games N 과 같다)
  const near = first.ratios.filter((r) => Math.abs(r.value - r.threshold) <= CONFIRM.margin + 1e-9);
  const verdict = (j) => Object.fromEntries([...j.lines, ...j.fails].map((l) => [l.replace(/^(PASS|FAIL) /, '').split(/ — | \(/)[0], l.startsWith('PASS') ? 'PASS' : 'FAIL']));
  let final = first;
  if (near.length) {
    for (let g = GAMES; g < CONFIRM.games; g++) results.push(playGame(g));
    final = judge(results);
  }
  ({ report, lines, fails } = final);
  report.confirm = {
    rule: `${CONFIRM.games}:${CONFIRM.margin}`, triggered: near.length > 0, near: near.map((r) => r.raw),
    firstGames: GAMES, games: results.length,
    firstPass: first.values, finalPass: final.values,
    firstVerdict: verdict(first), finalVerdict: verdict(final),
  };
  lines.unshift(near.length
    ? `CONFIRM ${GAMES}판 → ${results.length}판 (경계 ±${CONFIRM.margin} 안: ${near.map((r) => `${r.raw} = ${r.value}`).join(', ')}) — 판정은 ${results.length}판 값`
    : `CONFIRM 발동 안 함 (${GAMES}판 비율형 값이 모두 경계 ±${CONFIRM.margin} 밖) — 판정은 ${GAMES}판 값`);
}

if (JSON_OUT) console.log(JSON.stringify(report));
else {
  console.log(JSON.stringify(report, null, 2));
  if (placeholderCountries.length) console.error(`주의: 카드 없는 나라 ${placeholderCountries.length}개를 빈 자리표로 채움 (${placeholderCountries.join(' ')})`);
}
for (const l of lines) console.error(l);
for (const l of fails) console.error(l.startsWith('FAIL') ? l : `FAIL ${l}`);
process.exit(fails.length ? 1 : 0);
