import { describe, expect, it } from 'vitest';
import { BGM_VOL, createAudio, MAX_SFX } from './engine';
import { SFX, SFX_IDS, SFX_TABLE, sfxDuration } from './sfx';

// 가짜 AudioContext: 만든 오실레이터를 모아 두고 onended 를 수동으로 발사한다.
function fake(opts: { suspended?: boolean; playReject?: boolean; makeCtxThrows?: boolean } = {}) {
  let state = opts.suspended ? 'suspended' : 'running';
  let playReject = !!opts.playReject;
  const oscs: { onended: (() => void) | null; stopped: boolean }[] = [];
  const srcs: unknown[] = [];
  let ctxMade = 0;
  let resumeOk = !opts.suspended;
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = () => ({ connect: (n: unknown) => n, gain: param() });
  const makeCtx = () => {
    ctxMade++;
    if (opts.makeCtxThrows) throw new Error('no audio');
    return {
      get state() { return state; },
      currentTime: 0, destination: {}, resume: async () => { if (!opts.suspended || resumeOk) state = 'running'; },
      createGain: node,
      createOscillator: () => { const o = { type: '', frequency: param(), onended: null as null | (() => void), stopped: false, connect: (n: unknown) => n, start() {}, stop() { o.stopped = true; } }; oscs.push(o); return o; },
      createBufferSource: () => { const b = { buffer: null as unknown, onended: null as null | (() => void), connect: (n: unknown) => n, start() { srcs.push(b); }, stop() {} }; return b; },
      decodeAudioData: (_ab: ArrayBuffer, ok: (b: unknown) => void) => { ok({ duration: 0.3 }); },
    } as unknown as AudioContext;
  };
  const els: { url: string; volume: number; muted: boolean; loop: boolean; paused: boolean; played: number }[] = [];
  const makeAudio = (url: string) => {
    const el = { url, volume: 1, muted: false, loop: false, paused: false, played: 0, play() { el.played++; return playReject ? Promise.reject(new Error('NotAllowed')) : Promise.resolve(); }, pause() { el.paused = true; } };
    els.push(el);
    return el as unknown as HTMLAudioElement;
  };
  let t = 0;
  const timers: (() => void)[] = [];
  const storage = new Map<string, string>();
  const deps = {
    makeCtx, makeAudio,
    storage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) },
    load: async (url: string) => (/SFX-tap|SFX-hop/.test(url) ? new ArrayBuffer(8) : null),
    now: () => t,
    setTimer: (fn: () => void) => void timers.push(fn),
  };
  const advance = (ms: number) => { t += ms; for (const fn of timers.splice(0)) fn(); };
  return { deps, oscs, srcs, els, storage, advance, allowResume: () => { resumeOk = true; }, allowPlay: () => { playReject = false; }, get ctxMade() { return ctxMade; } };
}

describe('sfx 표', () => {
  it('합성 23종(옛 14 + tap·splash + 별칭 7), 각 ≤ 0.6초', () => {
    expect(Object.keys(SFX)).toHaveLength(23);
    for (const n of Object.keys(SFX)) expect(sfxDuration(n)).toBeLessThanOrEqual(0.6);
  });
  it('효과음 27(DESIGN §21.2.2): 합성 대체가 모두 있고, 반복음(hop·coin·tap·tick)은 .45 이하', () => {
    expect(SFX_IDS).toHaveLength(27);
    for (const id of SFX_IDS) expect(SFX[SFX_TABLE[id].synth], id).toBeDefined();
    for (const id of ['hop', 'coin-get', 'coin-pay', 'tap', 'tick'] as const) expect(SFX_TABLE[id].vol).toBeLessThanOrEqual(0.55);
    for (const id of ['hop', 'coin-pay', 'tap', 'tick'] as const) expect(SFX_TABLE[id].vol).toBeLessThanOrEqual(0.45);
  });
});

describe('오디오 매니저', () => {
  it('제스처 전에는 AudioContext·BGM 재생이 없다', () => {
    const f = fake(); const a = createAudio(f.deps);
    a.playBgm('bgm.lobby'); a.playSfx('coin');
    expect(f.ctxMade).toBe(0); expect(f.els).toHaveLength(0); expect(f.oscs).toHaveLength(0);
  });

  it('unlock 뒤 대기 중이던 BGM 이 시작하고, unlock 은 한 번만 컨텍스트를 만든다', async () => {
    const f = fake(); const a = createAudio(f.deps);
    a.playBgm('bgm.lobby'); await a.unlock(); await a.unlock();
    expect(f.ctxMade).toBe(1); expect(f.els).toHaveLength(1);
    expect(f.els[0].loop).toBe(true); expect(f.els[0].played).toBe(1);
  });

  it('효과음 동시 4개를 넘으면 버리고, 끝나면 다시 쓴다', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    for (let i = 0; i < 6; i++) a.playSfx('dice');
    expect(a.activeSfx).toBe(MAX_SFX);
    f.oscs.filter(o => o.onended).forEach(o => o.onended!());
    expect(a.activeSfx).toBe(0);
    a.playSfx('coin'); expect(a.activeSfx).toBe(1);
  });

  it('모르는 효과음 이름은 무시', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    a.playSfx('nope'); expect(a.activeSfx).toBe(0);
  });

  it('소리 설정 3단(tw.sound)이 저장·복원되고, off 는 효과음·BGM 0, sfx 는 BGM 만 멈춘다', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    a.playBgm('bgm.lobby');
    expect(a.cycleSound()).toBe('sfx'); expect(f.storage.get('tw.sound')).toBe('sfx');
    f.advance(1100); expect(f.els[0].paused).toBe(true); expect(a.current).toBe(null);
    a.playSfx('coin'); expect(a.activeSfx).toBe(1);
    expect(a.cycleSound()).toBe('off'); a.playSfx('coin-get'); expect(a.activeSfx).toBe(1);
    expect(createAudio(f.deps).mode).toBe('off');
    expect(a.cycleSound()).toBe('all'); expect(a.current).toBe('bgm.lobby'); expect(f.els).toHaveLength(2); // 새로 1000ms 페이드인
    f.advance(1100); expect(f.els[1].volume).toBeGreaterThan(0);
  });

  it('옛 tw.muted=1 은 첫 실행에 off 로 옮기고 tw.muted 를 지운다', () => {
    const f = fake(); f.storage.set('tw.muted', '1');
    const a = createAudio(f.deps);
    expect(a.mode).toBe('off'); expect(f.storage.get('tw.sound')).toBe('off'); expect(f.storage.has('tw.muted')).toBe(false);
  });

  it('녹음이 있는 효과음은 AudioBuffer 로, 없거나 404 면 같은 이름 합성 대체', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    await new Promise((r) => setTimeout(r, 0));
    a.playSfx('tap'); a.playSfx('wrong');
    expect(a.recorded.sort()).toEqual(['hop', 'tap']); // 가짜 load: tap·hop 만 받아짐, 나머지는 404
    expect(a.log.map((x) => `${x.name}:${x.src}`)).toEqual(['tap:file', 'wrong:synth']);
    expect(f.srcs).toHaveLength(1);
    expect(f.oscs.length).toBeGreaterThan(0);
  });

  it('같은 소리 최소 간격 안의 요청은 버리고(hop 100ms), 관전 기기는 0.7×', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    a.playSfx('hop'); f.advance(50); a.playSfx('hop'); f.advance(60); a.playSfx('hop');
    expect(a.log.filter((x) => x.name === 'hop')).toHaveLength(2);
    a.playSfx('correct', { spectator: true });
    expect(a.log.at(-1)!.vol).toBeCloseTo(0.49, 2);
  });

  it('슬롯 4 가 꽉 차면 높음(correct)은 가장 오래된 낮음을 끊고, 높음끼리·보통은 버린다', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    a.playSfx('coin-get'); f.advance(1); a.playSfx('tick'); f.advance(1); a.playSfx('build'); f.advance(1); a.playSfx('shield');
    expect(a.activeSfx).toBe(4);
    a.playSfx('flag'); expect(a.log.some((x) => x.name === 'flag')).toBe(false); // 보통 → 버림
    a.playSfx('correct'); expect(a.activeSfx).toBe(4); expect(a.log.at(-1)!.name).toBe('correct');
    a.playSfx('wrong'); a.playSfx('fanfare'); // 남은 낮음 tick 하나를 wrong 이 끊고, fanfare 는 낮음이 없어 버림
    expect(a.log.map((x) => x.name)).toEqual(['coin-get', 'tick', 'build', 'shield', 'correct', 'wrong']);
  });

  it('더킹은 곱이 아니라 최솟값: 문항 .6 → 멈춤 .25 → 재개 .6 → 해설 1, 탭 숨김 0', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    a.playBgm('bgm.mission'); f.advance(1100);
    expect(f.els[0].volume).toBeCloseTo(BGM_VOL, 3);
    a.setDuck('question', true); expect(a.duck).toBe(0.6);
    a.setPaused(true); expect(a.duck).toBe(0.25);
    a.playSfx('coin'); a.playSfx('chime'); expect(a.log.map((x) => x.name)).toEqual(['chime']); // 멈춤 중 새 소리 0(차임만)
    a.setPaused(false); expect(a.duck).toBe(0.6);
    f.advance(400); expect(f.els[0].volume).toBeCloseTo(BGM_VOL * 0.6, 3);
    a.setDuck('question', false); expect(a.duck).toBe(1);
    a.setHidden(true); expect(a.duck).toBe(0); a.playSfx('coin'); expect(a.log).toHaveLength(1);
    f.advance(400); expect(f.els[0].volume).toBe(0);
    a.setHidden(false); f.advance(400); expect(f.els[0].volume).toBeCloseTo(BGM_VOL, 3);
  });

  it('막판 전환은 1500ms 크로스페이드, 옛 4곡은 −18 LUFS 맞춤 gain', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    a.playBgm('bgm.board'); f.advance(1100);
    expect(f.els[0].volume).toBeLessThan(BGM_VOL * 0.6); // −5.9dB
    a.playBgm('bgm.final', 1500); f.advance(1100);
    expect(f.els[0].paused).toBe(false); // 아직 1500ms 안
    f.advance(500); expect(f.els[0].paused).toBe(true);
    expect(a.current).toBe('bgm.final');
  });

  it('BGM 곡 교체는 크로스페이드(새 곡 0->, 옛 곡 ->0 뒤 정지)', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    a.playBgm('bgm.board'); a.playBgm('bgm.final');
    expect(f.els).toHaveLength(2);
    expect(f.els[0].paused).toBe(false); // 아직 페이드 중
    f.advance(500);
    expect(f.els[1].volume).toBeGreaterThan(0); expect(f.els[0].volume).toBeLessThan(0.2);
    f.advance(600);
    expect(f.els[0].paused).toBe(true); expect(f.els[0].volume).toBe(0);
  });

  it('같은 곡을 다시 요청해도 새로 만들지 않는다', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    a.playBgm('bgm.board'); a.playBgm('bgm.board'); expect(f.els).toHaveLength(1);
  });

  it('localStorage 가 막혀도 던지지 않는다', () => {
    const f = fake();
    const a = createAudio({ ...f.deps, storage: { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } } });
    expect(a.muted).toBe(false); expect(() => a.setMuted(true)).not.toThrow(); expect(a.muted).toBe(true); expect(() => a.cycleSound()).not.toThrow();
  });

  it('suspended 컨텍스트는 running 이 될 때까지 unlocked 가 아니고, 제스처마다 resume 재시도', async () => {
    const f = fake({ suspended: true }); const a = createAudio(f.deps);
    a.playBgm('bgm.lobby');
    expect(await a.unlock()).toBe(false); expect(a.unlocked).toBe(false); expect(f.els).toHaveLength(0);
    a.playSfx('coin'); expect(a.activeSfx).toBe(0);
    f.allowResume();
    expect(await a.unlock()).toBe(true); expect(a.unlocked).toBe(true); expect(f.ctxMade).toBe(1); expect(f.els).toHaveLength(1);
  });

  it('makeCtx 가 던져도 unlock 은 false 로 끝나고 다음 제스처에 다시 시도', async () => {
    const f = fake({ makeCtxThrows: true }); const a = createAudio(f.deps);
    expect(await a.unlock()).toBe(false); expect(a.unlocked).toBe(false);
    expect(await a.unlock()).toBe(false); expect(f.ctxMade).toBe(2);
  });

  it('거부된 BGM play() 는 다음 제스처에서 같은 요소로 재시도', async () => {
    const f = fake({ playReject: true }); const a = createAudio(f.deps);
    a.playBgm('bgm.board'); await a.unlock();
    await Promise.resolve(); // 거부 처리
    expect(f.els[0].played).toBe(1);
    f.allowPlay();
    expect(await a.unlock()).toBe(true);
    expect(f.els).toHaveLength(1); expect(f.els[0].played).toBe(2);
    await a.unlock(); expect(f.els[0].played).toBe(2); // 성공 뒤엔 더 안 부름
  });

  it('새 페이드가 같은 요소의 옛 페이드를 취소한다', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    a.playBgm('bgm.board'); f.advance(300);
    a.playBgm(null); f.advance(300); // board 페이드아웃 시작
    expect(f.els[0].volume).toBeLessThan(0.2);
  });

  it('onended 가 안 오는 효과음 슬롯은 시간이 지나면 회수된다', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    for (let i = 0; i < 4; i++) a.playSfx('dice');
    a.playSfx('coin'); expect(a.activeSfx).toBe(4);
    f.advance(2000);
    a.playSfx('coin'); expect(a.activeSfx).toBe(1);
  });
});
