import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { buildDesignerPrompt, DesignerAgent, saveGeminiImageResponse } from "../src/agents/designer";

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
