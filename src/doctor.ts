import { existsSync, accessSync, constants } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { runShellCommand } from "./utils/command";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const results: CheckResult[] = [];
  const config = loadConfig();

  results.push(checkFileExists(".env file", ".env", false));
  results.push(await checkWritableDirectory("Database directory", path.dirname(config.DATABASE_PATH)));
  results.push(await checkWritableDirectory("Obsidian Vault", config.OBSIDIAN_VAULT_PATH));
  results.push(await checkWritableDirectory("Project Root", config.PROJECT_ROOT));
  results.push(await checkWritableDirectory("Attachments directory", config.ATTACHMENTS_DIR));

  results.push(checkValue("DIRECTOR_DISCORD_TOKEN", config.DIRECTOR_DISCORD_TOKEN));
  results.push(checkValue("GAME_DIRECTOR_CHANNEL_ID", config.GAME_DIRECTOR_CHANNEL_ID));

  results.push(await checkCommand("ClaudeCode command", config.CLAUDE_CODE_COMMAND));
  results.push(await checkCommand("Codex command", config.CODEX_COMMAND));
  results.push(await checkOllamaEndpoint(config.OLLAMA_BASE_URL));
  results.push(await checkOptionalCommand("Vision command", config.VISION_COMMAND, "VISION_COMMAND is empty; image analysis command is disabled."));
  results.push(await checkOptionalCommand("Browser command", config.BROWSER_COMMAND, "BROWSER_COMMAND is empty; browser context command is disabled."));

  printResults(results);

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

function checkFileExists(name: string, filePath: string, required: boolean): CheckResult {
  const exists = existsSync(filePath);
  return {
    name,
    ok: exists || !required,
    detail: exists ? `${filePath} exists.` : `${filePath} is missing${required ? "." : "; continuing with environment defaults."}`,
  };
}

function checkValue(name: string, value: string): CheckResult {
  return {
    name,
    ok: Boolean(value),
    detail: value ? "configured." : "missing or empty.",
  };
}

async function checkWritableDirectory(name: string, directory: string): Promise<CheckResult> {
  try {
    await mkdir(directory, { recursive: true });
    accessSync(directory, constants.W_OK);
    return { name, ok: true, detail: `${directory} is writable.` };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function checkCommand(name: string, command: string): Promise<CheckResult> {
  if (!command) return { name, ok: false, detail: "command is empty." };

  const binary = command.trim().split(/\s+/)[0];
  const probe = process.platform === "win32" ? `where ${binary}` : `command -v ${binary}`;
  const result = await runShellCommand({ command: probe, timeoutMs: 10000 });

  return {
    name,
    ok: result.ok,
    detail: result.ok ? `${binary} found.` : `${binary} not found. ${result.stderr.trim()}`.trim(),
  };
}

async function checkOptionalCommand(name: string, command: string, disabledDetail: string): Promise<CheckResult> {
  if (!command) return { name, ok: true, detail: disabledDetail };
  return await checkCommand(name, command);
}

async function checkOllamaEndpoint(baseUrl: string): Promise<CheckResult> {
  try {
    const response = await fetch(baseUrl.replace(/\/$/, "/models"));
    return {
      name: "Ollama/OpenAI-compatible endpoint",
      ok: response.ok,
      detail: response.ok ? `${baseUrl} responded.` : `${baseUrl} returned HTTP ${response.status}.`,
    };
  } catch (error) {
    return {
      name: "Ollama/OpenAI-compatible endpoint",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function printResults(results: CheckResult[]): void {
  console.log("AgentRunner Doctor");
  console.log("==================");
  for (const result of results) {
    console.log(`${result.ok ? "✓" : "✗"} ${result.name}: ${result.detail}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
