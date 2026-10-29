// 활동 자료 그림. 키가 없거나 로드에 실패하면 fallback(글자)을 그린다 → 대체 글자 카드가 되고, 활동은 멈추지 않는다.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { assetUrl, hasAsset, warnOnce } from '../../assets/manifest';

export const missionKey = (file: string) => `mission.${file.replace(/\.\w+$/, '')}`;

export interface MissionImgProps {
  file?: string;
  /** 그림에 붙는 이름(스크린리더용). 글자로는 보이지 않는다 */
  label: string;
  /** 그림이 없거나 로드 실패일 때 대신 보일 것(글자 카드) */
  fallback?: ComponentChildren;
  /** 시험용: 주소를 직접 정한다(기본 = 매니페스트) */
  urlFor?: (key: string) => string | null;
}

export function MissionImg({ file, label, fallback, urlFor }: MissionImgProps) {
  const [bad, setBad] = useState(false);
  const key = file ? missionKey(file) : null;
  const url = key ? (urlFor ? urlFor(key) : hasAsset(key) ? assetUrl(key) : null) : null;
  if (!url || bad) return <>{fallback}</>;
  return <img class="mi-img" src={url} alt={label} decoding="async" draggable={false}
    onError={() => { warnOnce(key!, `로드 실패 ${url}`); setBad(true); }} />;
}
