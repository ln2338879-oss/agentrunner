# Discord Channel Design

## Channel Layout

```text
#game-director
#dev-tasks
#content-factory
#review-log
#build-log
#archive
```

## #game-director

사용자가 주로 보는 메인 채널입니다.

담당 봇:

- ClaudeCode Director

용도:

- 새 기능 요청
- 기획 요청
- 작업 승인
- 최종 결과 확인

예시:

```text
@Director 초반 전투 프로토타입 만들어줘.
```

## #dev-tasks

Codex Builder가 구현 작업을 받는 채널입니다.

담당 봇:

- Codex Builder
- ClaudeCode Director가 지시 메시지를 남김

용도:

- 구현 작업 지시
- 파일 수정 결과 보고
- 테스트 결과 보고

예시:

```text
@Builder BattleManager와 DamageCalculator를 구현해줘. 요구사항은 아래와 같다...
```

## #content-factory

Ollama Factory가 대량 콘텐츠를 생성하는 채널입니다.

담당 봇:

- Ollama Factory
- ClaudeCode Director가 생성 규칙을 제공

용도:

- 아이템 데이터 생성
- 몬스터 데이터 생성
- NPC 대사 생성
- 퀘스트 초안 생성

예시:

```text
@Factory 초반 지역용 일반 몬스터 30종을 JSON 배열로 생성해줘.
```

## #review-log

검수 결과를 모으는 채널입니다.

담당 봇:

- ClaudeCode Director

용도:

- Codex 결과 리뷰
- Ollama 생성물 리뷰
- 수정 지시 기록
- 승인/반려 기록

## #build-log

빌드, 테스트, 오류 로그 전용 채널입니다.

담당 봇:

- Codex Builder

용도:

- 테스트 결과
- 빌드 로그
- 에러 메시지
- 수정 완료 보고

## #archive

완료된 작업 요약을 보관합니다.

용도:

- 완료 기능 목록
- 확정된 기획
- 승인된 데이터셋
- 릴리즈 노트 초안

## Permission Recommendation

| 채널 | 사용자 | Director | Builder | Factory |
|---|---:|---:|---:|---:|
| #game-director | 읽기/쓰기 | 읽기/쓰기 | 읽기 | 읽기 |
| #dev-tasks | 읽기 | 읽기/쓰기 | 읽기/쓰기 | 읽기 |
| #content-factory | 읽기 | 읽기/쓰기 | 읽기 | 읽기/쓰기 |
| #review-log | 읽기 | 읽기/쓰기 | 읽기 | 읽기 |
| #build-log | 읽기 | 읽기 | 읽기/쓰기 | 읽기 |
| #archive | 읽기 | 읽기/쓰기 | 읽기 | 읽기 |
