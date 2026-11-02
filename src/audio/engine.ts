// 오디오 매니저(DESIGN §21.2). 첫 사용자 제스처 전에는 재생하지 않고(autoplay 정책), AudioContext 가 실제로 running 이 될 때만 unlocked.
// BGM: 곡마다 <audio loop>, 곡 바뀔 때 볼륨 크로스페이드(1000 · 막판 1500), 같은 곡 안에서는 더킹(문항 .6 · 멈춤 .25 · 컷씬 0 · 탭 숨김 0, 최솟값).
// 효과음 27: 녹음(AudioBuffer)이 있으면 그것, 없으면 같은 이름의 합성 대체. 동시 4 · 우선순위 선점 · 같은 소리 최소 간격 · 관전 0.7×.
// 소리 설정 3단 tw.sound = all | sfx | off(옛 tw.muted=1 → off).
import { assetUrl, hasAsset } from '../assets/manifest';
import { SFX, SFX_TABLE, playSfx as synth, type SfxDef } from './sfx';

export const MAX_SFX = 4;
const SOUND_KEY = 'tw.sound';
const OLD_MUTE_KEY = 'tw.muted';
export const FADE_MS = 1000;
export const FINAL_FADE_MS = 1500;
export const DUCK_MS = 300;
const DUCK_UP_CUT_MS = 500; // 컷씬 끝 올림
export const BGM_VOL = 0.35;
export const DUCK = { question: 0.6, pause: 0.25, cutscene: 0 } as const;
export type DuckKind = keyof typeof DUCK;
/** 옛 BGM 4곡은 파일이 ≈ −11.8 LUFS 라(새 BGM-mission 은 −18) 덮어쓰지 않고 재생 gain 으로 −18 에 맞춘다(ebur128 실측, 2026-11-02) */
const BGM_TRIM_DB: Record<string, number> = { 'bgm.lobby': -6.3, 'bgm.board': -5.9, 'bgm.final': -6.1, 'bgm.result': -6.6 };
const SPECTATOR = 0.7;
const LOG_MAX = 400;
export type SoundMode = 'all' | 'sfx' | 'off';
export const SOUND_MODES: SoundMode[] = ['all', 'sfx', 'off'];

export interface Deps {
  makeCtx: () => AudioContext;
  makeAudio: (url: string) => HTMLAudioElement;
  storage?: Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  /** 녹음 효과음 받기(없으면 fetch). null = 없음(404 등) */
  load?: (url: string) => Promise<ArrayBuffer | null>;
}
export interface SfxLog { name: string; at: number; src: 'file' | 'synth'; vol: number }

export function createAudio(d: Deps) {
  const now = d.now ?? (() => performance.now());
  const setTimer = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const store = () => { try { return d.storage ?? localStorage; } catch { return null; } };
  let mode: SoundMode = (() => {
    try {
      const s = store();
      const v = s?.getItem(SOUND_KEY);
      if (v === 'all' || v === 'sfx' || v === 'off') return v;
      if (s?.getItem(OLD_MUTE_KEY) === '1') { s.setItem(SOUND_KEY, 'off'); s.removeItem?.(OLD_MUTE_KEY); return 'off'; } // 옛 2단 이관
    } catch { /* 저장소 막힘 */ }
    return 'all';
  })();
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let unlocked = false;
  let blocked = false; // BGM play() 가 거부됨 -> 다음 제스처에서 다시 시도
  let want: string | null = null; // 원하는 BGM 키
  let wantFade = FADE_MS;
  let cur: { key: string; el: HTMLAudioElement } | null = null;
  const ducks = new Set<DuckKind>();
  let hidden = false;
  let paused = false;
  /** 재생 중 효과음 슬롯 */
  const slots = new Set<{ name: string; prio: SfxDef['prio']; at: number; until: number; stop: () => void }>();
  const lastAt = new Map<string, number>();
  const buffers = new Map<string, AudioBuffer>();
  let loading = false;
  const log: SfxLog[] = [];
  const fadeToken = new WeakMap<HTMLAudioElement, number>();

  function fade(el: HTMLAudioElement, to: number, ms: number, then?: () => void) {
    const tok = (fadeToken.get(el) ?? 0) + 1; // 같은 요소의 새 페이드가 옛 페이드를 취소
    fadeToken.set(el, tok);
    const from = el.volume, t0 = now();
    const step = () => {
      if (fadeToken.get(el) !== tok) return;
      const p = ms <= 0 ? 1 : Math.min(1, (now() - t0) / ms);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * p));
      if (p < 1) setTimer(step, 50); else then?.();
    };
    step();
  }

  /** 더킹: 걸린 것 중 최솟값(곱 아님). 탭 숨김 = 0 */
  const duckLevel = () => (hidden ? 0 : Math.min(1, ...[...ducks].map((k) => DUCK[k])));
  const trim = (key: string) => Math.pow(10, (BGM_TRIM_DB[key] ?? 0) / 20);
  const target = (key: string) => BGM_VOL * trim(key) * duckLevel();

  function tryPlay(el: HTMLAudioElement) {
    blocked = false;
    el.play().catch(() => { blocked = true; });
  }

  function syncBgm() {
    if (!unlocked) return; // 제스처 전: 원하는 곡만 기억
    const key = mode === 'all' ? want : null;
    if (cur && cur.key !== key) {
      const old = cur;
      cur = null;
      fade(old.el, 0, wantFade, () => old.el.pause());
    }
    if (key && !cur) {
      const url = assetUrl(key);
      if (!url) return;
      const el = d.makeAudio(url);
      el.loop = true;
      el.volume = 0;
      tryPlay(el); // 거부되면 blocked -> 다음 제스처의 unlock() 이 다시 시도
      fade(el, target(key), wantFade);
      cur = { key, el };
    }
  }
  function reduck(ms = DUCK_MS) { if (cur) fade(cur.el, target(cur.key), ms); }

  /** 녹음 효과음 27 을 받아 디코드(첫 제스처 뒤 1회). 실패·404 는 조용히 합성 대체 */
  async function loadSfx() {
    if (loading || !ctx) return;
    loading = true;
    const get = d.load ?? (async (url: string) => { try { const r = await fetch(url); return r.ok ? await r.arrayBuffer() : null; } catch { return null; } });
    await Promise.all(Object.keys(SFX_TABLE).map(async (id) => {
      const key = `sfx.${id}`;
      if (!hasAsset(key)) return;
      const url = assetUrl(key);
      if (!url) return;
      try {
        const ab = await get(url);
        if (!ab || !ctx) return;
        const c = ctx;
        const buf = await new Promise<AudioBuffer>((res, rej) => { const p = c.decodeAudioData(ab, res, rej); if (p && typeof p.then === 'function') p.then(res, rej); });
        buffers.set(id, buf);
      } catch { /* 디코드 실패: 합성 대체 */ }
    }));
  }

  function finishUnlock() {
    unlocked = true;
    syncBgm();
    void loadSfx();
  }

  const modeSubs = new Set<(m: SoundMode) => void>();
  function setMode(m: SoundMode) {
    const was = mode;
    mode = m;
    for (const f of modeSubs) f(m); // 간판 여러 개(입장·로비·규칙 창)가 같은 값을 그린다
    try { store()?.setItem(SOUND_KEY, m); store()?.removeItem?.(OLD_MUTE_KEY); } catch { /* 저장 불가여도 이번 세션은 동작 */ }
    if (master) master.gain.value = m === 'off' ? 0 : 1;
    if (was !== m) { wantFade = FADE_MS; syncBgm(); } // all 로 돌아오면 1000ms 페이드인(크로스페이드 없이 새로)
  }

  const api = {
    get mode() { return mode; },
    get muted() { return mode === 'off'; },
    get unlocked() { return unlocked; },
    get activeSfx() { return slots.size; },
    /** 시험 훅: 지금 울리는 BGM 키(제스처 전·설정 off/sfx 면 null) */
    get current() { return cur?.key ?? null; },
    get wanted() { return want; },
    /** 시험 훅: 지금 걸린 더킹 배수(0~1) */
    get duck() { return duckLevel(); },
    get bgmVolume() { return cur?.el.volume ?? 0; },
    /** 시험 훅: 실제로 낸 효과음 기록(최근 400) */
    get log() { return log; },
    get recorded() { return [...buffers.keys()]; },
    /** 제스처마다 호출. ctx 가 running 이 될 때까지 resume 을 재시도하고, 막혔던 BGM 도 다시 시도. 모두 끝났으면 true. */
    async unlock(): Promise<boolean> {
      if (unlocked) {
        if (blocked && cur) tryPlay(cur.el);
        return !blocked;
      }
      try {
        if (!ctx) {
          ctx = d.makeCtx();
          master = ctx.createGain();
          master.gain.value = mode === 'off' ? 0 : 1;
          master.connect(ctx.destination);
        }
        if (ctx.state !== 'running') await ctx.resume();
      } catch { return false; } // 컨텍스트 생성·resume 실패: 다음 제스처에서 다시
      if (ctx.state !== 'running') return false;
      if (!unlocked) finishUnlock();
      return !blocked;
    },
    /** 장면 곡(DESIGN §21.2.1). fadeMs: 크로스페이드(기본 1000, 막판 1500) */
    playBgm(key: string | null, fadeMs = FADE_MS) {
      if (key === want) return;
      want = key;
      wantFade = fadeMs;
      syncBgm();
    },
    /** 더킹 걸기·풀기(문항·멈춤·컷씬). 같은 곡 안 gain 만 300ms(컷씬 풀림은 500ms) */
    setDuck(kind: DuckKind, on: boolean) {
      if (ducks.has(kind) === on) return;
      if (on) ducks.add(kind); else ducks.delete(kind);
      reduck(!on && kind === 'cutscene' ? DUCK_UP_CUT_MS : DUCK_MS);
    },
    /** 탭 숨김: BGM 0, 효과음은 숨긴 동안 버린다 */
    setHidden(h: boolean) { if (hidden === h) return; hidden = h; reduck(); },
    /** 판 멈춤: 더킹 .25, 새 효과음 0(모달 chime 만), 재개 뒤 밀린 소리 없음(큐 없음) */
    setPaused(p: boolean) { paused = p; api.setDuck('pause', p); },
    playSfx(name: string, opts: { spectator?: boolean } = {}) {
      if (!unlocked || mode === 'off' || hidden || !ctx || !master) return;
      if (paused && name !== 'chime') return;
      const def: SfxDef | undefined = (SFX_TABLE as Record<string, SfxDef>)[name] ?? (SFX[name] ? { vol: 1, gap: 0, prio: 'mid', synth: name, len: 0.6 } : undefined);
      if (!def) return;
      const t = now();
      const last = lastAt.get(name);
      if (def.gap > 0 && last !== undefined && t - last < def.gap) return; // 같은 소리 최소 간격
      for (const s of slots) if (t > s.until) slots.delete(s); // onended 누락 슬롯 회수
      if (slots.size >= MAX_SFX) {
        if (def.prio !== 'hi') return; // 낮음·보통끼리는 새 소리를 버린다
        const victim = [...slots].filter((s) => s.prio === 'lo').sort((a, b) => a.at - b.at)[0];
        if (!victim) return; // 높음끼리는 버림
        victim.stop();
        slots.delete(victim);
      }
      lastAt.set(name, t);
      const vol = def.vol * (opts.spectator ? SPECTATOR : 1);
      const g = ctx.createGain();
      g.gain.value = vol;
      g.connect(master);
      const buf = buffers.get(name);
      const slot = { name, prio: def.prio, at: t, until: t + (buf ? buf.duration : 0.6) * 1000 + 900, stop: () => {} };
      slots.add(slot);
      const end = () => { slots.delete(slot); };
      if (buf) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(g);
        src.onended = end;
        src.start();
        slot.stop = () => { try { src.stop(); } catch { /* 이미 멈춤 */ } };
      } else {
        slot.stop = synth(ctx, g, def.synth, end);
      }
      log.push({ name, at: Math.round(t), src: buf ? 'file' : 'synth', vol: +vol.toFixed(3) });
      if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
    },
    setSound: setMode,
    /** 설정이 바뀌면 부른다. 돌려준 함수로 해제 */
    onMode(f: (m: SoundMode) => void) { modeSubs.add(f); return () => { modeSubs.delete(f); }; },
    /** 간판 1탭: 전부 → 효과음만 → 무음 → 전부 */
    cycleSound(): SoundMode { const m = SOUND_MODES[(SOUND_MODES.indexOf(mode) + 1) % 3]; setMode(m); return m; },
    /** 옛 2단(켜기/끄기) 호환 */
    setMuted(m: boolean) { setMode(m ? 'off' : 'all'); },
  };
  return api;
}

/** 브라우저용 싱글턴. 앱 시작 때 armOnFirstGesture() 한 번(T07). */
export const audio = createAudio({
  makeCtx: () => new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(),
  makeAudio: url => new Audio(url),
});

const GESTURES = ['pointerup', 'click', 'touchend', 'keydown'] as const;
/** 누르면 '똑'(tap): 단추·간판·답 단추. 제스처 리스너 하나로 모든 화면에 건다 */
const TAP_SEL = 'button:not(:disabled), .ov-btn, .hang-plate, .ov-ans, [role="button"]';
/** 제스처마다 unlock() 시도. 리스너는 안 뗀다: running 이 된 뒤에도 거부된 BGM 재시도가 필요하고, 그때 unlock() 은 no-op 에 가깝다.
 *  탭 숨김은 BGM 0(visibilitychange). 시험 훅 window.__audio */
export function armOnFirstGesture(target: Window = window) {
  const go = () => { void audio.unlock(); };
  for (const g of GESTURES) target.addEventListener(g, go);
  target.addEventListener('pointerdown', (e) => { if ((e.target as Element | null)?.closest?.(TAP_SEL)) audio.playSfx('tap'); }, true);
  const vis = () => audio.setHidden(document.hidden);
  document.addEventListener('visibilitychange', vis);
  vis();
  (target as unknown as { __audio: typeof audio }).__audio = audio;
}
