#!/usr/bin/env node
// 문항 원본(출처 포함) → src/data/ (출처 제거, 키 정렬, LF). 사용: --src <원본 폴더> --out <출력 폴더>
// 보관 나라(ARCHIVED)는 원본에 그대로 두고 출력에서만 뺀다(PRD §3.3, 2026-10-26 판 재설계 — 되돌릴 수 있게).
import fs from 'node:fs';
import path from 'node:path';

const FILES = ['cards.json', 'questions.json', 'tf.json', 'missions.json', 'culture-cards.json'];
const STRIP = new Set(['sources', 'sourceRef']);
// PRD S6 과 같은 패턴. 출력에 걸리면 빌드 실패.
const LEAK = /지도서|교과서|\[MCP|\[6사|\[4사|pp?\.[ ]?[0-9]/;
// 판에서 뺀 나라: 잠비아·페루(해설 카드·문항·참/거짓), 뉴질랜드(문화 카드).
const ARCHIVED = ['zm', 'pe', 'nz'];

/** 보관 나라 항목을 뺀다. 카드·문화 카드는 country, 문항·참/거짓은 cardId 의 카드 country 로 판정 */
function dropArchived(f, data, cardCountry) {
  if (!Array.isArray(data)) return data;
  const gone = (c) => ARCHIVED.includes(c);
  if (f === 'cards.json' || f === 'culture-cards.json') return data.filter((x) => !gone(x.country));
  if (f === 'questions.json' || f === 'tf.json') return data.filter((x) => !gone(cardCountry.get(x.cardId)));
  return data; // missions: 나라 칸과 무관(PRD §5 4.3)
}
// 출력 글에 보관 나라 id 가 남았는지(카드 id "zm-1", 문화 카드 "cc-nz", country 값 "pe").
const ARCHIVED_ID = new RegExp(`"(?:${ARCHIVED.join('|')})(?:-[0-9a-z-]+)?"|"cc-(?:${ARCHIVED.join('|')})"`);

function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) if (!STRIP.has(k)) o[k] = strip(v[k]);
    return o;
  }
  return v;
}

function main() {
  const a = process.argv.slice(2);
  const arg = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined);
  const src = arg('--src');
  const out = arg('--out');
  if (!src || !out) {
    console.error('사용: build-content.mjs --src <원본 폴더> --out <출력 폴더>');
    process.exit(2);
  }
  // 전부 메모리에서 만들고, 하나라도 실패하면 아무것도 쓰지 않는다.
  const built = [];
  const errs = [];
  let cardCountry = new Map();
  try { cardCountry = new Map(JSON.parse(fs.readFileSync(path.join(src, 'cards.json'), 'utf8')).map((c) => [c.id, c.country])); } catch { /* 아래 루프가 [missing]·[parse] 로 알린다 */ }
  for (const f of FILES) {
    const fp = path.join(src, f);
    if (!fs.existsSync(fp)) { errs.push(`[missing] ${fp}`); continue; }
    let data;
    try { data = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { errs.push(`[parse] ${fp}: ${e.message}`); continue; }
    const text = JSON.stringify(strip(dropArchived(f, data, cardCountry)), null, 2) + '\n';
    const m = text.match(LEAK);
    const a = text.match(ARCHIVED_ID);
    if (m) errs.push(`[leak] ${f}: 출처 표현이 값에 남아 있음: ${m[0]}`);
    else if (a) errs.push(`[archived] ${f}: 보관 나라 id 가 남아 있음: ${a[0]}`);
    else built.push([f, text]);
  }
  if (errs.length) {
    console.error(errs.join('\n'));
    process.exit(1);
  }
  fs.mkdirSync(out, { recursive: true });
  for (const [f, text] of built) {
    fs.writeFileSync(path.join(out, f), text);
    console.log(`${f} → ${path.join(out, f)}`);
  }
}

main();
