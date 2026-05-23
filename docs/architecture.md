# Architecture

## Goal

AgentRunner는 게임 개발 자동화를 위한 3봇 협업 구조입니다.

기본 아이디어는 EJClaw의 역할 분리 방식에서 가져오되, 게임 개발에 맞게 다음처럼 재설계합니다.

```text
EJClaw 원형
Owner -> Reviewer -> Arbiter

AgentRunner 변형
Director -> Builder / Factory -> Director Review
```

## High-level Flow

```text
User
 ↓
Discord #game-director
 ↓
ClaudeCode Director
 ↓
Task Router
 ├─ Planning / Design -> ClaudeCode Director
 ├─ Implementation -> Codex Builder
 └─ Bulk Content -> Ollama Factory
 ↓
Result Collection
 ↓
ClaudeCode Review
 ↓
User Report
```

## Components

### 1. Discord Gateway

Discord는 사용자가 봇에게 작업을 지시하고 결과를 확인하는 UI입니다.

권장 채널:

- `#game-director`
- `#dev-tasks`
- `#content-factory`
- `#review-log`
- `#build-log`

### 2. ClaudeCode Director

중앙 의사결정자입니다.

담당:

- 게임 기획
- 기능 우선순위 결정
- 구현 작업 분해
- Codex 작업 지시
- Ollama 작업 지시
- 최종 리뷰
- 사용자 보고

### 3. Codex Builder

실제 프로젝트 파일을 수정하는 구현자입니다.

담당:

- 코드 생성
- 파일 수정
- 테스트 실행
- 빌드 오류 수정
- 리팩토링
- Git diff 요약

### 4. Ollama Factory

로컬 모델 기반 대량 생성 작업자입니다.

담당:

- 아이템 데이터 초안
- 몬스터 데이터 초안
- NPC 대사
- 퀘스트 초안
- 에셋 프롬프트 초안
- JSON/CSV 초안

## Control Principle

ClaudeCode는 계속 작업하는 worker가 아니라, director/reviewer 역할로 제한합니다.

이유:

1. 비용이 높음
2. 판단 능력이 뛰어남
3. 장문 기획과 검수에 강함
4. 반복 생성은 로컬 모델이 더 경제적임

## Recommended Routing

| 요청 유형 | 담당 |
|---|---|
| 게임 방향성 결정 | ClaudeCode Director |
| 시스템 설계 | ClaudeCode Director |
| 실제 코드 구현 | Codex Builder |
| 버그 수정 | Codex Builder |
| 아이템/몬스터 대량 생성 | Ollama Factory |
| 대사/퀘스트 초안 | Ollama Factory |
| 최종 품질 검수 | ClaudeCode Director |

## Failure Handling

1. Codex가 구현 실패
   - Director가 오류 로그를 읽고 작업 범위를 더 작게 쪼갭니다.

2. Ollama 생성물이 품질 낮음
   - Director가 규칙을 더 명확히 작성하고 재생성 지시합니다.

3. Director 판단이 필요한 충돌 발생
   - 사용자에게 선택지를 2~3개로 줄여 보고합니다.

## Repository Role

이 저장소는 다음을 보관합니다.

- 봇별 역할 정의
- 시스템 프롬프트
- 작업 흐름 문서
- Discord 채널 운영 규칙
- Hermes provider 설정 예시

실제 비밀키, Discord token, API key는 절대 커밋하지 않습니다.
