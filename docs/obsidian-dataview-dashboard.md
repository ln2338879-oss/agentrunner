# Obsidian Dataview Dashboard Templates

AgentRunner는 Obsidian Vault에 작업, 리뷰, 승인 결과를 Markdown으로 저장합니다. Obsidian Dataview 플러그인을 사용하면 아래 쿼리로 작업 상태판을 만들 수 있습니다.

## 진행 중 작업

```dataview
TABLE task_id, role, status, file.mtime AS updated
FROM "01_Tasks"
WHERE status = "running" OR status = "needs_revision"
SORT file.mtime DESC
```

## 리뷰 대기 또는 수정 필요 작업

```dataview
TABLE task_id, verdict, round, file.mtime AS reviewed
FROM "04_Reviews"
WHERE verdict = "NEEDS_REVISION"
SORT file.mtime DESC
```

## 승인된 작업

```dataview
TABLE task_id, role, report, review, approved_at
FROM "07_Approved"
WHERE status = "approved"
SORT approved_at DESC
```

## 차단 또는 복구된 작업

```dataview
TABLE created_at, stale_task_minutes
FROM "08_Recovery"
SORT created_at DESC
```

## Builder 보고서

```dataview
TABLE task_id, status, file.mtime AS updated
FROM "05_BuilderReports"
SORT file.mtime DESC
```

## Factory 출력

```dataview
TABLE task_id, status, file.mtime AS updated
FROM "06_FactoryOutputs"
SORT file.mtime DESC
```

## 추천 Vault 홈 구성

`AgentRunnerVault/Home.md`를 만들고 아래처럼 섹션을 나누면 됩니다.

```markdown
# AgentRunner Dashboard

## 진행 중

<진행 중 작업 Dataview 쿼리>

## 수정 필요

<리뷰 대기 또는 수정 필요 작업 Dataview 쿼리>

## 승인 완료

<승인된 작업 Dataview 쿼리>

## Builder Reports

<Builder 보고서 Dataview 쿼리>

## Factory Outputs

<Factory 출력 Dataview 쿼리>
```

## Frontmatter 규칙

AgentRunner가 생성하는 노트는 Dataview가 읽기 쉬운 frontmatter를 가져야 합니다.

권장 필드:

```yaml
task_id: TASK-...
role: builder | factory | director
status: running | ready_for_review | approved | blocked | failed
verdict: APPROVED | NEEDS_REVISION | BLOCKED
round: 1
report: 05_BuilderReports/...
review: 04_Reviews/...
approved_at: 2026-05-23T00:00:00.000Z
```
