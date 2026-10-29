// 랜드마크 컷씬(DESIGN §12, 숫자야구 홈런 컷씬 방식): 정지 그림 레이어를 코드로 겹쳐 4.0초 타임라인 하나로 움직인다.
// 움직이는 속성은 transform·opacity·clip-path 뿐(WAAPI). 파티클은 canvas 1장. 글자는 전부 코드.
// 그림이 하나라도 못 오면(오류·1.5초 초과) 배너만 2초 — 멈추는 일은 없다. 아무 데나 누르면 건너뛴다.
import { useEffect, useRef, useState } from 'preact/hooks';
import { assetUrl, hasAsset } from '../../assets/manifest';
import { preload } from '../../assets/preload';
import { CUT_MS, HOLD_MS } from '../../shared/protocol';
import { josa } from '../../state/nick';
import { confettiColors, drawConfetti, makeConfetti } from './confetti';
import '../../styles/overlays.css';

export const BANNER_ONLY_MS = 2000;
export const LOAD_LIMIT_MS = 1500;

export interface CutsceneProps {
  tile: number;
  /** 에셋 캐릭터 번호 1~7 */
  charId: number;
  builder: string;
  country: string;
  /** 랜드마크 통행료(코인 칩) */
  toll: number;
  /** 재접속으로 이어 볼 때: 이 기기 시계로 본 컷씬 시작 시각. 그만큼 지난 지점부터 재생, 4초가 지났으면 배너만(DESIGN §12.3) */
  startedAt?: number;
  onDone: () => void;
}

const keysOf = (tile: number, c: number) => ({
  bg: `cutscene.${tile}`, lm: `landmark.${tile}.big`, far: 'cutscene.cloud-far', near: 'cutscene.cloud-near', rays: 'cutscene.rays',
  p18: `char.${c}.p18.big`, p10: `char.${c}.p10.big`, p12: `char.${c}.p12.big`, p11: `char.${c}.p11.big`, coin: 'ui.coin',
});

type Mode = 'loading' | 'play' | 'still' | 'banner';

/** 초 단위 시각 → 4초 타임라인의 offset */
const o = (sec: number) => sec / (CUT_MS / 1000);
type K = Keyframe & { offset: number };
/** [시각(초), 값] 목록 → 키프레임. 같은 시각 두 개는 즉시 바뀜(포즈 교체) */
const track = (prop: string, pts: [number, string | number, string?][]): K[] =>
  pts.map(([t, v, easing]) => ({ offset: Math.min(1, o(t)), [prop]: v, ...(easing ? { easing } : {}) }) as K);
const step = (sec: number) => sec + 0.001;
const BACK_OUT = 'cubic-bezier(0.34, 1.4, 0.64, 1)';

export function Cutscene(p: CutsceneProps) {
  const k = keysOf(p.tile, p.charId);
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [mode, setMode] = useState<Mode>('loading');
  const done = useRef(false);
  const from = useRef(0); // 타임라인을 시작할 지점(ms)
  const finish = () => { if (!done.current) { done.current = true; p.onDone(); } };

  useEffect(() => {
    const need = Object.values(k);
    if (!need.every(hasAsset)) { setMode('banner'); return; }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<boolean[]>((r) => { timer = setTimeout(() => r([false]), LOAD_LIMIT_MS); });
    void Promise.race([preload(need), limit]).then((ok) => {
      clearTimeout(timer);
      if (!live) return;
      from.current = p.startedAt === undefined ? 0 : Math.max(0, Date.now() - p.startedAt);
      setMode(!ok.every(Boolean) || from.current >= CUT_MS ? 'banner' : reduced ? 'still' : 'play');
    });
    return () => { live = false; clearTimeout(timer); };
  }, [p.tile, p.charId]);

  useEffect(() => {
    if (mode === 'loading') return;
    const t = setTimeout(finish, mode === 'play' ? CUT_MS + HOLD_MS - from.current : BANNER_ONLY_MS);
    return () => clearTimeout(t);
  }, [mode]);

  // Enter·Escape·Space 로도 건너뛴다
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') { e.preventDefault(); finish(); } };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  const self = useRef<HTMLDivElement>(null);
  useEffect(() => { self.current?.focus(); }, []);

  const banner = `${josa(p.builder, '이', '가')} ${p.country}에 랜드마크를 세웠어요!`;
  return (
    <div class="cut" ref={self} tabIndex={0} data-mode={mode} role="button" aria-label={`${banner} 누르면 건너뛰어요`} onClick={finish}>
      {mode === 'play' && <Timeline k={k} from={from.current} />}
      {mode === 'still' && (
        <div class="cut-stage">
          <img class="cut-bg" src={assetUrl(k.bg)!} alt="" />
          <img class="cut-lm" src={assetUrl(k.lm)!} alt="" />
          <img class="cut-ch cut-ch--still" src={assetUrl(k.p12)!} alt="" />
        </div>
      )}
      {mode !== 'loading' && (
        <div class={`cut-banner${mode === 'play' ? ' is-timed' : ''}`} data-cut="banner" style={from.current ? { '--cut-from': `${from.current}ms` } : undefined}>
          <p class="cut-banner-text">{banner}</p>
          <span class="cut-coin ov-chip ov-chip--discount">이제 통행료 {p.toll.toLocaleString('ko-KR')}</span>
        </div>
      )}
      <span class="cut-skip">누르면 건너뛰어요</span>
    </div>
  );
}

function Timeline({ k, from }: { k: ReturnType<typeof keysOf>; from: number }) {
  const r = {
    stage: useRef<HTMLDivElement>(null), bg: useRef<HTMLImageElement>(null), far: useRef<HTMLImageElement>(null),
    rays: useRef<HTMLImageElement>(null), lm: useRef<HTMLImageElement>(null), ch: useRef<HTMLDivElement>(null),
    p18: useRef<HTMLImageElement>(null), p10: useRef<HTMLImageElement>(null), p12: useRef<HTMLImageElement>(null),
    p11: useRef<HTMLImageElement>(null), g18: useRef<HTMLImageElement>(null), g10: useRef<HTMLImageElement>(null),
    g12: useRef<HTMLImageElement>(null), flash: useRef<HTMLDivElement>(null), near: useRef<HTMLImageElement>(null),
    ring: useRef<HTMLDivElement>(null), canvas: useRef<HTMLCanvasElement>(null),
  };

  useEffect(() => {
    const opt = { duration: CUT_MS, fill: 'forwards' as const };
    const anims: Animation[] = [];
    const play = (el: Element | null, kf: Keyframe[], extra: KeyframeAnimationOptions = {}) => {
      if (el) anims.push(el.animate(kf, { ...opt, ...extra }));
    };
    // z0 배경 push-in, 샷 3 은 80ms 정지(hit-stop)
    play(r.bg.current, track('transform', [[0, 'scale(1)'], [1, 'scale(1.04)'], [2.2, 'scale(1.08)'], [2.3, 'scale(1.08)'], [4, 'scale(1.1)']]));
    // z1·z6 구름
    play(r.far.current, track('transform', [[0, 'translateX(0)'], [1, 'translateX(-10px)'], [2.2, 'translateX(-22px)'], [2.3, 'translateX(-22px)'], [4, 'translateX(-30px)']]));
    play(r.near.current, track('transform', [[0, 'translateX(0)'], [1, 'translateX(-24px)'], [2.2, 'translateX(-52px)'], [2.3, 'translateX(-52px)'], [4, 'translateX(-68px)']]));
    // z2 광선: 샷 2~3 에서 켜지고 샷 4 에 0.8초 동안 꺼진다
    play(r.rays.current, track('opacity', [[0, 0], [1, 0], [2.2, 0.7], [2.3, 1], [3.1, 0], [4, 0]]));
    play(r.rays.current, track('transform', [[0, 'rotate(0deg)'], [1, 'rotate(0deg)'], [2.2, 'rotate(25deg)'], [4, 'rotate(25deg)']]));
    // z3 랜드마크: 땅에서 솟음(1.1초 back.out), 임팩트에서 1.06 튐
    play(r.lm.current, [
      ...track('transform', [[0, 'translateY(60%) scale(0.6)'], [1, 'translateY(60%) scale(0.6)', BACK_OUT], [2.1, 'translateY(0) scale(1)'], [2.2, 'translateY(0) scale(1)'], [2.26, 'translateY(0) scale(1.06)'], [2.32, 'translateY(0) scale(1)'], [4, 'translateY(0) scale(1)']]),
    ]);
    play(r.lm.current, track('clipPath', [[0, 'inset(0 0 100% 0)'], [1, 'inset(0 0 100% 0)'], [2.1, 'inset(0 0 0% 0)'], [4, 'inset(0 0 0% 0)']]));
    // z4 캐릭터: 등장(0.25초) → 샷 4 홉 두 번
    play(r.ch.current, [
      { offset: 0, transform: 'translateY(40px)', opacity: 0, easing: 'ease-out' },
      { offset: o(0.25), transform: 'translateY(0)', opacity: 1 },
      { offset: o(2.3), transform: 'translateY(0)', opacity: 1, easing: 'ease-out' },
      { offset: o(2.525), transform: 'translateY(-28px)', opacity: 1, easing: 'ease-in' },
      { offset: o(2.75), transform: 'translateY(0)', opacity: 1, easing: 'ease-out' },
      { offset: o(2.975), transform: 'translateY(-28px)', opacity: 1, easing: 'ease-in' },
      { offset: o(3.2), transform: 'translateY(0)', opacity: 1 },
      { offset: 1, transform: 'translateY(0)', opacity: 1 },
    ]);
    // 포즈 교체: P18 경탄 → P10 기대(1.0초) → P12 환호(2.2초) ↔ P11 홉(공중 구간)
    play(r.p18.current, track('opacity', [[0, 1], [1, 1], [step(1), 0], [4, 0]]));
    play(r.p10.current, track('opacity', [[0, 0], [1, 0], [step(1), 1], [2.2, 1], [step(2.2), 0], [4, 0]]));
    play(r.p12.current, track('opacity', [[0, 0], [2.2, 0], [step(2.2), 1], [2.3, 1], [step(2.3), 0], [2.525, 0], [step(2.525), 1], [2.75, 1], [step(2.75), 0], [2.975, 0], [step(2.975), 1], [4, 1]]));
    play(r.p11.current, track('opacity', [[0, 0], [2.3, 0], [step(2.3), 1], [2.525, 1], [step(2.525), 0], [2.75, 0], [step(2.75), 1], [2.975, 1], [step(2.975), 0], [4, 0]]));
    // P10 미세 흔들림 ±1.5° 8Hz (샷 2)
    if (r.p10.current) anims.push(r.p10.current.animate([{ transform: 'rotate(-1.5deg)' }, { transform: 'rotate(1.5deg)' }, { transform: 'rotate(-1.5deg)' }], { duration: 125, delay: 1000, iterations: 9.6 }));
    // z5 잔상(이전 포즈, 120ms·60ms) + 흰 섬광 2프레임(80ms)
    play(r.g18.current, track('opacity', [[0, 0], [1, 0], [step(1), 0.45], [1.12, 0], [4, 0]]));
    play(r.g10.current, track('opacity', [[0, 0], [2.2, 0], [step(2.2), 0.45], [2.32, 0], [4, 0]]));
    play(r.g12.current, track('opacity', [[0, 0], [2.3, 0], [step(2.3), 0.45], [2.36, 0], [4, 0]]));
    play(r.flash.current, track('opacity', [[0, 0], [1, 0], [step(1), 0.9], [1.08, 0], [2.2, 0], [step(2.2), 0.9], [2.28, 0], [4, 0]]));
    // z7 충격파 링 + 화면 흔들림 ±6px 4회 240ms
    play(r.ring.current, [
      { offset: 0, transform: 'translate(-50%, -50%) scale(0)', opacity: 0 },
      { offset: o(2.2), transform: 'translate(-50%, -50%) scale(0)', opacity: 0 },
      { offset: o(2.201), transform: 'translate(-50%, -50%) scale(0)', opacity: 1, easing: 'ease-out' },
      { offset: o(2.5), transform: 'translate(-50%, -50%) scale(3)', opacity: 0 },
      { offset: 1, transform: 'translate(-50%, -50%) scale(3)', opacity: 0 },
    ]);
    play(r.stage.current, track('transform', [[0, 'translate(0, 0)'], [2.2, 'translate(0, 0)'], [2.26, 'translate(6px, -4px)'], [2.32, 'translate(-6px, 4px)'], [2.38, 'translate(6px, 2px)'], [2.44, 'translate(0, 0)'], [4, 'translate(0, 0)']]));
    for (const a of anims) a.currentTime = from; // 재접속: 서버 시각으로 지난 만큼 건너뛴다
    const stopParticles = particles(r.canvas.current, assetUrl(k.coin), from);
    return () => { anims.forEach((a) => a.cancel()); stopParticles(); };
  }, []);

  const src = (key: string) => assetUrl(key) ?? '';
  return (
    <div class="cut-stage" ref={r.stage}>
      <img class="cut-bg" ref={r.bg} src={src(k.bg)} alt="" />
      <img class="cut-screen cut-far" ref={r.far} src={src(k.far)} alt="" />
      <img class="cut-screen cut-rays" ref={r.rays} src={src(k.rays)} alt="" />
      <img class="cut-lm" ref={r.lm} src={src(k.lm)} alt="" />
      <div class="cut-ch" ref={r.ch}>
        <img class="cut-pose" ref={r.p18} src={src(k.p18)} alt="" />
        <img class="cut-pose" ref={r.p10} src={src(k.p10)} alt="" />
        <img class="cut-pose" ref={r.p12} src={src(k.p12)} alt="" />
        <img class="cut-pose" ref={r.p11} src={src(k.p11)} alt="" />
        <img class="cut-pose cut-ghost" ref={r.g18} src={src(k.p18)} alt="" />
        <img class="cut-pose cut-ghost" ref={r.g10} src={src(k.p10)} alt="" />
        <img class="cut-pose cut-ghost" ref={r.g12} src={src(k.p12)} alt="" />
      </div>
      <div class="cut-flash" ref={r.flash} />
      <img class="cut-screen cut-near" ref={r.near} src={src(k.near)} alt="" />
      <div class="cut-ring" ref={r.ring} />
      <canvas class="cut-canvas" ref={r.canvas} width={1366} height={768} />
    </div>
  );
}

/** canvas 한 장: 2.2초에 코인 60개 분출(중력 1.6초), 2.3초에 색종이 40개 낙하(1.7초). 끝나면 스스로 멈춘다 */
function particles(cv: HTMLCanvasElement | null, coinUrl: string | null, from: number): () => void {
  const ctx = cv?.getContext('2d');
  if (!cv || !ctx) return () => {};
  const coin = new Image();
  if (coinUrl) coin.src = coinUrl;
  const colors = confettiColors(cv);
  // 랜드마크 중심(x 64%, y 50%)에서 위로 터진다
  const cx = 1366 * 0.64, cy = 768 * 0.5;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const coins = Array.from({ length: 60 }, () => {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2, v = 500 + rnd() * 600;
    return { vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: 22 + rnd() * 20 };
  });
  const confetti = makeConfetti(rnd, colors);
  const t0 = performance.now() - from;
  let raf = 0;
  const frame = (now: number) => {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, 1366, 768);
    const tc = t - 2.2;
    if (tc > 0 && tc < 1.6) {
      ctx.globalAlpha = Math.min(1, (1.6 - tc) / 0.4);
      for (const c of coins) {
        const x = cx + c.vx * tc, y = cy + c.vy * tc + 0.5 * 1400 * tc * tc;
        if (coin.complete && coin.naturalWidth) ctx.drawImage(coin, x - c.s / 2, y - c.s / 2, c.s, c.s);
      }
    }
    drawConfetti(ctx, confetti, t - 2.3); // 토큰을 못 읽으면 색종이는 건너뛴다
    ctx.globalAlpha = 1;
    if (t < CUT_MS / 1000) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
