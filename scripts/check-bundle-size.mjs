// 첫 로드 예산(PRD §11): dist/index.html 이 직접 참조하는 js·css 만 합산. 지연 청크·이미지·외부 URL 제외.
// 사용: node scripts/check-bundle-size.mjs --max-kb 3072
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const i = process.argv.indexOf('--max-kb');
const maxKb = Number(i > 0 ? process.argv[i + 1] : 3072);
if (!(maxKb > 0)) { console.error('--max-kb 는 양수'); process.exit(2); }

let html;
try { html = readFileSync('dist/index.html', 'utf8'); }
catch { console.error('check-bundle-size: dist/index.html 없음 — 먼저 npm run build'); process.exit(1); }

const refs = new Set();
for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) refs.add(m[1]);
for (const m of html.matchAll(/<link\b[^>]*>/g)) {
  const tag = m[0];
  const href = tag.match(/\bhref="([^"]+)"/)?.[1];
  if (href && /\brel="(stylesheet|modulepreload)"/.test(tag)) refs.add(href);
}

const local = [...refs].filter((ref) => !/^(https?:)?\/\//.test(ref)); // 외부(글꼴 CSS)는 dist 밖
if (!local.length) { console.error('check-bundle-size: dist/index.html 에서 js·css 참조를 하나도 못 찾음'); process.exit(1); }

let total = 0;
for (const ref of local) {
  const file = join('dist', ref.replace(/^\//, '').split(/[?#]/)[0]);
  const size = statSync(file).size; // 없으면 throw → exit 1
  total += size;
  console.log(`${(size / 1024).toFixed(1).padStart(8)} KB  ${ref}`);
}
const kb = total / 1024;
console.log(`합계 ${kb.toFixed(1)} KB / 예산 ${maxKb} KB`);
if (kb > maxKb) { console.error('check-bundle-size: 예산 초과'); process.exit(1); }
