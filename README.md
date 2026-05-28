# AgentRunner

AgentRunner는 Discord에서 받은 작업을 여러 AI 역할에게 나눠 맡기는 **멀티 에이전트 자동 작업 런타임**입니다.

쉽게 말하면 다음 흐름을 자동화합니다.

```text
Discord에서 작업 요청
→ Director가 작업 종류 판단
→ Builder / Factory / Designer 중 알맞은 역할에게 전달
→ 결과 생성
→ Director가 리뷰
→ 승인, 수정 요청, 사람 호출, 작업 분리 처리
→ 결과를 Discord와 Obsidian Vault에 기록
```

처음에는 게임 개발 자동화를 목표로 만들었지만, 현재 구조는 게임 전용이 아닙니다. 코드 수정, 문서 작성, 데이터 정리, 이미지 생성, 리뷰, 작업 분리, 운영 자동화에 모두 사용할 수 있습니다.

---

## 1. AgentRunner가 하는 일

### 역할별 작업 분담

| 역할 | 기본 도구 | 하는 일 |
|---|---|---|
| Director | Claude Code | 작업 분류, 계획, 리뷰, 승인/차단 판단 |
| Builder | Codex | 코드 구현, 버그 수정, 테스트, 빌드 |
| Factory | Ollama / 로컬 LLM | 문서, JSON, CSV, 아이템/몬스터 데이터 같은 콘텐츠 생성 |
| Designer | Gemini Image | 이미지, 디자인, 픽셀아트, 시각 자료 생성 |

전체 구조는 이렇습니다.

```text
Discord User
  ↓
AgentRunner
  ├─ SQLite DB                 # 작업 상태 저장
  ├─ Obsidian Vault            # 결과 Markdown 파일 저장
  ├─ Router                    # 작업 분류
  ├─ Workflow Engine           # plan → work → review 흐름 관리
  ├─ Step Scheduler            # 실행 가능한 step 자동 처리
  ├─ Director                  # 계획 / 리뷰 / 중재
  ├─ Builder                   # 코드 작업
  ├─ Factory                   # 콘텐츠 생성
  └─ Designer                  # 이미지 생성
  ↓
Discord 알림 + Obsidian 결과물
```

---

## 2. 설치 전 필요한 것

### 필수 프로그램

AgentRunner를 실행하려면 아래 프로그램이 필요합니다.

| 항목 | 필요 여부 | 설명 |
|---|---:|---|
| Git | 필수 | GitHub 저장소 다운로드와 브랜치 관리 |
| Bun | 필수 | 프로젝트 실행, 테스트, 패키지 설치 |
| Node.js 20 LTS 이상 | 권장/거의 필수 | 일부 Node 생태계 도구 호환용 |
| SQLite | 내장 사용 | `bun:sqlite` 사용. 별도 DB 서버는 필요 없음 |
| Discord Bot Token | Discord 연동 시 필수 | 봇을 Discord 서버에 연결할 때 필요 |
| Ubuntu 또는 Windows | 필수 | 둘 중 하나에서 실행 가능. 서버 운영은 Ubuntu 권장 |

버전 확인:

```bash
git --version
bun --version
node -v
npm -v
```

### Ubuntu 서버 권장 패키지

Ubuntu에서 운영할 경우 기본적으로 아래를 설치하는 것을 권장합니다.

```bash
sudo apt update
sudo apt install -y git curl unzip build-essential sqlite3
```

Bun 설치:

```bash
curl -fsSL https://bun.sh/install | bash
```

설치 후 터미널을 다시 열거나 다음을 실행합니다.

```bash
source ~/.bashrc
```

### Windows 권장 설치

Windows에서 테스트할 경우 아래를 권장합니다.

```text
Git for Windows
Bun
Node.js 20 LTS 이상
Windows Terminal
PowerShell 7
```

Bun 설치 PowerShell 예시:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

패키지 빌드 문제가 생기면 Visual Studio Build Tools가 필요할 수 있습니다.

```text
Visual Studio Build Tools
- Desktop development with C++
- Windows 10/11 SDK 또는 Windows 11 SDK
```

---

## 3. 권장 컴퓨터 사양

### AgentRunner만 실행하는 경우

Claude Code, Codex, Gemini API, 외부 Ollama 서버를 붙이고 AgentRunner 자체만 돌리는 기준입니다.

| 구분 | 최소 | 권장 |
|---|---:|---:|
| CPU | 4코어 | 6~8코어 이상 |
| RAM | 8GB | 16GB~32GB |
| 저장공간 | 20GB | 100GB 이상 SSD |
| OS | Windows 10/11 또는 Ubuntu | Ubuntu 22.04/24.04 서버 권장 |

### Ollama 로컬 LLM까지 같은 컴퓨터에서 돌리는 경우

로컬 LLM을 같이 돌리면 GPU와 RAM이 중요합니다.

| 구분 | 권장 |
|---|---:|
| CPU | 6~8코어 이상 |
| RAM | 32GB 이상 |
| GPU | NVIDIA GPU 권장 |
| VRAM | 최소 8GB, 권장 12~16GB 이상 |
| 저장공간 | 100GB 이상 SSD |

예를 들어 아래 사양이면 AgentRunner + Discord 봇 + Ollama 보조 모델 운영에 꽤 적합합니다.

```text
Ryzen 7 7700
RTX 5060 Ti 16GB
DDR5 RAM 32GB
NVMe SSD 1TB
```

---

## 4. 빠른 시작

저장소 다운로드:

```bash
git clone https://github.com/ln2338879-oss/agentrunner.git
cd agentrunner
```

패키지 설치:

```bash
bun install
```

환경 파일 생성:

```bash
cp .env.example .env
```

기본 검증:

```bash
bun run doctor
bun test
```

외부 인증 없이 내부 런타임만 증명하려면:

```bash
bun run proof
```

Discord 없이도 SQLite, Obsidian Vault, task 생성, worker report artifact 생성을 확인할 수 있습니다.

---

## 5. `.env` 기본 설정

최소 설정 예시:

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

# Ollama / Factory
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=gemma
```

Designer 이미지 생성을 쓸 경우:

```env
GEMINI_API_KEY=PASTE_GEMINI_API_KEY_HERE
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
DESIGNER_OUTPUT_DIR=./vault/AgentRunnerVault/06_DesignerOutputs
```

운영 안정성 관련 기본값:

```env
TASK_LEASE_MINUTES=30
RECOVER_STALE_TASKS_ON_START=true
STARTUP_RECOVERY_MODE=requeue
STALE_TASK_MINUTES=120
WORKER_HEARTBEAT_INTERVAL_MS=30000
MAX_REVIEW_ROUNDS=3
```

---

## 6. 실행 명령어

```bash
bun run start          # Discord AgentRunner 실행
bun run dev            # 개발 모드 실행
bun run doctor         # 환경 점검
bun run proof          # 로컬 런타임 증명 생성
bun run worker         # 역할별 worker 실행
bun run scheduler      # workflow step scheduler 실행
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

1회만 검증:

```bash
AGENTRUNNER_WORKER_ROLE=builder WORKER_POLL_ONCE=true bun run worker
```

Scheduler 실행:

```bash
bun run scheduler
```

Scheduler 1회 실행:

```bash
bun run scheduler:once
```

---

## 7. Discord 명령어

Text command:

```text
!help
!tasks
!task TASK-...
!retry TASK-...
!steer TASK-... 다음 라운드에 반영할 추가 지시
```

Slash command:

```text
/help
/tasks
/task id:TASK-...
/retry id:TASK-...
/run prompt:작업 요청
```

일반 메시지를 보내도 새 작업으로 생성됩니다.

---

## 8. 현재 구현된 주요 기능

### 작업 분류 Router

기존에는 단순 키워드 순서로 작업을 분류했습니다.

이제는 역할별 점수를 계산합니다.

```text
builder 점수
factory 점수
designer 점수
director 점수
```

예시:

```text
이미지 처리 버그 수정해줘
→ 이미지라는 단어가 있어도 designer가 아니라 builder로 라우팅

NPC 생성 시스템 코드 고쳐줘
→ NPC라는 단어가 있어도 factory가 아니라 builder로 라우팅

몬스터 스탯을 CSV로 정리해줘
→ factory로 라우팅

게임 에셋 구조를 분석하고 이미지와 CSV까지 정리해줘
→ 애매하므로 director로 라우팅
```

분류 결과에는 이유도 남습니다.

```text
confidence
scores
signals
ambiguity
```

### Workflow 실행

기본 흐름:

```text
plan → build/design/generate → review → optional arbiter
```

예시:

```text
Director가 계획
→ Builder가 코드 수정
→ Director가 리뷰
→ 승인 또는 수정 요청
```

StepScheduler는 실행 가능한 step을 찾아 자동으로 처리합니다.

```text
director → builder → factory → designer → director
```

### Director Review Verdict

Director는 리뷰 결과를 아래 중 하나로 냅니다.

```text
VERDICT: APPROVED
VERDICT: NEEDS_REVISION
VERDICT: BLOCKED
VERDICT: NEEDS_HUMAN
VERDICT: SPLIT_TASK
VERDICT: RETRY_WITH_DIFFERENT_AGENT
```

처리 방식:

| Verdict | 처리 |
|---|---|
| APPROVED | 작업 승인 |
| NEEDS_REVISION | 이전 worker step과 review step을 다시 pending으로 돌림 |
| BLOCKED | 작업 차단 |
| NEEDS_HUMAN | 사람이 확인해야 하는 작업으로 표시 |
| SPLIT_TASK | 하위 planning task 생성 |
| RETRY_WITH_DIFFERENT_AGENT | 자동 전환하지 않고 사람 개입으로 처리 |

### Revision Loop

리뷰가 수정 요청을 내면:

```text
VERDICT: NEEDS_REVISION
→ build/design/generate step 다시 pending
→ review step 다시 pending
→ 다음 실행 때 이전 리뷰 피드백을 worker 프롬프트에 포함
```

즉, Builder가 같은 실수를 반복하지 않도록 이전 리뷰 피드백이 자동으로 들어갑니다.

### Review Safety Guard

리뷰어는 코드를 직접 고치면 안 됩니다.

그래서 review/arbitrate step에는 read-only guard가 들어갑니다.

```text
review 시작 전 git 상태 저장
→ review 실행
→ git 상태 다시 확인
→ 파일 변경이 있으면 READ_ONLY_VIOLATION 처리
```

리뷰어가 직접 파일을 수정하면 step은 실패합니다.

### Terminal Verdict Actions

예전에는 `SPLIT_TASK`, `NEEDS_HUMAN`, `RETRY_WITH_DIFFERENT_AGENT`가 상태만 바꾸고 멈췄습니다.

이제는 실제 액션을 수행합니다.

```text
NEEDS_HUMAN
→ 04_Reviews/<task>-needs_human-action.md 생성
→ human_intervention artifact 기록
→ task status = needs_human

RETRY_WITH_DIFFERENT_AGENT
→ 다른 모델로 자동 전환하지 않음
→ 사람이 판단하도록 needs_human 처리

SPLIT_TASK
→ 리뷰 피드백에서 하위 작업 후보 추출
→ child planning task 생성
→ parent task status = split_task
```

### Provider Issue → Human Escalation

Claude Code, Codex, Gemini, Ollama, Factory CLI 실행 중 계정/세션/사용량/인증 문제로 보이는 오류가 나오면 자동으로 다른 모델로 바꾸지 않습니다.

대신:

```text
needsHuman = true
errorKind 기록
human_intervention artifact 생성
task status = needs_human
```

분류 종류:

```text
auth
session_expired
rate_limit
usage_limit
timeout
network
validation
unknown
```

이 중 아래는 사람 확인이 필요한 문제로 처리됩니다.

```text
auth
session_expired
rate_limit
usage_limit
```

### Startup Recovery

프로세스가 꺼지거나 서버가 재시작되었을 때 running 상태로 남은 workflow step을 복구합니다.

```text
STARTUP_RECOVERY_MODE=requeue
```

이면:

```text
stale running step
→ pending으로 되돌림
→ 다음 scheduler/worker가 다시 실행 가능
```

```text
STARTUP_RECOVERY_MODE=block
```

이면:

```text
stale running step
→ failed 처리
→ task blocked 처리
```

복구 보고서는 Obsidian Vault에 저장됩니다.

```text
08_Recovery/startup-recovery-*.md
```

### Worker Heartbeat

worker와 scheduler가 살아 있는지 DB에 기록합니다.

```text
worker_heartbeats
```

기본 주기:

```env
WORKER_HEARTBEAT_INTERVAL_MS=30000
```

### DB 안정성 개선

SQLite DB에 주요 index가 추가되었습니다.

```text
tasks status/assigned index
workflow step claim index
reviews task/round index
artifacts task index
runtime events index
worker heartbeat index
```

또한 task claim과 workflow step claim은 transaction으로 묶었습니다.

```text
transaction {
  SELECT candidate
  UPDATE claim
  record runtime event
}
```

동시에 여러 worker가 같은 작업을 잡으려 할 때 중복 실행 위험을 줄입니다.

### Designer / Gemini Image

Designer는 Gemini image API를 사용합니다.

가능한 작업:

```text
픽셀아트 캐릭터 생성
아이콘 제작
로고 시안 생성
첨부 이미지를 참고한 디자인 생성
```

Discord에 첨부된 이미지는 로컬에 저장되고, Designer가 Gemini 요청에 reference image로 전달할 수 있습니다.

### Attachment / Vision / Browser Context

Discord 첨부파일은 로컬에 저장됩니다.

```text
ATTACHMENTS_DIR/<discord-message-id>/
```

이미지 분석 command를 설정하면 프롬프트에 vision 분석 결과가 추가됩니다.

```env
VISION_COMMAND=bun scripts/vision-openai.ts
OPENAI_API_KEY=...
OPENAI_VISION_MODEL=gpt-4.1-mini
```

또는 Gemini vision:

```env
VISION_COMMAND=bun scripts/vision-gemini.ts
GEMINI_API_KEY=...
GEMINI_VISION_MODEL=gemini-2.5-flash
```

URL context를 붙이려면:

```env
BROWSER_COMMAND=bun scripts/browser-fetch.ts
BROWSER_COMMAND_TIMEOUT_MS=300000
```

---

## 9. Obsidian Vault 구조

AgentRunner는 Obsidian 앱을 직접 제어하지 않습니다. 지정한 Vault 폴더에 Markdown 파일을 생성합니다.

```text
AgentRunnerVault/
  00_Inbox/
  01_Tasks/
  02_GameDesign/
  03_Content/
  04_Reviews/
  05_BuilderReports/
  06_FactoryOutputs/
  06_DesignerOutputs/
  07_Approved/
  08_Recovery/
  90_Prompts/
  99_System/
```

---

## 10. Dashboard

Dashboard는 별도 프로세스로 실행합니다.

```bash
bun run dashboard
```

환경 설정:

```env
DASHBOARD_ENABLED=true
DASHBOARD_HOST=127.0.0.1
DASHBOARD_PORT=8787
```

엔드포인트:

```text
GET /health
GET /api/status
GET /api/tasks
GET /api/tasks/:taskId
GET /api/tasks/:taskId/timeline
GET /
```

주의: 현재 dashboard 인증은 아직 없습니다. 외부에 공개하지 말고 기본값처럼 `127.0.0.1`에 묶어두는 것을 권장합니다.

---

## 11. Ubuntu 서버 배포

포함된 systemd 템플릿:

```text
deploy/systemd/agentrunner.service
deploy/systemd/agentrunner-worker@.service
```

setup 명령:

```bash
bun run setup
bun run setup:check
bun run setup:ubuntu
bun run setup:systemd
bun run setup:vps
```

서버에서 일반적인 순서:

```bash
git clone https://github.com/ln2338879-oss/agentrunner.git
cd agentrunner
bun install
cp .env.example .env
bun run doctor
bun run start
```

systemd를 쓸 경우:

```bash
sudo systemctl daemon-reload
sudo systemctl enable agentrunner
sudo systemctl start agentrunner
sudo systemctl status agentrunner
```

역할별 worker를 systemd로 분리할 수도 있습니다.

```text
agentrunner-worker@director
agentrunner-worker@builder
agentrunner-worker@factory
agentrunner-worker@designer
```

---

## 12. GitHub / PR Workflow

승인된 작업을 GitHub PR 생성 흐름으로 연결할 수 있습니다.

```env
APPROVED_TASK_COMMAND=bash scripts/trigger-approved-task-workflow.sh
```

수동 실행 예시:

```bash
gh workflow run approved-task-pr.yml \
  -f task_id=TASK-123 \
  -f report_path=05_BuilderReports/TASK-123-builder-round-1.md \
  -f review_path=04_Reviews/TASK-123-review-round-1.md \
  -f base_branch=main \
  -f draft=true
```

---

## 13. 품질 검사

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

GitHub Actions의 quality gate는 PR과 main push마다 install, typecheck, lint, format check, test, build를 실행합니다.

---

## 14. 현재 한계

아직 완전한 프로덕션 플랫폼은 아닙니다.

현재 남은 주요 한계:

```text
parallel DAG execution은 아직 미완성
Dashboard 인증 없음
구조화 로깅 미흡
task별 git worktree 격리 미구현
voice transcription 미구현
headless browser daemon 미구현
LICENSE 파일 별도 추가 필요
```

운영 안정성 기준으로 다음 보강 우선순위는 다음과 같습니다.

```text
1. task별 git worktree 격리
2. 구조화 로깅
3. Dashboard 인증
4. parallel DAG execution
```

---

## 15. 보안 주의

절대 커밋하면 안 되는 것:

```text
.env
Discord bot token
OpenAI API key
Gemini API key
Claude/Codex 인증 정보
개인 Discord 서버 정보
```

로그를 공개할 때는 아래 정보를 제거하세요.

```text
토큰
API key
channel ID
user ID
개인 서버 이름
개인 파일 경로
```

---

## 16. 지금까지의 안전성 개선 요약

최근 보강된 핵심은 다음입니다.

```text
리뷰어 read-only guard
NEEDS_REVISION 자동 requeue
수정 라운드에 이전 리뷰 피드백 주입
startup recovery
worker heartbeat
provider issue → human escalation
DB index 추가
task/workflow step claim transaction 처리
점수제 router classifier
SPLIT_TASK / NEEDS_HUMAN / RETRY_WITH_DIFFERENT_AGENT 실제 action 구현
```

이제 AgentRunner는 단순히 “AI에게 요청을 보내는 봇”이 아니라, 작업 상태를 저장하고, 실패를 복구하고, 리뷰를 강제하고, 애매한 상황에서는 사람을 부르는 방향의 런타임으로 발전하고 있습니다.
