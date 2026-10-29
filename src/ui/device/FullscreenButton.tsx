// U7: 게임 중 전체 화면에서 나오면 왼쪽 아래 귀퉁이에 작은 나무 간판(UI-sign-small)을 띄워 다시 들어가게 한다.
// 판 배율과 상관없이 화면 px 48(휴대폰 가로에서도 누르기 쉽게), 노치·홈 표시줄 안쪽. 미지원 기기·홈 화면 앱에선 안 보인다.
import { SignButton } from '../overlays/ScrollPanel';
import { enterFullscreen, useFullscreenExited } from './fullscreen';
import '../../styles/device.css';

export function FullscreenButton() {
  const show = useFullscreenExited();
  if (!show) return null;
  return (
    <div class="fs-corner" data-act="fullscreen">
      <SignButton label="전체 화면" class="fs-btn" onClick={() => { void enterFullscreen(); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </SignButton>
    </div>
  );
}
