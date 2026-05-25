import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import {
  buildDesignerPrompt,
  buildGeminiDesignerContents,
  DesignerAgent,
  extractReferenceImages,
  saveGeminiImageResponse,
} from "../src/agents/designer";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-designer-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("DesignerAgent", () => {
  test("builds a design-specific prompt", () => {
    const prompt = buildDesignerPrompt("Create a fantasy item icon.");

    expect(prompt).toContain("Designer agent");
    expect(prompt).toContain("User design request:");
    expect(prompt).toContain("Create a fantasy item icon.");
  });

  test("extracts image reference attachments from Discord attachment context", () => {
    const prompt = [
      "픽셀아트로 바꿔줘",
      "",
      "# Discord Attachments",
      "",
      "- filename: hero.png",
      "  url: https://cdn.example/hero.png",
      "  content_type: image/png",
      "  size_bytes: 123",
      "  kind: image",
      "  local_path: /tmp/hero.png",
      "- filename: notes.txt",
      "  url: https://cdn.example/notes.txt",
      "  content_type: text/plain",
      "  size_bytes: 20",
      "  kind: file",
      "  local_path: /tmp/notes.txt",
      "- filename: hero-copy.png",
      "  url: https://cdn.example/hero-copy.png",
      "  content_type: image/png",
      "  size_bytes: 123",
      "  kind: image",
      "  local_path: /tmp/hero.png",
    ].join("\n");

    expect(extractReferenceImages(prompt)).toEqual([
      { localPath: "/tmp/hero.png", mimeType: "image/png" },
    ]);
  });

  test("builds Gemini contents with inline reference image data", async () => {
    const outputDir = await createTempDir();
    const imagePath = path.join(outputDir, "reference.webp");
    await writeFile(imagePath, "reference-image-data", "utf-8");

    const contents = await buildGeminiDesignerContents({
      prompt: "Use this image as a reference.",
      referenceImages: [{ localPath: imagePath, mimeType: "image/webp" }],
    });

    expect(contents).toHaveLength(2);
    expect(contents[0]?.inlineData?.mimeType).toBe("image/webp");
    expect(contents[0]?.inlineData?.data).toBe(Buffer.from("reference-image-data").toString("base64"));
    expect(contents[1]?.text).toContain("Use this image as a reference.");
  });

  test("fails clearly when Gemini API key is missing", async () => {
    const agent = new DesignerAgent(loadConfig({ GEMINI_API_KEY: "" }));
    const result = await agent.run({
      taskId: "TASK-DESIGNER-MISSING-KEY",
      role: "designer",
      prompt: "Create a poster.",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("GEMINI_API_KEY");
  });

  test("saves inline image response data as artifacts", async () => {
    const outputDir = await createTempDir();
    const result = await saveGeminiImageResponse({
      taskId: "TASK-DESIGNER-1",
      outputDir,
      response: {
        candidates: [
          {
            content: {
              parts: [
                { text: "Generated a draft image." },
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: Buffer.from("fake-image-data").toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      },
    });

    expect(result.notes).toEqual(["Generated a draft image."]);
    expect(result.artifacts).toHaveLength(1);
    expect(path.basename(result.artifacts[0] ?? "")).toBe("TASK-DESIGNER-1-designer-2.png");
    expect(await readFile(result.artifacts[0] ?? "", "utf-8")).toBe("fake-image-data");
  });
});
