// 에셋 매니페스트 조회. 코드는 파일 경로 대신 키만 쓴다(assets/manifest.json 이 키 -> 파일).
// 키: tile.<n>(30칸, R5d TILE) plaza plaza.mask.<대륙> ui.signpost building.<n>.<1-3> landmark.<n>[.big] culture.<n> cutscene.<n> char.<c>.p<NN>[.big]|f00
//     card.<cardId>(th-2, aq-s1) item.<보상> event.<k> ui.<k> bgm.<k> + 묶음 2 optional(badge.<n> card.<cardId>)
import raw from '../../assets/manifest.json';

type Entry = string | { file: string; optional?: boolean; fallback?: string };
const entries = raw.entries as Record<string, Entry>;
const file = (e: Entry) => (typeof e === 'string' ? e : e.file);

// 지연 로드 대상: 컷씬·카드·배지·미션·결과 화면 그림(result.*, U6 — 결과 화면이 뜰 때 받는다)·고해상(.big)·BGM, 캐릭터 P01 외 포즈·랜드마크 배지·건물 2~3단계(게임 시작 때 gameStartKeys 로 받는다).
// 첫 로드(로비) 세트 = 나머지. 합계 ≤ 3MB 는 assets.test 가 지킨다.
const LAZY = /^(cutscene|culture|event|card|badge|mission|mc|result)\.|\.big$|^bgm\.|^char\.\d+\.p(?!01$)|^landmark\.\d+$|^building\.\d+\.[23]$/;
export const isLazy = (key: string) => LAZY.test(key);

export const hasAsset = (key: string) => key in entries;

/** 카드 자료 파일(cards.json image·image2, .png) → card.* 키. 문항 단계엔 카드 id 를 모르므로 파일 이름으로 찾는다 */
const CARD_BY_FILE = new Map(Object.entries(entries).filter(([k]) => k.startsWith('card.')).map(([k, e]) => [file(e).replace(/^webp\/|\.webp$/g, ''), k]));
export const cardAssetOf = (image: string) => CARD_BY_FILE.get(image.replace(/\.png$/, ''));

/** 키의 URL. 모르는 키면 경고 1회 뒤 null. */
export function assetUrl(key: string): string | null {
  const e = entries[key];
  if (!e) { warnOnce(key, '매니페스트에 없는 키'); return null; }
  return import.meta.env.BASE_URL + file(e);
}

/** optional 항목의 대체 키(없거나 'none' 이면 undefined). 호출 쪽이 색 블록으로 내려간다. */
export function fallbackOf(key: string): string | undefined {
  const e = entries[key];
  const fb = typeof e === 'object' ? e.fallback : undefined;
  return fb && fb !== 'none' ? fb : undefined;
}

const warned = new Set<string>();
/** 같은 키는 콘솔 경고 1회만(반복 0). */
export function warnOnce(key: string, why: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[assets] ${key}: ${why}`);
}
export const _resetWarned = () => warned.clear(); // 테스트용

/** 판 그림(R4 T-A): 칸 30·광장·대륙 마스크·이정표 ≈ 3.4MB. 첫 로드(≤ 3MB, PRD §11)에 넣으면 넘쳐서
 *  로비에서 첫 로드가 끝난 뒤 바로 이어 받는다(app.tsx) — 게임 시작 때는 이미 캐시에 있다. */
const BOARD = /^(tile\.\d+|plaza(\.mask\.\w+)?|ui\.signpost)$/;
export const boardKeys = () => Object.keys(entries).filter(k => BOARD.test(k));

/** 세로 안내 가로판(U4): 움직임을 줄인 기기는 요청하지 않으므로 첫 로드 세트에서 뺀다(app.tsx 가 동작 허용일 때만 붙인다) */
export const ROTATE_WIDE = 'ui.rotate-wide';

/** 첫 로드(로비) 세트: 지연 대상이 아닌 이미지 키 전부(판 그림 제외 — boardKeys, 세로 안내 가로판 제외 — ROTATE_WIDE). */
export const bootKeys = () => Object.keys(entries).filter(k => !isLazy(k) && !BOARD.test(k) && k !== ROTATE_WIDE && !k.startsWith('badge.') && file(entries[k]).endsWith('.webp'));

/** 도착 칸 n 이 확정되면 미리 받을 키(주사위 결과 시점). 없는 키는 걸러진다. */
export const tileLazyKeys = (n: number) =>
  [`culture.${n}`, `cutscene.${n}`, `landmark.${n}.big`, `badge.${n}`].filter(hasAsset);

/** 게임 시작 때 받아 둘 키: 캐릭터 P01 외 보드 포즈, 랜드마크 배지, 건물 2~3단계(.big 은 컷씬 직전에). */
export const gameStartKeys = () => Object.keys(entries).filter(k => /^(char\.\d+\.p\d+|landmark\.\d+|building\.\d+\.[23])$/.test(k) && isLazy(k));
