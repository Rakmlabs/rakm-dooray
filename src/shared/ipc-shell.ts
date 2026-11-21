// 앱 전역 편의: ⌘K, 폴더, 안 읽음·알림, 로컬 보관·검색, 창·트레이 영역의 IPC 계약. 이 영역 작업자만 고친다. ipc.ts 가 합친다.
// 채널 이름은 'shell:...' 처럼 영역 접두어를 붙인다. 형식: 'shell:이름': { args: [..]; result: .. }

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ShellAreaContract {}

export const SHELL_AREA_CHANNELS: (keyof ShellAreaContract)[] = []

/** main → renderer 이벤트 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ShellAreaEvents {}

export const SHELL_AREA_EVENTS: (keyof ShellAreaEvents)[] = []
