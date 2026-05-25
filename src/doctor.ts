import { existsSync, accessSync, constants } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { runShellCommand } from "./utils/command";

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  requireCredentials?: boolean;
  includeExternalChecks?: boolean;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<CheckResult[]> {
  const config = loadConfig(options.env ?? process.env);
  const cwd = options.cwd ?? process.cwd();
  const requireCredentials = options.requireCredentials ?? true;
  const includeExternalChecks = options.includeExternalChecks ?? true;

  const results: CheckResult[] = [];

  results.push(checkFileExists(".env file", path.join(cwd, ".env"), false));
  results.push(await checkWritableDirectory("Database directory", path.dirname(config.DATABASE_PATH)));
  results.push(await checkWritableDirectory("Obsidian Vault", config.OBSIDIAN_VAULT_PATH));
  results.push(await checkWritableDirectory("Project Root", config.PROJECT_ROOT));
  results.push(await checkWritableDirectory("Attachments directory", config.ATTACHMENTS_DIR));

  if (requireCredentials) {
    results.push(checkValue("DIRECTOR_DISCORD_TOKEN", config.DIRECTOR_DISCORD_TOKEN));
    results.push(checkValue("GAME_DIRECTOR_CHANNEL_ID", config.GAME_DIRECTOR_CHANNEL_ID));
  } else {
    results.push(skippedCheck("DIRECTOR_DISCORD_TOKEN", "credential check skipped for local proof."));
    results.push(skippedCheck("GAME_DIRECTOR_CHANNEL_ID", "credential check skipped for local proof."));
  }

  if (includeExternalChecks) {
    results.push(await checkCommand("ClaudeCode command", config.CLAUDE_CODE_COMMAND));
    results.push(await checkCommand("Codex command", config.CODEX_COMMAND));
    results.push(await checkOllamaEndpoint(config.OLLAMA_BASE_URL));
    results.push(await checkOptionalCommand("Vision command", config.VISION_COMMAND, "VISION_COMMAND is empty; image analysis command is disabled."));
    results.push(await checkOptionalCommand("Browser command", config.BROWSER_COMMAND, "BROWSER_COMMAND is empty; browser context command is disabled."));
  } else {
    results.push(skippedCheck("ClaudeCode command", "external command check skipped for local proof."));
    results.push(skippedCheck("Codex command", "external command check skipped for local proof."));
    results.push(skippedCheck("Ollama/OpenAI-compatible endpoint", "network endpoint check skipped for local proof."));
    results.push(skippedCheck("Vision command", "external command check skipped for local proof."));
    results.push(skippedCheck("Browser command", "external command check skipped for local proof."));
  }

  return results;
}

export function doctorPassed(results: CheckResult[]): boolean {
  return results.every((result) => result.ok);
}

export function printResults(results: CheckResult[]): void {
  console.log("AgentRunner Doctor");
  console.log("==================");
  for (const result of results) {
    console.log(`${result.ok ? "✓" : "✗"} ${result.name}: ${result.detail}`);
  }
}

export function formatDoctorMarkdown(results: CheckResult[]): string {
  return [
    "| Check | Status | Detail |",
    "|---|---|---|",
    ...results.map((result) => `| ${escapeMarkdownTable(result.name)} | ${result.ok ? "PASS" : "FAIL"} | ${escapeMarkdownTable(result.detail)} |`),
  ].join("\n");
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

function skippedCheck(name: string, detail: string): CheckResult {
  return { name, ok: true, detail };
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

function escapeMarkdownTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

async function main(): Promise<void> {
  const results = await runDoctor();
  printResults(results);
  if (!doctorPassed(results)) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
