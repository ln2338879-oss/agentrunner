# AgentRunner

Discord로 게임 개발을 지시하고, AI 에이전트가 기획·구현·콘텐츠 생성·리뷰를 나눠 처리하는 3봇 게임 개발 런타임입니다.

AgentRunner는 EJClaw의 멀티 에이전트 운영 패턴을 참고하되, 범용 코드 자동화가 아니라 **게임 개발 파이프라인**에 맞춰 설계되었습니다.

## 현재 상태

AgentRunner는 현재 **설치해서 테스트 사용 가능한 MVP** 단계입니다.

코드 레벨에서는 Discord 봇, SQLite 상태관리, Obsidian 기록, ClaudeCode/Codex/Ollama 어댑터, 리뷰 루프, 첨부파일 저장, vision/browser command, dashboard, doctor, failover, worker entrypoint, systemd/PM2 템플릿, GitHub Actions 품질 게이트가 구현되어 있습니다.

아직 부족한 것은 “장기 운영 증거”입니다. 실제 VPS나 로컬 서버에서 `bun run doctor → bun run start → Discord 작업 생성 → Obsidian 결과 확인`까지 실행한 runtime proof를 추가로 남겨야 프로덕션 신뢰도가 올라갑니다.

## 역할 구조

| 역할 | 기본 도구 | 목적 |
|---|---|---|
| Director | ClaudeCode | 기획, 분해, 리뷰 |
| Builder | Codex | 구현, 수정, 테스트 |
| Factory | Ollama/Gemma | 콘텐츠 대량 생성 |

```text
Discord User
  ↓
Director Bot
  ↓
AgentRunner Orchestrator
  ├─ SQLite Runtime DB
  ├─ Obsidian Vault
  ├─ Builder / Codex
  ├─ Factory / Ollama
  ├─ Vision Command
  ├─ Browser Command
  └─ Director Review Loop
  ↓
Discord Result + Obsidian Notes
```

## 구현된 기능

### Discord Runtime

- Director / Builder / Factory 3봇 구조
- Discord text commands
- Discord slash commands
- Discord 첨부파일 저장
- Discord 채널별 notification
- `!steer` 기반 mid-turn steering 기초
- 채널별 session context 주입

### 작업 관리

- SQLite WAL 런타임 DB
- tasks / task_runs / messages / reviews / artifacts
- sessions / attachments / steering 확장 스키마
- task lease
- stale task recovery
- NEEDS_REVISION 자동 재작업 루프
- Director verdict 기반 승인/차단

### 게임 개발 워크플로우

- Obsidian Vault 자동 생성
- 작업 노트 생성
- Builder report 생성
- Factory output 생성
- Director review 생성
- Approved summary 생성
- Dataview dashboard 템플릿
- group/channel별 프로젝트 설정
- skill context 자동 주입

### AI Adapter

- ClaudeCode CLI adapter
- Codex CLI adapter
- Ollama OpenAI-compatible adapter
- Factory endpoint/model failover
- CLI command failover
- Claude/Codex profile 후보 로테이션

### 멀티모달 / 웹 컨텍스트

- Discord 첨부파일 로컬 저장
- 이미지 `local_path` 프롬프트 주입
- `VISION_COMMAND` 기반 이미지 분석
- OpenAI vision 예시 스크립트
- Gemini vision 예시 스크립트
- `BROWSER_COMMAND` 기반 URL context 주입
- `scripts/browser-fetch.ts` 기본 예시

### 운영 / 배포

- `bun run doctor`
- `bun run dashboard`
- `bun run worker`
- systemd service template
- worker systemd template
- PM2 ecosystem template
- GitHub Actions quality gate
- approved task PR workflow
- CHANGELOG

## 빠른 시작

```bash
git clone https://github.com/ln2338879-oss/agentrunner.git
cd agentrunner
bun install
cp .env.example .env
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

서버 상태를 먼저 확인합니다.

```bash
bun run doctor
```

개발 모드 실행:

```bash
bun run dev
```

일반 실행:

```bash
bun run start
```

## 실행 명령어

```bash
bun run start          # Discord AgentRunner runtime
bun run dashboard      # Standalone dashboard server
bun run doctor         # Runtime environment check
bun run worker         # Isolated worker boot path
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
/run prompt:초반 몬스터 20종 JSON으로 만들어줘
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

## Builder / Factory 봇

Builder와 Factory 봇까지 로그인하려면 다음 값을 추가합니다.

```env
BUILDER_DISCORD_TOKEN=
FACTORY_DISCORD_TOKEN=
DEV_TASKS_CHANNEL_ID=
CONTENT_FACTORY_CHANNEL_ID=
REVIEW_LOG_CHANNEL_ID=
BUILD_LOG_CHANNEL_ID=
```

## Group / Skill 설정

채널별 프로젝트, 허용 역할, 정책, skill 목록을 설정할 수 있습니다.

```bash
cp configs/groups.example.yaml configs/groups.yaml
```

예시:

```yaml
groups:
  - id: runebound-dev
    name: Runebound Development
    discordChannelIds:
      - "000000000000000000"
    projectRoot: /opt/game-projects/runebound
    obsidianVaultPath: /opt/obsidian-vaults/AgentRunnerVault
    factoryModel: gemma
    allowedRoles:
      - director
      - builder
      - factory
    skills:
      - runebound-design
      - item-schema
    policy:
      allowCodeChanges: true
      allowContentGeneration: true
      requireDirectorReview: true
```

`SKILLS_DIR` 아래에는 자동으로 주입할 Markdown skill 문서를 둡니다.

```text
skills/default.md
skills/item-schema.md
skills/code-style.md
```

## 첨부파일 / Vision

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

Vision command를 설정하면 이미지 `local_path`가 있는 작업에서 이미지 분석 결과가 `# Vision Analysis`로 프롬프트에 추가됩니다.

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

`scripts/browser-fetch.ts`는 기본 fetch 기반 예시입니다. Chromium screenshot, 로그인 흐름, 동적 페이지가 필요하면 Playwright 기반 command로 교체할 수 있습니다.

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
GET /api/tasks
GET /api/tasks/:taskId
GET /
```

## Worker Process Isolation

역할별 worker entrypoint가 있습니다.

```bash
AGENTRUNNER_WORKER_ROLE=director bun run worker
AGENTRUNNER_WORKER_ROLE=builder bun run worker
AGENTRUNNER_WORKER_ROLE=factory bun run worker
```

systemd template:

```text
deploy/systemd/agentrunner-worker@.service
```

예시:

```bash
sudo systemctl enable --now agentrunner-worker@director
sudo systemctl enable --now agentrunner-worker@builder
sudo systemctl enable --now agentrunner-worker@factory
```

현재 worker entrypoint는 standby adapter boot path입니다. 역할별 프로세스 감독 기반은 준비되어 있지만, DB queue를 worker가 직접 consume하는 완전 분산 실행 구조는 다음 단계입니다.

## Obsidian Vault 구조

AgentRunner는 Obsidian 앱을 직접 제어하지 않습니다. Vault 폴더에 Markdown 파일을 생성합니다.

```text
AgentRunnerVault/
  00_Inbox/
  01_Tasks/
  02_GameDesign/
  03_Content/
    items/
    monsters/
    npcs/
    quests/
  04_Reviews/
  05_BuilderReports/
  06_FactoryOutputs/
  07_Approved/
  08_Recovery/
  90_Prompts/
  99_System/
```

## 리뷰 루프

Director는 Builder 또는 Factory 결과를 검토하고 다음 verdict 중 하나를 반환해야 합니다.

```text
VERDICT: APPROVED
VERDICT: NEEDS_REVISION
VERDICT: BLOCKED
```

`NEEDS_REVISION`이면 Orchestrator가 Director 피드백을 포함한 수정 프롬프트를 만들고 같은 worker를 다시 실행합니다. 이 과정은 `MAX_REVIEW_ROUNDS`까지 반복됩니다.

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

## Runtime Proof 만들기

이 프로젝트가 실제로 돌아간다는 증거를 남기려면 서버에서 다음 순서로 실행합니다.

```bash
bun install
bun run doctor
bun run start
```

Discord에서 테스트 작업을 생성합니다.

```text
/run prompt: 테스트용 포션 아이템 5개를 JSON으로 만들고 Director가 리뷰해줘
```

성공 기준:

```text
Discord 봇 로그인 성공
Task 생성 성공
Worker 실행 성공
Director review 생성
Obsidian Vault에 결과 파일 생성
Discord 응답 반환
```

민감정보를 제거한 로그는 `docs/proof/` 아래에 남기는 것을 권장합니다.

## 현재 한계

- 실제 장기 운영 로그는 아직 별도로 남겨야 합니다.
- worker entrypoint는 아직 standby boot path입니다.
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
