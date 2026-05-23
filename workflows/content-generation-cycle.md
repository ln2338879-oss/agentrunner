# Content Generation Cycle Template

Use this template when generating large amounts of game content.

## 1. User Request

```text
[User requests items, monsters, quests, dialogue, or asset prompts]
```

## 2. Director Rules

```markdown
## Generation Rules

### Content Type

### Game Context

### Tone

### Count

### Required Fields

### Forbidden Patterns

### Balance Rules

### Output Format
```

## 3. Factory Task

```markdown
## Task for Ollama Factory

### Goal

### Context

### Generation Rules

### Output Format

### Completion Criteria
```

## 4. Factory Output

Factory should return only the requested format.

Examples:

- JSON only
- CSV only
- Markdown table only

## 5. Director Review

```markdown
## Content Review

Status: APPROVED / NEEDS_REVISION / PARTIAL_APPROVAL

### Accepted Entries

### Rejected Entries

### Duplicates

### Balance Issues

### Required Regeneration
```

## 6. Builder Import Task

If approved, Director sends the final data to Codex Builder.

```markdown
## Task for Codex Builder

### Goal
Import approved data into the game project.

### Requirements

### Target File

### Validation
```
