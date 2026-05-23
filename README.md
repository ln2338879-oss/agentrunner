# AgentRunner

게임 개발용 3봇 AI 에이전트 운영 구조입니다.

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
ClaudeCode Director
 ├─ Codex Builder: 구현 작업
 └─ Ollama Factory: 콘텐츠 양산
 ↓
ClaudeCode Review
 ↓
User Report
```

## 문서 구조

```text
README.md
configs/
  bots.example.yaml
  hermes.providers.example.yaml
docs/
  architecture.md
  discord-channels.md
  roles.md
  workflows.md
prompts/
  claudecode-director.md
  codex-builder.md
  ollama-factory.md
workflows/
  game-feature-cycle.md
  content-generation-cycle.md
```

## 권장 사용 방식

1. 사용자는 `#game-director` 채널에서 ClaudeCode Director에게 요청합니다.
2. Director는 작업을 기획/구현/양산으로 분류합니다.
3. 구현은 Codex Builder에게 넘깁니다.
4. 반복 콘텐츠 생성은 Ollama Factory에게 넘깁니다.
5. 모든 결과는 ClaudeCode Director가 최종 검수합니다.

## 주의

이 저장소는 실행 가능한 완성 봇 코드가 아니라, Hermes/Discord 기반 3봇 운영을 위한 설계 문서와 프롬프트 템플릿입니다.
