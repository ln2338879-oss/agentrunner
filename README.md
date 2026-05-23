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
- 작업 분류 라우터
- SQLite WAL 런타임 스키마
- task_runs / messages / reviews / artifacts 기록
- locked_by / lock_expires_at 기반 task lease
- Obsidian Vault 폴더/노트 생성기
- 작업, 리뷰, 보고서 Markdown 템플릿
- Director / Builder / Factory Agent Adapter 인터페이스
- ClaudeCode CLI 실행 어댑터
- Codex CLI 실행 어댑터
- Ollama OpenAI-compatible chat completions 실행 어댑터
- Director verdict 기반 자동 리뷰 루프
- NEEDS_REVISION 재작업 루프
- Builder diff/test/build validation report
- GitHub Actions typecheck/test 체크

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
```

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

## 런타임 구조

```text
src/
  agents/
    director.ts
    builder.ts
    factory.ts
  db/
    runtime-store.ts
    schema.ts
  discord/
    director-bot.ts
    worker-bot.ts
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

## Task Lease

AgentRunner는 `locked_by`, `lock_expires_at`을 사용해 task lease를 관리합니다. Orchestrator는 worker 실행 전에 lease를 획득하고, 각 revision round 전에 lease를 갱신하며, 작업 종료 시 lease를 해제합니다.

## 다음 개발 우선순위

1. 재시작 후 running/locked task 복구
2. Discord 채널별 상세 로그 라우팅
3. GitHub PR 생성/커밋 승인 플로우
4. Obsidian Dataview 템플릿
5. 대시보드 추가

## 보안 주의

실제 Discord token, API key, `.env` 파일은 절대 커밋하지 않습니다.
