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
  [/^ui\.flag\./, { max: 128, min: Math.ceil(16 * ZOOM) }],
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
