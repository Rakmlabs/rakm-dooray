// 채팅 영역 소유. 설정 화면에 들어가는 채팅 관련 설정 카드 (링크 미리보기 등). Settings 가 그대로 넣는다.
import { useApp } from '../../state'
import { errorText } from '../../api'
import { useChatPrefs } from './chatStore'

export function ChatSettings() {
  const { toast } = useApp()
  const [prefs, save] = useChatPrefs()
  return (
    <div className="card chat-settings">
      <h2>채팅</h2>
      <label className="check-row">
        <input
          type="checkbox"
          checked={prefs.linkPreview}
          onChange={async (e) => {
            try {
              await save({ linkPreview: e.target.checked })
            } catch (err) {
              toast(errorText(err))
            }
          }}
        />
        <span className="check-text">
          <b>링크 미리보기</b>
          <small>
            메시지에 있는 링크의 제목·설명·대표 이미지를 카드로 보여줍니다. 이를 위해 이 컴퓨터가 링크 주소의 외부 사이트에 직접 요청합니다
            (쿠키·로그인 정보는 보내지 않고, 회사 내부망·내 컴퓨터 주소로는 요청하지 않습니다).
          </small>
        </span>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={prefs.threads}
          onChange={async (e) => {
            try {
              await save({ threads: e.target.checked })
            } catch (err) {
              toast(errorText(err))
            }
          }}
        />
        <span className="check-text">
          <b>스레드 기능 쓰기</b>
          <small>
            켜면 대화방의 스레드 탭, "새 주제" 버튼, 메시지의 "스레드로 답하기"가 보입니다. 꺼 두어도 대화에 달린 스레드("스레드 N개")는 열어서
            읽고, 답하고, 지울 수 있습니다.
          </small>
        </span>
      </label>
      <small>
        북마크와 답장 인용 정보는 이 컴퓨터에만 저장됩니다. 프로필 사진은 두레이 API 가 주지 않아 이름 첫 글자로 표시합니다.
      </small>
    </div>
  )
}
