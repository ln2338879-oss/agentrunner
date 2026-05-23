# AgentRunner Runtime Roadmap

AgentRunner의 목표는 EJClaw식 역할 분리와 리뷰 루프를 게임 개발에 맞게 재설계한 3봇 런타임입니다.

## Runtime Architecture

```text
Discord
 ├─ Director Bot  → 사용자 요청, 작업 분해, 최종 리뷰
 ├─ Builder Bot   → Codex 기반 구현/테스트/빌드 보고
 └─ Factory Bot   → Ollama/Gemma 기반 콘텐츠 대량 생성
        ↓
AgentRunner Orchestrator
 ├─ SQLite Runtime DB
 │   ├─ tasks
 │   ├─ task_runs
 │   ├─ messages
 │   ├─ reviews
 │   └─ artifacts
 └─ Obsidian Vault
     ├─ 01_Tasks
     ├─ 03_Content
     ├─ 04_Reviews
     ├─ 05_BuilderReports
     └─ 06_FactoryOutputs
```

## Current Implementation

- Bun + TypeScript runtime scaffold
- Optional 3 Discord bot login
- Director message intake
- task classification
- SQLite schema and runtime store
- Obsidian Vault folder manager
- task/report/review Markdown templates
- placeholder Director/Builder/Factory adapters
- GitHub Actions typecheck/test workflow

## Next Steps

### 1. Real Factory Adapter

Connect `src/agents/factory.ts` to Ollama's OpenAI-compatible endpoint.

Expected behavior:

```text
Factory task
 → call Ollama/Gemma
 → create Markdown/JSON/CSV draft
 → save under 06_FactoryOutputs or 03_Content
 → mark task ready for Director review
```

### 2. Real Builder Adapter

Connect `src/agents/builder.ts` to Codex CLI.

Expected behavior:

```text
Builder task
 → run Codex in PROJECT_ROOT
 → collect git diff
 → run configured tests/build
 → save Builder report
```

### 3. Director Review Loop

Connect `src/agents/director.ts` to Claude Code CLI or a Claude-compatible provider.

Expected verdicts:

- `APPROVED`
- `NEEDS_REVISION`
- `BLOCKED`

### 4. Lease and Recovery

Add lock expiration and restart recovery so long-running jobs do not duplicate.

### 5. Dashboard

Add a small web dashboard for tasks, status, reports, and Obsidian file links.
