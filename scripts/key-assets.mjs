// DESIGN §14.1 키잉 + §14.2 WebP. 02 에서 승인된 assets/webp 를 만든 로직(harness/.../key-all.reference.cjs)을 옮긴 것.
// 각 ID 의 최신 버전(-vN 중 가장 큰 것)만 변환. 승인 WebP 를 덮어쓰지 않도록 assets/webp 로의 출력은 거부한다.
// 사용:
//   node scripts/key-assets.mjs --dry                  대상 목록만 출력
//   node scripts/key-assets.mjs --out <빈 폴더>        변환
//   --only <정규식>    ID 필터 (묶음 2: '^(TB-|mp_|[a-z]{2}_)')
//   --src <PNG 폴더>   기본 assets/img2x(U9: AI 2배 원본, Real-ESRGAN 애니 모델). 파일이 없으면 assets/img 의 같은 이름으로 내려간다
//   --tier hi          U9 고해상 단계: 그림마다 HI_K 배(긴 변 상한 2048)로 만든다. 출력은 assets/webp/hi(같은 파일 이름).
//                      HI_K 에 없는 ID 는 만들지 않는다(기본 단계로 충분 — U9 실측 measure-before.json)
//   --sharp <경로>     sharp 위치. 기본 $SHARP_PATH 또는 ~/Desktop/math-baseball/node_modules/sharp (의존성 추가 금지라 밖의 것을 쓴다)
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const dry = process.argv.includes('--dry');
const SRC = resolve(arg('--src') ?? join(here, '../assets/img2x'));
const FALLBACK = resolve(join(here, '../assets/img')); // img2x 에 없는 파일(새로 생성된 그림 등)
const HI = arg('--tier') === 'hi';
const OUT = arg('--out') && resolve(arg('--out'));
if (!dry && !OUT) { console.error('--out <폴더> 또는 --dry 필요'); process.exit(2); }
if (OUT && OUT === resolve(here, '../assets/webp')) { console.error('승인된 assets/webp 는 다시 만들지 않는다. 다른 폴더로.'); process.exit(2); }

const latest = {};
const srcFiles = new Set(existsSync(SRC) ? readdirSync(SRC) : []);
for (const f of new Set([...srcFiles, ...readdirSync(FALLBACK)])) {
  if (!f.endsWith('.png') || f.startsWith('CS-')) continue;
  const m = f.slice(0, -4).match(/^(.*?)(?:-v(\d+))?$/);
  const v = +(m[2] || 1);
  if (!latest[m[1]] || latest[m[1]].v < v) latest[m[1]] = { v, file: f };
}
const SKIP = /^(PLAZA-[LR]|TILE-(\d\d|M)[bc]?)$/; // 반쪽 광장·옛 칸 그림(R5·R5b·R5c)은 보드에 안 쓴다
const only = arg('--only') && new RegExp(arg('--only')); // 예: --only '^(TB-|mp_|[a-z]{2}_)' 묶음 2 만
// U9 고해상 단계 배수(기본 크기 n 에 곱함, 긴 변 상한 2048). 근거 = 1920×1080·장치 배율 2(판 배율 1.406, 줌 1.8)에서 잰 화면 장치 px
// (reports/U9-hires-shots/measure-before.json 의 그림별 최댓값) ÷ 기본 크기 → 그 위로 반올림. 0 = hi 안 만듦.
const CAP = 2048;
// U9 후속 판정(2026-10-30 사용자): 광장만 긴 변 2880 — 1920 PC 줌 광장이 2833 장치 px 를 그린다(배율비 ≥ 1). 휴대·태블릿은 manifest.ts 가 기본을 쓴다
const PLAZA_CAP = 2880;
const capOf = id => (isPlaza(id) ? PLAZA_CAP : CAP);
function hiK(id, n) {
  if (/^TILE-/.test(id)) return 1.25; // 512 → 640 (줌 칸 627)
  if (isPlaza(id)) return PLAZA_CAP / 1944; // 1944 → 2880 (줌 2833@dpr1 ✓ · 5666@dpr2 — 상한, 예외)
  if (id === 'DICE-sum-burst') return 1.5; // U8 합 버스트 128 → 장치 360(1920 dpr2) → 256 × 1.5 = 384
  if (/^(DICE|FLAG-tall|PENNANT|BALCONY)-/.test(id)) return 0; // U8: 기본으로 충분(컵 309/512 · 주사위 169/256 · 쟁반 562/800 · 깃발 줌 222/256 · 발코니 줌 121/128)
  if (id === 'UI-signpost') return 2.25; // 256 → 576 (줌 551)
  if (/^CH\d-P19$/.test(id)) return 1.25; // 512 → 640 (문화 카드 빼꼼 611)
  if (/^CH\d-P\d\d$/.test(id)) return 2; // 보드 256 → 512(줌 498) · @1024 → 2048(문항 옆 고민 포즈 2530, 상한)
  if (/^LM-/.test(id)) return n >= 1024 ? 1.25 : 2; // 컷씬 @1024 → 1280(1253) · 판 256 → 512
  if (/^(BG|CUT)-/.test(id)) return CAP / 1536; // 1536×864 → 2048×1152 (화면 가득 3840 — 상한, 예외)
  if (/^(CC|EV)-/.test(id) || /^[a-z]{2}_/.test(id)) return CAP / 1440; // 1440×576 → 2048×819 (문화·해설 2319 — 상한)
  if (/^(mp_|MC-)/.test(id)) return 1.25; // 512 → 640 (미션 사진 582)
  if (id === 'UI-stage') return CAP / 1536; // 1536 → 2048 (인트로 바닥 3092 — 상한)
  if (id === 'LOGO') return 1.6875; // 1024 → 1728 (1687)
  if (id === 'UI-sign-small') return 2.25; // 256 → 576 (매달린 간판 9-slice 가운데가 판 타이머 폭으로 늘어남: 1/0.47 = 2.13 배)
  if (id === 'UI-plank-panel') return 2; // 1024 → 2048 (첫 팝업 판 820 css × 2.81)
  if (/^RS-/.test(id)) return id === 'RS-confetti' ? 0 : 2; // 결과 화면: 최대 1/0.53 = 1.9 배(두루마리) — 2 배(상한 2048)
  if (END_BIG.test(id)) return CAP / n; // U12 §19.4: 큰 면 4종(사진 배경·틀·펼친 여권·와이드)은 hi 긴 변 2048 고정(사용자 "최소 2K")
  if (/^END-/.test(id)) return 2; // U12 작은 그림(닫힌 여권·목 메달·테이프·하트·도장 테): 표시 ×4
  if (/^(UI|IT|TB)/.test(id) && n <= 128) return 2.25; // 아이콘 128 → 288 (미션 문장 281·주사위 197)
  return 0;
}
const ids = Object.keys(latest).sort().filter(id => (!only || only.test(id)) && !SKIP.test(id));

const PHOTO_UI = new Set(['UI-rotate', 'UI-rotate-wide']); // U1·U4: 하늘까지 꽉 찬 일러스트(키잉 없음)
const keyed = id => !PHOTO_UI.has(id) && id !== 'END-photo-bg' && /^(CH\d|ISL|BLD|LM|UI|IT|TB|LOGO|TILE|PLAZA|RS|DICE|FLAG-tall|PENNANT|BALCONY|END)/.test(id);
const tight = id => /^(CH4|CH6)-/.test(id) || id === 'UI-flag-4' || /^(FLAG-tall|PENNANT|BALCONY)-4$/.test(id) || isPlaza(id) || /^END-.+-4$/.test(id); // U8 자리 4 분홍 // U12 END 자리 4(분홍 표지·테이프·하트) // PLAZA: 남아메리카 보라 // 임계 70/110 (보라·분홍이 마젠타에 가까움)
const icon = id => (/^(UI|IT|TB)/.test(id) && !FREE[id] && id !== 'UI-signpost') || /^RS-(medal|stamp|dot|tab-ring)/.test(id)
  || /^(DICE-(top|sum)|FLAG-tall|PENNANT|BALCONY)/.test(id) || /^END-(heart|stamp)-ring-/.test(id); // U8: 가운데 패딩. 컵 3장(DICE-cup-*)만 바닥 중앙 앵커(§17.1.1)
// U6(DESIGN §16.7.3): 결과 화면 그림 RS-*. [모양, 크기, quality] — sq = 정사각 패딩(섬·트로피·핀은 바닥 중앙, 메달·도장·점·탭 고리는 가운데),
// w = 트림 뒤 폭 N(배너·이름표·칩·버튼·지도판·받침), box = 트림 뒤 정확히 W×H 로 늘림(두루마리 3:4), frame = 트림 없이 프레임 그대로(색종이 4×2 격자)
const RS = {
  'RS-banner': ['w', 1560, 88], 'RS-trophy': ['sq', 256, 90], 'RS-scroll': ['box', [768, 1024], 85], 'RS-scroll-wide': ['w', 1536, 85],
  'RS-map-board': ['w', 704, 88], 'RS-pin': ['sq', 64, 90], 'RS-line-chip': ['w', 880, 88], 'RS-btn-blue': ['w', 440, 90],
  'RS-souv-stand': ['w', 168, 90], 'RS-confetti': ['frame', 512, 88],
};
const rsSpec = id => RS[id] ?? (/^RS-isle-/.test(id) ? ['sq', 512, 85] : /^RS-plate-/.test(id) ? ['w', 600, 88] : /^RS-(medal|stamp)-/.test(id) ? ['sq', 128, 90]
  : /^RS-dot-/.test(id) ? ['sq', 64, 90] : /^RS-tab-ring-/.test(id) ? ['sq', 96, 90] : null);
// U12(DESIGN §19.4): 엔딩 그림 END-*. 키잉은 마젠타 전부(틀 창·여권 초상/스티커 틀·하트 가운데·도장 테 안·닫힌 여권 창이 뚫린다 — RS-tab-ring 전례).
// [모양, 기본 크기, quality] — bg = 키잉 0·cover 리사이즈(사진 배경 3:2), frame9 = 틀을 9 조각으로 나눠 창·테를 §19.2 비율(옆·위 20, 아래 150 / 820×690)로 맞춤,
// long = 트림 뒤 긴 변 N(비율 유지), fill = 트림 뒤 W×H 로 늘림(테이프), sq = 정사각 가운데 패딩
const END = {
  'END-photo-bg': ['bg', [1560, 1040], 85], 'END-photo-frame': ['frame9', [1640, 1380], 88], 'END-passport-wide': ['long', 1536, 85],
};
const endSpec = id => END[id] ?? (/^END-passport-open-/.test(id) ? ['long', 1000, 85] : /^END-passport-closed-/.test(id) ? ['long', 320, 88]
  : /^END-medal-neck-/.test(id) ? ['long', 192, 90] : /^END-tape-/.test(id) ? ['fill', [600, 136], 88]
  : /^END-heart-ring-/.test(id) ? ['sq', 336, 90] : /^END-stamp-ring-/.test(id) ? ['sq', 192, 90] : null);
const END_BIG = /^END-(photo-(bg|frame)|passport-(open-\d|wide))$/;
// 틀 창(트림 상자 기준, 생성본 실측 END-photo-frame: 창 x 3.67~96.28%·y 5.09~76.67%) → 820×690 에서 창 (20,20,780,520)
const FRAME_WIN = { l: 0.0367, t: 0.0509, r: 1 - 0.0367 - 0.9261, b: 1 - 0.0509 - 0.7158 };
const FRAME_OUT = { w: 820, h: 690, l: 20, t: 20, r: 20, b: 150 };
async function frame9(buf, W, H) {
  const { width: sw, height: sh } = await sharp(buf).metadata();
  const sx = [0, Math.round(sw * FRAME_WIN.l), Math.round(sw * (1 - FRAME_WIN.r)), sw];
  const sy = [0, Math.round(sh * FRAME_WIN.t), Math.round(sh * (1 - FRAME_WIN.b)), sh];
  const k = W / FRAME_OUT.w;
  const dx = [0, Math.round(FRAME_OUT.l * k), W - Math.round(FRAME_OUT.r * k), W];
  const dy = [0, Math.round(FRAME_OUT.t * k), H - Math.round(FRAME_OUT.b * k), H];
  const parts = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const input = await sharp(buf).extract({ left: sx[j], top: sy[i], width: sx[j + 1] - sx[j], height: sy[i + 1] - sy[i] })
      .resize(dx[j + 1] - dx[j], dy[i + 1] - dy[i], { fit: 'fill' }).png().toBuffer();
    parts.push({ input, left: dx[j], top: dy[i] });
  }
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(parts);
}
/** U12 포즈 P20·P21 실측(정사각 패딩 뒤): 트림 높이 ÷ 한 변 · 트림 폭 ÷ 한 변. key() 가 채운다 → OUT/poses.json */
const POSES = {};

// R4 T-A(DESIGN §16.8·§16.4): 판 그림. 칸 TILE-<n>d·TILE-Md 는 프레임 그대로(트림 없음 — 땅덩이 4~96%·윗면 8~62% 가 프레임 비율이라)
// 512, 광장 PLAZA 는 트림 뒤 긴 변 1944(줌 1.8 × 1080), 이정표는 기둥 가운데를 잘라 붙인 판+짧은 기둥(판 96 × 기둥 26 비율) 256 폭.
// U5(DESIGN §16.9.1): PLAZA-U5 = 낮은 광장(1080×390). 생성본이 PLAZA 와 같은 비율(1877×838)로 와서 윗면·절벽을 따로 세로로 줄여 맞춘다(아래 plazaU5)
const isPlaza = id => id === 'PLAZA' || id === 'PLAZA-U5';
const isTile = id => /^TILE-(\d\d|M)[de]$/.test(id); // e = 좌우 열 이름표 가운데판(2026-10-27, 11~14·26~29)
// R2 T-A A3: 정사각이 아닌 UI 그림(트림 뒤 긴 변 N). [긴 변, quality]
const FREE = { LOGO: [1024, 90], 'UI-stage': [1536, 85], 'UI-plank-panel': [1024, 90], 'DICE-tray': [800, 88] }; // U8 쟁반: 트림 뒤 폭 800
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
  if (/^(END-|CH\d-P2[01]$)/.test(id)) unfringe(data, info.width, info.height);
  if (isTile(id) || id === 'UI-signpost' || rsSpec(id)?.[0] === 'frame') return sharp(data, { raw: info }).png().toBuffer(); // 프레임 유지
  const w = x1 - x0 + 1, h = y1 - y0 + 1, side = Math.round(Math.max(w, h) * 1.04);
  const crop = await sharp(data, { raw: info }).extract({ left: x0, top: y0, width: w, height: h }).png().toBuffer();
  if (FREE[id] || isPlaza(id) || ['w', 'box'].includes(rsSpec(id)?.[0]) || ['frame9', 'long', 'fill'].includes(endSpec(id)?.[0])) return crop; // 트림만(정사각 패딩 없음)
  if (/^CH\d-P2[01]$/.test(id)) POSES[id] = { h: +(h / side).toFixed(4), w: +(w / side).toFixed(4) };
  // 발 앵커: 바닥 중앙에 붙임. 아이콘은 가운데.
  const top = icon(id) ? Math.round((side - h) / 2) : side - h;
  return sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: crop, left: Math.round((side - w) / 2), top }]).png().toBuffer();
}

/** U12: 크게 그리는 엔딩 그림(포즈 250px·여권)은 가장자리 1~2px 에 남는 보라 띠(마젠타가 섞인 불투명 픽셀)가 보인다.
 *  투명 픽셀 2px 안쪽이면서 마젠타 색조(R·B 가 G 보다 크고 R≈B)인 픽셀만 알파를 줄인다 — 보라 옷(B ≫ R)·분홍(R ≫ B)은 건드리지 않는다 */
function unfringe(d, W, H) {
  const a0 = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) a0[p] = d[p * 4 + 3];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, i = p * 4;
    if (!a0[p]) continue;
    const R = d[i], G = d[i + 1], B = d[i + 2];
    if (R - G < 30 || B - G < 30 || Math.abs(R - B) > 60) continue;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && a0[yy * W + xx] < 128) { near = true; break; }
    }
    if (near) d[i + 3] = Math.round(a0[p] * 0.25);
  }
}

const webp = (img, q, out) => img.webp({ quality: q, alphaQuality: 100, effort: 6 }).toFile(join(OUT, out));

// 이정표: 판(프레임 y 0~45%) + 기둥 끝·돌받침(78.3~100%)을 붙여 기둥을 26 비율로 줄인다(DESIGN §16.4 판 96×28·기둥 26)
const SIGN_CUT = [0.45, 0.783];
async function signpost(buf, W0 = 256) {
  const { width: W, height: H } = await sharp(buf).metadata();
  const a = Math.round(H * SIGN_CUT[0]), b = Math.round(H * SIGN_CUT[1]);
  const top = await sharp(buf).extract({ left: 0, top: 0, width: W, height: a }).png().toBuffer();
  const bot = await sharp(buf).extract({ left: 0, top: b, width: W, height: H - b }).png().toBuffer();
  const out = await sharp({ create: { width: W, height: a + H - b, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: top, left: 0, top: 0 }, { input: bot, left: 0, top: a }]).png().toBuffer();
  return sharp(out).resize(W0, null);
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
async function plazaU5(img, k = 1) {
  const u = { w: R(U5.w, k), h: R(U5.h, k), topH: R(U5.topH, k) };
  const png = await img.png().toBuffer();
  const { width: W, height: H } = await sharp(png).metadata();
  const cut = Math.round(H * U5.split);
  const top = await sharp(png).extract({ left: 0, top: 0, width: W, height: cut }).resize(u.w, u.topH, { fit: 'fill' }).png().toBuffer();
  const bot = await sharp(png).extract({ left: 0, top: cut, width: W, height: H - cut }).resize(u.w, u.h - u.topH, { fit: 'fill' }).png().toBuffer();
  return sharp({ create: { width: u.w, height: u.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: top, left: 0, top: 0 }, { input: bot, left: 0, top: u.topH }]);
}

/** 이 ID·기본 긴 변(long)의 배수. 기본 단계 = 1, hi 단계 = hiK(긴 변 상한 2048 반영), 0 = 만들지 않음 */
const kOf = (id, long) => { if (!HI) return 1; const k = hiK(id, long); return k ? Math.min(k, capOf(id) / long) : 0; };
const R = (n, k) => Math.round(n * k);

async function run(id, file) {
  if (keyed(id)) {
    const buf = await key(file, id);
    const sq = (s, k) => sharp(buf).resize(R(s, k), R(s, k));
    if (FREE[id]) { const [n, q] = FREE[id], k = kOf(id, n); if (!k) return false; return webp(sharp(buf).resize(R(n, k), R(n, k), { fit: 'inside' }), q, outName(id) + '.webp'); }
    const rs = /^RS-/.test(id) && rsSpec(id);
    if (/^RS-/.test(id)) {
      if (!rs) throw new Error(`RS 규격 없음: ${id}`);
      const [kind, n, q] = rs;
      const k = kOf(id, kind === 'box' ? Math.max(...n) : n);
      if (!k) return false;
      const img = kind === 'w' ? sharp(buf).resize(R(n, k), null) : kind === 'box' ? sharp(buf).resize(R(n[0], k), R(n[1], k), { fit: 'fill' }) : sq(n, k);
      return webp(img, q, id + '.webp');
    }
    const es = /^END-/.test(id) && endSpec(id);
    if (/^END-/.test(id)) {
      if (!es) throw new Error(`END 규격 없음: ${id}`);
      const [kind, n, q] = es;
      const k = kOf(id, Array.isArray(n) ? Math.max(...n) : n);
      if (!k) return false;
      const img = kind === 'frame9' ? await frame9(buf, R(n[0], k), R(n[1], k)) : kind === 'long' ? sharp(buf).resize(R(n, k), R(n, k), { fit: 'inside' })
        : kind === 'fill' ? sharp(buf).resize(R(n[0], k), R(n[1], k), { fit: 'fill' }) : sq(n, k);
      return webp(img, q, id + '.webp');
    }
    if (isTile(id)) { const k = kOf(id, 512); return k ? webp(sq(512, k), 85, id + '.webp') : false; } // R5d 칸: 512(줌 1.8 × 128 = 230)
    if (id === 'PLAZA') { if (HI) return false; await plazaMasks(buf, 1944); return webp(sharp(buf).resize(1944, null), 85, 'PLAZA.webp'); } // 원본 1877 → 1944(×1.036). 옛 광장(매니페스트 밖) — hi 없음
    if (id === 'PLAZA-U5') { const k = kOf(id, U5.w); await plazaMasks(buf, null, img => plazaU5(img, k), 'PLAZA-U5'); return webp(await plazaU5(sharp(buf), k), HI ? 76 : 85, 'PLAZA-U5.webp'); } // hi 2880 은 q76(600KB 상한 — q85 는 740KB)
    if (id === 'UI-signpost') { const k = kOf(id, 256); return k ? webp(await signpost(buf, R(256, k)), 90, id + '.webp') : false; }
    // P01 1024: 인트로 200px·로비 슬롯 330px (R2 A4). P13 1024: 문항 옆 고민 포즈(R2 D6, P10 과 교대)
    if (/^CH\d-P(01|10|11|12|13|18|20|21)$/.test(id) || /^LM-/.test(id)) { const k = kOf(id, 1024); if (k) await webp(sq(1024, k), 85, id + '@1024.webp'); }
    if (/^CH\d-P19$/.test(id)) { const k = kOf(id, 512); return k ? webp(sq(512, k), 88, id + '.webp') : false; } // 빼꼼 반신(R2 A2): 하단 중앙 = 허리선 중앙
    const one = (n, q, name = id) => { const k = kOf(id, n); return k ? webp(sq(n, k), q, name + '.webp') : false; };
    if (id === 'UI-sign-small') return one(256, 90);
    if (id === 'UI-logo') return one(512, 90);
    if (/^ISL/.test(id)) return one(512, 85, outName(id)); // R2 A1: 섬 전부 512
    // U8 §17.1.3·§17.2.1: 컵 512 · 주사위 눈·버스트·세로 깃발 256 · 삼각기·발코니 128(아이콘 규칙)
    if (/^DICE-cup-/.test(id)) return one(512, 90);
    if (/^(DICE-(top|sum)|FLAG-tall)/.test(id)) return one(256, 90);
    if (icon(id)) return one(128, 90);
    return one(256, /^CH/.test(id) ? 88 : 85);
  }
  if (id === 'END-photo-bg') { const [n, q] = [END[id][1], END[id][2]], k = kOf(id, n[0]); return k ? webp(sharp(file).resize(R(n[0], k), R(n[1], k), { fit: 'cover' }).removeAlpha(), q, id + '.webp') : false; } // U12 사진 배경: 키잉 0, 3:2 cover
  if (/^(MC-|mp_)/.test(id)) { const k = kOf(id, 512); return k ? webp(sharp(file).resize(R(512, k), R(512, k), { fit: 'cover' }).removeAlpha(), 85, id + '.webp') : false; } // U1 미션 그림 카드·묶음 2 미션 사진 1:1
  if (id === 'UI-rotate') { const k = kOf(id, 768); return k ? webp(sharp(file).resize(R(768, k), null).removeAlpha(), 82, id + '.webp') : false; } // U1 세로 안내 일러스트(폭 768)
  if (id === 'UI-rotate-wide') { const k = kOf(id, 1024); return k ? webp(sharp(file).resize(R(1024, k), R(576, k), { fit: 'cover' }).removeAlpha(), 82, id + '.webp') : false; } // U4 가로판 16:9(폭 1024)
  if (/^(CC|EV)-/.test(id) || /^[a-z]{2}_/.test(id)) { // CC·EV, 묶음 2 해설 카드 그림(<cc>_<이름>)
    const k = kOf(id, 1440);
    if (!k) return false;
    const m = await sharp(file).metadata(), h = Math.round(m.width / 2.5);
    return webp(sharp(file).extract({ left: 0, top: Math.round((m.height - h) / 2), width: m.width, height: h }).resize(R(1440, k), R(576, k)), 82, id + '.webp');
  }
  // CUT-nn·BG·구름·광선: 16:9 가운데 crop
  const k = kOf(id, 1536);
  return k ? webp(sharp(file).resize(R(1536, k), R(864, k), { fit: 'cover' }).removeAlpha(), 82, id + '.webp') : false;
}

const srcOf = f => (srcFiles.has(f) ? join(SRC, f) : join(FALLBACK, f));
let n = 0;
for (let i = 0; i < ids.length; i += 8)
  await Promise.all(ids.slice(i, i + 8).map(id => run(id, srcOf(latest[id].file)).then(r => { if (r !== false) n++; })));
writeFileSync(join(OUT, 'versions.json'), JSON.stringify(latest, null, 1));
if (Object.keys(POSES).length) writeFileSync(join(OUT, 'poses.json'), JSON.stringify(POSES, null, 1));
console.log(HI ? 'hi' : 'base', 'converted', n, 'of', ids.length, 'src', SRC);
