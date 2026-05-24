import type { RuntimeConfig } from "../config";
import { runShellCommand } from "../utils/command";

export async function appendBrowserContext(input: {
  content: string;
  config: RuntimeConfig;
}): Promise<string> {
  if (!input.config.BROWSER_COMMAND) return input.content;

  const urls = extractUrls(input.content);
  if (urls.length === 0) return input.content;

  const result = await runShellCommand({
    command: input.config.BROWSER_COMMAND,
    cwd: input.config.PROJECT_ROOT,
    input: [
      "# Browser Context Request",
      "",
      "Fetch or summarize the following URLs for game-development work.",
      "Return concise, source-aware notes and highlight implementation-relevant details.",
      "",
      ...urls.map((url) => `- ${url}`),
    ].join("\n"),
    timeoutMs: input.config.BROWSER_COMMAND_TIMEOUT_MS,
  });

  const context = result.ok
    ? result.stdout.trim()
    : [`Browser command failed.`, `exit_code: ${result.exitCode ?? "unknown"}`, result.stderr.trim()].filter(Boolean).join("\n");

  if (!context) return input.content;

  return [
    input.content,
    "",
    "# Browser Context",
    "",
    context,
  ].join("\n");
}

export function extractUrls(content: string): string[] {
  const matches = content.match(/https?:\/\/[^\s)\]>"']+/g) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[.,;:!?]+$/, "")))];
}
