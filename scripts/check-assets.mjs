// 에셋 검사(PRD §11, DESIGN §14.2): 매니페스트 항목의 파일 존재·WebP 형식·치수·용량. 순수 Node, 의존성 0.
// 필수 항목이 하나라도 없거나 규격 밖이면 목록을 찍고 exit 1. optional(묶음 2) 은 없어도 fallback 이 있으면 통과.
// 사용: node scripts/check-assets.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.ASSETS_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'assets'); // ASSETS_ROOT 는 테스트용
const MAX_BYTES = 600 * 1024;

// 규칙: 위에서 첫 일치. exact = 정확히 그 크기, max = 가로·세로 상한, min = 긴 변 하한.
// R4 A5 줌 규칙(DESIGN §16.6): 판(world) 레이어 그림은 원본 긴 변 ≥ 표시 × 1.8 —
// 칸 128→230, 캐릭터 44→79, 건물 36→65, 깃발 16→29, 이정표 판 96(그림 폭 109)→196, 광장 1080→1944.
// 2026-10-29 U5(§16.9.1·§16.9.2): 칸 상자 124→224, 귀퉁이 전신 캐릭터 96→173(말과 같은 포즈 파일), 광장 1080×390→1944×702.
const ZOOM = 1.8;
const RULES = [
  [/^tile\.\d+$/, { exact: [512, 512], min: Math.ceil(124 * ZOOM) }], // R5d 칸 512 (U5 상자 124)
  [/^plaza$/, { min: Math.ceil(1080 * ZOOM), max: 1944 }], // 광장 긴 변 1944
  [/^plaza\.mask\./, { max: 1944 }], // 대륙 마스크 5(광장과 같은 크기)
  [/^ui\.signpost$/, { exact: [256, 171], min: Math.ceil(109 * ZOOM) }], // 판+짧은 기둥(키잉 때 기둥을 잘라 붙임)
  // U8 §17.1.3 주사위 B(HUD — 줌 없음): 컵 512(높이 110 × 2 = 220) · 쟁반 폭 800 · 눈 6장 256(60 × 2) · 버스트 256(128)
  [/^dice\.cup\./, { exact: [512, 512] }],
  [/^dice\.tray$/, { max: 800, min: 400 }],
  [/^dice\.(face\.[1-6]|burst)$/, { exact: [256, 256] }],
  // U8 §17.2.1 땅 표시 C2(판 — 줌 1.8): 세로 깃발 256(길이 44 × 1.8 = 80) · 삼각기 128 · 발코니 128(24 × 1.8 = 44)
  [/^own\.flag\.[1-4]$/, { exact: [256, 256], min: Math.ceil(44 * ZOOM) }],
  [/^own\.(pennant|balcony)\.[1-4]$/, { exact: [128, 128], min: Math.ceil(24 * ZOOM) }],
  [/^(culture|event|card)\./, { exact: [1440, 576] }],
  [/^mission\./, { exact: [512, 512] }], // 묶음 2 미션 사진 1:1
  [/^mc\./, { exact: [512, 512] }], // U1 미션 그림 카드 1:1
  [/^ui\.rotate$/, { max: 1536 }], // U1 세로 안내 일러스트(폭 768 × 1365)
  [/^ui\.rotate-wide$/, { exact: [1024, 576] }], // U4 세로 안내 가로판 16:9(폭 1024)
  [/\.big$/, { max: 1024 }], // 컷씬용 1024 (랜드마크·캐릭터 P10~13·18)
  [/^char\.\d+\.p19$/, { exact: [512, 512] }], // 문화 카드 빼꼼 반신(R2 A2·D7)
  [/^char\.\d+\.p\d\d$/, { max: 256, min: Math.ceil(96 * ZOOM) }], // U5 포즈: 귀퉁이 전신 96 × 1.8
  [/^char\./, { max: 256, min: Math.ceil(44 * ZOOM) }],
  [/^building\./, { max: 512, min: Math.ceil(36 * ZOOM) }],
  [/^landmark\./, { max: 512 }],
  [/^(cutscene|ui\.boardBg)/, { max: 1536 }],
  [/^ui\.logo$/, { max: 512 }],
  // R2 T-A A3 첫 화면·팝업·결과 단상
  [/^logo\.v2$/, { max: 1024 }],
  [/^ui\.stage$/, { max: 1536 }],
  [/^ui\.plank$/, { max: 1024 }],
  [/^ui\.sign$/, { max: 256 }],
  // U6 결과 화면 그림 RS-*(DESIGN §16.7.3)
  [/^result\.isle\.\d$/, { exact: [512, 512] }],
  [/^result\.trophy$/, { exact: [256, 256] }],
  [/^result\.(medal|stamp)\./, { exact: [128, 128] }],
  [/^result\.(pin|dot\.\w+)$/, { exact: [64, 64] }],
  [/^result\.tab-ring\.\d$/, { exact: [96, 96] }],
  [/^result\.scroll$/, { exact: [768, 1024] }],
  [/^result\.confetti$/, { exact: [512, 512] }],
  [/^result\.banner$/, { max: 1560 }],
  [/^result\.scroll-wide$/, { max: 1536 }],
  [/^result\.line-chip$/, { max: 880 }],
  [/^result\.map-board$/, { max: 704 }],
  [/^result\.plate\.\d$/, { max: 600 }],
  [/^result\.btn-blue$/, { max: 440 }],
  [/^result\.souv-stand$/, { max: 168 }],
  [/^(ui|item|badge)\./, { max: 128 }],
];

// U9 고해상 단계 하한(긴 변): 1920×1080·장치 배율 2 에서 잰 장치 px(U9-hires-shots/measure-before.json), 2048 넘으면 2048.
// 판(world)은 줌 1.8 포함. 이 목록의 키는 hi 가 있어야 한다(없으면 실패).
const HI_CAP = 2048;
// U9 후속 판정(2026-10-30 사용자): 광장(+ 대륙 마스크)만 긴 변 2880 — 1920 PC 줌 광장 2833 장치 px(배율비 ≥ 1). PC 만 쓴다(manifest.ts)
const HI_CAP_OF = (key) => (/^plaza(\.mask\.\w+)?$/.test(key ?? '') ? 2880 : HI_CAP);
const HI_MIN = [
  [/^tile\.\d+$/, 627], // 칸 줌 627
  [/^plaza(\.mask\.\w+)?$/, 2833], // 광장 줌 2833@dpr1(1920 PC) — 상한 2880(dpr2 5666 은 예외)
  [/^dice\.burst$/, 360], // U8 합 버스트 128 → 1920 dpr2 360
  [/^ui\.signpost$/, 551],
  [/^ui\.sign$/, 545], // 간판 9-slice 가운데(184 px)가 장치 439 px 로 → 256 × 2.13
  [/^char\.\d+\.p19$/, 611], // 문화 카드 빼꼼
  [/^char\.\d+\.p1[023]\.big$/, 2048], // 문항 옆 고민 포즈 2530 → 상한
  [/^char\.\d+\.p\d\d$/, 498], // 보드 캐릭터 줌
  [/^landmark\.\d+\.big$/, 1253], // 컷씬 랜드마크
  [/^(cutscene|ui\.boardBg)/, 2048], // 화면 가득 3840 → 상한
  [/^(culture|event|card)\./, 2048], // 2319 → 상한
  [/^(mission|mc)\./, 582],
  [/^ui\.stage$/, 2048],
  [/^logo\.v2$/, 1687],
  [/^result\.scroll$/, 1822],
  [/^result\.banner$/, 2048],
  [/^result\.isle\.\d$/, 787],
  [/^(ui|item)\.(dice|missionEmblem|chest)$/, 281],
];

/** WebP 헤더에서 [w, h] 를 읽는다. WebP 가 아니면 null. */
function webpSize(buf) {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const fourcc = buf.toString('latin1', 12, 16);
  if (fourcc === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  if (fourcc === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1];
  }
  if (fourcc === 'VP8X') return [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
  return null;
}

/** fallback 사슬이 자기 자신으로 돌아오면 true. */
function cyclic(entries, key) {
  const seen = new Set();
  for (let k = key; k && k !== 'none'; ) {
    if (seen.has(k)) return true;
    seen.add(k);
    const e = entries[k];
    k = typeof e === 'object' ? e.fallback : undefined;
  }
  return false;
}

function check(root = ROOT) {
  const { entries } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const errors = [];
  const info = [];
  const used = new Set();
  for (const [key, v] of Object.entries(entries)) {
    const { file, optional = false, fallback } = typeof v === 'string' ? { file: v } : v;
    used.add(file);
    const path = join(root, file);
    if (!existsSync(path)) {
      if (!optional) errors.push(`누락(필수): ${key} -> ${file}`);
      else if (!fallback) errors.push(`optional 인데 fallback 없음: ${key}`);
      else if (fallback !== 'none' && !(fallback in entries)) errors.push(`fallback 키 없음: ${key} -> ${fallback}`);
      else if (cyclic(entries, key)) errors.push(`fallback 순환: ${key}`);
      else info.push(key);
      continue;
    }
    if (file.endsWith('.mp3')) { // 0바이트·잘린 파일 방지: ID3 태그 또는 MPEG 프레임 동기(0xFFEx)로 시작
      const b = readFileSync(path);
      const ok = b.length > 0 && (b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));
      if (!ok) errors.push(`mp3 아님·빈 파일: ${key} -> ${file}`);
      continue;
    }
    if (!file.endsWith('.webp')) continue;
    const buf = readFileSync(path);
    const size = webpSize(buf);
    if (!size) { errors.push(`WebP 아님: ${key} -> ${file}`); continue; }
    if (buf.length > MAX_BYTES) errors.push(`600KB 초과: ${key} ${(buf.length / 1024).toFixed(0)}KB`);
    const rule = RULES.find(([re]) => re.test(key))?.[1];
    if (!rule) { errors.push(`규격 규칙 없음: ${key}`); continue; }
    const [w, h] = size;
    if (rule.exact && (w !== rule.exact[0] || h !== rule.exact[1])) errors.push(`치수 ${w}x${h} (필요 ${rule.exact.join('x')}): ${key}`);
    if (rule.max && Math.max(w, h) > rule.max) errors.push(`치수 ${w}x${h} (상한 ${rule.max}): ${key}`);
    if (rule.min && Math.max(w, h) < rule.min) errors.push(`치수 ${w}x${h} (줌 하한 ${rule.min}): ${key}`);
  }
  // U9 고해상 단계(hi): manifest.hi 의 파일마다 webp/hi/<같은 이름> — WebP·600KB 이하·긴 변 ≤ 2048·기본보다 큼·비율 같음(±1.5%),
  // 그리고 HI_MIN(1920×1080·dpr 2·줌 1.8 실측 장치 px, 상한 2048)을 넘는다
  const hiRaw = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).hi; // hi 목록이 없는 매니페스트(옛 형식)는 hi 검사 생략
  const hi = hiRaw ?? [];
  const keyOf = new Map(Object.entries(entries).map(([k, v]) => [typeof v === 'string' ? v : v.file, k]));
  for (const f of hi) {
    if (!used.has(f)) { errors.push(`hi 인데 매니페스트 항목 없음: ${f}`); continue; }
    const hp = join(root, f.replace(/^webp\//, 'webp/hi/'));
    if (!existsSync(hp)) { errors.push(`hi 누락: ${f}`); continue; }
    const hb = readFileSync(hp), hs = webpSize(hb), bs = existsSync(join(root, f)) ? webpSize(readFileSync(join(root, f))) : null;
    if (!hs) { errors.push(`hi WebP 아님: ${f}`); continue; }
    if (hb.length > MAX_BYTES) errors.push(`hi 600KB 초과: ${f} ${(hb.length / 1024).toFixed(0)}KB`);
    const L = Math.max(...hs), cap = HI_CAP_OF(keyOf.get(f));
    if (L > cap) errors.push(`hi 치수 ${hs.join('x')} (상한 ${cap}): ${f}`);
    if (bs) {
      if (L <= Math.max(...bs)) errors.push(`hi 가 기본보다 크지 않음 ${hs.join('x')} ≤ ${bs.join('x')}: ${f}`);
      if (Math.abs(hs[0] / hs[1] - bs[0] / bs[1]) > 0.015 * (bs[0] / bs[1])) errors.push(`hi 비율 다름 ${hs.join('x')} vs ${bs.join('x')}: ${f}`);
    }
    const key = keyOf.get(f), need = HI_MIN.find(([re]) => re.test(key))?.[1];
    if (need && L < need) errors.push(`hi 치수 ${hs.join('x')} (고해상 하한 ${need}): ${key} -> ${f}`);
  }
  const hiSet = new Set(hi);
  for (const [key, v] of Object.entries(entries)) {
    const f = typeof v === 'string' ? v : v.file;
    if (hiRaw && f.endsWith('.webp') && existsSync(join(root, f)) && HI_MIN.some(([re]) => re.test(key)) && !hiSet.has(f)) errors.push(`고해상(hi) 없음: ${key} -> ${f}`);
  }
  // 매니페스트에 안 걸린 webp: 정보만(실패 아님)
  const orphans = readdirSync(join(root, 'webp')).filter(f => f.endsWith('.webp') && !used.has(`webp/${f}`));
  return { errors, optionalMissing: info, orphans, total: Object.keys(entries).length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = check();
  console.log(`check-assets: 항목 ${r.total}, optional 미생성 ${r.optionalMissing.length} (fallback 있음), 매니페스트 밖 webp ${r.orphans.length}`);
  if (r.orphans.length) console.log(`  매니페스트 밖: ${r.orphans.join(' ')}`);
  if (r.errors.length) {
    console.error(`check-assets: 실패 ${r.errors.length}건`);
    for (const e of r.errors) console.error('  ' + e);
    process.exit(1);
  }
  console.log('check-assets: OK');
}
