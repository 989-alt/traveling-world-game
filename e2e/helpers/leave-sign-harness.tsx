// U14 학생 나가기 간판 하네스(board-placement '간판' 시험용): 게임 루트(.game)에 학생 메뉴(규칙 + 나가기)와 세로 안내만.
// window.__leaves = 나가기 간판 누른 횟수
import { render } from 'preact';
import '../../src/styles/tokens.css';
import '../../src/styles/base.css';
import '../../src/styles/board.css';
import { GameMenu } from '../../src/ui/screens/Game';
import { RotateGuard } from '../../src/ui/board/RotateGuard';

const w = window as unknown as { __leaves: number };
w.__leaves = 0;

render(
  <div class="game">
    <div class="board-root" style={{ position: 'fixed', inset: 0, background: '#9EC3E8' }} />
    <GameMenu host={false} onRules={() => {}} onPause={() => {}} onLeave={() => { w.__leaves++; }} />
    <RotateGuard />
  </div>,
  document.getElementById('app')!,
);
