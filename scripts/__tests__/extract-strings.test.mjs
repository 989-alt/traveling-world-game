// extract-strings.mjs 와 lang-review.sh 판정·한도 대체 검사. 실행: node traveling-world/scripts/__tests__/extract-strings.test.mjs
// 실제 GPT/agy 는 부르지 않는다 — PATH 앞에 가짜 codex/agy 를 둔다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extract, extractFromCode } from '../extract-strings.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SH = path.resolve(HERE, '../lang-review.sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-review-test-'));
const write = (f, s) => (fs.mkdirSync(path.dirname(f), { recursive: true }), fs.writeFileSync(f, s));

// 1. 코드 추출: 리터럴·JSX 텍스트·템플릿 중첩 포함, 주석·한글 없는 문자열 제외
const code = `// 주석 한글은 뺀다
/* 블록 주석 한글 */
const a = '안녕해요';
const b = "english only";
const c = \`\${x ? '중첩' : ''} 남았어요\`;
export const V = () => <p>화면 문구예요</p>;
`;
const got = extractFromCode(code).map((x) => x.text);
assert.deepEqual(got.sort(), ['안녕해요', "${x ? '중첩' : ''} 남았어요", '화면 문구예요'].sort());
assert.equal(extractFromCode(code).find((x) => x.text === '안녕해요').line, 3);

// 1b. JSX 텍스트가 {식} 옆에 있어도 한 항목으로 잡힌다
const jsx = (c) => extractFromCode(c).map((x) => x.text);
assert.deepEqual(jsx('<b>{name}님이 도착했어요</b>'), ['{…}님이 도착했어요']);
assert.deepEqual(jsx('<p>점수는 {n}점이에요</p>'), ['점수는 {…}점이에요']);
assert.deepEqual(jsx('<p>{n}점 얻었어요</p>'), ['{…}점 얻었어요']);
assert.deepEqual(jsx('const f = (v) => v > 1; <i>{l.map((v) => v.a)}개예요</i>'), ['{…}개예요']);

// 1c. console.* 인수(개발자용)는 뺀다. 같은 줄의 화면 문구는 남는다
assert.deepEqual(jsx('console.warn(`로드 실패 ${url}`, "또"); console.error("에러"); warnOnce(k, `경고 ${u}`); const a = "화면"; <p>보임</p>'), ['화면', '보임']);

// 2. 폴더 추출: json 경로·ui·audio 포함, 테스트·dev 제외, 나중에 생긴 화면도 잡힘
const src = path.join(tmp, 'src');
write(path.join(src, 'data/q.json'), JSON.stringify([{ id: 'x', stem: '문항이에요', choices: ['가', 'b'] }]));
write(path.join(src, 'ui/A.tsx'), 'export const A = () => <b>첫 화면</b>;');
write(path.join(src, 'ui/A.test.tsx'), 'const t = "테스트 문구";');
write(path.join(src, 'dev/h.tsx'), 'const t = "개발용";');
write(path.join(src, 'audio/s.ts'), 'export const label = "효과음 이름";');
let items = extract(src);
assert.deepEqual(items.map((i) => i.src), ['data/q.json:[0].stem', 'data/q.json:[0].choices[0]', 'audio/s.ts:1', 'ui/A.tsx:1']);
write(path.join(src, 'ui/screens/Late.tsx'), 'export const L = () => <h1>늦게 생긴 화면</h1>;');
items = extract(src);
assert.ok(items.some((i) => i.src === 'ui/screens/Late.tsx:1'));
assert.equal(new Set(items.map((i) => i.id)).size, items.length);

// 3. 판정: 가짜 결과 파일
const judge = (obj) => {
  const f = path.join(tmp, 'r.json');
  fs.writeFileSync(f, JSON.stringify(obj));
  return spawnSync('bash', [SH, '--judge', f], { encoding: 'utf8' });
};
assert.equal(judge({ reviewer: 'gpt-6.1-sol', findings: [] }).status, 0);
const bad = judge({ reviewer: 'gpt-6.1-sol', findings: [{ id: 's0001', text: '원문', problem: '번역투', suggestion: '고침' }] });
assert.equal(bad.status, 1);
assert.match(bad.stdout, /s0001/);
assert.equal(judge({ reviewer: 'x' }).status, 2);
// 입력에 없는 id 는 exit 2
const inp = path.join(tmp, 'in.json');
fs.writeFileSync(inp, JSON.stringify({ items: [{ id: 's0001' }] }));
fs.writeFileSync(path.join(tmp, 'r2.json'), JSON.stringify({ reviewer: 'x', findings: [{ id: 's9999', text: 't', problem: 'p', suggestion: 's' }] }));
assert.equal(spawnSync('bash', [SH, '--judge', path.join(tmp, 'r2.json'), inp], { encoding: 'utf8' }).status, 2);
fs.writeFileSync(path.join(tmp, 'r3.json'), JSON.stringify({ reviewer: 'x', findings: [{ id: 's0001', text: 't', problem: 'p', suggestion: 's' }] }));
assert.equal(spawnSync('bash', [SH, '--judge', path.join(tmp, 'r3.json'), inp], { encoding: 'utf8' }).status, 1);

// 4. 한도 대체: 가짜 codex 는 한도 메시지로 실패, 가짜 agy 가 결과를 낸다. CHUNK=1000 → 청크 1개
const bin = path.join(tmp, 'bin');
write(path.join(bin, 'codex'), '#!/bin/sh\necho "You hit your usage limit"; exit 1\n');
write(path.join(bin, 'agy'), '#!/bin/sh\necho \'{"status":"SUCCESS","result":"{\\"findings\\":[]}"}\'\n');
fs.chmodSync(path.join(bin, 'codex'), 0o755);
fs.chmodSync(path.join(bin, 'agy'), 0o755);
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, LANG_REVIEW_STATE: path.join(tmp, 'state'), CHUNK: '1000' };
let r = spawnSync('bash', [SH, '7'], { encoding: 'utf8', env });
assert.equal(r.status, 0, r.stdout + r.stderr);
const res = JSON.parse(fs.readFileSync(path.join(tmp, 'state/lang-review-7.json'), 'utf8'));
assert.equal(res.reviewer, 'gemini-4-argon-medium');
assert.equal(res.round, 7);

// 5. 한도가 아닌 codex 실패는 대체하지 않고 실패
// 이전 결과(지적 0건)가 남아 있어도 통과로 오판하면 안 된다. 에코된 프롬프트의 "usage limit" 도 한도로 보지 않는다.
const stale = path.join(tmp, 'state/lang-review-8.json');
fs.writeFileSync(stale, JSON.stringify({ reviewer: 'old', findings: [] }));
write(path.join(bin, 'codex'), '#!/bin/sh\necho "usage limit 기준 설명"; for i in $(seq 40); do echo boom; done; exit 1\n');
r = spawnSync('bash', [SH, '8'], { encoding: 'utf8', env });
assert.equal(r.status, 2);
assert.ok(!fs.existsSync(stale));
// codex 가 성공(rc 0)이라 해도 결과 파일이 없으면 exit 2
write(path.join(bin, 'codex'), '#!/bin/sh\nexit 0\n');
fs.writeFileSync(stale, JSON.stringify({ reviewer: 'old', findings: [] }));
assert.equal(spawnSync('bash', [SH, '8'], { encoding: 'utf8', env }).status, 2);
assert.ok(!fs.existsSync(stale));
// agy status 가 SUCCESS 가 아니면 exit 2
write(path.join(bin, 'codex'), '#!/bin/sh\necho "You\'ve hit your usage limit"; exit 1\n');
write(path.join(bin, 'agy'), '#!/bin/sh\necho \'{"status":"ERROR","result":"{\\"findings\\":[]}"}\'\n');
assert.equal(spawnSync('bash', [SH, '8'], { encoding: 'utf8', env }).status, 2);

// 6. GPT 성공이면 reviewer = gpt-6.1-sol, 지적 있으면 exit 1
write(path.join(bin, 'codex'), '#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done; echo \'{"findings":[{"id":"s0001","text":"t","problem":"p","suggestion":"s"}]}\' > "$2"\n');
r = spawnSync('bash', [SH, '9'], { encoding: 'utf8', env });
assert.equal(r.status, 1);
assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'state/lang-review-9.json'), 'utf8')).reviewer, 'gpt-6.1-sol');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('extract-strings.test: OK');
