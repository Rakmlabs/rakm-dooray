// 위키 블록 편집기 영역의 IPC 계약. 이 영역 작업자만 고친다. ipc.ts 가 합친다.
// 채널 이름은 'wiki:...' 처럼 영역 접두어를 붙인다. 형식: 'wiki:이름': { args: [..]; result: .. }

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WikiAreaContract {}

export const WIKI_AREA_CHANNELS: (keyof WikiAreaContract)[] = []

/** main → renderer 이벤트 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WikiAreaEvents {}

export const WIKI_AREA_EVENTS: (keyof WikiAreaEvents)[] = []
