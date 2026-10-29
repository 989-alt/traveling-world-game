// 효과음 14종: WebAudio 합성(출처·라이선스 파일 없음, 다운로드 0KB — 에셋목록 §5, PRD §13).
// 한 음 = [파형, 시작Hz, 끝Hz, 시작초, 길이초, 음량]. 소리마다 끝 시각 ≤ 0.6초.
type Note = [OscillatorType, number, number, number, number, number];

export const SFX: Record<string, Note[]> = {
  dice: [['square', 300, 300, 0, 0.04, 0.3], ['square', 420, 420, 0.07, 0.04, 0.3], ['square', 360, 360, 0.14, 0.04, 0.3], ['square', 520, 520, 0.22, 0.05, 0.3]],
  hop: [['sine', 330, 520, 0, 0.12, 0.4]],
  coin: [['square', 988, 988, 0, 0.07, 0.25], ['square', 1319, 1319, 0.07, 0.25, 0.25]],
  correct: [['triangle', 523, 523, 0, 0.12, 0.4], ['triangle', 784, 784, 0.12, 0.25, 0.4]],
  wrong: [['sine', 392, 392, 0, 0.15, 0.35], ['sine', 311, 294, 0.15, 0.3, 0.35]], // 부드러운 2음 하강
  card: [['triangle', 600, 900, 0, 0.1, 0.3], ['triangle', 900, 900, 0.1, 0.1, 0.2]],
  build: [['square', 140, 90, 0, 0.08, 0.4], ['square', 140, 90, 0.2, 0.08, 0.4], ['square', 180, 110, 0.4, 0.1, 0.4]],
  fanfare: [['triangle', 523, 523, 0, 0.1, 0.4], ['triangle', 659, 659, 0.1, 0.1, 0.4], ['triangle', 784, 784, 0.2, 0.1, 0.4], ['triangle', 1047, 1047, 0.3, 0.3, 0.45]],
  takeover: [['sawtooth', 220, 440, 0, 0.25, 0.25], ['sawtooth', 440, 330, 0.25, 0.2, 0.25]],
  shield: [['sine', 700, 1400, 0, 0.12, 0.35], ['sine', 1400, 1400, 0.12, 0.2, 0.3]],
  bankrupt: [['sawtooth', 300, 60, 0, 0.55, 0.3]],
  timer: [['square', 880, 880, 0, 0.08, 0.25], ['square', 880, 880, 0.15, 0.08, 0.25]],
  missionOk: [['triangle', 659, 659, 0, 0.1, 0.4], ['triangle', 880, 880, 0.1, 0.1, 0.4], ['triangle', 1319, 1319, 0.2, 0.3, 0.4]],
  missionFail: [['sine', 330, 330, 0, 0.2, 0.35], ['sine', 262, 220, 0.2, 0.35, 0.35]],
};
export type SfxName = keyof typeof SFX;
export const sfxDuration = (name: string) => Math.max(...SFX[name].map(n => n[3] + n[4]));

/** 소리 하나를 예약하고, 마지막 음이 끝나면 onEnd 를 부른다. */
export function playSfx(ctx: AudioContext, out: AudioNode, name: string, onEnd: () => void) {
  const t0 = ctx.currentTime;
  const end = sfxDuration(name);
  let last: OscillatorNode | null = null;
  for (const [type, f0, f1, at, dur, vol] of SFX[name]) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0 + at);
    if (f1 !== f0) osc.frequency.linearRampToValueAtTime(f1, t0 + at + dur);
    g.gain.setValueAtTime(vol, t0 + at);
    g.gain.linearRampToValueAtTime(0, t0 + at + dur); // 클릭음 방지
    osc.connect(g).connect(out);
    osc.start(t0 + at);
    osc.stop(t0 + at + dur);
    if (!last || at + dur >= end - 1e-9) last = osc;
  }
  last!.onended = onEnd;
}
