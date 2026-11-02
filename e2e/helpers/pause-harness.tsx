// U14 멈춤 모달 하네스(board-placement '세로' 시험용): 서버 없이 게임 루트(.game) 꼴만 세운다 —
// 보드 자리 판 + 매달린 간판 + 멈춤 모달(P-H) + 세로 안내(마지막 자식). 진짜 Game.tsx 와 같은 부품(PauseLayer·useInertSiblings·RotateGuard)을 쓴다.
// window.__pm.resumes = [게임 계속하기] 누른 횟수
import { render } from 'preact';
import { useRef, useState } from 'preact/hooks';
import '../../src/styles/tokens.css';
import '../../src/styles/base.css';
import '../../src/styles/board.css';
import { GameMenu } from '../../src/ui/screens/Game';
import { PauseLayer, PauseModal, useInertSiblings } from '../../src/ui/overlays/PauseModal';
import { RotateGuard } from '../../src/ui/board/RotateGuard';

const pm = { resumes: 0, pauses: 0 };
(window as unknown as { __pm: typeof pm }).__pm = pm;

function Harness() {
  const [paused, setPaused] = useState(true);
  const layer = useRef<HTMLDivElement>(null);
  useInertSiblings(paused, layer);
  return (
    <div class={`game${paused ? ' is-paused' : ''}`}>
      <div class="board-root" style={{ position: 'fixed', inset: 0, background: '#9EC3E8' }}><button type="button" class="fake-board-btn">판</button></div>
      <GameMenu host paused={paused} onRules={() => {}} onPause={() => { pm.pauses++; setPaused(true); }} />
      {paused && (
        <PauseLayer layerRef={layer}>
          <PauseModal kind="P-H" remainingMs={754_000} onResume={() => { pm.resumes++; setPaused(false); }} onAskEnd={() => {}} onSeat={() => {}} />
        </PauseLayer>
      )}
      <RotateGuard />
    </div>
  );
}

render(<Harness />, document.getElementById('app')!);
