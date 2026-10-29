#!/usr/bin/env node
// 앱 화면에 나오는 한글 문구를 한 파일로 뽑는다 (PRD S11). 사용: extract-strings.mjs [--src <폴더>] [--out <파일>]
// 범위: src/data/*.json 의 한글 문자열 전부 + src/**/*.tsx 와 src/audio/*.ts 의 한글 문자열 리터럴·JSX 텍스트.
// 파일은 실행 때마다 훑으므로 나중에 생기는 화면(tsx)도 자동으로 들어온다.
// shortcut: 리터럴 스캐너는 정규식 수준이라 JSX 텍스트 안의 홑따옴표(')에서 틀릴 수 있다, 한글 문구에 쓰이면 파서로 교체.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HANGUL = /[가-힣]/;
const SKIP = /(\.test\.|\.spec\.|[\\/]__tests__[\\/]|[\\/]dev[\\/]|harness\.tsx$)/;

function walk(dir, ok) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, ok) : ok(p) ? [p] : [];
  });
}

// 주석을 지우고, 문자열 리터럴은 따로 모으고 코드에선 같은 길이 공백으로 바꾼다(JSX 텍스트 검색용).
export function scanCode(src) {
  const lits = [];
  let code = '';
  let line = 1;
  let i = 0;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === '//') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = src.length;
      code += ' '.repeat(j - i);
      i = j;
    } else if (two === '/*') {
      let j = src.indexOf('*/', i + 2);
      j = j < 0 ? src.length : j + 2;
      const seg = src.slice(i, j);
      code += blank(seg);
      line += (seg.match(/\n/g) || []).length;
      i = j;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && (c === '`' || src[j] !== '\n')) {
        if (c === '`' && src[j] === '$' && src[j + 1] === '{') {
          // ${…} 안의 따옴표·백틱은 건너뛴다 (중괄호 균형만 본다)
          for (let d = 0; j < src.length; j++) {
            d += src[j] === '{' ? 1 : src[j] === '}' ? -1 : 0;
            if (d === 0 && src[j] === '}') break;
          }
        }
        j += src[j] === '\\' ? 2 : 1;
      }
      const seg = src.slice(i, Math.min(j + 1, src.length));
      lits.push({ pos: i, line, text: seg.slice(1, seg.endsWith(c) && seg.length > 1 ? -1 : undefined) });
      code += blank(seg);
      line += (seg.match(/\n/g) || []).length;
      i = j + 1;
    } else {
      if (c === '\n') line++;
      code += c;
      i++;
    }
  }
  return { lits, code };
}

export function extractFromCode(src) {
  const { lits, code } = scanCode(src);
  // console.* 와 그 래퍼 warnOnce(manifest.ts, console.warn 을 키당 1회 부름) 호출 인수는 개발자용이라 화면에 안 나온다 — 괄호 범위를 구해 그 안의 리터럴은 뺀다.
  const dev = [];
  for (const m of code.matchAll(/\b(?:console\s*\.\s*\w+|warnOnce)\s*\(/g)) {
    let d = 0, k = m.index + m[0].length - 1;
    for (; k < code.length; k++) { d += code[k] === '(' ? 1 : code[k] === ')' ? -1 : 0; if (d === 0) break; }
    dev.push([m.index, k]);
  }
  const out = lits.filter((l) => HANGUL.test(l.text) && !dev.some(([a, b]) => l.pos > a && l.pos < b)).map((l) => ({ line: l.line, text: l.text.replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim() }));
  // JSX 텍스트: > 와 < 사이를 한 항목으로. {식} 은 {…} 자리표시로 바꾼다 (=> 는 건너뜀).
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '>' || code[i - 1] === '=') continue;
    let j = i + 1;
    let text = '';
    for (; j < code.length && code[j] !== '<' && code[j] !== '>'; j++) {
      if (code[j] !== '{') { text += code[j]; continue; }
      let d = 0, k = j;
      for (; k < code.length; k++) { d += code[k] === '{' ? 1 : code[k] === '}' ? -1 : 0; if (d === 0) break; }
      if (code.slice(j + 1, k).trim()) text += '{…}'; // 주석만 든 {} 는 버린다
      j = k;
    }
    if (code[j] !== '<' || !HANGUL.test(text.replace(/\{…\}/g, ''))) continue;
    const first = i + 1 + (code.slice(i + 1).search(/\S/));
    out.push({ line: code.slice(0, first).split('\n').length, text: text.replace(/\s+/g, ' ').trim() });
    i = j - 1;
  }
  return out;
}

function walkJson(v, p, emit) {
  if (typeof v === 'string') HANGUL.test(v) && emit(p, v.trim());
  else if (Array.isArray(v)) v.forEach((x, k) => walkJson(x, `${p}[${k}]`, emit));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) walkJson(v[k], p ? `${p}.${k}` : k, emit);
}

export function extract(srcDir) {
  const items = [];
  const rel = (f) => path.relative(srcDir, f).split(path.sep).join('/');
  const add = (src, text) => items.push({ id: `s${String(items.length + 1).padStart(4, '0')}`, src, text });
  for (const f of walk(path.join(srcDir, 'data'), (p) => p.endsWith('.json')).sort()) {
    walkJson(JSON.parse(fs.readFileSync(f, 'utf8')), '', (p, t) => add(`${rel(f)}:${p}`, t));
  }
  const codeFiles = walk(srcDir, (p) => (p.endsWith('.tsx') || (p.endsWith('.ts') && rel(p).startsWith('audio/'))) && !SKIP.test(p)).sort();
  for (const f of codeFiles) {
    for (const { line, text } of extractFromCode(fs.readFileSync(f, 'utf8'))) add(`${rel(f)}:${line}`, text);
  }
  return items;
}

const byFile = (items) => items.reduce((o, it) => ((o[it.src.split(':')[0]] = (o[it.src.split(':')[0]] || 0) + 1), o), {});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const arg = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined);
  const src = path.resolve(arg('--src') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../src'));
  const out = arg('--out');
  if (!out) { console.error('--out <파일> 필요'); process.exit(2); }
  const items = extract(src);
  const dist = byFile(items);
  fs.writeFileSync(out, JSON.stringify({ count: items.length, byFile: dist, items }, null, 2) + '\n');
  console.log(`항목 ${items.length}개 → ${out}`);
  for (const [f, n] of Object.entries(dist)) console.log(`  ${String(n).padStart(5)}  ${f}`);
}
