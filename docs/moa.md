# Mixture-of-Agents (MoA)

AgentRunner의 MoA는 `review` / `arbitrate` 단계에서 여러 외부 모델의 의견을 보조 컨텍스트로 수집하는 기능입니다.

기본 구조는 그대로 유지됩니다. 최종 verdict는 Director가 결정하고, MoA 모델들은 참고 의견만 제공합니다.

```text
Review / Arbitration Step
→ MoA external model commands
→ advisory opinions
→ Director final verdict
```

## 언제 동작하나

MoA는 아래 조건을 모두 만족할 때만 동작합니다.

1. `MOA_ENABLED=true`
2. `MOA_MODEL_COMMANDS`에 하나 이상의 명령이 있음
3. Director 프롬프트가 review 또는 arbitrate 단계로 판정됨

일반 planning, build, factory, designer 작업에는 기본적으로 MoA를 붙이지 않습니다.

## 설정

`.env`에 아래 값을 추가합니다.

```env
MOA_ENABLED=true
MOA_MODEL_COMMANDS=codex --ask-for-approval never||ollama run qwen2.5:7b
MOA_COMMAND_TIMEOUT_MS=120000
```

`MOA_MODEL_COMMANDS`는 `||`로 구분합니다. 각 명령은 stdin으로 프롬프트를 받고 stdout으로 의견을 출력해야 합니다.

## 안전 정책

MoA 명령은 Director와 같은 read-only isolation policy 아래에서 실행됩니다. 파일 수정, 배포, publish, dependency mutation처럼 write 또는 publish로 보이는 명령은 runtime isolation에서 차단될 수 있습니다.

MoA 출력은 advisory context입니다. 외부 모델 출력이 `APPROVED`를 제안해도 AgentRunner의 최종 verdict는 Director와 strict review gate가 결정합니다.

## 실패 처리

개별 MoA 명령이 실패해도 AgentRunner는 나머지 의견을 수집합니다. 실패한 명령은 report에 `ok`, `exit_code`, `timed_out`, `error_kind`와 함께 기록됩니다.

인증 만료, 계정 제한, 사용량 제한처럼 사람이 개입해야 하는 오류도 MoA 의견 섹션에 표시됩니다. 이 경우에도 최종 판단은 Director 실행 결과와 기존 safety gate를 따릅니다.

## 권장 사용 방식

MoA는 비용이 큰 기능이므로 항상 켜기보다 중요한 review나 arbitration 단계에만 켜는 방식이 좋습니다.

권장 조합은 다음과 같습니다.

```text
Primary Director: Claude Code
MoA opinion 1: Codex
MoA opinion 2: local Ollama model
```

이렇게 구성하면 구현 관점, 로컬 모델 관점, Director 판단을 분리해 단일 모델의 사각지대를 줄일 수 있습니다.
