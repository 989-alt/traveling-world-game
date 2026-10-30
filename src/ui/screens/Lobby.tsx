// 로비(PRD §8-2, v3 08): 방 코드 알약, 자리 4칸(빈자리는 로봇), 캐릭터 6종 고르기, 방장의 시작 버튼.
import { useState } from 'preact/hooks';
import { AssetImg, Pic } from '../../assets/AssetImg';
import { PIN_RE } from '../../shared/protocol';
import type { Seat } from '../../shared/types';
import type { GameClient } from '../../state/client';
import { josa } from '../../state/nick';
import type { ClientState } from '../../state/store';
import { seatViews } from '../../state/view';
import { SignButton } from '../overlays/ScrollPanel';
import { Rules } from './Rules';
import '../../styles/screens.css';

const CHARS = [0, 1, 2, 3, 4, 5];

function CodePill({ code }: { code: string }) {
  return (
    <div class="code-pill" aria-label={`방 코드 ${code.split('').join(' ')}`}>
      {code.split('').map((c, i) => <span key={i} class="code-box">{c}</span>)}
    </div>
  );
}

export function Lobby({ client, s }: { client: GameClient; s: ClientState }) {
  const room = s.room!;
  const seats = seatViews(room);
  const [rules, setRules] = useState(false);
  const [asked, setAsked] = useState<number | null>(null);
  const takenChars = room.seats.filter((x) => x.taken).map((x) => x.charId);
  const host = s.seat !== null && s.seat === room.hostSeat;
  const full = room.seats.every((x) => x.taken);

  return (
    <main class="sc sc--lobby">
      <AssetImg k="ui.boardBg" class="sc-bg" />
      <div class="sc-wrap lobby">
        <CodePill code={room.code} />
        <p class="lobby-sub">{room.settings.totalMinutes}분 놀이 · 친구에게 코드를 알려 주세요</p>
        <section class="sc-glass lobby-seats" aria-label="자리">
          {seats.map((v) => (
            <div key={v.seat} class={`lb-slot${v.seat === s.seat ? ' is-me' : ''}`} data-seat={v.seat} style={{ '--seat': `var(--seat-${v.seat + 1})` }}>
              {/* v3 08: 위 70% = P01 1024 반신 크롭(빈자리는 로봇 CH7), 아래 = 자리색 띠 + 원 */}
              <div class="lb-slot-art">
                <Pic base k={`char.${v.charId}.p01.big`} class={`lb-slot-char${v.charId === 7 ? ' lb-slot-char--bot' : ''}`} fallback={<AssetImg k={`char.${v.charId}.f00`} class="lb-slot-face" alt="" />} />
                <span class="lb-slot-band">{v.seat + 1}번{v.seat === room.hostSeat && v.taken ? ' · 방장' : ''}</span>
              </div>
              <div class="lb-slot-foot">
                <i class="lb-slot-dot" aria-hidden="true" />
                <b class="lb-slot-name">{v.taken ? v.name : '빈자리'}</b>
                <span class="lb-slot-state">{v.taken ? (v.seat === s.seat ? '나' : v.connected ? '준비됐어요' : '잠시 나갔어요') : '로봇이 함께해요'}</span>
              </div>
            </div>
          ))}
        </section>

        {s.seat === null ? (
          <section class="lobby-pick" aria-label="캐릭터 고르기">
            <h2>{full ? '자리가 다 찼어요' : '함께 여행할 친구를 골라요'}</h2>
            <div class="pick-row">
              {CHARS.map((c) => (
                <button type="button" key={c} class="pick" data-char={c} aria-pressed={asked === c}
                  disabled={full || takenChars.includes(c) || (asked !== null && !s.error)} onClick={() => { setAsked(c); client.join(c); }}>
                  <AssetImg k={`char.${c + 1}.f00`} class="pick-face" alt={`탐험가 ${c + 1}`} />
                </button>
              ))}
            </div>
            {s.error === 'full' && <p class="sc-msg" role="alert">자리가 다 찼어요. 다른 방 코드를 받아 와요.</p>}
          </section>
        ) : (
          <div class="lobby-go">
            {host
              ? <button type="button" class="start-btn" data-act="start" onClick={() => client.send({ t: 'start' })}><span class="start-tri" aria-hidden="true" />출발하기</button>
              : <p class="sc-note-line" role="status">{josa(seats[room.hostSeat].name, '이', '가')} 출발을 누르면 바로 시작해요</p>}
          </div>
        )}
        <div class="lobby-signs"><SignButton label="규칙 보기" onClick={() => setRules(true)}><b class="sign-q">?</b></SignButton></div>
      </div>
      {rules && <Rules onClose={() => setRules(false)} />}
    </main>
  );
}

/** 이미 시작한 방에 처음 보는 기기로 왔다: 자리 번호를 고르고 저장 화면에서 찍어 둔 PIN 4자리를 넣는다 */
export function PinEntry({ client, s }: { client: GameClient; s: ClientState }) {
  const seats = seatViews(s.room!);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [pin, setPin] = useState('');
  const ok = seat !== null && PIN_RE.test(pin);
  const err = s.error === 'pin' ? '번호가 맞지 않아요. 찍어 둔 사진을 다시 봐 주세요.'
    : s.error === 'locked' ? '여러 번 틀렸어요. 1분 쉬었다가 다시 해 봐요.' : '';
  return (
    <main class="sc sc--pin">
      <AssetImg k="ui.boardBg" class="sc-bg" />
      <form class="sc-glass pin-box" onSubmit={(e) => { e.preventDefault(); if (ok) client.claim(seat!, pin); }}>
        <h1>내 자리로 돌아가기</h1>
        <p>이미 시작한 방이에요. 내 자리를 고르고 비밀번호 4자리를 넣어 주세요.</p>
        <div class="pin-seats" role="radiogroup" aria-label="내 자리">
          {seats.map((v) => (
            <button type="button" role="radio" key={v.seat} class="pin-seat" aria-checked={seat === v.seat} onClick={() => setSeat(v.seat)}
              style={{ '--seat': `var(--seat-${v.seat + 1})` }}>
              <AssetImg k={`char.${v.charId}.f00`} class="pin-face" alt="" />
              <span>{v.seat + 1}번 · {v.name}</span>
            </button>
          ))}
        </div>
        <label class="entry-label" for="seat-pin">비밀번호 4자리</label>
        <input id="seat-pin" class="code-input pin-input" type="text" inputMode="numeric" autoComplete="off" maxLength={4} pattern="[0-9]{4}"
          value={pin} onInput={(e) => setPin((e.target as HTMLInputElement).value.replace(/[^0-9]/g, '').slice(0, 4))} />
        {err && <p class="sc-msg" role="alert">{err}</p>}
        <div class="pin-btns">
          <button type="submit" class="ov-btn ov-btn--primary" disabled={!ok}>돌아가기</button>
          <button type="button" class="ov-btn ov-btn--secondary" onClick={() => client.leave()}>처음 화면으로</button>
        </div>
      </form>
    </main>
  );
}
