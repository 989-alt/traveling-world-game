#!/usr/bin/env node
// 문항 풀 정적 검사 (PRD S4). 사용: check-content.mjs [--src <폴더>] [--schema <파일>] [--schema-only]
// --schema-only: 풀 전체를 모아야 풀리는 집계 조건(개수·M 태그 수·분석 미션 수·생각 그물·정답 위치 분포)만 건너뛴다.
// 보관 나라(ARCHIVED)는 원본에 남아 있어도 빌드처럼 빼고 센다. --data <폴더>(기본 src/data)에 보관 나라 id 가 0건인지도 본다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const arg = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined);
const SRC = arg('--src') ?? path.resolve(HERE, '../../docs/traveling-world/문항');
const SCHEMA = arg('--schema') ?? path.resolve(HERE, '../../docs/traveling-world/문항/schema.json');
const SCHEMA_ONLY = a.includes('--schema-only');
const DATA = arg('--data') ?? path.resolve(HERE, '../src/data');

// ---- 상수 (PRD 와 교과분석에서 옮겨 온 값) ----
// 2026-10-26 판 재설계(PRD §3.3·§6 S4): 여행지 22 + 한국(출발 칸 탐험) = 해설 카드 나라 23. 잠비아·페루·뉴질랜드는 보관.
const ARCHIVED = ['zm', 'pe', 'nz'];
const COUNTRIES = ['ph', 'th', 'sa', 'np', 'cn', 'kr', 'it', 'fr', 'ch', 'no', 'ru', 'cd', 'tz', 'et', 'eg', 'mx', 'us', 'ca', 'gl', 'ec', 'br', 'cl', 'ar'];
const CULTURE_COUNTRIES = [...COUNTRIES, 'au'];
const N = { cards: 94, questions: 276, antarcticaQuestions: 6, missions: 40, culture: 24, analytic: 12 };
// PRD §5 10.4 행: 페루 L2~L4 보관 뒤에도 고산 생활(10.4) 문항이 3개 이상 남아야 한다.
const TOPIC_MIN = { '10.4': 3 };
// 생각 그물 키워드 (PRD 13.1 = 교과분석 13.1 + 기후 분포 순서의 다섯 기후). 공백을 뺀 문자열로 비교한다.
const THINK_NET = ['산지', '하천', '해안', '사막', '계단식 농사', '스키장', '광업', '온천', '어업', '대규모 농사', '수력 발전', '수상 시장', '양식업', '항구', '관광지', '염전', '열대', '건조', '온대', '냉대', '한대'];
// 금지어 (PRD §13). 라틴 문자 기호는 앞뒤가 영문이 아닐 때만 쾨펜 기호로 본다.
const LEAK = /지도서|교과서|\[MCP|\[6사|\[4사|pp?\.[ ]?[0-9]/; // PRD S6 과 같은 패턴. 본문에만 건다
const BANNED = [/벌금/, /패널티/, /틀렸습니다/, /덴마크령/, /그린란드라는 나라/, /덴마크의 땅/, /셰르파(?!족)/, /툰드라/, /스텝/, /아열대/, /빙설/, /대륙성/, /(?<![A-Za-z])(Af|Am|Aw|BWh|BWk|BW|BSh|BSk|BS|Cfa|Cfb|Cfc|Csa|Csb|Cwa|Cwb|Dfa|Dfb|Dfc|Dfd|Dwa|Dwb|Dwc|ET|EF)(?![A-Za-z])/];
// 미션 explain 에만 거는 말투(합쇼체·끝맺음 없는 '~만'). 문항 선지엔 걸지 않는다
const EXPLAIN_BANNED = [/입니다/, /합니다/, /습니다/, /만$/];
const SKIP_KEYS = new Set(['id', 'cardId', 'country', 'image', 'image2', 'kind', 'type', 'continent', 'origin', 'topics', 'mTags', 'sources', 'sourceRef']);

// PRD §7: M6·M12 는 참/거짓 전용. 선지에 붙이면 실패, 오답 선지 ≥3 조건은 면제.
const TF_ONLY = ['M6', 'M12'];

const errs = [];
const fail = (code, msg) => errs.push(`[${code}] ${msg}`);
const len = (s) => [...s].length;
const norm = (s) => s.replace(/\s+/g, '');

// ---- 작은 스키마 검사기 ----
function validate(v, s, p, root) {
  if (s.$ref) return validate(v, s.$ref.slice(2).split('/').reduce((o, k) => o[k], root), p, root);
  const t = s.type;
  const ok = !t || (t === 'array' ? Array.isArray(v) : t === 'integer' ? Number.isInteger(v) : t === 'object' ? v && typeof v === 'object' && !Array.isArray(v) : typeof v === t);
  if (!ok) return fail('schema', `${p}: 타입 ${t} 아님`);
  if (s.enum && !s.enum.includes(v)) fail('schema', `${p}: ${JSON.stringify(v)} 는 허용값 아님`);
  if (typeof v === 'string') {
    if (s.minLength !== undefined && len(v) < s.minLength) fail('schema', `${p}: ${s.minLength}자 미만`);
    if (s.maxLength !== undefined && len(v) > s.maxLength) fail('length', `${p}: ${len(v)}자 > 상한 ${s.maxLength} ("${v}")`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) fail('schema', `${p}: 형식 불일치 "${v}"`);
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) fail('schema', `${p}: ${v} < ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) fail('schema', `${p}: ${v} > ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) fail('schema', `${p}: 항목 ${v.length}개 < ${s.minItems}`);
    if (s.maxItems !== undefined && v.length > s.maxItems) fail('schema', `${p}: 항목 ${v.length}개 > ${s.maxItems}`);
    if (s.items) v.forEach((x, i) => validate(x, s.items, `${p}[${i}]`, root));
  } else if (t === 'object') {
    for (const k of s.required ?? []) if (!(k in v)) fail('schema', `${p}: 필수 필드 ${k} 없음`);
    for (const k of Object.keys(v)) {
      if (s.properties?.[k]) validate(v[k], s.properties[k], `${p}.${k}`, root);
      else if (s.additionalProperties === false) fail('schema', `${p}: 정의에 없는 필드 ${k}`);
    }
  }
}

// ---- 읽기 ----
let schema;
try { schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8')); } catch (e) { console.error(`스키마 읽기 실패: ${SCHEMA}: ${e.message}`); process.exit(1); }
// --schema-only: 없는 파일·빈 파일은 건너뛴다(부분 폴더 검사). 풀 검사: 없으면 [missing] 실패.
let present = 0;
const load = (f) => {
  const fp = path.join(SRC, f);
  if (!fs.existsSync(fp) || (SCHEMA_ONLY && !fs.readFileSync(fp, 'utf8').trim())) {
    if (!SCHEMA_ONLY) fail('missing', `${f}: 파일 없음`);
    return [];
  }
  try {
    const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (Array.isArray(d) && d.length) present++;
    if (!Array.isArray(d)) fail('schema', `${f}: 배열이 아님`);
    return Array.isArray(d) ? d : [];
  } catch (e) { fail('schema', `${f}: 읽기 실패 ${e.message}`); return []; }
};
// 원본 그대로 읽고, 보관 나라만 뺀다(build-content.mjs 와 같은 규칙).
const gone = (c) => ARCHIVED.includes(c);
const cards = load('cards.json').filter((x) => !gone(x?.country));
const keptCard = new Set(cards.map((c) => c?.id));
const archivedCard = (x) => !keptCard.has(x?.cardId) && gone(String(x?.cardId ?? '').split('-')[0]);
const questions = load('questions.json').filter((x) => !archivedCard(x));
const tfs = load('tf.json').filter((x) => !archivedCard(x));
const missions = load('missions.json');
const culture = load('culture-cards.json').filter((x) => !gone(x?.country));
if (SCHEMA_ONLY && !present) fail('missing', `${SRC}: 검사할 파일이 하나도 없음`);
// 파일 사이 규칙은 필요한 파일이 모두 있을 때만 돈다(풀 검사는 항상).
const has = (...a) => !SCHEMA_ONLY || a.every((x) => x.length);
const sets = [[cards, 'explanationCard', 'cards'], [questions, 'question', 'questions'], [tfs, 'tfStatement', 'tf'], [missions, 'mission', 'missions'], [culture, 'cultureCard', 'culture-cards']];
for (const [arr, key, name] of sets) {
  arr.forEach((x, i) => validate(x, schema[key], `${name}[${i}](${x?.id ?? '?'})`, schema));
  const seen = new Set();
  for (const x of arr) { if (seen.has(x?.id)) fail('dup', `${name}: id 중복 ${x.id}`); seen.add(x?.id); }
}
if (errs.length) done(); // 모양이 틀리면 뒤 검사를 믿을 수 없다

// ---- 항목별 규칙 (--schema-only 에도 적용) ----
const cardById = new Map(cards.map((c) => [c.id, c]));
for (const c of cards) {
  const want = c.country === 'aq' ? /^aq-s[12]$/ : new RegExp(`^${c.country}-${c.level}$`);
  if (!want.test(c.id)) fail('card-id', `${c.id}: id 가 country·level 과 안 맞음`);
  if (c.country === 'aq' && c.level !== 1) fail('card-id', `${c.id}: 남극 카드 level 은 1`);
  if (c.level === 4 && !c.image2) fail('card-image2', `${c.id}: 4단계는 image2 (자료 2개 나란히) 필요`);
  // 2026-10-29 U5(lang-review-10): 비교 종류 꼬리표는 4단계 비교 카드만, 글자 머리말 '공통점:·차이점:' 대신
  if (c.reasonKinds && c.level !== 4) fail('reason-kinds', `${c.id}: reasonKinds 는 4단계 비교 카드만`);
  if (c.reasonKinds && (c.reasons ?? []).some((r) => /^(공통점|차이점)\s*[:：]/.test(r))) fail('reason-kinds', `${c.id}: 꼬리표가 있는데 글자 머리말이 남음`);
  if (c.country === 'gl' && c.level === 1 && !c.answer.includes('자치')) fail('greenland', `${c.id}: 첫 줄(answer)에 '자치' 없음`);
}
const byCard = (arr) => { const m = new Map(); for (const x of arr) { if (!m.has(x.cardId)) m.set(x.cardId, []); m.get(x.cardId).push(x); } return m; };
if (has(cards)) for (const x of [...questions, ...tfs]) if (!cardById.has(x.cardId)) fail('card-ref', `${x.id}: cardId ${x.cardId} 카드 없음`);
const qByCard = byCard(questions);
const tByCard = byCard(tfs);
for (const c of cards) {
  const qs = qByCard.get(c.id) ?? [];
  if (has(questions)) {
  const kinds = qs.map((q) => q.kind).sort().join(',');
  if (kinds !== 'initial,review,review') fail('q-per-card', `${c.id}: 문항 구성이 initial 1 + review 2 가 아님 (${kinds || '없음'})`);
  const texts = qs.map((q) => q.choices[q.answer].text);
  if (new Set(texts).size !== texts.length) fail('q-answer-dup', `${c.id}: 세 문항의 정답 문장이 서로 같음`);
  }
  const ts = tByCard.get(c.id) ?? [];
  if (has(tfs) && (ts.length < 2 || !ts.some((t) => t.answer) || !ts.some((t) => !t.answer))) fail('tf-per-card', `${c.id}: 참/거짓은 카드마다 참 1 + 거짓 1 이상 (지금 ${ts.length}개)`);
}
for (const q of questions) {
  const c = cardById.get(q.cardId);
  if (c && c.level !== q.level) fail('q-level', `${q.id}: level ${q.level} ≠ 카드 level ${c.level}`);
  if (new Set(q.choices.map((x) => norm(x.text))).size !== 4) fail('q-choices', `${q.id}: 선지 문장 중복`);
  if (q.choices[q.answer].mTags?.length) fail('q-correct-mtag', `${q.id}: 정답 선지에 mTags 금지`);
  for (const x of q.choices) for (const m of x.mTags ?? []) if (TF_ONLY.includes(m)) fail('m-tf-only', `${q.id}: ${m} 는 참/거짓 전용인데 선지에 붙음`);
  if (q.level >= 2 && !q.choices.some((x, i) => i !== q.answer && x.mTags?.length)) fail('q-mtag', `${q.id}: ${q.level}단계 문항인데 오답 선지 mTags 없음`);
  if ([q.stem, ...q.choices.map((x) => x.text)].some((s) => /몇\s*도/.test(s))) fail('degrees', `${q.id}: '몇 도' 위치 문항`);
}
for (const t of tfs) if (!t.answer && !t.mTags.length) fail('tf-mtag', `${t.id}: 거짓 문장은 mTags 필수`);
for (const m of missions) {
  const need = { connect: 'pairs', block: 'pairs', order: 'steps', photo: 'options', graph: 'options' }[m.type];
  if (!m[need]) fail('mission-shape', `${m.id}: ${m.type} 미션은 ${need} 필요`);
  if (m.options && !m.options.some((o) => o.correct)) fail('mission-shape', `${m.id}: 정답 option 없음`);
  if (m.type === 'photo' && m.options?.some((o) => !o.image)) fail('mission-shape', `${m.id}: photo 미션은 option 마다 image`);
  if (m.type === 'graph' && !m.image) fail('mission-shape', `${m.id}: graph 미션은 image`);
  if (!m.spectatorTf.answer && !m.spectatorTf.mTags.length) fail('tf-mtag', `${m.id}: 관전 거짓 문장은 mTags 필수`);
  // 실패 해설 explain(PRD §3.5, QA r3). 판정 뒤 실패한 도착자 화면에만 나온다
  if (typeof m.explain !== 'string' || !m.explain.trim()) { fail('mission-explain', `${m.id}: explain 없음`); continue; }
  if (len(m.explain) > 80) fail('length', `${m.id}: explain ${len(m.explain)}자 > 80`);
  if (m.explain.split(/[.!?]\s*/).filter(Boolean).length > 2) fail('mission-explain', `${m.id}: explain 3문장 이상`);
  if ((m.type === 'connect' || m.type === 'block') && m.pairs?.length && m.pairs.every((p) => norm(m.explain).includes(norm(p.right)))) fail('mission-explain', `${m.id}: explain 이 정답을 전부 나열`);
  for (const re of EXPLAIN_BANNED) if (re.test(m.explain)) fail('banned', `${m.id}: explain 금지 말투 ${re} : "${m.explain}"`);
  if (norm(m.explain) === norm(m.spectatorTf.text)) fail('mission-explain', `${m.id}: explain 이 관전 참/거짓 문장과 같음`);
}
const ccCountries = new Set(culture.map((c) => c.country));
if (ccCountries.size !== culture.length) fail('culture-dup', '문화 카드 country 중복');
const textsOf = (o, out = []) => {
  if (typeof o === 'string') out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => textsOf(x, out));
  else if (o && typeof o === 'object') for (const k of Object.keys(o)) if (!SKIP_KEYS.has(k)) textsOf(o[k], out);
  return out;
};
const questionText = norm([...questions, ...tfs.map((t) => t.text), ...missions.map((m) => m.spectatorTf.text)].flatMap((x) => (typeof x === 'string' ? [x] : textsOf(x))).join('\n'));
let sourceMd = null;
for (const c of culture) {
  if (c.country === 'gl' && !c.note?.includes('자치')) fail('greenland', `${c.id}: 보조 줄(note)에 '자치' 없음 (예: 덴마크 자치령)`);
  if (!c.badge) continue;
  if (questionText.includes(norm(c.badge.name))) fail('badge-leak', `${c.id}: 맛보기 뱃지 '${c.badge.name}' 가 문항·참/거짓에 나옴`);
  if (c.badge.origin === 'outside') {
    sourceMd ??= fs.existsSync(path.join(SRC, '맛보기-출처.md')) ? fs.readFileSync(path.join(SRC, '맛보기-출처.md'), 'utf8') : '';
    if (!sourceMd.includes(c.badge.id)) fail('badge-source', `${c.id}: 지도서 밖 뱃지 ${c.badge.id} 가 맛보기-출처.md 에 없음 (없으면 뱃지를 생략)`);
  }
}
const allText = [cards, questions, tfs, missions, culture].flatMap((x) => textsOf(x));
for (const s of allText) if (LEAK.test(s)) fail('leak', `본문에 출처 표현 ${s.match(LEAK)[0]} : "${s}"`);
for (const s of allText) for (const re of BANNED) if (re.test(s)) fail('banned', `금지어 ${re} : "${s}"`);

// ---- 집계 규칙 (풀 전체) ----
if (!SCHEMA_ONLY) {
  const exp = (name, got, want) => got !== want && fail('count', `${name} ${got}개 ≠ ${want}`);
  exp('해설 카드', cards.length, N.cards);
  exp('문항(남극 제외)', questions.filter((q) => cardById.get(q.cardId)?.country !== 'aq').length, N.questions);
  exp('문항(남극)', questions.filter((q) => cardById.get(q.cardId)?.country === 'aq').length, N.antarcticaQuestions);
  exp('미션', missions.length, N.missions);
  exp('문화 카드', culture.length, N.culture);
  for (const c of COUNTRIES) if (cards.filter((x) => x.country === c).length !== 4) fail('count', `${c}: 해설 카드 4장(1~4단계) 아님`);
  if (cards.filter((x) => x.country === 'aq').length !== 2) fail('count', 'aq: 해설 카드 2장 아님');
  for (const c of CULTURE_COUNTRIES) if (!ccCountries.has(c)) fail('count', `${c}: 문화 카드 없음`);
  for (let i = 1; i <= 22; i++) {
    const m = `M${i}`;
    const wrong = questions.reduce((n, q) => n + q.choices.filter((x, k) => k !== q.answer && x.mTags?.includes(m)).length, 0);
    const tf = tfs.filter((t) => t.mTags.includes(m)).length;
    if (!TF_ONLY.includes(m) && wrong < 3) fail('m-wrong', `${m}: 오답 선지 ${wrong}개 < 3`);
    if (tf < 2) fail('m-tf', `${m}: 참/거짓 ${tf}개 < 2`);
  }
  for (const [t, min] of Object.entries(TOPIC_MIN)) {
    const n = questions.filter((q) => q.topics.includes(t)).length;
    if (n < min) fail('topic', `topic:${t} 문항 ${n}개 < ${min} (Fable 보강 필요)`);
  }
  // 빌드 산출(src/data)에 보관 나라 id 0건
  const ARCHIVED_ID = new RegExp(`"(?:cc-)?(?:${ARCHIVED.join('|')})(?:-[0-9a-z-]+)?"`);
  if (!fs.existsSync(DATA)) fail('archived', `${DATA}: 빌드 산출 폴더 없음`);
  else for (const f of fs.readdirSync(DATA).filter((x) => x.endsWith('.json'))) {
    const m = fs.readFileSync(path.join(DATA, f), 'utf8').match(ARCHIVED_ID);
    if (m) fail('archived', `${path.join(DATA, f)}: 보관 나라 id ${m[0]} 가 남아 있음 (build-content.mjs 를 다시 돌릴 것)`);
  }
  const an = missions.filter((m) => m.analytic).length;
  if (an < N.analytic) fail('analytic', `비교·분석 미션 ${an}개 < ${N.analytic}`);
  const qText = questions.flatMap((q) => [q.stem, ...q.choices.map((x) => x.text)]).join('\n');
  // 공백을 지우지 않는다("한 대" 가 "한대" 로 잡히면 안 됨). 키워드 안 공백은 0개 이상 공백 허용, 두 글자 키워드는 앞이 한글이 아닐 때만.
  const kwRe = (k) => new RegExp((k.length <= 2 ? '(?<![가-힣])' : '') + k.split(' ').join('\\s*'));
  for (const k of THINK_NET) if (!kwRe(k).test(qText)) fail('think-net', `생각 그물 키워드 '${k}' 가 어떤 문항에도 없음`);
  const four = questions.length;
  for (let p = 0; p < 4; p++) {
    const r = questions.filter((q) => q.answer === p).length / (four || 1);
    if (r < 0.15 || r > 0.35) fail('answer-pos', `정답 위치 ${p + 1}번 ${(r * 100).toFixed(1)}% (15~35% 밖)`);
  }
}

function done() {
  if (errs.length) {
    console.error(errs.join('\n'));
    console.error(`\ncheck-content: 실패 ${errs.length}건${SCHEMA_ONLY ? ' (schema-only)' : ''}`);
    process.exit(1);
  }
  console.log(`check-content: 통과${SCHEMA_ONLY ? ' (schema-only)' : ''} — 카드 ${cards.length} · 문항 ${questions.length} · 참/거짓 ${tfs.length} · 미션 ${missions.length} · 문화 ${culture.length}`);
}
done();
