import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import type { RuntimeConfig } from "../config";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../runtime/types";

interface GeminiInlineDataPart {
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
  text?: string;
}

interface GeminiImageResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiInlineDataPart[];
    };
  }>;
}

export class DesignerAgent implements AgentAdapter {
  readonly role = "designer" as const;

  constructor(private readonly config: RuntimeConfig) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    if (!this.config.GEMINI_API_KEY) {
      return {
        ok: false,
        output: "Gemini image generation is not configured.",
        error: "GEMINI_API_KEY is required for DesignerAgent.",
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey: this.config.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: this.config.GEMINI_IMAGE_MODEL,
        contents: buildDesignerPrompt(input.prompt),
      });

      const result = await saveGeminiImageResponse({
        response: response as GeminiImageResponse,
        taskId: input.taskId,
        outputDir: this.config.DESIGNER_OUTPUT_DIR,
      });

      return {
        ok: result.artifacts.length > 0 || result.notes.length > 0,
        output: formatDesignerOutput({
          model: this.config.GEMINI_IMAGE_MODEL,
          notes: result.notes,
          artifacts: result.artifacts,
        }),
        artifacts: result.artifacts,
      };
    } catch (error) {
      return {
        ok: false,
        output: "DesignerAgent failed to generate image output.",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export function buildDesignerPrompt(prompt: string): string {
  return [
    "You are AgentRunner's Designer agent.",
    "Create production-ready visual design output for the user's request.",
    "Prefer clear composition, usable visual hierarchy, and artifact-ready results.",
    "If the request is for game assets, make the result directly usable as a game art reference or asset draft.",
    "",
    "User design request:",
    prompt,
  ].join("\n");
}

export async function saveGeminiImageResponse(input: {
  response: GeminiImageResponse;
  taskId: string;
  outputDir: string;
}): Promise<{ notes: string[]; artifacts: string[] }> {
  await mkdir(input.outputDir, { recursive: true });

  const notes: string[] = [];
  const artifacts: string[] = [];
  const parts = input.response.candidates?.[0]?.content?.parts ?? [];

  for (const [index, part] of parts.entries()) {
    if (part.text) notes.push(part.text);
    if (!part.inlineData?.data) continue;

    const extension = extensionForMimeType(part.inlineData.mimeType);
    const imagePath = path.join(input.outputDir, `${input.taskId}-designer-${index + 1}${extension}`);
    await writeFile(imagePath, Buffer.from(part.inlineData.data, "base64"));
    artifacts.push(imagePath);
  }

  return { notes, artifacts };
}

function formatDesignerOutput(input: {
  model: string;
  notes: string[];
  artifacts: string[];
}): string {
  return [
    "# Designer Output",
    "",
    `Model: ${input.model}`,
    "",
    "## Notes",
    input.notes.length > 0 ? input.notes.join("\n\n") : "No text notes returned.",
    "",
    "## Artifacts",
    input.artifacts.length > 0 ? input.artifacts.map((artifact) => `- ${artifact}`).join("\n") : "No image artifacts returned.",
  ].join("\n");
}

function extensionForMimeType(mimeType?: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return ".png";
}
