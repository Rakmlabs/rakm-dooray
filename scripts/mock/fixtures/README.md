# 배포 메모

알파 빌드 배포 순서입니다.

1. `npm run build`
2. 설치 파일 서명
3. 공지

| 환경 | 주소 |
|---|---|
| 스테이징 | stg.example.com |
| 운영 | app.example.com |

> 운영 배포는 금요일 오후 금지.

```sh
npm run dist
```
