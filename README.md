# AgentRunner

AgentRunner는 Discord에서 요청을 받아 여러 AI 역할이 계획, 실행, 검토, 디자인 생성을 나눠 처리하는 **범용 멀티 에이전트 팀 런타임**입니다.

초기에는 게임 개발 자동화를 목표로 시작했지만, 현재 구조는 게임 전용이 아니라 개발, 문서/콘텐츠 생성, 디자인/이미지 생성, 리뷰, 중재, 운영 자동화까지 확장 가능한 범용 workflow runtime입니다.

## 현재 상태

AgentRunner는 이제 단순 MVP를 넘어 **기능형 베타 / 준프로덕션 런타임** 단계입니다.

구현된 핵심은 다음과 같습니다.

```text
Discord Director Bot
→ task classification
→ role registry
→ workflow registry
→ provider registry
→ policy engine
→ SQLite runtime state
→ Obsidian artifact vault
→ workflow step ledger
→ ready-step claim
→ StepExecutor
→ StepScheduler loop
→ Director review / arbitration
→ dashboard visibility
```

아직 완전한 프로덕션 플랫폼은 아닙니다. 남은 핵심은 human gate의 workflow step 정식 편입, revision requeue policy, provider retry/fallback 고도화, parallel DAG execution, dashboard control API입니다.

## 역할 구조

| 역할 | 기본 도구 | 목적 |
|---|---|---|
| Director | ClaudeCode | 계획, 리뷰, 중재, verdict 판단 |
| Builder | Codex | 코드 구현, 수정, 테스트 |
| Factory | Ollama/Gemma | 문서, 데이터, 콘텐츠 생성 |
| Designer | Gemini image / Nano Banana 계열 | 이미지, 디자인, 시각 자료 생성 |

```text
Discord User
  ↓
Director Bot
  ↓
AgentRunner Runtime
  ├─ SQLite Runtime DB
  ├─ Obsidian Vault
  ├─ Role Registry
  ├─ Workflow Registry
  ├─ Provider Registry
  ├─ Policy Engine
  ├─ StepScheduler
  ├─ Director / Planner / Reviewer / Arbiter
  ├─ Builder / Codex
  ├─ Factory / Ollama
  └─ Designer / Gemini Image
  ↓
Discord Result + Obsidian Artifacts + Dashboard
```

## 구현된 기능

### Discord Runtime

- Director / Builder / Factory / Designer worker 구조
- Discord text commands
- Discord slash commands
- Discord 첨부파일 저장
- Discord 채널별 notification
- `!steer` 기반 mid-turn steering
- 채널별 session context 주입
- 디자인 요청 중 사용자의 의견/선택/취향 판단이 필요한 경우 작성자 Discord mention 후 진행 보류

### 작업 관리

- SQLite WAL 런타임 DB
- tasks / task_runs / messages / reviews / artifacts
- sessions / attachments / steering 확장 스키마
- task lease
- stale task recovery
- Director verdict 기반 승인/차단
- NEEDS_REVISION revision loop
- workflow step ledger
- workflow step lease
- ready-step dependency gating
- step-level outputRef / error / timestamps

### Workflow Engine

- role registry
- workflow registry
- provider registry
- workflow routing metadata
- workspace/profile config
- policy engine
- workflow step execution ledger
- ready step claim
- StepExecutor
- StepScheduler loop
- Director planner/reviewer/arbiter step 독립 실행
- Builder / Factory / Designer step 독립 실행

기본 flow 예시:

```text
planner → builder/factory/designer → reviewer → optional arbiter
```

Scheduler 기본 sweep:

```text
director → builder → factory → designer → director
```

이 순서 덕분에 단일 cycle에서 다음 흐름을 처리할 수 있습니다.

```text
plan → build/design/generate → review
```

### Designer / Gemini Image

- Designer role 추가
- Gemini image provider 연결
- `GEMINI_API_KEY`
- `GEMINI_IMAGE_MODEL`
- Discord 첨부 이미지 `local_path` 추출
- Gemini `inlineData` 참조 이미지 전달
- 생성 이미지 artifact 저장
- `design_image` artifact 기록
- 디자인 요청 중 주관적 선택/취향 판단이 필요한 경우 작업 생성 전에 작성자 mention

예시:

```text
픽셀아트 아이콘 만들어줘                → 자동 진행
첨부 이미지 스타일로 캐릭터 만들어줘     → 자동 진행
로고 시안 중 하나 골라줘                 → 작성자 mention 후 방향 확정 요청
어떤 게 더 좋아?                         → 작성자 mention 후 방향 확정 요청
```

### AI Adapter / Provider

- ClaudeCode CLI adapter
- Codex CLI adapter
- Ollama OpenAI-compatible adapter
- Gemini image provider
- Factory endpoint/model failover
- CLI command failover
- Claude/Codex profile 후보 로테이션

### 멀티모달 / 웹 컨텍스트

- Discord 첨부파일 로컬 저장
- 이미지 `local_path` 프롬프트 주입
- DesignerAgent 참조 이미지 처리
- `VISION_COMMAND` 기반 이미지 분석
- OpenAI vision 예시 스크립트
- Gemini vision 예시 스크립트
- `BROWSER_COMMAND` 기반 URL context 주입
- `scripts/browser-fetch.ts` 기본 예시

### Dashboard

- runtime status dashboard
- task list
- task detail JSON
- task timeline
- workflow step status count
- workflow step timeline event
- artifacts / reviews / runs 조회

### 운영 / 배포

- `bun run setup`
- `bun run setup:check`
- `bun run setup:local`
- `bun run setup:ubuntu`
- `bun run setup:systemd`
- `bun run setup:vps`
- `bun run doctor`
- `bun run proof`
- `bun run dashboard`
- `bun run worker`
- `bun run scheduler`
- `bun run scheduler:once`
- systemd service template
- worker systemd template
- PM2 ecosystem template
- GitHub Actions quality gate
- runtime proof workflow

## 빠른 시작

```bash
git clone https://github.com/ln2338879-oss/agentrunner.git
cd agentrunner
bun install
cp .env.example .env
```

로컬에서 내부 런타임 증명을 먼저 생성할 수 있습니다. 이 명령은 Discord 토큰이나 Claude/Codex/Ollama 인증 없이 SQLite, Obsidian Vault, worker queue polling, artifact 생성을 검증합니다.

```bash
bun run proof
```

setup runner를 사용할 수도 있습니다.

```bash
bun run setup
bun run setup:check
bun run setup:local
bun run setup:ubuntu
bun run setup:systemd
bun run setup:vps
```

`.env`에 최소값을 설정합니다.

```env
DIRECTOR_DISCORD_TOKEN=PASTE_TOKEN_HERE
GAME_DIRECTOR_CHANNEL_ID=PASTE_CHANNEL_ID_HERE

DATABASE_PATH=./data/agentrunner.sqlite
OBSIDIAN_VAULT_PATH=./vault/AgentRunnerVault
PROJECT_ROOT=./game-project
ATTACHMENTS_DIR=./data/attachments

CLAUDE_CODE_COMMAND=claude
CODEX_COMMAND=codex
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=gemma
```

Designer / Gemini image generation을 사용하려면 다음을 추가합니다.

```env
GEMINI_API_KEY=PASTE_GEMINI_API_KEY_HERE
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
DESIGNER_OUTPUT_DIR=./vault/AgentRunnerVault/06_DesignerOutputs
```

서버 상태를 확인합니다.

```bash
bun run doctor
```

일반 실행:

```bash
bun run start
```

개발 모드:

```bash
bun run dev
```

## 실행 명령어

```bash
bun run start          # Discord AgentRunner runtime
bun run dashboard      # Standalone dashboard server
bun run doctor         # Runtime environment check
bun run proof          # Local runtime proof generator
bun run worker         # Isolated role worker
bun run scheduler      # Continuous workflow step scheduler
bun run scheduler:once # Run one scheduler cycle
bun run quality:check  # typecheck + lint + format check + test
bun run build          # TypeScript build
```

## Discord 명령어

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

일반 메시지는 새 작업으로 생성됩니다.

## Slash command 등록

`.env`에 다음 값을 설정합니다.

```env
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
REGISTER_SLASH_COMMANDS=true
```

`DISCORD_GUILD_ID`를 비워두면 global command로 등록됩니다. 개발 중에는 guild command가 반영이 빠릅니다.

## Worker Bots

Builder, Factory, Designer worker bot까지 로그인하려면 다음 값을 추가합니다.

```env
BUILDER_DISCORD_TOKEN=
FACTORY_DISCORD_TOKEN=
DESIGNER_DISCORD_TOKEN=
DEV_TASKS_CHANNEL_ID=
CONTENT_FACTORY_CHANNEL_ID=
DESIGN_TASKS_CHANNEL_ID=
REVIEW_LOG_CHANNEL_ID=
BUILD_LOG_CHANNEL_ID=
```

## StepScheduler

StepScheduler는 ready workflow step을 계속 찾아 실행합니다.

```bash
bun run scheduler
```

1회 cycle만 실행하려면:

```bash
bun run scheduler:once
```

환경 변수:

```env
STEP_SCHEDULER_INTERVAL_MS=5000
STEP_SCHEDULER_MAX_STEPS_PER_CYCLE=20
STEP_SCHEDULER_ONCE=false
```

## Group / Skill 설정

채널별 프로젝트, 허용 역할, 정책, skill 목록을 설정할 수 있습니다.

```bash
cp configs/groups.example.yaml configs/groups.yaml
```

예시:

```yaml
groups:
  - id: default-workspace
    name: Default Workspace
    discordChannelIds:
      - "000000000000000000"
    projectRoot: /opt/projects/default
    obsidianVaultPath: /opt/obsidian-vaults/AgentRunnerVault
    factoryModel: gemma
    allowedRoles:
      - director
      - builder
      - factory
      - designer
    defaultWorkflow: plan-build-review
    skills:
      - default
      - code-style
    policy:
      allowCodeChanges: true
      allowContentGeneration: true
      allowImageGeneration: true
      requireDirectorReview: true
```

`SKILLS_DIR` 아래에는 자동으로 주입할 Markdown skill 문서를 둡니다.

```text
skills/default.md
skills/code-style.md
skills/item-schema.md
```

## 첨부파일 / Vision / Designer reference images

Discord 메시지에 파일이나 이미지를 첨부하면 AgentRunner가 파일을 저장하고 프롬프트에 정보를 추가합니다.

```text
filename
url
content_type
size_bytes
kind
local_path
skipped_reason
```

저장 위치:

```text
ATTACHMENTS_DIR/<discord-message-id>/
```

DesignerAgent는 이미지 첨부의 `local_path`를 찾아 Gemini 요청에 참조 이미지로 전달합니다.

Vision command를 설정하면 이미지 분석 결과가 `# Vision Analysis`로 프롬프트에 추가됩니다.

OpenAI 예시:

```env
VISION_COMMAND=bun scripts/vision-openai.ts
OPENAI_API_KEY=...
OPENAI_VISION_MODEL=gpt-4.1-mini
```

Gemini 예시:

```env
VISION_COMMAND=bun scripts/vision-gemini.ts
GEMINI_API_KEY=...
GEMINI_VISION_MODEL=gemini-2.5-flash
```

## Browser Context

요청에 URL이 포함되어 있고 `BROWSER_COMMAND`가 설정되어 있으면 URL 요약 결과가 `# Browser Context`로 프롬프트에 추가됩니다.

```env
BROWSER_COMMAND=bun scripts/browser-fetch.ts
BROWSER_COMMAND_TIMEOUT_MS=300000
```

## Failover / Profile Rotation

ClaudeCode, Codex, Factory command 후보를 순서대로 시도할 수 있습니다.

```env
ENABLE_AGENT_FAILOVER=true

CLAUDE_CODE_COMMAND=claude
CLAUDE_CODE_COMMANDS=claude --profile backup||claude --profile fallback

CODEX_COMMAND=codex
CODEX_COMMANDS=codex --profile backup

FACTORY_COMMANDS=
```

Factory는 Ollama endpoint/model fallback도 지원합니다.

```env
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_BASE_URLS=http://127.0.0.1:11434/v1||http://backup-host:11434/v1

OLLAMA_MODEL=gemma
OLLAMA_MODELS=llama3.1||mistral
```

## Dashboard

Dashboard는 Discord runtime과 분리된 별도 프로세스로 실행합니다.

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

## Worker Process Isolation

역할별 worker entrypoint가 있습니다. worker는 먼저 ready workflow step을 claim하고, 없으면 legacy pending task queue로 fallback합니다.

```bash
AGENTRUNNER_WORKER_ROLE=director bun run worker
AGENTRUNNER_WORKER_ROLE=builder bun run worker
AGENTRUNNER_WORKER_ROLE=factory bun run worker
AGENTRUNNER_WORKER_ROLE=designer bun run worker
```

1회 검증:

```bash
AGENTRUNNER_WORKER_ROLE=builder WORKER_POLL_ONCE=true bun run worker
```

systemd template:

```text
deploy/systemd/agentrunner-worker@.service
```

## Obsidian Vault 구조

AgentRunner는 Obsidian 앱을 직접 제어하지 않습니다. Vault 폴더에 Markdown 파일을 생성합니다.

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

## Review Verdicts

Director review / arbitration step은 다음 verdict 중 하나를 반환해야 합니다.

```text
VERDICT: APPROVED
VERDICT: NEEDS_REVISION
VERDICT: BLOCKED
VERDICT: NEEDS_HUMAN
VERDICT: SPLIT_TASK
VERDICT: RETRY_WITH_DIFFERENT_AGENT
```

`NEEDS_REVISION`이면 기존 Orchestrator loop에서는 Director 피드백을 포함한 수정 프롬프트를 만들고 같은 worker를 다시 실행합니다. 독립 StepScheduler 경로에서는 revision requeue policy가 후속 작업으로 남아 있습니다.

## Approved Task PR Workflow

승인된 작업을 PR 흐름으로 연결할 수 있습니다.

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

## 서버 배포

포함된 배포 템플릿:

```text
deploy/systemd/agentrunner.service
deploy/systemd/agentrunner-worker@.service
deploy/pm2/ecosystem.config.cjs
```

배포 문서:

```text
docs/deployment.md
docs/operations-hardening.md
docs/doctor-and-vision.md
docs/advanced-runtime.md
docs/setup-and-proof.md
docs/workflow-step-executor.md
docs/designer-gemini.md
```

## 품질 게이트

로컬 검사:

```bash
bun run quality:check
bun run build
```

개별 검사:

```bash
bun run typecheck
bun run lint
bun run format:check
bun test
bun run build
```

GitHub Actions의 `AgentRunner Quality Gate` workflow는 PR과 main push마다 install, typecheck, lint, format check, test, build를 실행합니다.

`AgentRunner Runtime Proof` workflow는 내부 런타임 proof를 검증합니다.

## Runtime Proof 만들기

외부 인증 없이 내부 런타임 증명 파일을 만들 수 있습니다.

```bash
bun run proof
```

이 명령은 다음을 검증하고 `docs/proof/runtime-proof.md`를 생성합니다.

```text
Doctor internal path checks
SQLite database creation
Obsidian Vault folder creation
sample task creation
worker queue polling
worker report artifact creation
task completed status
```

실제 Discord까지 포함한 증거를 남기려면 서버에서 다음 순서로 실행합니다.

```bash
bun install
bun run doctor
bun run start
```

Discord에서 테스트 작업을 생성합니다.

```text
/run prompt: 테스트용 콘텐츠를 만들고 Director가 리뷰해줘
```

성공 기준:

```text
Discord 봇 로그인 성공
Task 생성 성공
Workflow step 생성
Worker 또는 scheduler 실행 성공
Director review 생성
Obsidian Vault에 결과 파일 생성
Discord 응답 반환
```

민감정보를 제거한 로그는 `docs/proof/` 아래에 남기는 것을 권장합니다.

## 현재 한계

- human gate는 아직 workflow step으로 정식 편입되지 않았습니다.
- StepScheduler는 single-process sequential scheduler입니다. parallel DAG execution은 후속 작업입니다.
- 독립 StepScheduler 경로의 revision requeue policy는 후속 작업입니다.
- retry with different provider/agent 정책은 더 고도화가 필요합니다.
- browser command는 기본 fetch 예시이며 headless Chromium daemon은 아닙니다.
- voice transcription은 아직 구현되지 않았습니다.
- LICENSE 파일은 별도로 추가해야 합니다.

## 보안 주의

절대 커밋하면 안 되는 것:

```text
.env
Discord bot token
OpenAI API key
Gemini API key
Claude/Codex 인증 토큰
개인 Discord 서버 정보
```

로그를 공개할 때는 토큰, API key, channel ID, user ID를 제거하세요.
