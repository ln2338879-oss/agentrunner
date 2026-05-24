import { runShellCommand } from "../utils/command";
import type { RuntimeConfig } from "../config";

export async function appendVisionAnalysis(input: {
  content: string;
  config: RuntimeConfig;
}): Promise<string> {
  if (!input.config.VISION_COMMAND) return input.content;

  const imagePaths = extractImageLocalPaths(input.content);
  if (imagePaths.length === 0) return input.content;

  const result = await runShellCommand({
    command: input.config.VISION_COMMAND,
    cwd: input.config.PROJECT_ROOT,
    input: [
      "# Vision Analysis Request",
      "",
      "Analyze the following local image paths and return concise game-development-relevant observations.",
      "",
      ...imagePaths.map((filePath) => `- ${filePath}`),
    ].join("\n"),
    timeoutMs: input.config.VISION_COMMAND_TIMEOUT_MS,
  });

  const analysis = result.ok
    ? result.stdout.trim()
    : [`Vision command failed.`, `exit_code: ${result.exitCode ?? "unknown"}`, result.stderr.trim()].filter(Boolean).join("\n");

  if (!analysis) return input.content;

  return [
    input.content,
    "",
    "# Vision Analysis",
    "",
    analysis,
  ].join("\n");
}

export function extractImageLocalPaths(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const paths: string[] = [];
  let currentKind = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("kind:")) {
      currentKind = trimmed.replace("kind:", "").trim();
      continue;
    }

    if (currentKind === "image" && trimmed.startsWith("local_path:")) {
      const localPath = trimmed.replace("local_path:", "").trim();
      if (localPath) paths.push(localPath);
    }
  }

  return [...new Set(paths)];
}
