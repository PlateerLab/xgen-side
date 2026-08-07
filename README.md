# XGEN Side

Windows에서 로컬로 실행되는 Skill-first AI 브라우저입니다.

XGEN Side는 일반 채팅, 웹 검색, 실제 브라우저 조작을 하나의 데스크톱 앱 안에서 연결합니다. 사용자의 요청은 먼저 Skill Router를 통과하며, 선택된 Skill이 허용한 도구와 브라우저 동작만 실행됩니다.

> 현재 상태: 초기 Windows 데스크톱 프로토타입. 핵심 UI, 로컬 Provider 실행, Skill Router, Browser Agent Overview와 로컬 실행 기록을 구현하고 있습니다.

## 제품 구조

- 왼쪽 패널: 채팅과 브라우저 세션을 한 목록에서 관리
- 중앙 화면: 일반 AI 채팅 또는 실제 브라우저 탭
- 오른쪽 패널: 현재 페이지를 대상으로 질문하고 작업하는 XGEN Side Agent
- Browser Agent Overview: 일반 채팅에서 브라우저 작업이 필요할 때 선택된 Skill, 실행 단계, 대상 사이트와 허용된 동작을 표시
- 라이트·다크 모드와 XGEN 포인트 컬러 `#305EEB`

## Skill-first 실행

모든 Agent 요청은 Skill Router에서 실행 계획으로 변환됩니다.

```text
User request
    ↓
Skill Router
    ├─ Conversation
    ├─ Web research
    ├─ Page reader
    ├─ Browser navigation
    ├─ Structured extraction
    └─ Form guard
    ↓
Provider adapter (Codex CLI / Claude Code CLI)
    ↓
Command broker + Browser bridge
    ↓
Local run store
```

- 브라우저 권한은 `default: deny`에서 시작합니다.
- 선택된 Skill이 요구한 action category만 실행 시점에 허용합니다.
- 필요한 Skill이 비활성화되어 있으면 Provider나 브라우저를 실행하기 전에 차단합니다.
- Skill 선택과 실행 이벤트는 로컬 세션 기록에 저장됩니다.

## Provider

XGEN Side는 별도의 API 키를 강제하지 않고 사용자가 로컬에서 인증한 CLI Provider를 사용할 수 있도록 설계했습니다.

- OpenAI: Codex CLI 인증과 구독 환경
- Anthropic: Claude Code CLI 인증과 구독 환경
- Provider와 모델은 Settings에서 등록하고 채팅 입력창 안에서 선택
- Provider별 실행 차이는 공통 adapter 계약으로 정규화

XGEN Side는 계정 비밀번호나 구독 토큰을 자체 저장하지 않습니다. 실제 인증은 각 Provider의 공식 CLI가 담당합니다.

## 로컬 실행과 보안

- Windows PowerShell을 기본 명령 셸로 사용
- 명령어를 직접 실행하지 않고 Command Broker의 정책 판정을 거침
- 읽기 전용 명령, 승인 필요 명령, 거부 명령을 분리
- 실행 요청, Skill route, 승인 결과, 출력과 오류를 로컬 파일에 기록
- Browser bridge는 선택된 Skill이 브라우저를 요구할 때만 Provider에 연결
- 삭제, 업로드, 다운로드, 외부 상태 변경은 기본적으로 허용하지 않음

## 시작하기

### 요구 사항

- Windows 11
- Node.js 24 이상
- pnpm 11.1.3 이상
- 사용하려는 Provider에 따라 설치 및 로그인된 Codex CLI 또는 Claude Code CLI

### 설치와 실행

```powershell
pnpm install
pnpm dev:xgen-side
```

### 검증

```powershell
pnpm typecheck:xgen-side
pnpm test:xgen-side
pnpm build:xgen-side
```

GitHub Actions는 Windows에서 위 세 검증만 실행합니다. 원본 프로젝트의 npm 배포, GitHub Release, Linux/macOS 바이너리 빌드는 자동 실행하지 않습니다.

## 저장소 구조

```text
apps/desktop/                XGEN Side Electron 앱
  src/main/                  Provider, Skill, 정책, 브라우저, 로컬 저장소
  src/preload/               타입이 지정된 IPC bridge
  src/renderer/              Chat, Browser, Settings, Overview UI
cli/                         내장 agent-browser 엔진
skill-data/                  엔진용 Skill과 참고 자료
docs/xgen-side/              XGEN Side 아키텍처 문서
scripts/xgen-side.mjs        데스크톱 개발·검증 명령 진입점
```

더 자세한 내용은 [XGEN Side 개요](XGEN_SIDE.md)와 [아키텍처 문서](docs/xgen-side/architecture.md)를 참고하세요.

## 현재 구현 범위

- [x] Windows Electron 앱 셸
- [x] 일반 채팅과 브라우저 세션 UI
- [x] 좌우 패널 열기·닫기
- [x] 라이트·다크 테마
- [x] Codex CLI와 Claude Code CLI adapter
- [x] Provider·MCP·도메인별 Skill 설정
- [x] Skill Router와 최소 권한 Browser policy
- [x] Browser Agent Overview
- [x] 로컬 실행 기록
- [ ] Overview와 실제 Electron 탭의 라이브 화면 연결
- [ ] 승인 UI와 실시간 command stream
- [ ] Windows 설치 패키지와 자동 업데이트

## Upstream

브라우저 자동화 엔진은 Vercel Labs의 [agent-browser](https://github.com/vercel-labs/agent-browser)를 기반으로 합니다. 원본 엔진은 이 저장소에서 XGEN Side가 사용할 수 있는 하나의 로컬 도구로 취급합니다.

원본 저작권과 라이선스 고지는 [LICENSE](LICENSE) 및 소스에 포함된 제3자 고지에 따라 유지됩니다. 깨끗한 XGEN Side 이력을 위해 원본 Git 커밋 기록은 저장소에 포함하지 않지만, 저작권과 오픈소스 출처는 제거하지 않습니다.

## License

Apache License 2.0. 자세한 조건은 [LICENSE](LICENSE)를 확인하세요.
