// 미션 짝(정답)이 그림·아이콘만으로 드러나지 않는지
// R4-TF2 리뷰 m-06: 핀란드·빙판 위 운전면허 시험이 둘 다 ❄️
// R4-final 리뷰: 키는 달라도 같은 나라·같은 장면 그림(필리핀 계단식 논 둘, 통발 고기잡이가 그려진 콩고강 급류)이면 드러난다
import { describe, expect, it } from 'vitest';
import manifest from '../../../assets/manifest.json';
import missions from '../../data/missions.json';
import type { Mission } from '../../shared/content-types';
import { BOARD } from '../../shared/board';
import { artOf } from './art';

/** 화면에 실제로 보이는 것: 그림이 있으면 그림 키, 없으면 아이콘 */
const shown = (label: string) => { const a = artOf(label); return a.key ? `img:${a.key}` : `icon:${a.icon}`; };

/** 미션 사진이 찍힌 나라(장소가 특정 나라인 것만). 일반 장면(고상 가옥·흙벽돌 집 등)은 없음 */
const MP_COUNTRY: Record<string, string> = {
  mp_himalaya: 'np', mp_everest: 'np', mp_alps: 'ch', mp_huanghe: 'cn', mp_sognefjord: 'no', mp_maunaloa: 'us',
  mp_rocky: 'ca', mp_elarco: 'mx', mp_korea_mudflat: 'kr', mp_canada_mudflat: 'ca', mp_fundy: 'ca', mp_uluru: 'au',
  mp_roraima: 've', mp_benagil: 'pt',
};

/** 그림 키 → 나라 접두. card.xx-* · culture.<칸> · mission.mp_* · event.antarctic(남극) */
function countryOf(key: string): string | undefined {
  let m = /^card\.([a-z]{2})-/.exec(key);
  if (m) return m[1];
  m = /^culture\.(\d+)$/.exec(key);
  if (m) return BOARD[Number(m[1])]?.country;
  m = /^mission\.(mp_[a-z_]+)$/.exec(key);
  if (m) return MP_COUNTRY[m[1]];
  if (key === 'event.antarctic') return 'aq';
  return undefined;
}

/** 그림 키 → 원본 장면(파일 이름 줄기, -v2 같은 판 꼬리 뗌) */
const entries = (manifest as unknown as { entries: Record<string, string | { file: string }> }).entries;
function sceneOf(key: string): string {
  const e = entries[key];
  const file = typeof e === 'string' ? e : e?.file ?? key;
  return file.replace(/^.*\//, '').replace(/\.[a-z0-9]+$/i, '').replace(/-v\d+$/, '');
}
/** 줄기가 같거나 한쪽이 다른 쪽의 앞부분이면 같은 장면(ph_terrace ⊂ ph_terrace_hill) */
const sameScene = (a: string, b: string) => { const x = sceneOf(a), y = sceneOf(b); return x === y || x.startsWith(`${y}_`) || y.startsWith(`${x}_`); };

/** 짝 한 쌍의 문제(없으면 null) */
function clash(left: string, right: string): string | null {
  const l = shown(left), r = shown(right);
  if (l === r) return `같은 그림·아이콘 ${l}`;
  const lk = artOf(left).key, rk = artOf(right).key;
  if (!lk || !rk) return null;
  const lc = countryOf(lk), rc = countryOf(rk);
  if (lc && lc === rc) return `같은 나라 ${lc} (${lk} · ${rk})`;
  if (sameScene(lk, rk)) return `같은 장면 ${sceneOf(lk)} · ${sceneOf(rk)}`;
  return null;
}

/** 그림 카드가 실제로 붙는 항목: 연결 = 왼쪽·오른쪽 전부(Connect item), 블록 = 왼쪽 조각만(Placement art — 오른쪽은 지도 자리·글 칸). 나머지 유형은 LabelArt 를 안 쓴다 */
function cardLabels(m: Mission): string[] {
  if (m.type === 'connect') return (m.pairs ?? []).flatMap((p) => [p.left, p.right]);
  if (m.type === 'block') return (m.pairs ?? []).map((p) => p.left);
  return [];
}

describe('미션 짝 그림', () => {
  const all = missions as Mission[];
  // 화면에서 짝의 양쪽 그림이 함께 보이는 것은 연결 미션뿐(블록은 왼쪽 조각만 그림)
  const connects = all.filter((m) => m.type === 'connect' && m.pairs?.length);
  it('미션 40개, 연결 미션이 있다', () => { expect(all.length).toBe(40); expect(connects.length).toBeGreaterThan(0); });
  it.each(connects.map((m) => [m.id, m] as const))('%s: 짝의 양쪽이 같은 그림·나라·장면을 쓰지 않는다', (_, m) => {
    const bad = m.pairs!.map((p) => [p, clash(p.left, p.right)] as const).filter(([, c]) => c).map(([p, c]) => `${p.left} | ${p.right}: ${c}`);
    expect(bad).toEqual([]);
  });

  // U1: 그림 카드 자리에 아이콘으로 떨어지는 항목 0(전 미션). 아이콘은 그림 로드 실패 대체로만 남는다
  it('전 미션 40개: 그림 카드 자리의 모든 항목이 매니페스트에 있는 그림으로 풀린다', () => {
    const icons = all.flatMap((m) => cardLabels(m).filter((l) => !artOf(l).key).map((l) => `${m.id} ${l} → ${artOf(l).icon}`));
    expect(icons).toEqual([]);
    expect(all.flatMap(cardLabels).length).toBeGreaterThan(60); // 세는 법이 비지 않았는지
  });
  it.each(all.filter((m) => cardLabels(m).length).map((m) => [m.id, m] as const))('%s: 한 미션 안 두 항목이 같은 그림 키를 쓰지 않는다', (_, m) => {
    const keys = cardLabels(m).map((l) => artOf(l).key);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it('검사기 자체: 같은 그림·나라·장면을 잡는다', () => {
    expect(countryOf('card.ph-4')).toBe('ph');
    expect(countryOf('culture.19')).toBe('cd');
    expect(countryOf('mission.mp_sognefjord')).toBe('no');
    expect(countryOf('culture.14')).toBe(countryOf('card.no-3'));
    expect(sameScene('card.ph-4', 'card.ph-2')).toBe(true); // ph_terrace_hill · ph_terrace
    expect(sameScene('card.cl-2', 'card.us-4')).toBe(false);
  });

  // 리뷰에서 짚은 짝 + 같은 방식으로 찾은 짝: 왼쪽에 결과가 그려진 그림·같은 나라 그림을 다시 쓰면 실패
  const DENY: [label: string, banned: RegExp][] = [
    ['경사진 땅', /^img:card\.ph-|^img:culture\.1$|^img:mission\.mp_himalaya$/], // 필리핀 계단식 논, 히말라야 사진에도 계단식 밭
    ['콩고강의 급류', /^img:card\.cd-|^img:culture\.19$/], // CC-17·cd_* 에 통발 고기잡이
    ['노르웨이의 하천', /^img:card\.no-|^img:culture\.14$|^img:mission\.mp_sognefjord$/],
    ['짜오프라야강', /^img:card\.th-|^img:culture\.2$/], // 수상 시장
    ['일리노이강의 평야', /^img:card\.(us|cn)-|^img:culture\.(23|3)$/], // cn_compare_illinois = 기계 농사
    ['프랑스 파리', /^img:card\.fr-|^img:culture\.12$/],
    ['풍부한 지하자원', /^img:card\.(ch-4\.b|cl-)/], // 노천 광산 = 광업
    ['냉대', /^img:card\.ru-2$|^img:mission\.mp_(pulp|log_house)$/], // 타이가 그림에 통나무집
    ['햇볕과 모래바람을 막아요', /^img:mission\.mp_sahara$|^img:card\.sa-/], // 사하라 사진에 긴 옷 입은 사람
    ['긴 겨울 추위를 막아 줘요', /^img:mission\.mp_fur_coat$|^img:card\.ca-|^img:event\.climate\.blizzard$/], // 눈 덮인 숲 = 털옷 사진 배경
    ['아름다운 경관', /^img:mission\.mp_(alps|ski|elarco)$/], // 케이블카·관광객
    ['남아메리카', /^icon:🦜$/], // 브라질 문화 카드에 앵무새
  ];
  it.each(DENY)('%s: 짝을 드러내는 그림을 쓰지 않는다', (label, banned) => {
    expect(shown(label)).not.toMatch(banned);
  });
});
