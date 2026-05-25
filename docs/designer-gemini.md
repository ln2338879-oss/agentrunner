# Designer Agent with Gemini Image Generation

AgentRunner can route visual design and image generation requests to a dedicated `designer` role.

The default Designer provider is `nanobanana`, backed by Gemini image generation.

## Runtime flow

```text
Discord request
→ DirectorBot
→ classifyTask()
→ design task
→ DesignerAgent
→ Gemini image generation
→ image artifacts saved to DESIGNER_OUTPUT_DIR
→ Director review
→ approved summary
```

## Environment

Add these values to `.env`:

```env
GEMINI_API_KEY=
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
DESIGNER_OUTPUT_DIR=./vault/AgentRunnerVault/06_DesignerOutputs
```

`GEMINI_IMAGE_MODEL` defaults to `gemini-3.1-flash-image-preview`.

## Routing examples

Requests containing visual design or image generation keywords are routed to `designer`:

```text
픽셀아트 포스터 디자인 만들어줘
로고 시안 제작해줘
컨셉아트 이미지 생성해줘
thumbnail image for a devlog
pixel art sprite icon
```

## Role config

```yaml
roles:
  - id: designer
    label: Designer
    legacyRole: designer
    provider: nanobanana
    model: gemini-3.1-flash-image-preview
    capabilities:
      - generate-image
      - design-production
      - write-files
    permissions:
      canWriteFiles: true
      requiresReview: true
```

## Workflow config

```yaml
workflows:
  - id: plan-design-review
    label: Plan, Design, Review
    defaultForTaskTypes:
      - design
    steps:
      - id: plan
        role: planner
        action: plan
      - id: design
        role: designer
        action: generate-image
        dependsOn:
          - plan
      - id: review
        role: reviewer
        action: review
        dependsOn:
          - design
```

## Output artifacts

Designer outputs are written to:

```text
06_DesignerOutputs/
```

The Designer agent records:

- a Markdown worker report
- generated image files
- `design_image` artifact rows for saved image files

## Current scope

This implementation supports the central runtime path:

```text
DirectorBot → Orchestrator → DesignerAgent
```

A separate `DESIGNER_DISCORD_TOKEN` and `DESIGN_TASKS_CHANNEL_ID` are included for future worker-bot separation, but the first implementation does not require a separate Designer Discord bot.

## Follow-up work

Recommended next steps:

1. Add a dedicated Designer Discord worker bot.
2. Add reference-image attachment support.
3. Add image edit/inpaint workflows.
4. Add dashboard image previews.
5. Add a human approval queue for sensitive design/image actions.
