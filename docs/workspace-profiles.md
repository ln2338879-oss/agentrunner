# AgentRunner Workspace Profiles

Workspace profiles let AgentRunner stay compatible with legacy `groups.yaml` while adding generic project/workspace routing.

The older `groups` structure remains valid. New fields are additive:

- `profiles`
- `profileId`
- `workspaceId`
- `workspaceName`
- `artifactRoot`
- `defaultWorkflow`

## Profile

A profile defines reusable defaults for a class of work.

```yaml
profiles:
  - id: software-dev
    name: Software Development
    defaultWorkflow: plan-build-review
    skills:
      - code-style
      - testing
    policy:
      allowCodeChanges: true
      allowContentGeneration: false
      requireDirectorReview: true
```

## Workspace group

A group still maps Discord channels to runtime settings, but it can now inherit from a profile.

```yaml
groups:
  - id: agentrunner-core
    name: AgentRunner Core
    profileId: software-dev
    workspaceId: agentrunner
    workspaceName: AgentRunner
    discordChannelIds:
      - "000000000000000000"
    projectRoot: /opt/projects/agentrunner
    artifactRoot: /opt/vaults/agentrunner
    defaultWorkflow: plan-build-review
    allowedRoles:
      - director
      - builder
```

## Effective behavior

When a group references a profile:

- `effectiveSkills` = profile skills + group skills
- `effectivePolicy` = default policy + profile policy + group policy
- `defaultWorkflow` on the group overrides the profile's default workflow
- `artifactRoot` can be used as an Obsidian vault fallback when `obsidianVaultPath` is not set

## Compatibility

Existing group-only configs continue to work:

```yaml
groups:
  - id: legacy-dev
    name: Legacy Dev
    discordChannelIds:
      - "111111111111111111"
    projectRoot: /opt/project
    allowedRoles:
      - director
      - builder
      - factory
```

## Migration path

1. Keep existing `groups` entries.
2. Add reusable `profiles` for common categories like `game-dev`, `software-dev`, `content-lab`, or `research`.
3. Add `profileId` to each group.
4. Add `workspaceId` and `workspaceName` for dashboard and future routing.
5. Move shared skills and policy defaults from groups into profiles.
