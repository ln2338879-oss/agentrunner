# AgentRunner

AgentRunner는 Discord에서 받은 작업을 여러 AI 역할에게 나눠 맡기는 자동 작업 런타임입니다.

쉽게 말하면, 사용자가 Discord에 일을 시키면 AgentRunner가 알아서 역할을 나누고, 결과를 만들고, 리뷰하고, 필요하면 사람에게 확인을 요청합니다.

```text
사용자 요청
→ Director가 작업을 판단
→ Builder / Factory / Designer가 작업 수행
→ Director가 결과 리뷰
→ 승인 / 수정 요청 / 사람 확인 / 작업 분리
→ Discord와 Obsidian Vault에 기록
```

처음 목표는 게임 개발 자동화였지만, 구조상 코드 수정, 문서 작성, 데이터 정리, 이미지 생성, 리뷰 자동화에도 사용할 수 있습니다.

---

## 주요 역할

| 역할 | 하는 일 |
|---|---|
| Director | 작업 분류, 계획, 리뷰, 승인/차단 판단 |
| Builder | 코드 구현, 버그 수정, 테스트, 빌드 |
| Factory | 문서, JSON, CSV, 게임 데이터 같은 콘텐츠 생성 |
| Designer | 이미지, 디자인, 픽셀아트, 시각 자료 생성 |

---

## 전체 구조

```text
Discord
  ↓
AgentRunner
  ├─ Router              # 어떤 역할이 맡을지 판단
  ├─ Workflow Engine     # plan → work → review 흐름 관리
  ├─ Step Scheduler      # 실행 가능한 작업을 자동 실행
  ├─ SQLite DB           # 작업 상태 저장
  ├─ Obsidian Vault      # 결과 Markdown 저장
  ├─ Director            # 계획 / 리뷰
  ├─ Builder             # 코드 작업
  ├─ Factory             # 콘텐츠 생성
  └─ Designer            # 이미지 생성
  ↓
Discord 알림 + Obsidian 결과물
```

---

## 빠른 시작

저장소를 받습니다.

```bash
git clone https://github.com/ln2338879-oss/agentrunner.git
cd agentrunner
```

패키지를 설치합니다.

```bash
bun install
```

환경 파일을 만듭니다.

```bash
cp .env.example .env
```

기본 점검을 실행합니다.

```bash
bun run doctor
bun test
```

Discord 없이 내부 동작만 확인하려면 다음을 실행합니다.

```bash
bun run proof
```

---

## 필요한 것

| 항목 | 설명 |
|---|---|
| Git | 저장소 다운로드와 브랜치 관리 |
| Bun | 실행, 테스트, 패키지 설치 |
| Node.js 20 이상 | 일부 도구 호환용 |
| Discord Bot Token | Discord에서 사용할 때 필요 |
| Claude Code | Director 역할에 사용 |
| Codex | Builder 역할에 사용 |
| Ollama 또는 Factory CLI | Factory 역할에 사용 |
| Gemini API Key | Designer 이미지 생성에 사용 |

SQLite는 `bun:sqlite`를 사용하므로 별도 DB 서버가 필요 없습니다.

---

## 기본 `.env` 예시

```env
# Discord
DIRECTOR_DISCORD_TOKEN=PASTE_TOKEN_HERE
GAME_DIRECTOR_CHANNEL_ID=PASTE_CHANNEL_ID_HERE

# Runtime paths
DATABASE_PATH=./data/agentrunner.sqlite
OBSIDIAN_VAULT_PATH=./vault/AgentRunnerVault
PROJECT_ROOT=./game-project
ATTACHMENTS_DIR=./data/attachments

# AI commands
CLAUDE_CODE_COMMAND=claude
CODEX_COMMAND=codex

# Factory
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=gemma

# Designer
GEMINI_API_KEY=PASTE_GEMINI_API_KEY_HERE
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
```

---

## 실행 명령어

```bash
bun run start          # Discord AgentRunner 실행
bun run dev            # 개발 모드 실행
bun run doctor         # 환경 점검
bun run proof          # 로컬 런타임 증명
bun run worker         # 역할별 worker 실행
bun run scheduler      # workflow scheduler 실행
bun run scheduler:once # scheduler 1회 실행
bun run dashboard      # dashboard 실행
bun run quality:check  # typecheck + lint + format + test
bun run build          # TypeScript build
```

역할별 worker 실행 예시:

```bash
AGENTRUNNER_WORKER_ROLE=director bun run worker
AGENTRUNNER_WORKER_ROLE=builder bun run worker
AGENTRUNNER_WORKER_ROLE=factory bun run worker
AGENTRUNNER_WORKER_ROLE=designer bun run worker
```

---

## Discord 명령어

Text command:

```text
!help
!tasks
!task TASK-...
!retry TASK-...
!steer TASK-... 다음 실행에 반영할 추가 지시
```

Slash command:

```text
/help
/tasks
/task id:TASK-...
/retry id:TASK-...
/run prompt:작업 요청
```

일반 메시지를 보내도 새 작업으로 만들 수 있습니다.

---

## 작업 흐름

가장 기본적인 코드 작업 흐름은 아래와 같습니다.

```text
Director가 계획
→ Builder가 코드 수정
→ Director가 리뷰
→ 통과하면 승인
→ 문제가 있으면 Builder에게 다시 수정 요청
```

콘텐츠 작업은 Factory가 맡고, 이미지 작업은 Designer가 맡습니다.

```text
문서 / JSON / CSV / 게임 데이터 → Factory
이미지 / 디자인 / 픽셀아트 → Designer
코드 / 버그 / 테스트 / 빌드 → Builder
계획 / 리뷰 / 애매한 요청 → Director
```

---

## 리뷰 결과

Director는 리뷰할 때 아래 결과 중 하나를 냅니다.

| 결과 | 의미 |
|---|---|
| `APPROVED` | 작업 승인 |
| `NEEDS_REVISION` | 수정 필요. 이전 작업 단계로 되돌림 |
| `BLOCKED` | 더 진행할 수 없음 |
| `NEEDS_HUMAN` | 사람이 직접 확인해야 함 |
| `SPLIT_TASK` | 큰 작업을 작은 작업으로 나눔 |
| `RETRY_WITH_DIFFERENT_AGENT` | 다른 방식이 필요해서 사람 확인으로 넘김 |

---

## 안전 장치

AgentRunner는 자동으로 코드를 수정하거나 명령을 실행할 수 있기 때문에 안전 장치가 중요합니다.

현재 들어간 핵심 안전 장치는 세 가지입니다.

### 1. 리뷰어는 코드를 직접 고치지 못함

리뷰 단계에서는 Director가 파일을 수정하면 안 됩니다.

AgentRunner는 리뷰 전후의 git 상태를 비교합니다.

```text
리뷰 시작 전 상태 저장
→ 리뷰 실행
→ 다시 상태 확인
→ 파일이 바뀌었으면 실패 처리
```

이렇게 해서 리뷰어가 몰래 코드를 고치는 일을 막습니다.

### 2. 승인했다고 바로 통과하지 않음

Director가 `APPROVED`를 내도 바로 끝나지 않습니다.

Strict Review Gate가 한 번 더 확인합니다.

예를 들어 아래 문제가 있으면 승인을 수정 요청으로 바꿉니다.

```text
코드는 바뀌었는데 테스트가 없음
검증 명령이 실패함
위험한 파일이 바뀜
```

즉, AI가 “좋아 보임”이라고 말해도 규칙에 걸리면 통과하지 않습니다.

### 3. 위험한 작업은 사람 허락을 받음

Risk Approval Gate는 위험한 요청을 실행 전에 멈춥니다.

아래 같은 요청은 바로 실행하지 않고 `needs_human` 상태로 바뀝니다.

```text
커밋 / 푸시 / 머지 / 릴리스
배포 / 운영 반영
토큰 / 비밀번호 / 인증 정보 변경
의존성 / lockfile 변경
CI/CD / GitHub Actions 변경
대량 삭제나 위험한 파일 작업
```

예시:

```text
"수정하고 바로 커밋해서 푸시해줘"
→ Builder 실행 전에 멈춤
→ task status = needs_human
→ 사람이 먼저 확인해야 함
```

---

## 안전 관련 `.env` 설정

기본적으로 안전 기능은 켜는 것을 권장합니다.

```env
# 리뷰 승인 후 추가 검증
STRICT_REVIEW_ENABLED=true
STRICT_REVIEW_REQUIRE_TESTS=true
STRICT_REVIEW_COMMANDS=
STRICT_REVIEW_FAIL_ON_VALIDATION_ERROR=true

# 위험 작업은 사람 확인 필요
RISK_APPROVAL_ENABLED=true
RISK_APPROVAL_BLOCK_DESTRUCTIVE_COMMANDS=true
RISK_APPROVAL_REQUIRE_FOR_DEPLOY=true
RISK_APPROVAL_REQUIRE_FOR_SECRETS=true
RISK_APPROVAL_REQUIRE_FOR_DEPENDENCY_CHANGES=true
RISK_APPROVAL_REQUIRE_FOR_CI_CHANGES=true
REQUIRE_USER_APPROVAL_BEFORE_COMMIT=true

# 리뷰어 파일 수정 방지
REVIEW_READ_ONLY_GUARD=true
```

---

## 결과 저장 위치

AgentRunner는 결과를 Obsidian Vault 폴더에 Markdown 파일로 저장합니다.

```text
AgentRunnerVault/
  01_Tasks/           # 작업 문서
  04_Reviews/         # 리뷰 결과
  05_BuilderReports/  # 코드 작업 결과
  06_FactoryOutputs/  # 콘텐츠 결과
  06_DesignerOutputs/ # 이미지 결과
  08_Recovery/        # 복구 보고서
```

Obsidian 앱을 직접 제어하지는 않습니다. 지정한 폴더에 파일을 만들어 둡니다.

---

## Dashboard

Dashboard는 별도 프로세스로 실행합니다.

```bash
bun run dashboard
```

기본 설정:

```env
DASHBOARD_ENABLED=true
DASHBOARD_HOST=127.0.0.1
DASHBOARD_PORT=8787
```

주의: 현재 dashboard 인증은 아직 없습니다. 외부에 공개하지 말고 `127.0.0.1`로 사용하는 것을 권장합니다.

---

## 품질 검사

전체 검사:

```bash
bun run quality:check
```

개별 검사:

```bash
bun run typecheck
bun run lint
bun run format:check
bun test
bun run build
```

GitHub Actions는 PR과 main push마다 install, typecheck, lint, format check, test, build를 실행합니다.

---

## 아직 남은 한계

AgentRunner는 계속 개선 중입니다.

현재 남은 주요 한계는 아래와 같습니다.

```text
Dashboard 인증 없음
task별 git worktree 격리 미구현
승인/거절 전용 Discord 명령은 아직 보강 필요
parallel DAG execution은 아직 미완성
구조화 로깅 미흡
LICENSE 파일 별도 추가 필요
```

운영 안정성을 더 높이려면 다음 작업이 우선입니다.

```text
1. task별 git worktree 격리
2. 승인/거절 Discord 명령 추가
3. Dashboard 인증
4. 구조화 로깅
```

---

## 보안 주의

아래 정보는 절대 GitHub에 올리면 안 됩니다.

```text
.env
Discord bot token
OpenAI API key
Gemini API key
Claude/Codex 인증 정보
개인 Discord 서버 정보
```

로그를 공유할 때도 토큰, API key, channel ID, user ID, 개인 파일 경로는 제거하세요.
