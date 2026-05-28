import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import type { RuntimeConfig } from "../config";
import { classifyProviderError, formatHumanEscalation } from "../providers/error-classifier";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../runtime/types";

export interface GeminiInlineDataPart {
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

interface ReferenceImage {
  localPath: string;
  mimeType: string;
}

export class DesignerAgent implements AgentAdapter {
  readonly role = "designer" as const;

  constructor(private readonly config: RuntimeConfig) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    if (!this.config.GEMINI_API_KEY) {
      const classification = classifyProviderError({
        provider: "Gemini Image",
        error: "GEMINI_API_KEY is required for DesignerAgent.",
      });
      return {
        ok: false,
        output: formatHumanEscalation({
          provider: "Gemini Image",
          classification: { ...classification, needsHuman: true, kind: "auth" },
          stderr: "GEMINI_API_KEY is required for DesignerAgent.",
        }),
        error: "Gemini image generation requires a human to configure GEMINI_API_KEY.",
        errorKind: "auth",
        needsHuman: true,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey: this.config.GEMINI_API_KEY });
      const referenceImages = extractReferenceImages(input.prompt);
      const contents = await buildGeminiDesignerContents({
        prompt: input.prompt,
        referenceImages,
      });
      const response = await ai.models.generateContent({
        model: this.config.GEMINI_IMAGE_MODEL,
        contents: contents as never,
      });

      const result = await saveGeminiImageResponse({
        response: response as unknown as GeminiImageResponse,
        taskId: input.taskId,
        outputDir: this.config.DESIGNER_OUTPUT_DIR,
      });

      return {
        ok: result.artifacts.length > 0 || result.notes.length > 0,
        output: formatDesignerOutput({
          model: this.config.GEMINI_IMAGE_MODEL,
          notes: result.notes,
          artifacts: result.artifacts,
          referenceImages,
        }),
        artifacts: result.artifacts,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const classification = classifyProviderError({ provider: "Gemini Image", error: message });
      return {
        ok: false,
        output: classification.needsHuman
          ? formatHumanEscalation({ provider: "Gemini Image", classification, stderr: message })
          : "DesignerAgent failed to generate image output.",
        error: classification.needsHuman ? classification.reason : message,
        errorKind: classification.kind,
        needsHuman: classification.needsHuman,
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
    "When reference images are provided, use them as visual reference material while following the user's current request.",
    "",
    "User design request:",
    prompt,
  ].join("\n");
}

export function extractReferenceImages(prompt: string): ReferenceImage[] {
  const references: ReferenceImage[] = [];
  let currentContentType: string | undefined;
  let currentKind: string | undefined;

  for (const rawLine of prompt.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("content_type:")) {
      currentContentType = line.replace(/^content_type:\s*/, "").trim();
      continue;
    }
    if (line.startsWith("kind:")) {
      currentKind = line.replace(/^kind:\s*/, "").trim();
      continue;
    }
    if (!line.startsWith("local_path:")) continue;

    const localPath = line.replace(/^local_path:\s*/, "").trim();
    const hasExplicitContentType = Boolean(currentContentType && currentContentType !== "unknown");
    const mimeType = currentContentType?.startsWith("image/")
      ? currentContentType
      : hasExplicitContentType
        ? currentContentType ?? "application/octet-stream"
        : mimeTypeFromPath(localPath);

    if (currentKind === "image" || mimeType.startsWith("image/")) {
      references.push({ localPath, mimeType });
    }

    currentContentType = undefined;
    currentKind = undefined;
  }

  return dedupeReferenceImages(references);
}

export async function buildGeminiDesignerContents(input: {
  prompt: string;
  referenceImages: ReferenceImage[];
}): Promise<GeminiInlineDataPart[]> {
  const imageParts: GeminiInlineDataPart[] = await Promise.all(input.referenceImages.map(async (image) => ({
    inlineData: {
      mimeType: image.mimeType,
      data: await readImageBase64(image.localPath),
    },
  })));

  return [
    ...imageParts,
    { text: buildDesignerPrompt(input.prompt) },
  ];
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

async function readImageBase64(localPath: string): Promise<string> {
  const bytes = await readFile(localPath);
  return bytes.toString("base64");
}

function formatDesignerOutput(input: {
  model: string;
  notes: string[];
  artifacts: string[];
  referenceImages: ReferenceImage[];
}): string {
  return [
    "# Designer Output",
    "",
    `Model: ${input.model}`,
    "",
    "## Reference Images",
    input.referenceImages.length > 0
      ? input.referenceImages.map((image) => `- ${image.localPath} (${image.mimeType})`).join("\n")
      : "No reference images provided.",
    "",
    "## Notes",
    input.notes.length > 0 ? input.notes.join("\n\n") : "No text notes returned.",
    "",
    "## Artifacts",
    input.artifacts.length > 0 ? input.artifacts.map((artifact) => `- ${artifact}`).join("\n") : "No image artifacts returned.",
  ].join("\n");
}

function dedupeReferenceImages(images: ReferenceImage[]): ReferenceImage[] {
  const seen = new Set<string>();
  return images.filter((image) => {
    const key = `${image.localPath}\0${image.mimeType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extensionForMimeType(mimeType?: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return ".png";
}

function mimeTypeFromPath(localPath: string): string {
  const extension = path.extname(localPath).toLowerCase();
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
}
