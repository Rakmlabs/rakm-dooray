// 모의 서버용 한글(hwp/hwpx) 샘플 생성기. make.py 다음에 실행한다: node scripts/mock/fixtures/make-hwp.mjs
// 진짜 한글 본문 레코드까지 만들지는 않는다. 앱이 미리보기에 쓰는 부분만 실제 형식대로 넣는다.
//  - hwp: OLE 복합 파일 + FileHeader, PrvText(UTF-16LE), PrvImage(PNG)
//  - hwpx: zip + mimetype, Contents/section0.xml(hp:p/hp:t), Preview/PrvText.txt, Preview/PrvImage.png
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import CFB from 'cfb'
import JSZip from 'jszip'

const here = dirname(fileURLToPath(import.meta.url))
const png = readFileSync(join(here, 'preview.png'))
const lines = ['주간 업무 보고 (3월 1주)', '', '1. 메신저 파일 미리보기 개발', '2. 위키 편집기 개선', '3. 투자사 미팅 준비', '', '다음 주: 알파 릴리스 QA']

const header = Buffer.alloc(256)
header.write('HWP Document File', 0, 'latin1')
header.writeUInt32LE(0x05010000, 32) // 버전 5.1
header.writeUInt32LE(0, 36) // 속성: 압축·암호 없음
const cfb = CFB.utils.cfb_new()
CFB.utils.cfb_add(cfb, '/FileHeader', header)
CFB.utils.cfb_add(cfb, '/PrvText', Buffer.from(lines.map((l) => `<${l}>`).join('\r\n'), 'utf16le'))
CFB.utils.cfb_add(cfb, '/PrvImage', png)
CFB.utils.cfb_del(cfb, '/\u0001Sh33tJ5')
writeFileSync(join(here, '주간보고.hwp'), CFB.write(cfb, { type: 'buffer' }))

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const section = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
${['투자 제안서 요약', '', '회사: RAKM', '단계: 시드', '요청 금액: 5억 원', '', '핵심 지표는 첨부한 엑셀 파일을 참고해 주세요.']
  .map((t) => `  <hp:p><hp:run><hp:t>${esc(t)}</hp:t></hp:run></hp:p>`)
  .join('\n')}
</hs:sec>`
const zip = new JSZip()
zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' })
zip.file('version.xml', '<?xml version="1.0" encoding="UTF-8"?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" major="5" minor="1"/>')
zip.file('Contents/section0.xml', section)
zip.file('Preview/PrvText.txt', '<투자 제안서 요약>\r\n<회사: RAKM>')
zip.file('Preview/PrvImage.png', png)
writeFileSync(join(here, '투자제안서.hwpx'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
console.log('ok')
