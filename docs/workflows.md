# Workflows

## Workflow 1: Game Feature Cycle

기능 하나를 설계하고 구현하는 기본 흐름입니다.

```text
User Request
 ↓
Director: 요구사항 정리
 ↓
Director: 작업 단위 분해
 ↓
Builder: 구현
 ↓
Builder: 테스트/빌드
 ↓
Director: 리뷰
 ↓
User Report
```

### Step 1. User Request

예시:

```text
초반 전투 시스템 만들어줘.
```

### Step 2. Director Planning

Director는 다음을 확정합니다.

- 목표
- 포함 기능
- 제외 기능
- 필요한 파일
- 테스트 기준
- 완료 조건

### Step 3. Builder Implementation

Builder는 구현 전 다음을 보고합니다.

- 수정할 파일
- 새로 만들 파일
- 예상 리스크

구현 후 다음을 보고합니다.

- 변경 파일
- 핵심 구현 내용
- 테스트 결과
- 남은 문제

### Step 4. Director Review

Director는 다음 기준으로 리뷰합니다.

- 요구사항 충족 여부
- 게임성
- 코드 구조
- 확장성
- 버그 가능성
- 다음 작업 제안

## Workflow 2: Content Generation Cycle

아이템, 몬스터, 대사 같은 대량 콘텐츠 생성 흐름입니다.

```text
User Request
 ↓
Director: 생성 규칙 정의
 ↓
Factory: 대량 생성
 ↓
Director: 중복/밸런스/톤 검수
 ↓
Builder: 데이터 파일 반영
 ↓
User Report
```

### Example

```text
초반 지역 몬스터 50종 만들어줘.
```

Director가 규칙을 정의합니다.

- 지역 톤
- 몬스터 등급
- 능력치 범위
- 드랍 테이블
- 출력 형식

Factory가 JSON 초안을 생성합니다.

Director가 검수합니다.

Builder가 실제 게임 데이터 파일에 반영합니다.

## Workflow 3: Bug Fix Cycle

```text
User/Error Log
 ↓
Director: 문제 범위 파악
 ↓
Builder: 재현/수정
 ↓
Builder: 테스트 결과 보고
 ↓
Director: 회귀 가능성 검토
 ↓
User Report
```

## Workflow 4: Art Prompt Cycle

이미지 AI를 직접 저장소에 포함하지는 않지만, 에셋 프롬프트 제작 흐름은 관리합니다.

```text
User Request
 ↓
Director: 에셋 사양 정의
 ↓
Factory: 프롬프트 초안 대량 생성
 ↓
Director: 프롬프트 정제
 ↓
Image AI: 에셋 생성
 ↓
Builder: 프로젝트 import 설정
```

## Completion Report Format

모든 작업 완료 보고는 다음 형식을 권장합니다.

```markdown
## 완료 요약

- 작업명:
- 담당 봇:
- 변경 파일:
- 테스트 결과:
- 남은 문제:
- 다음 추천 작업:
```
