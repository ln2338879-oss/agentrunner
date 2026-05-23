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
 ├─ SQLite Runtime DB: 상태, 큐, 메시지, 락
 ├─ Obsidian Vault: 작업 문서, 리뷰, 콘텐츠 결과물
 ├─ Codex Builder: 구현 작업
 └─ Ollama Factory: 콘텐츠 양산
 ↓
Director Review
 ↓
User Report
```

## 현재 구현 상태

현재 저장소는 설계 문서 단계에서 실행 가능한 런타임 스캐폴드 단계로 확장되었습니다.

포함된 기능:

- Bun + TypeScript 프로젝트 구조
- Director / Builder / Factory 3봇 로그인 구조
- Discord Director Bot 메시지 수신
- 작업 분류 라우터
- SQLite 런타임 스키마
- Obsidian Vault 폴더/노트 생성기
- 작업, 리뷰, 보고서 Markdown 템플릿
- Director / Builder / Factory Agent Adapter 인터페이스
- GitHub Actions typecheck/test 체크

아직 실제 ClaudeCode, Codex CLI, Ollama 호출은 placeholder adapter 상태입니다. 다음 단계에서 각 adapter를 실제 CLI/API에 연결합니다.

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
```

Builder/Factory 봇까지 실제 로그인하려면 다음 값도 설정합니다.

```env
BUILDER_DISCORD_TOKEN=
FACTORY_DISCORD_TOKEN=
DEV_TASKS_CHANNEL_ID=
CONTENT_FACTORY_CHANNEL_ID=
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
  router/
    classify.ts
  runtime/
    orchestrator.ts
    types.ts
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

## 문서 구조

```text
configs/
  bots.example.yaml
  hermes.providers.example.yaml
docs/
  architecture.md
  discord-channels.md
  roles.md
  runtime-roadmap.md
  workflows.md
prompts/
  claudecode-director.md
  codex-builder.md
  ollama-factory.md
workflows/
  game-feature-cycle.md
  content-generation-cycle.md
```

## 다음 개발 우선순위

1. Factory adapter를 Ollama OpenAI-compatible endpoint에 연결
2. Builder adapter를 Codex CLI에 연결
3. Director adapter를 ClaudeCode CLI 또는 Claude provider에 연결
4. Director Review Loop 구현
5. task lease / retry / restart recovery 구현
6. dashboard 추가

## 보안 주의

실제 Discord token, API key, `.env` 파일은 절대 커밋하지 않습니다.
