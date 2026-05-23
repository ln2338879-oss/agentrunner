# AgentRunner

게임 개발용 3봇 AI 에이전트 런타임입니다.

이 저장소는 EJClaw의 `owner / reviewer / arbiter`형 자동화 패턴을 참고하되, 게임 개발에 맞게 다음 3개 역할로 재설계합니다.

| 봇 | 모델/도구 | 핵심 역할 |
|---|---|---|
| Director | ClaudeCode | 기획, 시스템 설계, 작업 분해, 최종 리뷰 |
| Builder | Codex | 코드 구현, 수정, 테스트, 빌드 오류 해결 |
| Factory | Ollama / Gemma | 아이템, 몬스터, NPC 대사, JSON/CSV 초안 대량 생성 |

## 핵심 철학

ClaudeCode는 비싼 판단 리소스이므로 계속 코드를 쓰게 하지 않습니다. 대신 전체 방향성, 설계, 리뷰, 승인만 맡깁니다.

Codex는 실제 프로젝트 파일을 수정하는 구현자입니다.

Ollama는 로컬에서 비용 없이 대량 초안을 생산하는 작업자입니다.

```text
User
 ↓
Discord Director Bot
 ↓
AgentRunner Orchestrator
 ├─ SQLite Runtime DB: 상태, 큐, 메시지, 리뷰, 산출물, 작업 락
 ├─ Obsidian Vault: 작업 문서, 리뷰, 콘텐츠 결과물
 ├─ Codex Builder: 구현 작업 + diff/test/build 보고
 └─ Ollama Factory: 콘텐츠 양산
 ↓
Director Review Loop
 ↓
User Report
```

## 현재 구현 상태

현재 저장소는 문서 단계가 아니라 실행 가능한 3봇 런타임 단계입니다.

포함된 기능:

- Bun + TypeScript 프로젝트 구조
- Director / Builder / Factory 3봇 로그인 구조
- Discord Director Bot 메시지 수신
- Discord `!tasks`, `!task`, `!retry`, `!help` 상태 명령어
- Discord slash command: `/run`, `/tasks`, `/task`, `/retry`, `/help`
- Discord 첨부파일 context 주입
- 작업 분류 라우터
- SQLite WAL 런타임 스키마
- task_runs / messages / reviews / artifacts 기록
- sessions / attachments / steering 확장 스키마
- locked_by / lock_expires_at 기반 task lease
- 재시작 시 stale task 복구
- Discord 채널별 runtime notification
- group/channel별 설정 로더
- skill context 주입
- Obsidian Vault 폴더/노트 생성기
- 작업, 리뷰, 보고서 Markdown 템플릿
- 승인 완료 노트 생성
- Obsidian Dataview dashboard 템플릿 문서
- Director / Builder / Factory Agent Adapter 인터페이스
- ClaudeCode CLI 실행 어댑터
- Codex CLI 실행 어댑터
- Ollama OpenAI-compatible chat completions 실행 어댑터
- Director verdict 기반 자동 리뷰 루프
- NEEDS_REVISION 재작업 루프
- Builder diff/test/build validation report
- systemd / PM2 배포 템플릿
- CHANGELOG
- 승인 후 Git/PR hook 예시 스크립트
- GitHub Actions 기반 승인 작업 PR workflow
- ESLint / Prettier / TypeScript / test / build 품질 게이트

## 빠른 시작

```bash
bun install
cp .env.example .env
bun run dev
```

`.env`에 최소한 다음 값을 설정합니다.

```env
DIRECTOR_DISCORD_TOKEN=
GAME_DIRECTOR_CHANNEL_ID=
OBSIDIAN_VAULT_PATH=./vault/AgentRunnerVault
DATABASE_PATH=./data/agentrunner.sqlite
PROJECT_ROOT=./game-project
GROUPS_CONFIG_PATH=./configs/groups.yaml
SKILLS_DIR=./skills
```

Slash command를 등록하려면 다음 값을 추가합니다.

```env
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
REGISTER_SLASH_COMMANDS=true
```

`DISCORD_GUILD_ID`를 비워두면 global command로 등록됩니다. 개발 중에는 guild command가 반영이 빠르므로 권장합니다.

Builder/Factory 봇까지 실제 로그인하려면 다음 값도 설정합니다.

```env
BUILDER_DISCORD_TOKEN=
FACTORY_DISCORD_TOKEN=
DEV_TASKS_CHANNEL_ID=
CONTENT_FACTORY_CHANNEL_ID=
```

AI 실행 설정:

```env
CLAUDE_CODE_COMMAND=claude
CODEX_COMMAND=codex
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=gemma
```

Builder 검증 설정:

```env
BUILDER_DIFF_COMMAND=git diff --stat && git diff --name-only
BUILDER_TEST_COMMAND=
BUILDER_BUILD_COMMAND=
```

승인 후 훅 예시:

```env
# 로컬 브랜치/커밋 helper
APPROVED_TASK_COMMAND=bash scripts/approved-task-git-pr.sh

# 또는 GitHub Actions workflow_dispatch 기반 PR 생성 helper
APPROVED_TASK_COMMAND=bash scripts/trigger-approved-task-workflow.sh
```

## Discord 명령어

Director 채널에서 사용할 수 있습니다.

```text
!help
!tasks
!task TASK-...
!retry TASK-...
```

Slash command도 지원합니다.

```text
/help
/tasks
/task id:TASK-...
/retry id:TASK-...
/run prompt:초반 몬스터 20종 JSON으로 만들어줘
```

일반 메시지는 새 게임 개발 작업으로 생성됩니다.

## Group / Skill 설정

`GROUPS_CONFIG_PATH`는 Discord 채널별 프로젝트, 허용 역할, 정책, skill 목록을 정의합니다. 예시는 `configs/groups.example.yaml`에 있습니다.

```bash
cp configs/groups.example.yaml configs/groups.yaml
```

`SKILLS_DIR` 아래에는 작업마다 자동 주입할 Markdown skill 문서를 둡니다.

```text
skills/default.md
skills/item-schema.md
skills/code-style.md
```

채널이 특정 group에 매칭되면 해당 group의 `skills` 목록이 프롬프트 앞에 자동으로 붙습니다. group 정책으로 코드 변경 금지, 콘텐츠 생성 금지, 허용 역할 제한도 설정할 수 있습니다.

## Discord 첨부파일

텍스트 메시지에 파일이나 이미지를 첨부하면 AgentRunner가 다음 정보를 프롬프트에 추가합니다.

```text
filename
url
content_type
size_bytes
kind: image
```

현재 단계는 첨부 URL context 주입입니다. 실제 vision 모델로 이미지 자체를 분석하는 adapter 확장은 다음 단계입니다.

## 품질 게이트

로컬에서 전체 품질 검사를 실행합니다.

```bash
bun run quality:check
```

개별 명령어:

```bash
bun run typecheck
bun run lint
bun run format:check
bun test
bun run build
```

GitHub Actions의 `AgentRunner Quality Gate` workflow는 PR과 main push마다 install, typecheck, lint, format check, test, build를 모두 실행합니다.

## 승인 작업 PR workflow

`.github/workflows/approved-task-pr.yml`은 승인된 AgentRunner 작업을 PR 형태로 정리하기 위한 workflow입니다.

수동 실행 예시:

```bash
gh workflow run approved-task-pr.yml \
  -f task_id=TASK-123 \
  -f report_path=05_BuilderReports/TASK-123-builder-round-1.md \
  -f review_path=04_Reviews/TASK-123-review-round-1.md \
  -f base_branch=main \
  -f draft=true
```

AgentRunner에서 승인 후 자동으로 이 workflow를 호출하려면 다음 훅을 사용합니다.

```env
APPROVED_TASK_COMMAND=bash scripts/trigger-approved-task-workflow.sh
```

이 방식은 로컬 코드에 GitHub 토큰을 직접 하드코딩하지 않고, GitHub Actions의 `GITHUB_TOKEN` 권한으로 PR을 생성합니다.

## 서버 배포

systemd와 PM2 템플릿이 포함되어 있습니다.

```text
deploy/systemd/agentrunner.service
deploy/pm2/ecosystem.config.cjs
```

배포 가이드는 `docs/deployment.md`를 참고하세요.

## 런타임 구조

```text
src/
  agents/
    director.ts
    builder.ts
    factory.ts
  db/
    extended-schema.ts
    runtime-store.ts
    schema.ts
  discord/
    attachments.ts
    commands.ts
    director-bot.ts
    notifier.ts
    slash-commands.ts
    worker-bot.ts
  groups/
    group-config.ts
  obsidian/
    vault-manager.ts
    templates.ts
  review/
    review-loop.ts
    verdict.ts
  router/
    classify.ts
  runtime/
    orchestrator.ts
    types.ts
  skills/
    context.ts
  utils/
    command.ts
    prompt.ts
  config.ts
  index.ts
```

## Obsidian Vault 구조

AgentRunner는 Obsidian 앱을 직접 제어하지 않습니다. 대신 Vault 폴더에 Markdown 파일을 생성합니다.

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

Dataview 템플릿은 `docs/obsidian-dataview-dashboard.md`에 있습니다.

## 리뷰 루프

Director는 Builder 또는 Factory 결과를 검토하고 다음 verdict 중 하나를 반환해야 합니다.

```text
VERDICT: APPROVED
VERDICT: NEEDS_REVISION
VERDICT: BLOCKED
```

`NEEDS_REVISION`이면 Orchestrator가 Director 피드백을 포함한 수정 프롬프트를 만들고 같은 worker를 다시 실행합니다. 이 과정은 `MAX_REVIEW_ROUNDS`까지 반복됩니다.

## Task Lease와 복구

AgentRunner는 `locked_by`, `lock_expires_at`을 사용해 task lease를 관리합니다. Orchestrator는 worker 실행 전에 lease를 획득하고, 각 revision round 전에 lease를 갱신하며, 작업 종료 시 lease를 해제합니다.

시작 시 `RECOVER_STALE_TASKS_ON_START=true`이면 오래 멈춘 `running` 또는 `needs_revision` 작업을 `blocked`로 전환하고 `08_Recovery/`에 복구 리포트를 남깁니다.

## 다음 개발 우선순위

1. 실제 CI/typecheck 결과 기반 버그 수정
2. 이미지 URL 다운로드와 vision adapter 연결
3. sessions 테이블을 실제 대화 이어가기 로직에 연결
4. steering_messages 기반 mid-turn steering
5. 음성 전사
6. 브라우저 자동화
7. 웹 dashboard 추가

## 보안 주의

실제 Discord token, API key, `.env` 파일은 절대 커밋하지 않습니다.
