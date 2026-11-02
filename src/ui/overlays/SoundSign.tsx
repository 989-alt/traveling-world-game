// 소리 설정 3단 간판(U16 DESIGN §21.2.3): 1탭마다 전부 → 효과음만 → 무음. 입장 in-signs · 로비 lobby-signs · 규칙 창 오른쪽 위에 같은 간판.
// 저장 키 tw.sound(engine). 아이콘: 전부 = 스피커 + 음표, 효과음만 = 스피커, 무음 = 스피커 빗금
import { useEffect, useState } from 'preact/hooks';
import { audio, type SoundMode } from '../../audio/engine';
import { SignButton } from './ScrollPanel';

const LABEL: Record<SoundMode, string> = { all: '소리: 전부', sfx: '소리: 효과음만', off: '소리: 꺼짐' };

export function SoundSign({ class: cls }: { class?: string }) {
  const [mode, setMode] = useState<SoundMode>(audio.mode);
  useEffect(() => audio.onMode(setMode), []);
  return (
    <SignButton label={LABEL[mode]} class={`sound-sign${cls ? ` ${cls}` : ''}`} onClick={() => setMode(audio.cycleSound())}>
      <span data-sound={mode} style={{ display: 'contents' }}><SoundIcon mode={mode} /></span>
    </SignButton>
  );
}

export function SoundIcon({ mode }: { mode: SoundMode }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M3 9h4l5-4v14l-5-4H3z" />
      {mode === 'off' && <path d="M2.5 3.5 21 20.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none" />}
      {mode === 'sfx' && <path d="M15 8.5a5 5 0 0 1 0 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none" />}
      {mode === 'all' && <>
        <path d="M15 8.5a5 5 0 0 1 0 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none" />
        <path d="M19 3.5v7.2a1.9 1.9 0 1 1-1.3-1.8V3.5z" />
        <path d="M19 3.5h3v1.8h-3z" />
      </>}
    </svg>
  );
}
