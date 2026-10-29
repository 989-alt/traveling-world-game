// 대기실 안내 문구(U123 L3·L4): 지난 저장본을 어떻게 바꿨는지에 맞는 한 문장
import type { ServerMsg } from '../../shared/protocol';

export type NoticeKind = NonNullable<Extract<ServerMsg, { t: 'state' }>['notice']>;

export const NOTICE_TEXT: Record<NoticeKind, string> = {
  /** 옛 판(40칸) 게임 저장본을 버림 */
  oldBoard: '지난 판은 새 판으로 시작해요. 판이 새로 바뀌었어요!',
  /** 20분 게임 저장본을 버림(판 모양은 그대로, 놀이 시간이 바뀜) */
  oldTime: '놀이 시간이 바뀌어서 새 판으로 시작해요.',
  /** 대기실 저장본의 옛 놀이 시간 설정을 40분으로 바꿈 */
  newTime: '놀이 시간이 바뀌어서 40분 놀이로 맞췄어요.',
};
