// 화면 고르기: 서버 상태 하나로 입장 → 로비 → 게임/저장/재개/끝 을 정한다.
import { useEffect, useRef, useState } from 'preact/hooks';
import { ROTATE_WIDE, boardKeys, bootKeys, gameStartKeys } from './assets/manifest';
import { preload } from './assets/preload';
import { armOnFirstGesture } from './audio/engine';
import { FullscreenButton } from './ui/device/FullscreenButton';
import { armFullscreenOnFirstGesture } from './ui/device/fullscreen';
import { GameClient, useClient } from './state/client';
import { Connecting, Entry, Replaced } from './ui/screens/Entry';
import { Game } from './ui/screens/Game';
import { MONO } from './ui/board/Board';
import { Lobby, PinEntry } from './ui/screens/Lobby';
import { Finished, OldBoardNotice, Paused } from './ui/screens/Pause';

export const client = new GameClient();

export function App() {
  const s = useClient(client);
  useEffect(() => {
    armOnFirstGesture(); // T11: 첫 터치에서 소리 잠금 풀기
    armFullscreenOnFirstGesture(); // U7: 첫 탭에서 전체 화면(휴대폰 상단바 숨김) · 가로 고정. 거부되면 그냥 진행
    client.resumeSaved();
    const vis = () => { if (!document.hidden) client.resync(); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, []);

  const phase = s.room?.phase;
  // 독점승(DESIGN §16.5): 엔진은 독점과 같은 갱신에서 판을 끝낸다(서버 기준 그대로). 이 기기가 진행 중에 그 갱신을 받았으면
  // 보드를 3.0초(모션 줄이기 2초) 더 두어 독점 연출을 보이고 결과로 넘어간다. 재접속·전체 다시 받기로 처음 본 '끝'은 바로 결과.
  const lastPhase = useRef(phase);
  const holdUntil = useRef(0);
  const [, rerender] = useState(0);
  if (lastPhase.current === 'playing' && phase === 'finished' && !s.resynced && s.fresh.some((e) => e.ev === 'event' && e.kind === 'monopoly')) {
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    holdUntil.current = Date.now() + (reduced ? MONO.reducedBanner : MONO.end);
  }
  lastPhase.current = phase;
  const monoHold = phase === 'finished' && Date.now() < holdUntil.current;
  useEffect(() => {
    if (!monoHold) return;
    const h = setTimeout(() => rerender((x) => x + 1), holdUntil.current - Date.now() + 20);
    return () => clearTimeout(h);
  }, [monoHold]);
  const started = useRef(false);
  useEffect(() => {
    // U4: 세로 안내 가로판은 ui.rotate 와 같이 첫 로드에 받되, 움직임을 줄인 기기는 요청하지 않는다(DESIGN §4.2)
    const motion = typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (phase === 'lobby') void preload(motion ? [...bootKeys(), ROTATE_WIDE] : bootKeys()).then(() => preload(boardKeys())); // 판 그림은 첫 로드 뒤 이어서(R4)
    // 로비를 거치지 않고 판에 들어온 경우(새로고침·재접속·PIN 복귀)도 판 그림을 먼저 받는다(Game 은 받는 동안 '판 펼치는 중')
    if (phase && phase !== 'lobby' && !started.current) { started.current = true; void preload(boardKeys()).then(() => preload(gameStartKeys())); } // T11 인계
  }, [phase]);

  return (
    <div class="app" data-phase={phase ?? 'entry'} data-mono-hold={monoHold ? '1' : undefined} data-conn={s.conn}>
      {screen()}
      <FullscreenButton />
      {s.room && (s.conn === 'connecting' || s.conn === 'retrying') && (
        <p class="net-banner" role="alert">연결이 잠깐 끊겼어요. 다시 잇는 중이에요…</p>
      )}
    </div>
  );

  function screen() {
    if (!s.code) return <Entry client={client} />;
    if (s.conn === 'replaced') return <Replaced onAgain={() => { if (!client.resumeSaved()) client.leave(); }} />;
    if (!s.room) return <Connecting retrying={s.conn === 'retrying'} onBack={() => client.leave()} />;
    if (s.room.phase === 'lobby') return <>{s.room.notice && <OldBoardNotice kind={s.room.notice} />}<Lobby client={client} s={s} /></>;
    if (s.seat === null) return <PinEntry client={client} s={s} />;
    if (s.room.phase === 'paused') return <Paused client={client} s={s} />;
    if (s.room.phase === 'finished' && !monoHold) return <Finished s={s} />;
    return <Game client={client} s={s} ending={monoHold} />;
  }
}
