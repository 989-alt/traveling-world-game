// 효과음: 녹음 27(DESIGN §21.2.2, assets/audio/SFX-<ID>.mp3)과 그 합성 대체(WebAudio, 다운로드 0KB — 에셋목록 §5).
// 녹음이 없거나(만들지 못함·404·디코드 실패) 아직 안 풀렸으면 SFX_TABLE 의 synth 이름으로 합성음을 낸다.
// 한 음 = [파형, 시작Hz, 끝Hz, 시작초, 길이초, 음량].
type Note = [OscillatorType, number, number, number, number, number];

/** 합성 소리. 옛 14종 + U16 새 2(tap·splash) + 별칭 변형 7(dice 뒤 2음·hop 저음·째깍 1음·coin 저음·build 1음·hop 상승 길게·fanfare 짧게). 끝 ≤ 0.6초 */
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
  // U16 새 2
  tap: [['square', 880, 880, 0, 0.04, 0.2]],
  splash: [['sine', 900, 200, 0, 0.35, 0.35], ['sine', 600, 150, 0.08, 0.3, 0.25]],
  // U16 별칭 변형(표의 "합성 대체" 열)
  diceLand: [['square', 520, 520, 0, 0.05, 0.3], ['square', 660, 660, 0.08, 0.06, 0.3]],
  land: [['sine', 220, 140, 0, 0.14, 0.45]],
  tick: [['square', 1200, 1200, 0, 0.04, 0.2]],
  coinLow: [['square', 659, 659, 0, 0.12, 0.22]],
  build1: [['square', 160, 100, 0, 0.1, 0.4]],
  flyUp: [['sine', 300, 900, 0, 0.45, 0.35]],
  fanfareShort: [['triangle', 784, 784, 0, 0.08, 0.35], ['triangle', 1047, 1047, 0.08, 0.08, 0.35], ['triangle', 1319, 1319, 0.16, 0.2, 0.35]],
};
export type SynthName = keyof typeof SFX;
export const sfxDuration = (name: string) => Math.max(...SFX[name].map(n => n[3] + n[4]));

/** 효과음 27(DESIGN §21.2.2 표 그대로): 음량 = 효과음 마스터 안 배수 · 같은 소리 최소 간격(ms) · 우선순위 · 합성 대체 · 녹음 목표 길이(초).
 *  우선순위: hi(팡파르·독점·정답·오답·미션·종·차임)는 슬롯이 꽉 차면 lo(홉·탭·째깍·코인) 중 가장 오래된 것을 끊는다 */
export type Prio = 'hi' | 'mid' | 'lo';
export interface SfxDef { vol: number; gap: number; prio: Prio; synth: SynthName; len: number }
const d = (vol: number, gap: number, prio: Prio, synth: SynthName, len: number): SfxDef => ({ vol, gap, prio, synth, len });
export const SFX_TABLE = {
  tap: d(0.35, 80, 'lo', 'tap', 0.08),
  'dice-shake': d(0.6, 0, 'mid', 'dice', 0.55),
  'dice-land': d(0.6, 0, 'mid', 'diceLand', 0.3),
  hop: d(0.3, 100, 'lo', 'hop', 0.14),
  land: d(0.5, 0, 'mid', 'land', 0.3),
  'card-open': d(0.45, 300, 'mid', 'card', 0.4),
  tick: d(0.45, 900, 'lo', 'tick', 0.1),
  correct: d(0.7, 0, 'hi', 'correct', 0.7),
  wrong: d(0.5, 0, 'hi', 'wrong', 0.6),
  'coin-get': d(0.55, 120, 'lo', 'coin', 0.4),
  'coin-pay': d(0.45, 120, 'lo', 'coinLow', 0.3),
  flag: d(0.55, 0, 'mid', 'build1', 0.5),
  build: d(0.55, 0, 'mid', 'build', 0.6),
  takeover: d(0.6, 0, 'mid', 'takeover', 0.7),
  shield: d(0.55, 0, 'mid', 'shield', 0.5),
  fanfare: d(0.9, 0, 'hi', 'fanfare', 4.0),
  monopoly: d(0.8, 0, 'hi', 'missionOk', 2.0),
  fly: d(0.5, 0, 'mid', 'flyUp', 0.8),
  splash: d(0.5, 0, 'mid', 'splash', 0.6),
  festival: d(0.6, 0, 'mid', 'fanfareShort', 1.2),
  'mission-ok': d(0.7, 0, 'hi', 'missionOk', 1.0),
  'mission-fail': d(0.5, 0, 'hi', 'missionFail', 0.8),
  sparkle: d(0.6, 0, 'mid', 'shield', 1.2),
  bankrupt: d(0.5, 0, 'mid', 'bankrupt', 1.2),
  chime: d(0.5, 0, 'hi', 'card', 0.5),
  stamp: d(0.5, 150, 'mid', 'build1', 0.4),
  bell: d(0.7, 0, 'hi', 'timer', 1.5),
} satisfies Record<string, SfxDef>;
export type SfxId = keyof typeof SFX_TABLE;
export const SFX_IDS = Object.keys(SFX_TABLE) as SfxId[];

/** 합성 소리 하나를 예약하고, 마지막 음이 끝나면 onEnd 를 부른다. 돌려준 함수로 바로 끊는다(우선순위 선점) */
export function playSfx(ctx: AudioContext, out: AudioNode, name: string, onEnd: () => void): () => void {
  const t0 = ctx.currentTime;
  const end = sfxDuration(name);
  let last: OscillatorNode | null = null;
  const all: OscillatorNode[] = [];
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
    all.push(osc);
    if (!last || at + dur >= end - 1e-9) last = osc;
  }
  last!.onended = onEnd;
  return () => { for (const o of all) { try { o.stop(); } catch { /* 이미 멈춤 */ } } };
}
