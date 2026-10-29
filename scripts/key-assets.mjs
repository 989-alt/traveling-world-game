// DESIGN §14.1 키잉 + §14.2 WebP. 02 에서 승인된 assets/webp 를 만든 로직(harness/.../key-all.reference.cjs)을 옮긴 것.
// 각 ID 의 최신 버전(-vN 중 가장 큰 것)만 변환. 승인 WebP 를 덮어쓰지 않도록 assets/webp 로의 출력은 거부한다.
// 사용:
//   node scripts/key-assets.mjs --dry                  대상 목록만 출력
//   node scripts/key-assets.mjs --out <빈 폴더>        변환
//   --only <정규식>    ID 필터 (묶음 2: '^(TB-|mp_|[a-z]{2}_)')
//   --src <PNG 폴더>   기본 assets/img
//   --sharp <경로>     sharp 위치. 기본 $SHARP_PATH 또는 ~/Desktop/math-baseball/node_modules/sharp (의존성 추가 금지라 밖의 것을 쓴다)
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const dry = process.argv.includes('--dry');
const SRC = resolve(arg('--src') ?? join(here, '../assets/img'));
const OUT = arg('--out') && resolve(arg('--out'));
if (!dry && !OUT) { console.error('--out <폴더> 또는 --dry 필요'); process.exit(2); }
if (OUT && OUT === resolve(here, '../assets/webp')) { console.error('승인된 assets/webp 는 다시 만들지 않는다. 다른 폴더로.'); process.exit(2); }

const latest = {};
for (const f of readdirSync(SRC)) {
  if (!f.endsWith('.png') || f.startsWith('CS-')) continue;
  const m = f.slice(0, -4).match(/^(.*?)(?:-v(\d+))?$/);
  const v = +(m[2] || 1);
  if (!latest[m[1]] || latest[m[1]].v < v) latest[m[1]] = { v, file: f };
}
const SKIP = /^(PLAZA-[LR]|TILE-(\d\d|M)[bc]?)$/; // 반쪽 광장·옛 칸 그림(R5·R5b·R5c)은 보드에 안 쓴다
const only = arg('--only') && new RegExp(arg('--only')); // 예: --only '^(TB-|mp_|[a-z]{2}_)' 묶음 2 만
const ids = Object.keys(latest).sort().filter(id => (!only || only.test(id)) && !SKIP.test(id));

const PHOTO_UI = new Set(['UI-rotate', 'UI-rotate-wide']); // U1·U4: 하늘까지 꽉 찬 일러스트(키잉 없음)
const keyed = id => !PHOTO_UI.has(id) && /^(CH\d|ISL|BLD|LM|UI|IT|TB|LOGO|TILE|PLAZA|RS)/.test(id);
const tight = id => /^(CH4|CH6)-/.test(id) || id === 'UI-flag-4' || isPlaza(id); // PLAZA: 남아메리카 보라 // 임계 70/110 (보라·분홍이 마젠타에 가까움)
const icon = id => (/^(UI|IT|TB)/.test(id) && !FREE[id] && id !== 'UI-signpost') || /^RS-(medal|stamp|dot|tab-ring)/.test(id);
// U6(DESIGN §16.7.3): 결과 화면 그림 RS-*. [모양, 크기, quality] — sq = 정사각 패딩(섬·트로피·핀은 바닥 중앙, 메달·도장·점·탭 고리는 가운데),
// w = 트림 뒤 폭 N(배너·이름표·칩·버튼·지도판·받침), box = 트림 뒤 정확히 W×H 로 늘림(두루마리 3:4), frame = 트림 없이 프레임 그대로(색종이 4×2 격자)
const RS = {
  'RS-banner': ['w', 1560, 88], 'RS-trophy': ['sq', 256, 90], 'RS-scroll': ['box', [768, 1024], 85], 'RS-scroll-wide': ['w', 1536, 85],
  'RS-map-board': ['w', 704, 88], 'RS-pin': ['sq', 64, 90], 'RS-line-chip': ['w', 880, 88], 'RS-btn-blue': ['w', 440, 90],
  'RS-souv-stand': ['w', 168, 90], 'RS-confetti': ['frame', 512, 88],
};
const rsSpec = id => RS[id] ?? (/^RS-isle-/.test(id) ? ['sq', 512, 85] : /^RS-plate-/.test(id) ? ['w', 600, 88] : /^RS-(medal|stamp)-/.test(id) ? ['sq', 128, 90]
  : /^RS-dot-/.test(id) ? ['sq', 64, 90] : /^RS-tab-ring-/.test(id) ? ['sq', 96, 90] : null);
// R4 T-A(DESIGN §16.8·§16.4): 판 그림. 칸 TILE-<n>d·TILE-Md 는 프레임 그대로(트림 없음 — 땅덩이 4~96%·윗면 8~62% 가 프레임 비율이라)
// 512, 광장 PLAZA 는 트림 뒤 긴 변 1944(줌 1.8 × 1080), 이정표는 기둥 가운데를 잘라 붙인 판+짧은 기둥(판 96 × 기둥 26 비율) 256 폭.
// U5(DESIGN §16.9.1): PLAZA-U5 = 낮은 광장(1080×390). 생성본이 PLAZA 와 같은 비율(1877×838)로 와서 윗면·절벽을 따로 세로로 줄여 맞춘다(아래 plazaU5)
const isPlaza = id => id === 'PLAZA' || id === 'PLAZA-U5';
const isTile = id => /^TILE-(\d\d|M)[de]$/.test(id); // e = 좌우 열 이름표 가운데판(2026-10-27, 11~14·26~29)
// R2 T-A A3: 정사각이 아닌 UI 그림(트림 뒤 긴 변 N). [긴 변, quality]
const FREE = { LOGO: [1024, 90], 'UI-stage': [1536, 85], 'UI-plank-panel': [1024, 90] };
// 버전이 이름에 남는 출력(옛 v1 WebP 와 나란히 둔다): ISL-center-v2 → result.podium, LOGO-v2 → logo.v2
const outName = id => (/^(ISL-center|LOGO)$/.test(id) && latest[id].v > 1 ? `${id}-v${latest[id].v}` : id);

if (dry) {
  for (const id of ids) console.log(`${id}\t${latest[id].file}\t${keyed(id) ? (tight(id) ? 'key-tight' : 'key') : 'no-key'}`);
  console.log(`대상 ${ids.length}`);
  process.exit(0);
}

const sharp = createRequire(import.meta.url)(arg('--sharp') ?? process.env.SHARP_PATH ?? join(homedir(), 'Desktop/math-baseball/node_modules/sharp'));
mkdirSync(OUT, { recursive: true });

async function key(file, id) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [lo, hi] = tight(id) ? [70, 110] : [90, 140];
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const R = data[i], G = data[i + 1], B = data[i + 2];
    const d = Math.sqrt((R - 255) ** 2 + G ** 2 + (B - 255) ** 2);
    const a = d < lo ? 0 : d < hi ? (d - lo) / (hi - lo) : 1;
    if (a > 0 && a < 1) { // 디스필
      data[i] = Math.min(R, (G + B) / 2 + 40);
      data[i + 2] = Math.min(B, (G + R) / 2 + 40);
    }
    data[i + 3] = Math.round(a * 255);
    if (data[i + 3] > 8) {
      const x = p % info.width, y = (p / info.width) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (isTile(id) || id === 'UI-signpost' || rsSpec(id)?.[0] === 'frame') return sharp(data, { raw: info }).png().toBuffer(); // 프레임 유지
  const w = x1 - x0 + 1, h = y1 - y0 + 1, side = Math.round(Math.max(w, h) * 1.04);
  const crop = await sharp(data, { raw: info }).extract({ left: x0, top: y0, width: w, height: h }).png().toBuffer();
  if (FREE[id] || isPlaza(id) || ['w', 'box'].includes(rsSpec(id)?.[0])) return crop; // 트림만(정사각 패딩 없음)
  // 발 앵커: 바닥 중앙에 붙임. 아이콘은 가운데.
  const top = icon(id) ? Math.round((side - h) / 2) : side - h;
  return sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: crop, left: Math.round((side - w) / 2), top }]).png().toBuffer();
}

const webp = (img, q, out) => img.webp({ quality: q, alphaQuality: 100, effort: 6 }).toFile(join(OUT, out));

// 이정표: 판(프레임 y 0~45%) + 기둥 끝·돌받침(78.3~100%)을 붙여 기둥을 26 비율로 줄인다(DESIGN §16.4 판 96×28·기둥 26)
const SIGN_CUT = [0.45, 0.783];
async function signpost(buf) {
  const { width: W, height: H } = await sharp(buf).metadata();
  const a = Math.round(H * SIGN_CUT[0]), b = Math.round(H * SIGN_CUT[1]);
  const top = await sharp(buf).extract({ left: 0, top: 0, width: W, height: a }).png().toBuffer();
  const bot = await sharp(buf).extract({ left: 0, top: b, width: W, height: H - b }).png().toBuffer();
  const out = await sharp({ create: { width: W, height: a + H - b, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: top, left: 0, top: 0 }, { input: bot, left: 0, top: a }]).png().toBuffer();
  return sharp(out).resize(256, null);
}

// 대륙 마스크 5(R4 A3): 광장 지도에서 대륙색(토큰 hue ±18°, 채도 > .35)인 픽셀 + 대륙 상자(광장 비율) → 닫힘(구멍 메움) → 2px 페더.
// 결과는 흰색 + 알파. 보드는 이 알파로 자리색을 칠한다(mask-image). 상자는 PLAZA.png 실측.
// hue = 그림의 실측 대륙색(토큰 hue 와 다름: 북아메리카 그림 85° vs 토큰 115°, 남아메리카 295° vs 269°) — PLAZA.png 히스토그램.
// 유럽 파랑은 바다(197°, 명도 .98)와 hue 가 가까워 명도 상한 .85 로 가른다.
const CONT = {
  asia: { hue: 355, box: [0.58, 0.14, 0.86, 0.50] },
  europe: { hue: 218, box: [0.48, 0.19, 0.62, 0.36], vmax: 0.85 },
  africa: { hue: 48, box: [0.53, 0.31, 0.70, 0.62] },
  namerica: { hue: 85, box: [0.17, 0.12, 0.41, 0.39] },
  samerica: { hue: 295, box: [0.20, 0.38, 0.41, 0.69] },
};
function hsv(R, G, B) {
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
  let h = 0;
  if (d) h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx / 255];
}
async function plazaMasks(buf, W, post = (img) => img, prefix = 'PLAZA') {
  const { data, info } = await (W ? sharp(buf).resize(W, null) : sharp(buf)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const [name, c] of Object.entries(CONT)) {
    const m = Buffer.alloc(info.width * info.height);
    const [bx0, by0, bx1, by1] = [c.box[0] * info.width, c.box[1] * info.height, c.box[2] * info.width, c.box[3] * info.height];
    for (let p = 0; p < m.length; p++) {
      const x = p % info.width, y = (p / info.width) | 0;
      if (x < bx0 || x > bx1 || y < by0 || y > by1 || data[p * 4 + 3] < 128) continue;
      const [h, s, v] = hsv(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
      const dh = Math.min(Math.abs(h - c.hue), 360 - Math.abs(h - c.hue));
      if (dh <= 18 && s > 0.35 && v > 0.25 && v <= (c.vmax ?? 1)) m[p] = 255;
    }
    const raw = { width: info.width, height: info.height, channels: 1 };
    // 구멍 메움 = 밀도: 반경 ≈ 10px@1944 이웃의 20% 이상이 대륙색이면 대륙(대륙 위 나무·건물·그림자를 덮는다) → 2px 페더
    const r = Math.round(info.width / 200);
    const den = await sharp(m, { raw }).blur(r).threshold(50).extractChannel(0).raw().toBuffer();
    const fea = await sharp(den, { raw }).blur(2).extractChannel(0).raw().toBuffer(); // 2px 페더
    const rgba = Buffer.alloc(info.width * info.height * 4, 255);
    for (let p = 0; p < fea.length; p++) rgba[p * 4 + 3] = fea[p];
    await webp(await post(sharp(rgba, { raw: { ...raw, channels: 4 } })), 80, `${prefix}-mask-${name}.webp`);
  }
}

// PLAZA-U5: 트림한 그림(윗면 = 위 79.95%, 앞 절벽 = 아래 20.05% — 생성본 실측: 윗면 앞 풀 테 끝 y 655 / 트림 29~811)을
// 표시 상자 PLAZA_ART 1120×402(광장 1080×390 + 번짐) × 1.7357 = 1944×698 로: 윗면 332 → 576 px, 절벽 70 → 122 px.
// 윗면은 세로 0.86 배, 절벽은 0.73 배로 따로 줄인다(통째로 줄이면 윗면이 모자라고 절벽이 남는다). 마스크도 같은 변환
const U5 = { w: 1944, h: 698, topH: 576, split: 0.7995 };
async function plazaU5(img) {
  const png = await img.png().toBuffer();
  const { width: W, height: H } = await sharp(png).metadata();
  const cut = Math.round(H * U5.split);
  const top = await sharp(png).extract({ left: 0, top: 0, width: W, height: cut }).resize(U5.w, U5.topH, { fit: 'fill' }).png().toBuffer();
  const bot = await sharp(png).extract({ left: 0, top: cut, width: W, height: H - cut }).resize(U5.w, U5.h - U5.topH, { fit: 'fill' }).png().toBuffer();
  return sharp({ create: { width: U5.w, height: U5.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: top, left: 0, top: 0 }, { input: bot, left: 0, top: U5.topH }]);
}

async function run(id, file) {
  if (keyed(id)) {
    const buf = await key(file, id);
    const sq = s => sharp(buf).resize(s, s);
    if (FREE[id]) { const [n, q] = FREE[id]; return webp(sharp(buf).resize(n, n, { fit: 'inside' }), q, outName(id) + '.webp'); }
    const rs = /^RS-/.test(id) && rsSpec(id);
    if (/^RS-/.test(id)) {
      if (!rs) throw new Error(`RS 규격 없음: ${id}`);
      const [kind, n, q] = rs;
      const img = kind === 'w' ? sharp(buf).resize(n, null) : kind === 'box' ? sharp(buf).resize(n[0], n[1], { fit: 'fill' }) : sq(n);
      return webp(img, q, id + '.webp');
    }
    if (isTile(id)) return webp(sq(512), 85, id + '.webp'); // R5d 칸: 512(줌 1.8 × 128 = 230)
    if (id === 'PLAZA') { await plazaMasks(buf, 1944); return webp(sharp(buf).resize(1944, null), 85, 'PLAZA.webp'); } // 원본 1877 → 1944(×1.036)
    if (id === 'PLAZA-U5') { await plazaMasks(buf, null, plazaU5, 'PLAZA-U5'); return webp(await plazaU5(sharp(buf)), 85, 'PLAZA-U5.webp'); }
    if (id === 'UI-signpost') return webp(await signpost(buf), 90, id + '.webp');
    // P01 1024: 인트로 200px·로비 슬롯 330px (R2 A4). P13 1024: 문항 옆 고민 포즈(R2 D6, P10 과 교대)
    if (/^CH\d-P(01|10|11|12|13|18)$/.test(id) || /^LM-/.test(id)) await webp(sq(1024), 85, id + '@1024.webp');
    if (/^CH\d-P19$/.test(id)) return webp(sq(512), 88, id + '.webp'); // 빼꼼 반신(R2 A2): 하단 중앙 = 허리선 중앙
    if (id === 'UI-sign-small') return webp(sq(256), 90, id + '.webp');
    if (id === 'UI-logo') return webp(sq(512), 90, id + '.webp');
    if (/^ISL/.test(id)) return webp(sq(512), 85, outName(id) + '.webp'); // R2 A1: 섬 전부 512
    if (icon(id)) return webp(sq(128), 90, id + '.webp');
    return webp(sq(256), /^CH/.test(id) ? 88 : 85, id + '.webp');
  }
  if (/^MC-/.test(id)) return webp(sharp(file).resize(512, 512, { fit: 'cover' }).removeAlpha(), 85, id + '.webp'); // U1 미션 그림 카드 1:1(mp_ 와 같은 처리)
  if (id === 'UI-rotate') return webp(sharp(file).resize(768, null).removeAlpha(), 82, id + '.webp'); // U1 세로 안내 일러스트(폭 768)
  if (id === 'UI-rotate-wide') return webp(sharp(file).resize(1024, 576, { fit: 'cover' }).removeAlpha(), 82, id + '.webp'); // U4 가로판 일러스트 16:9(폭 1024)
  if (/^mp_/.test(id)) return webp(sharp(file).resize(512, 512, { fit: 'cover' }).removeAlpha(), 85, id + '.webp'); // 묶음 2 미션 사진 1:1
  if (/^(CC|EV)-/.test(id) || /^[a-z]{2}_/.test(id)) { // CC·EV, 묶음 2 해설 카드 그림(<cc>_<이름>)
    const m = await sharp(file).metadata(), h = Math.round(m.width / 2.5);
    return webp(sharp(file).extract({ left: 0, top: Math.round((m.height - h) / 2), width: m.width, height: h }).resize(1440, 576), 82, id + '.webp');
  }
  // CUT-nn·BG·구름·광선: 16:9 가운데 crop
  return webp(sharp(file).resize(1536, 864, { fit: 'cover' }).removeAlpha(), 82, id + '.webp');
}

let n = 0;
for (let i = 0; i < ids.length; i += 8)
  await Promise.all(ids.slice(i, i + 8).map(id => run(id, join(SRC, latest[id].file)).then(() => n++)));
writeFileSync(join(OUT, 'versions.json'), JSON.stringify(latest, null, 1));
console.log('converted', n, 'of', ids.length);
