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
  results.push(await checkWritableDirectory("Designer output directory", config.DESIGNER_OUTPUT_DIR));
  results.push(checkDashboardExposure(config.DASHBOARD_ENABLED, config.DASHBOARD_HOST));
  results.push(checkPositiveNumber("TASK_LEASE_MINUTES", config.TASK_LEASE_MINUTES));
  results.push(checkPositiveNumber("STALE_TASK_MINUTES", config.STALE_TASK_MINUTES));
  results.push(checkPositiveNumber("WORKER_HEARTBEAT_INTERVAL_MS", config.WORKER_HEARTBEAT_INTERVAL_MS));
  results.push(checkPositiveNumber("STEP_SCHEDULER_INTERVAL_MS", config.STEP_SCHEDULER_INTERVAL_MS));

  if (requireCredentials) {
    results.push(checkValue("DIRECTOR_DISCORD_TOKEN", config.DIRECTOR_DISCORD_TOKEN));
    results.push(checkValue("GAME_DIRECTOR_CHANNEL_ID", config.GAME_DIRECTOR_CHANNEL_ID));
    results.push(checkSlashCommandRegistration(config.REGISTER_SLASH_COMMANDS, config.DISCORD_CLIENT_ID));
  } else {
    results.push(skippedCheck("DIRECTOR_DISCORD_TOKEN", "credential check skipped for local proof."));
    results.push(skippedCheck("GAME_DIRECTOR_CHANNEL_ID", "credential check skipped for local proof."));
    results.push(skippedCheck("Discord slash command registration", "credential check skipped for local proof."));
  }

  if (includeExternalChecks) {
    results.push(await checkCommandCandidates(
      "ClaudeCode command",
      parsePipeList(config.CLAUDE_CODE_COMMAND, config.CLAUDE_CODE_COMMANDS),
    ));
    results.push(await checkCommandCandidates(
      "Codex command",
      parsePipeList(config.CODEX_COMMAND, config.CODEX_COMMANDS),
    ));
    results.push(await checkEndpointCandidates(
      "Ollama/OpenAI-compatible endpoint",
      parsePipeList(config.OLLAMA_BASE_URL, config.OLLAMA_BASE_URLS),
    ));
    results.push(await checkOptionalCommand("Vision command", config.VISION_COMMAND, "VISION_COMMAND is empty; image analysis command is disabled."));
    results.push(await checkOptionalCommand("Browser command", config.BROWSER_COMMAND, "BROWSER_COMMAND is empty; browser context command is disabled."));
    results.push(checkOptionalValue("Gemini image provider", config.GEMINI_API_KEY, "GEMINI_API_KEY is empty; DesignerAgent will escalate image tasks to human intervention."));
  } else {
    results.push(skippedCheck("ClaudeCode command", "external command check skipped for local proof."));
    results.push(skippedCheck("Codex command", "external command check skipped for local proof."));
    results.push(skippedCheck("Ollama/OpenAI-compatible endpoint", "network endpoint check skipped for local proof."));
    results.push(skippedCheck("Vision command", "external command check skipped for local proof."));
    results.push(skippedCheck("Browser command", "external command check skipped for local proof."));
    results.push(skippedCheck("Gemini image provider", "external credential check skipped for local proof."));
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

function checkOptionalValue(name: string, value: string, disabledDetail: string): CheckResult {
  return value ? { name, ok: true, detail: "configured." } : { name, ok: true, detail: disabledDetail };
}

function checkSlashCommandRegistration(enabled: boolean, clientId: string): CheckResult {
  if (!enabled) {
    return {
      name: "Discord slash command registration",
      ok: true,
      detail: "REGISTER_SLASH_COMMANDS is false; text commands can still run.",
    };
  }

  return {
    name: "Discord slash command registration",
    ok: Boolean(clientId),
    detail: clientId ? "DISCORD_CLIENT_ID is configured." : "REGISTER_SLASH_COMMANDS is true, but DISCORD_CLIENT_ID is missing.",
  };
}

function checkDashboardExposure(enabled: boolean, host: string): CheckResult {
  if (!enabled) return { name: "Dashboard exposure", ok: true, detail: "dashboard is disabled." };
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") {
    return { name: "Dashboard exposure", ok: true, detail: `dashboard is bound to ${host}.` };
  }
  return {
    name: "Dashboard exposure",
    ok: false,
    detail: `dashboard is enabled on ${host}; keep DASHBOARD_HOST on 127.0.0.1/localhost unless an authenticated reverse proxy protects it.`,
  };
}

function checkPositiveNumber(name: string, value: number): CheckResult {
  return {
    name,
    ok: Number.isFinite(value) && value > 0,
    detail: Number.isFinite(value) && value > 0 ? `${value} configured.` : `${value} is not a positive number.`,
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

  const binary = command.trim().split(/\s+/)[0] ?? "";
  const probe = process.platform === "win32" ? `where ${binary}` : `command -v ${binary}`;
  const result = await runShellCommand({ command: probe, timeoutMs: 10000 });

  return {
    name,
    ok: result.ok,
    detail: result.ok ? `${binary} found.` : `${binary} not found. ${result.stderr.trim()}`.trim(),
  };
}

async function checkCommandCandidates(name: string, commands: string[]): Promise<CheckResult> {
  if (commands.length === 0) return { name, ok: false, detail: "no command candidates configured." };

  const checks = await Promise.all(commands.map((command) => checkCommand(name, command)));
  const firstPassing = checks.find((check) => check.ok);
  if (firstPassing) {
    return {
      name,
      ok: true,
      detail: `${firstPassing.detail} candidates=${commands.length}.`,
    };
  }

  return {
    name,
    ok: false,
    detail: checks.map((check, index) => `candidate ${index + 1}: ${check.detail}`).join(" | "),
  };
}

async function checkOptionalCommand(name: string, command: string, disabledDetail: string): Promise<CheckResult> {
  if (!command) return { name, ok: true, detail: disabledDetail };
  return await checkCommand(name, command);
}

async function checkEndpointCandidates(name: string, baseUrls: string[]): Promise<CheckResult> {
  if (baseUrls.length === 0) return { name, ok: false, detail: "no endpoint candidates configured." };

  const checks = await Promise.all(baseUrls.map((baseUrl) => checkOllamaEndpoint(baseUrl)));
  const firstPassing = checks.find((check) => check.ok);
  if (firstPassing) {
    return {
      name,
      ok: true,
      detail: `${firstPassing.detail} candidates=${baseUrls.length}.`,
    };
  }

  return {
    name,
    ok: false,
    detail: checks.map((check, index) => `candidate ${index + 1}: ${check.detail}`).join(" | "),
  };
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

function parsePipeList(primary: string, alternates: string): string[] {
  return [...new Set([primary, ...alternates.split("||")].map((value) => value.trim()).filter(Boolean))];
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
