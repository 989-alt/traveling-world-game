// 세계 지도(Natural Earth, assets/maps). 색은 missions.css 가 입히고, 글자는 얹지 않는다.
// R4-TF2 수정 1(v3 05): 대륙을 도톰하게 — 아래 두꺼운 옆면 + 그림자 + 위 가장자리 밝은 선(SVG 필터 wm-raise).
// landmarks: 대륙마다 작은 랜드마크 그림(지도 위 장식). 자리 표시(㉠)와 겹치지 않게 대륙 한쪽에 둔다.
import worldSvg from '../../../assets/maps/world.svg?raw';
import { assetUrl, hasAsset } from '../../assets/manifest';
import { BOARD } from '../../shared/board';
import { spotPct, type MapMode } from './map-spots';

const RAISE = `<filter id="wm-raise" x="-3%" y="-3%" width="106%" height="112%" color-interpolation-filters="sRGB">
<feOffset in="SourceAlpha" dy="1.6" result="dn"/><feFlood flood-color="#0b1a40" flood-opacity=".45"/><feComposite in2="dn" operator="in" result="side"/>
<feGaussianBlur in="SourceAlpha" stdDeviation="1.4" result="bl"/><feOffset in="bl" dy="2.8" result="sh"/><feFlood flood-color="#0b1a40" flood-opacity=".35"/><feComposite in2="sh" operator="in" result="shadow"/>
<feOffset in="SourceAlpha" dy="0.7" result="sa"/><feComposite in="SourceAlpha" in2="sa" operator="out" result="rim"/><feFlood flood-color="#fff" flood-opacity=".75"/><feComposite in2="rim" operator="in" result="hi"/>
<feMerge><feMergeNode in="shadow"/><feMergeNode in="side"/><feMergeNode in="SourceGraphic"/><feMergeNode in="hi"/></feMerge></filter>`;
const SVG = worldSvg.replace('<defs>', `<defs>${RAISE}`);

/** 대륙 랜드마크: 보드 나라 칸의 랜드마크 그림을 그 나라 근처(경도·위도)에 */
const MARKS: [country: string, lon: number, lat: number][] = [
  ['중국', 118, 24], ['프랑스', -2, 42], ['이집트', 34, 25], ['미국', -82, 31], ['브라질', -44, -24],
];
const tileOf = (name: string) => BOARD.find((t) => t.name === name)?.index;

export function WorldMap({ mode, zones, landmarks }: { mode: MapMode; zones?: string[]; landmarks?: boolean }) {
  return (
    <div class="wm" data-mode={mode} data-zones={zones?.join(' ')} aria-hidden="true">
      <div class="wm-svg" dangerouslySetInnerHTML={{ __html: SVG }} />
      {landmarks && MARKS.map(([c, lon, lat]) => {
        const k = `landmark.${tileOf(c)}`;
        const url = hasAsset(k) ? assetUrl(k) : null;
        if (!url) return null;
        const p = spotPct(lon, lat);
        return <img key={c} class="wm-mark" src={url} alt="" draggable={false} style={{ left: `${p.x}%`, top: `${p.y}%` }} />;
      })}
    </div>
  );
}
