// 기후 그래프: 데이터로 SVG 를 그린다(그림 파일 아님). 두 도시 이상이면 나란히.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { CITIES, type CityKey } from './climate-data';
import { chartModel, H, LEGEND, W } from './chart-model';

export interface ClimateChartProps {
  cities: CityKey[];
  /** false = 수치 없는 모양 비교(눈금 숫자 없음) */
  showValues?: boolean;
  /** 범례(막대·선이 무엇인지). 그래프 읽는 법을 묻는 활동에서는 끈다 */
  legend?: boolean;
  /** true = 칸 크기(화면 px)를 재서 그 크기로 그린다: 칸이 좁아도 눈금 글자가 CSS 크기(13px) 그대로(문항·해설 카드, DESIGN §5) */
  fit?: boolean;
}

/** 첫 그래프 칸의 레이아웃 크기(px). 크기가 바뀌면 다시 잰다 */
function useBox(on: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.firstElementChild as SVGSVGElement | null | undefined;
    if (!on || !el) return;
    const read = () => {
      // 레이아웃 크기(변환 전)를 내림: viewBox ≤ 실제 크기라 배율 ≥ 1, 글자가 CSS 크기보다 작아지지 않는다
      const cs = getComputedStyle(el);
      const w = Math.floor(parseFloat(cs.width)), h = Math.floor(parseFloat(cs.height));
      if (w > 0 && h > 0) setBox((b) => (b && b.w === w && b.h === h ? b : { w, h }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [on]);
  return [ref, on ? box : null] as const;
}

export function ClimateChart({ cities, showValues = true, legend = true, fit = false }: ClimateChartProps) {
  const [rowRef, box] = useBox(fit);
  return (
    <figure class="cg" data-count={cities.length} data-fit={fit ? (box ? '1' : '0') : undefined} aria-label={`기후 그래프: ${cities.map((c) => CITIES[c].name).join(', ')}`}>
      <div class="cg-row" ref={rowRef}>
        {cities.map((key) => {
          const m = chartModel(CITIES[key], showValues, box ?? undefined);
          const { x, y, w, h } = m.plot;
          return (
            <svg key={key} class="cg-svg" viewBox={`0 0 ${box?.w ?? W} ${box?.h ?? H}`} role="img" aria-label={`${m.title} 월별 기온과 강수량`} data-city={key}>
              <text class="cg-city" x={x + w / 2} y={11}>{m.title}</text>
              <rect class="cg-plot" x={x} y={y} width={w} height={h} />
              {m.leftTicks.map((t) => <line key={`g${t.y}`} class="cg-grid" x1={x} x2={x + w} y1={t.y} y2={t.y} />)}
              {m.bars.map((b, i) => <rect key={i} class="cg-bar" x={b.x} y={b.y} width={b.w} height={b.h} />)}
              <path class="cg-line" d={m.line} />
              {m.dots.map((d, i) => <circle key={i} class="cg-dot" cx={d.x} cy={d.y} r={3} />)}
              {m.leftTicks.map((t) => <text key={`l${t.y}`} class="cg-tick cg-tick--l" x={x - 4} y={t.y + 4}>{t.text}</text>)}
              {m.rightTicks.map((t) => <text key={`r${t.y}`} class="cg-tick cg-tick--r" x={x + w + 4} y={t.y + 4}>{t.text}</text>)}
              {m.xLabels.map((t) => <text key={t.text} class="cg-tick cg-tick--x" x={t.x} y={y + h + 16}>{t.text}</text>)}
              <text class="cg-unit" x={x + w + 4} y={(box?.h ?? H) - 4}>월</text>
              {showValues && <text class="cg-unit cg-tick--l" x={x - 4} y={10}>℃</text>}
              {showValues && <text class="cg-unit" x={x + w + 4} y={10}>mm</text>}
            </svg>
          );
        })}
      </div>
      {legend && (
        <figcaption class="cg-legend">
          <span class="cg-key"><i class="cg-swatch cg-swatch--bar" />{LEGEND.bar}</span>
          <span class="cg-key"><i class="cg-swatch cg-swatch--line" />{LEGEND.line}</span>
        </figcaption>
      )}
    </figure>
  );
}
