# AgentRunner Policy Engine

The policy engine centralizes decisions for potentially risky runtime actions.

This step keeps default behavior compatible with the existing runtime while allowing workspaces and profiles to deny or require human approval for specific actions.

## Policy fields

```yaml
policy:
  allowCodeChanges: true
  allowContentGeneration: true
  requireDirectorReview: true
  allowFileWrites: true
  allowShellCommands: true
  allowTests: true
  allowBuilds: true
  allowApprovedTaskCommand: true
  allowSystemdRestart: false
  allowNetworkAccess: false
  requireHumanApprovalFor:
    - approved_task_command
    - systemd_restart
```

## Actions

Supported policy actions:

```text
code_changes
content_generation
write_files
run_shell_command
run_tests
run_build
approved_task_command
systemd_restart
network_access
```

## Decisions

Every action resolves to one of three statuses:

| Status | Meaning |
|---|---|
| `allowed` | The action may run. |
| `denied` | The action is blocked by policy. |
| `needs_human` | The action must wait for explicit human approval. |

## Current enforcement

The first enforcement points are intentionally conservative:

- builder tasks require `code_changes`
- factory tasks require `content_generation`
- approved-task hooks require `approved_task_command`

When an approved-task hook is denied or requires human approval, AgentRunner records a policy decision artifact instead of running the command.

## Profile and group merging

Policies inherit from defaults, then profile policy, then group policy.

`requireHumanApprovalFor` is merged as a union of profile and group values.

```yaml
profiles:
  - id: software-dev
    policy:
      requireHumanApprovalFor:
        - approved_task_command

groups:
  - id: agentrunner-core
    profileId: software-dev
    policy:
      requireHumanApprovalFor:
        - systemd_restart
```

The effective policy requires human approval for both `approved_task_command` and `systemd_restart`.

## Migration path

1. Add policy decisions without changing most runtime behavior.
2. Enforce policy for approved-task hooks and high-risk task categories.
3. Extend enforcement to shell commands, tests, build steps, file writes, and systemd actions.
4. Add a human approval queue for `needs_human` actions.
5. Surface policy decisions in the dashboard.
