// 메시지 표시·프로필·입력 편의 영역의 IPC 계약. 이 영역 작업자만 고친다. ipc.ts 가 합친다.
// 채널 이름은 'chat:...' 처럼 영역 접두어를 붙인다. 형식: 'chat:이름': { args: [..]; result: .. }

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ChatAreaContract {}

export const CHAT_AREA_CHANNELS: (keyof ChatAreaContract)[] = []

/** main → renderer 이벤트 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ChatAreaEvents {}

export const CHAT_AREA_EVENTS: (keyof ChatAreaEvents)[] = []
