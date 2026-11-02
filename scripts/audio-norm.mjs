#!/usr/bin/env node
// U16 소리 다듬기(DESIGN §21.2, 에셋목록 §4·§5). ffmpeg 하나로:
//   효과음: raw/SFX-<ID>.mp3 · raw/SFX-<ID>-b.mp3 두 안 중 하나를 골라 → 앞 무음 제거 → 목표 길이 → 끝 30ms 페이드 → loudnorm I=-16 TP=-1.5 → mp3 96k mono 44.1k
//   배경음악: raw/BGM-<ID>.mp3 → 끝 30ms 페이드 → loudnorm I=-18 TP=-1.5 → 같은 형식
// 고르기(듣기 대리 지표, 실측): 10ms 창 RMS 로 첫 소리(onset, 피크 −30dB 넘는 첫 창)와 첫 덩어리 길이(그 뒤 −35dB 아래가 120ms 이어지면 끝)를 재고,
//   점수 = |ln(덩어리 길이 / 목표)| + 앞 무음 벌점(0.5초 넘으면 +0.5) + 덩어리 수 벌점(0.05/개, 같은 소리 반복·잡음 꼬리) → 작은 안.
//   계약 규칙: 덩어리 길이가 목표의 0.5~2배인 안을 먼저 고른다(둘 다 아니면 점수로 고르고 표에 '범위 밖' 표시).
// 출력 파일이 이미 있으면 건너뛴다(덮어쓰기 금지, --force 로만). 결과 표(고른 안·길이·피크·앞 무음)를 stdout 과 --report JSON 에 남긴다.
//
// 사용: node scripts/audio-norm.mjs --in assets/audio/raw --out assets/audio --table ../docs/traveling-world/에셋목록.md [--report x.json] [--force] [--only tap,hop]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const IN = opt('in', 'assets/audio/raw');
const OUT = opt('out', 'assets/audio');
const TABLE = opt('table', '../docs/traveling-world/에셋목록.md');
const REPORT = opt('report', null);
const FORCE = flag('force');
const ONLY = opt('only', null)?.split(',');

function ffmpegBin() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch { /* PATH 에 없음 */ }
  return execFileSync('uvx', ['--from', 'imageio-ffmpeg', 'python', '-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim();
}
const FF = ffmpegBin();
const ff = (a) => execFileSync(FF, ['-hide_banner', '-nostdin', '-y', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
function stderrOf(a) {
  try { return execFileSync('sh', ['-c', `"${FF}" -hide_banner -nostdin ${a.map((x) => `'${x.replace(/'/g, "'\\''")}'`).join(' ')} -f null - 2>&1`], { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch (e) { return String(e.stdout ?? '') + String(e.stderr ?? ''); }
}

/** 표 읽기: | SFX-<id> | 효과음 | 소리 | 길이 | ... */
function targets() {
  const out = new Map();
  for (const line of readFileSync(TABLE, 'utf8').split('\n')) {
    const m = line.match(/^\|\s*SFX-([a-z-]+)\s*\|\s*효과음\s*\|[^|]*\|\s*([\d.]+)\s*\|/);
    if (m) out.set(m[1], Number(m[2]));
  }
  return out;
}

const SR = 22050, WIN = Math.round(SR * 0.01);
/** 10ms 창 RMS(dBFS) */
function envelope(file) {
  const buf = execFileSync(FF, ['-hide_banner', '-nostdin', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  const f = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const db = [];
  for (let i = 0; i + WIN <= f.length; i += WIN) {
    let s = 0;
    for (let j = i; j < i + WIN; j++) s += f[j] * f[j];
    db.push(10 * Math.log10(s / WIN + 1e-12));
  }
  return db;
}
/** 첫 소리·첫 덩어리 길이·덩어리 수 */
function measure(file) {
  const db = envelope(file);
  const peak = Math.max(...db);
  const on = peak - 30, off = peak - 35, gap = 12; // 120ms
  const onset = db.findIndex((v) => v > on);
  let end = db.length, quiet = 0;
  for (let i = onset; i < db.length; i++) {
    if (db[i] < off) { if (++quiet >= gap) { end = i - gap + 1; break; } } else quiet = 0;
  }
  let bursts = 0, inB = false;
  quiet = 0;
  for (let i = 0; i < db.length; i++) {
    if (db[i] > on) { if (!inB) bursts++; inB = true; quiet = 0; } else if (inB && db[i] < off && ++quiet >= gap) inB = false;
  }
  return { dur: db.length / 100, onset: onset / 100, event: (end - onset) / 100, bursts, peak: +peak.toFixed(1) };
}
function score(m, target) {
  return Math.abs(Math.log(Math.max(0.01, m.event) / target)) + (m.onset > 0.5 ? 0.5 : 0) + 0.05 * Math.max(0, m.bursts - 1);
}

/** 적분 음량(LUFS)·참 피크(dBTP). 0.4초보다 짧은 소리는 게이트 블록(400ms)을 못 채우므로 3초가 되도록 이어 붙여(aloop) 잰다 */
function loudness(file, len) {
  const loop = len < 3 ? `aloop=loop=${Math.ceil(3 / Math.max(0.02, len))}:size=${Math.round(len * 44100)},` : '';
  const out = stderrOf(['-i', file, '-af', `aresample=44100,${loop}ebur128=peak=true`]);
  const tail = out.slice(out.lastIndexOf('Summary:'));
  return { lufs: Number(tail.match(/I:\s+(-?[\d.]+) LUFS/)?.[1] ?? NaN), tp: Number(tail.match(/Peak:\s+(-?[\d.]+)\s+dBFS/)?.[1] ?? NaN) };
}

/** loudnorm 대응(두 단계, 선형): 다듬은 소리를 재서 목표 I 까지 한 번에 gain → 참 피크가 TP 를 넘으면 리미터(마진 0.7dB, mp3 인코딩 넘침 몫).
 *  짧은 효과음은 loudnorm 필터가 적분 음량을 못 재(−70) 같은 정의(EBU R128)를 aloop 측정으로 쓴다 */
function normalize(src, dst, { start = 0, len = null, I, TP = -1.5 }) {
  const cut = `atrim=start=${start}${len ? `:duration=${len}` : ''},asetpts=PTS-STARTPTS`;
  const total = len ?? Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], { encoding: 'utf8' })) - start;
  const fade = `afade=t=out:st=${Math.max(0, total - 0.03).toFixed(3)}:d=0.03`;
  const pre = `aformat=channel_layouts=mono,aresample=44100,${cut},${fade}`;
  const tmp = `${dst}.tmp.wav`;
  ff(['-i', src, '-af', pre, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_f32le', tmp]);
  const m = loudness(tmp, total);
  const gain = I - m.lufs;
  const lim = Math.pow(10, (TP - 0.7) / 20);
  ff(['-i', tmp, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=${lim.toFixed(4)}:level=false:attack=1:release=20,atrim=0:${total.toFixed(3)}`, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', dst]);
  execFileSync('rm', ['-f', tmp]);
  const after = measure(dst);
  const fin = loudness(dst, after.dur);
  return { len: after.dur, lead: after.onset, tp: fin.tp, lufs: fin.lufs, gain: +gain.toFixed(1) };
}

const T = targets();
const rows = [];
for (const [id, target] of T) {
  if (ONLY && !ONLY.includes(id)) continue;
  const dst = join(OUT, `SFX-${id}.mp3`);
  const takes = [`SFX-${id}.mp3`, `SFX-${id}-b.mp3`].map((f) => join(IN, f)).filter(existsSync);
  if (!takes.length) { rows.push({ id, target, status: '녹음 없음(합성 대체)' }); continue; }
  const ms = takes.map((f) => ({ f, m: measure(f) }));
  for (const x of ms) x.s = score(x.m, target);
  const inRange = ms.filter((x) => x.m.event >= 0.5 * target && x.m.event <= 2 * target);
  const pick = (inRange.length ? inRange : ms).sort((a, b) => a.s - b.s)[0];
  const row = { id, target, takes: ms.map((x) => ({ take: x.f.endsWith('-b.mp3') ? 'b' : 'a', ...x.m, score: +x.s.toFixed(2) })), pick: pick.f.endsWith('-b.mp3') ? 'b' : 'a', inRange: inRange.length > 0 };
  if (existsSync(dst) && !FORCE) { rows.push({ ...row, status: '있음(건너뜀)' }); continue; }
  const start = Math.max(0, pick.m.onset - 0.005);
  const r = normalize(pick.f, dst, { start, len: target, I: -16 });
  const ok = Math.abs(r.len - target) <= 0.2 * target + 0.03 && r.tp <= -1.4 && r.lead <= 0.02;
  rows.push({ ...row, out: r, status: ok ? 'ok' : '확인 필요' });
}
// 배경음악: raw/BGM-*.mp3 → out (I=-18)
for (const f of existsSync(IN) ? (await import('node:fs')).readdirSync(IN).filter((x) => /^BGM-[a-z]+\.mp3$/.test(x)) : []) {
  const id = f.replace(/\.mp3$/, '');
  if (ONLY && !ONLY.includes(id)) continue;
  const dst = join(OUT, f);
  if (existsSync(dst) && !FORCE) { rows.push({ id, status: '있음(건너뜀)' }); continue; }
  const m = measure(join(IN, f)); // 루프 앞 무음(Lyria 원본 ≈0.7초)을 걷어 이음매 공백을 없앤다
  const r = normalize(join(IN, f), dst, { start: Math.max(0, m.onset - 0.005), I: -18 });
  rows.push({ id, out: r, status: 'ok' });
}

const fmt = (n, d = 2) => (n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(d));
console.log('| ID | 목표 s | 안 a 덩어리/앞/수 | 안 b 덩어리/앞/수 | 고름 | 결과 길이 | 앞 무음 | 피크 dBTP | LUFS | 상태 |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  const t = (k) => { const x = r.takes?.find((y) => y.take === k); return x ? `${fmt(x.event)}/${fmt(x.onset)}/${x.bursts}` : '—'; };
  console.log(`| ${r.id} | ${r.target ?? '—'} | ${t('a')} | ${t('b')} | ${r.pick ?? '—'}${r.pick && !r.inRange ? '(범위 밖)' : ''} | ${fmt(r.out?.len)} | ${fmt(r.out?.lead, 3)} | ${fmt(r.out?.tp, 1)} | ${fmt(r.out?.lufs, 1)} | ${r.status} |`);
}
if (REPORT) writeFileSync(REPORT, JSON.stringify(rows, null, 2));
