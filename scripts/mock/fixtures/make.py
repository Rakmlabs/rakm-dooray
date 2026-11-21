# 모의 서버용 샘플 파일 생성기 (인터넷에서 받지 않고 로컬에서 만든다).
#   python3 scripts/mock/fixtures/make.py      (PIL, openpyxl, python-docx, python-pptx, reportlab, ffmpeg 필요)
#   node scripts/mock/fixtures/make-hwp.mjs     (hwp/hwpx — make.py 가 만든 preview.png 를 쓴다)
# 결과물은 이 폴더에 둔다. 전부 합쳐 수 MB 이내.
import io, json, os, subprocess, datetime
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = '/System/Library/Fonts/AppleSDGothicNeo.ttc'


def font(size):
    try:
        return ImageFont.truetype(FONT, size)
    except Exception:
        return ImageFont.load_default()


def gradient(w, h, c1, c2):
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)))
    return img


def photo(name, w, h, c1, c2, title, sub):
    img = gradient(w, h, c1, c2)
    d = ImageDraw.Draw(img)
    for i in range(14):
        x = (i * 173) % w
        y = (i * 97) % h
        r = 30 + (i * 37) % 120
        d.ellipse([x - r, y - r, x + r, y + r], outline=(255, 255, 255), width=3)
    # 격자 (확대했을 때 선명도 확인용)
    for x in range(0, w, 100):
        d.line([(x, h - 60), (x, h - 40)], fill=(255, 255, 255), width=2)
    d.text((w // 14, h // 3), title, font=font(max(36, w // 14)), fill=(255, 255, 255))
    d.text((w // 14, h // 3 + max(36, w // 14) + 20), sub, font=font(max(20, w // 36)), fill=(235, 240, 255))
    path = os.path.join(HERE, name)
    if name.endswith('.png'):
        img = img.quantize(64).convert('RGB')
        img.save(path, optimize=True)
    else:
        img.save(path, quality=80, optimize=True)


photo('사무실_화이트보드.jpg', 1600, 1000, (47, 107, 255), (25, 31, 40), '3월 릴리스 계획', '화이트보드 사진 · 1600×1000')
photo('제품_목업.png', 900, 1400, (31, 138, 92), (12, 40, 60), '앱 목업', '세로 이미지 · 900×1400')
photo('행사_현수막.jpg', 2000, 600, (196, 32, 47), (60, 20, 80), 'RAKM 데모데이', '가로로 긴 이미지 · 2000×600')
photo('screenshot.png', 1280, 800, (60, 60, 70), (20, 22, 28), '스크린샷', '1280×800')

# 한글·HWP 미리보기 이미지
prev = gradient(400, 560, (255, 255, 255), (230, 236, 245))
pd = ImageDraw.Draw(prev)
pd.text((30, 40), '주간 업무 보고', font=font(34), fill=(25, 31, 40))
for i in range(10):
    pd.line([(30, 120 + i * 36), (370 - (i % 3) * 60, 120 + i * 36)], fill=(140, 150, 165), width=6)
prev.save(os.path.join(HERE, 'preview.png'), optimize=True)

# 동영상·오디오
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=8',
                '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                '-crf', '32', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '48k', '-movflags', '+faststart',
                os.path.join(HERE, '시연영상.mp4')], check=True)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=12',
                '-c:a', 'libmp3lame', '-b:a', '48k', os.path.join(HERE, '회의녹음.mp3')], check=True)

# PDF — 비내장 한글 CID 글꼴(HYSMyeongJo)을 써서 pdf.js 의 CMap 처리도 확인한다
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.pagesizes import A4
pdfmetrics.registerFont(UnicodeCIDFont('HYSMyeongJo-Medium'))
c = canvas.Canvas(os.path.join(HERE, '사업계획서_v3.pdf'), pagesize=A4)
W, H = A4
for page in range(1, 4):
    c.setFillColorRGB(0.18, 0.42, 1)
    c.rect(0, H - 80, W, 80, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont('HYSMyeongJo-Medium', 24)
    c.drawString(40, H - 52, f'RAKM 사업계획서 v3 — {page}장')
    c.setFillColorRGB(0.1, 0.12, 0.16)
    c.setFont('HYSMyeongJo-Medium', 14)
    lines = ['1. 문제 정의: 두 사람이 매일 쓰는 도구가 흩어져 있다.', '2. 해결: 메신저·위키·파일을 한 앱에서.',
             '3. 시장: 소규모 팀 협업 도구', '4. 일정: 3월 알파, 6월 베타', 'Page %d / 3' % page]
    for i, t in enumerate(lines):
        c.drawString(50, H - 140 - i * 28, t)
    c.setStrokeColorRGB(0.18, 0.42, 1)
    c.setLineWidth(2)
    for i in range(6):
        c.rect(60 + i * 80, 200, 60, 40 + page * 20 + i * 25, stroke=1, fill=0)
    c.showPage()
c.save()

# DOCX
import docx
from docx.shared import Inches
doc = docx.Document()
doc.add_heading('알파 프로젝트 회의록', 0)
doc.add_paragraph('일시: 2026년 3월 1일 (일) 오후 2시 · 참석: 나소유, 김공동, 박개발')
doc.add_heading('논의 내용', level=1)
for t in ['릴리스 범위를 메신저·위키로 한정한다.', 'QA 는 3월 10일부터 시작한다.', '파일 미리보기는 앱 안에서 처리한다.']:
    doc.add_paragraph(t, style='List Bullet')
p = doc.add_paragraph('강조할 내용은 ')
p.add_run('굵게').bold = True
p.add_run(', 참고는 ')
p.add_run('기울임').italic = True
p.add_run(' 으로 적는다.')
doc.add_heading('할 일', level=1)
table = doc.add_table(rows=1, cols=3)
table.style = 'Light Grid Accent 1'
for cell, t in zip(table.rows[0].cells, ['항목', '담당', '기한']):
    cell.text = t
for row in [('릴리스 범위 확정', '김공동', '3/3'), ('QA 계획', '박개발', '3/8'), ('공지 초안', '나소유', '3/12')]:
    cells = table.add_row().cells
    for cell, t in zip(cells, row):
        cell.text = t
doc.add_paragraph()
doc.add_picture(os.path.join(HERE, 'preview.png'), width=Inches(2))
doc.save(os.path.join(HERE, '회의록_0301.docx'))

# XLSX
import openpyxl
from openpyxl.styles import Font, PatternFill
wb = openpyxl.Workbook()
ws = wb.active
ws.title = '월별 매출'
ws.append(['월', '매출(원)', '비용(원)', '이익(원)', '비고'])
for cell in ws[1]:
    cell.font = Font(bold=True)
    cell.fill = PatternFill('solid', fgColor='EAF1FF')
data = [(1, 1200000, 900000), (2, 1500000, 950000), (3, 2100000, 1100000), (4, 1800000, 1000000), (5, 2600000, 1300000), (6, 3100000, 1500000)]
for m, s, e in data:
    r = ws.max_row + 1
    ws.append([f'{m}월', s, e, f'=B{r}-C{r}', '목표 달성' if s > 2000000 else ''])
    ws.cell(row=r, column=4).value = s - e  # 미리 계산된 값을 넣는다 (뷰어는 수식을 계산하지 않음)
ws.append(['합계', sum(d[1] for d in data), sum(d[2] for d in data), sum(d[1] - d[2] for d in data), ''])
ws2 = wb.create_sheet('일정')
ws2.append(['날짜', '할 일', '담당'])
ws2.append([datetime.date(2026, 3, 3), '릴리스 범위 확정', '김공동'])
ws2.append([datetime.date(2026, 3, 10), 'QA 시작', '박개발'])
ws2.append([datetime.date(2026, 3, 15), '알파 릴리스', '나소유'])
wb.save(os.path.join(HERE, '릴리스_예산.xlsx'))

# PPTX
from pptx import Presentation
from pptx.util import Inches as PI
prs = Presentation()
s = prs.slides.add_slide(prs.slide_layouts[0])
s.shapes.title.text = 'RAKM 데모데이 발표'
s.placeholders[1].text = '2026년 3월 · 창업팀'
s = prs.slides.add_slide(prs.slide_layouts[1])
s.shapes.title.text = '우리가 푸는 문제'
tf = s.placeholders[1].text_frame
tf.text = '도구가 흩어져 있다'
for t in ['메신저와 위키를 오가며 일한다', '첨부 파일을 매번 내려받아 연다']:
    tf.add_paragraph().text = t
s = prs.slides.add_slide(prs.slide_layouts[5])
s.shapes.title.text = '화면 미리보기'
s.shapes.add_picture(os.path.join(HERE, 'preview.png'), PI(3.5), PI(1.8), height=PI(4.5))
prs.save(os.path.join(HERE, '데모데이_발표.pptx'))

# 텍스트 계열
open(os.path.join(HERE, '메모.txt'), 'w', encoding='utf-8').write('오늘 할 일\n- 투자사 미팅 자료 정리\n- 위키 회의록 올리기\n- 파일 뷰어 점검\n\n내일은 오전 10시 출근.\n')
open(os.path.join(HERE, 'README.md'), 'w', encoding='utf-8').write('# 배포 메모\n\n알파 빌드 배포 순서입니다.\n\n1. `npm run build`\n2. 설치 파일 서명\n3. 공지\n\n| 환경 | 주소 |\n|---|---|\n| 스테이징 | stg.example.com |\n| 운영 | app.example.com |\n\n> 운영 배포는 금요일 오후 금지.\n\n```sh\nnpm run dist\n```\n')
open(os.path.join(HERE, '고객목록.csv'), 'w', encoding='utf-8').write('이름,회사,단계,금액\n김하나,한빛상사,미팅,"1,200,000"\n이두리,누리테크,계약,3500000\n박세찬,"가람, 주식회사",제안,800000\n최네온,별빛랩,보류,0\n')
json.dump({'name': 'rakm-dooray', 'version': '0.1.0', 'features': {'viewer': True, 'upload': ['drag', 'paste']}, 'limits': {'uploadMB': 100, 'cacheMB': 1024}},
          open(os.path.join(HERE, 'config.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
open(os.path.join(HERE, 'server.ts'), 'w', encoding='utf-8').write('''import { createServer } from 'node:http'

// 간단한 상태 확인 서버
interface Health {
  ok: boolean
  uptime: number
}

const started = Date.now()

export function health(): Health {
  return { ok: true, uptime: Math.round((Date.now() - started) / 1000) }
}

createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(health()))
  }
  res.writeHead(404).end('not found')
}).listen(3000)
''')
open(os.path.join(HERE, '압축본.zip'), 'wb').write(b'PK\x05\x06' + b'\x00' * 18)
print('ok')
