// 채팅 파일 뷰어·업로드·캐시 영역의 IPC 계약. 이 영역 작업자만 고친다. ipc.ts 가 합친다.
// 채널 이름은 'files:...' 처럼 영역 접두어를 붙인다. 형식: 'files:이름': { args: [..]; result: .. }

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FilesAreaContract {}

export const FILES_AREA_CHANNELS: (keyof FilesAreaContract)[] = []

/** main → renderer 이벤트 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FilesAreaEvents {}

export const FILES_AREA_EVENTS: (keyof FilesAreaEvents)[] = []
