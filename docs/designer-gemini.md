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

## Optional Designer Discord worker bot

The central DirectorBot path works without a separate Designer Discord bot.

To also start a dedicated Designer worker bot, configure:

```env
DESIGNER_DISCORD_TOKEN=
DESIGN_TASKS_CHANNEL_ID=
```

When `DESIGNER_DISCORD_TOKEN` is set, `src/index.ts` logs in a Designer worker bot using `DESIGN_TASKS_CHANNEL_ID` as its channel filter.

The dedicated bot currently acknowledges visual task handoffs. Actual execution remains coordinated through AgentRunner runtime adapters, task state, and Obsidian artifacts.

## Reference image attachments

When a user attaches an image to a DirectorBot message, AgentRunner already persists the attachment under `ATTACHMENTS_DIR` and appends a `# Discord Attachments` block to the task prompt.

DesignerAgent now scans that block for image attachments with `local_path` and passes those files to Gemini as inline image parts.

```text
# Discord Attachments

- filename: hero.png
  content_type: image/png
  kind: image
  local_path: ./data/attachments/123/hero.png
```

The Gemini request is built as:

```text
inlineData image part(s)
text design prompt
```

This supports prompts like:

```text
이 첨부 이미지 스타일로 픽셀아트 캐릭터를 만들어줘
이 로고를 더 판타지 게임풍으로 바꿔줘
첨부한 캐릭터를 스프라이트 아이콘 느낌으로 다시 디자인해줘
```

For small images, Gemini supports inline image data passed to `generateContent`; larger or reusable images should be moved to a future Files API flow.

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
- reference image paths used for the design request

## Current scope

This implementation supports both paths:

```text
DirectorBot → Orchestrator → DesignerAgent
Designer Discord worker bot → worker handoff acknowledgement
```

## Follow-up work

Recommended next steps:

1. Add image edit/inpaint workflows.
2. Add dashboard image previews.
3. Add a human approval queue for sensitive design/image actions.
4. Make the Designer Discord worker claim and execute queued design tasks directly.
5. Add Files API support for large or reusable reference images.
