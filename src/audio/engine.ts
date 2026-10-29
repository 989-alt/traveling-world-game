// 오디오 매니저. 첫 사용자 제스처 전에는 재생하지 않고(autoplay 정책), AudioContext 가 실제로 running 이 될 때만 unlocked.
// BGM: 곡마다 <audio loop>, 곡 바뀔 때 볼륨 크로스페이드. 효과음: 동시 4개, 넘으면 새 소리를 버린다.
import { assetUrl } from '../assets/manifest';
import { SFX, playSfx } from './sfx';

export const MAX_SFX = 4;
const MUTE_KEY = 'tw.muted';
const FADE_MS = 1000;
const BGM_VOL = 0.5;
const SFX_STUCK_MS = 1500; // 가장 긴 소리 0.6초의 여유. onended 가 안 오면 이 시간 뒤 슬롯을 비운다.

export interface Deps {
  makeCtx: () => AudioContext;
  makeAudio: (url: string) => HTMLAudioElement;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

export function createAudio(d: Deps) {
  const now = d.now ?? (() => performance.now());
  const setTimer = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const store = () => { try { return d.storage ?? localStorage; } catch { return null; } };
  let muted = (() => { try { return store()?.getItem(MUTE_KEY) === '1'; } catch { return false; } })();
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let unlocked = false;
  let blocked = false; // BGM play() 가 거부됨 -> 다음 제스처에서 다시 시도
  let want: string | null = null; // 원하는 BGM 키
  let cur: { key: string; el: HTMLAudioElement } | null = null;
  const slots = new Map<object, number>(); // 재생 중 효과음 -> 시작 시각
  const fadeToken = new WeakMap<HTMLAudioElement, number>();

  function fade(el: HTMLAudioElement, to: number, then?: () => void) {
    const tok = (fadeToken.get(el) ?? 0) + 1; // 같은 요소의 새 페이드가 옛 페이드를 취소
    fadeToken.set(el, tok);
    const from = el.volume, t0 = now();
    const step = () => {
      if (fadeToken.get(el) !== tok) return;
      const p = Math.min(1, (now() - t0) / FADE_MS);
      el.volume = from + (to - from) * p;
      if (p < 1) setTimer(step, 50); else then?.();
    };
    step();
  }

  function tryPlay(el: HTMLAudioElement) {
    blocked = false;
    el.play().catch(() => { blocked = true; });
  }

  function syncBgm() {
    if (!unlocked) return; // 제스처 전: 원하는 곡만 기억
    if (cur && cur.key !== want) {
      const old = cur;
      cur = null;
      fade(old.el, 0, () => old.el.pause());
    }
    if (want && !cur) {
      const url = assetUrl(want);
      if (!url) return;
      const el = d.makeAudio(url);
      el.loop = true;
      el.volume = 0;
      el.muted = muted;
      tryPlay(el); // 거부되면 blocked -> 다음 제스처의 unlock() 이 다시 시도
      fade(el, BGM_VOL);
      cur = { key: want, el };
    }
  }

  function finishUnlock() {
    unlocked = true;
    syncBgm();
  }

  return {
    get muted() { return muted; },
    get unlocked() { return unlocked; },
    get activeSfx() { return slots.size; },
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
          master.gain.value = muted ? 0 : 1;
          master.connect(ctx.destination);
        }
        if (ctx.state !== 'running') await ctx.resume();
      } catch { return false; } // 컨텍스트 생성·resume 실패: 다음 제스처에서 다시
      if (ctx.state !== 'running') return false;
      if (!unlocked) finishUnlock();
      return !blocked;
    },
    playBgm(key: string | null) { want = key; syncBgm(); },
    playSfx(name: string) {
      if (!unlocked || muted || !ctx || !master || !SFX[name]) return;
      const t = now();
      for (const [s, at] of slots) if (t - at > SFX_STUCK_MS) slots.delete(s); // onended 누락 슬롯 회수
      if (slots.size >= MAX_SFX) return;
      const slot = {};
      slots.set(slot, t);
      playSfx(ctx, master, name, () => slots.delete(slot));
    },
    setMuted(m: boolean) {
      muted = m;
      try { store()?.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* 저장 불가여도 이번 세션은 동작 */ }
      if (master) master.gain.value = m ? 0 : 1;
      if (cur) cur.el.muted = m;
    },
  };
}

/** 브라우저용 싱글턴. 앱 시작 때 armOnFirstGesture() 한 번(T07). */
export const audio = createAudio({
  makeCtx: () => new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(),
  makeAudio: url => new Audio(url),
});

const GESTURES = ['pointerup', 'click', 'touchend', 'keydown'] as const;
/** 제스처마다 unlock() 시도. 리스너는 안 뗀다: running 이 된 뒤에도 거부된 BGM 재시도가 필요하고, 그때 unlock() 은 no-op 에 가깝다. */
export function armOnFirstGesture(target: Window = window) {
  const go = () => { void audio.unlock(); };
  for (const g of GESTURES) target.addEventListener(g, go);
}
