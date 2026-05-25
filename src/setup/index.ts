import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config";
import { doctorPassed, formatDoctorMarkdown, runDoctor, type CheckResult } from "../doctor";
import { runShellCommand, type ShellCommandResult } from "../utils/command";
import { detectPlatform, type PlatformInfo } from "./platform";

export type SetupMode = "check" | "local" | "ubuntu" | "systemd" | "vps";

export interface SetupCliOptions {
  mode: SetupMode;
  apply: boolean;
  interactive: boolean;
  yes: boolean;
  reportPath: string;
}

export interface SetupAction {
  name: string;
  status: "PASS" | "FAIL" | "SKIP" | "PLAN";
  detail: string;
}

export interface ServiceStatus {
  service: string;
  active: boolean;
  detail: string;
}

export interface DiscordChecklistItem {
  name: string;
  configured: boolean;
  detail: string;
}

const DEFAULT_REPORT_PATH = "setup-report.md";
const DEFAULT_INSTALL_DIR = "/opt/agentrunner";
const DEFAULT_REPO_URL = "https://github.com/ln2338879-oss/agentrunner.git";
const WORKER_ROLES = ["director", "builder", "factory"] as const;

export function parseSetupArgs(argv: string[]): SetupCliOptions {
  let mode: SetupMode = "check";
  let apply = false;
  let interactive = true;
  let yes = false;
  let reportPath = DEFAULT_REPORT_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") mode = "check";
    else if (arg === "--local") mode = "local";
    else if (arg === "--ubuntu") mode = "ubuntu";
    else if (arg === "--systemd") mode = "systemd";
    else if (arg === "--vps") mode = "vps";
    else if (arg === "--apply") apply = true;
    else if (arg === "--yes" || arg === "-y") yes = true;
    else if (arg === "--non-interactive") interactive = false;
    else if (arg === "--report" && argv[index + 1]) {
      reportPath = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--report=")) {
      reportPath = arg.slice("--report=".length);
    }
  }

  if (yes) interactive = false;
  return { mode, apply, interactive, yes, reportPath };
}

export function buildDiscordChecklist(env: NodeJS.ProcessEnv): DiscordChecklistItem[] {
  return [
    {
      name: "Director bot token",
      configured: Boolean(env.DIRECTOR_DISCORD_TOKEN),
      detail: env.DIRECTOR_DISCORD_TOKEN ? "DIRECTOR_DISCORD_TOKEN is set." : "Set DIRECTOR_DISCORD_TOKEN in .env.",
    },
    {
      name: "Director channel",
      configured: Boolean(env.GAME_DIRECTOR_CHANNEL_ID),
      detail: env.GAME_DIRECTOR_CHANNEL_ID ? "GAME_DIRECTOR_CHANNEL_ID is set." : "Set GAME_DIRECTOR_CHANNEL_ID in .env.",
    },
    {
      name: "Builder bot token",
      configured: Boolean(env.BUILDER_DISCORD_TOKEN),
      detail: env.BUILDER_DISCORD_TOKEN ? "BUILDER_DISCORD_TOKEN is set." : "Optional: set BUILDER_DISCORD_TOKEN for the Builder bot.",
    },
    {
      name: "Factory bot token",
      configured: Boolean(env.FACTORY_DISCORD_TOKEN),
      detail: env.FACTORY_DISCORD_TOKEN ? "FACTORY_DISCORD_TOKEN is set." : "Optional: set FACTORY_DISCORD_TOKEN for the Factory bot.",
    },
    {
      name: "Worker/log channels",
      configured: Boolean(env.DEV_TASKS_CHANNEL_ID || env.CONTENT_FACTORY_CHANNEL_ID || env.REVIEW_LOG_CHANNEL_ID || env.BUILD_LOG_CHANNEL_ID),
      detail:
        env.DEV_TASKS_CHANNEL_ID || env.CONTENT_FACTORY_CHANNEL_ID || env.REVIEW_LOG_CHANNEL_ID || env.BUILD_LOG_CHANNEL_ID
          ? "At least one worker/log channel is configured."
          : "Optional: set DEV_TASKS_CHANNEL_ID, CONTENT_FACTORY_CHANNEL_ID, REVIEW_LOG_CHANNEL_ID, and BUILD_LOG_CHANNEL_ID.",
    },
    {
      name: "Slash command app",
      configured: Boolean(env.DISCORD_CLIENT_ID),
      detail: env.DISCORD_CLIENT_ID ? "DISCORD_CLIENT_ID is set." : "Optional: set DISCORD_CLIENT_ID to register slash commands.",
    },
  ];
}

export function formatSetupReport(input: {
  generatedAt: Date;
  options: SetupCliOptions;
  platform: PlatformInfo;
  actions: SetupAction[];
  doctorResults: CheckResult[];
  proofResult?: ShellCommandResult;
  serviceStatuses: ServiceStatus[];
  discordChecklist: DiscordChecklistItem[];
}): string {
  const result = input.actions.some((action) => action.status === "FAIL") || !doctorPassed(input.doctorResults) ? "FAIL" : "PASS";
  const proofStatus = input.proofResult ? (input.proofResult.ok ? "PASS" : "FAIL") : "SKIP";

  return [
    "# AgentRunner Setup Report",
    "",
    `Generated at: ${input.generatedAt.toISOString()}`,
    `Mode: ${input.options.mode}`,
    `Apply changes: ${input.options.apply ? "yes" : "no"}`,
    `Result: ${result}`,
    "",
    "## Platform",
    "",
    `- Platform: ${input.platform.platform}`,
    `- Arch: ${input.platform.arch}`,
    `- Release: ${input.platform.release}`,
    `- Linux: ${input.platform.isLinux}`,
    `- WSL: ${input.platform.isWsl}`,
    `- systemd detected: ${input.platform.hasSystemd}`,
    "",
    "## Setup Actions",
    "",
    "| Action | Status | Detail |",
    "|---|---|---|",
    ...input.actions.map((action) => `| ${escapeTable(action.name)} | ${action.status} | ${escapeTable(action.detail)} |`),
    "",
    "## Doctor Checks",
    "",
    formatDoctorMarkdown(input.doctorResults),
    "",
    "## Runtime Proof",
    "",
    `- Status: ${proofStatus}`,
    input.proofResult ? `- Exit code: ${input.proofResult.exitCode ?? "none"}` : "- Exit code: not run",
    input.proofResult?.stdout ? `- Output: ${escapeInline(input.proofResult.stdout.trim()).slice(0, 500)}` : "- Output: none",
    input.proofResult?.stderr ? `- Error: ${escapeInline(input.proofResult.stderr.trim()).slice(0, 500)}` : "- Error: none",
    "",
    "## systemd Service Status",
    "",
    input.serviceStatuses.length > 0
      ? [
          "| Service | Active | Detail |",
          "|---|---|---|",
          ...input.serviceStatuses.map((status) => `| ${escapeTable(status.service)} | ${status.active ? "yes" : "no"} | ${escapeTable(status.detail)} |`),
        ].join("\n")
      : "systemd status was not checked.",
    "",
    "## Discord Bot Token / Channel Checklist",
    "",
    "| Item | Configured | Detail |",
    "|---|---|---|",
    ...input.discordChecklist.map((item) => `| ${escapeTable(item.name)} | ${item.configured ? "yes" : "no"} | ${escapeTable(item.detail)} |`),
    "",
    "## VPS First-Run Guide",
    "",
    "1. Copy `.env.example` to `.env` if it does not exist.",
    "2. Fill in Discord bot tokens and channel IDs. Do not commit `.env`.",
    "3. Run `bun run setup:check` and fix failed checks.",
    "4. Run `bun run setup:local` for a local proof-only setup.",
    "5. On Ubuntu VPS, run `bun run setup:ubuntu -- --apply` only after reviewing the planned commands.",
    "6. For systemd, run `bun run setup:systemd -- --apply` after `.env` is complete.",
    "7. Start the runtime with `bun run start` or `sudo systemctl start agentrunner`.",
    "8. In Discord, send `/run prompt: 테스트용 포션 아이템 5개를 JSON으로 만들고 Director가 리뷰해줘`.",
    "9. Confirm the Discord reply and Obsidian Vault outputs under `01_Tasks`, `04_Reviews`, and `07_Approved`.",
    "",
    "## Safe Re-run Commands",
    "",
    "```bash",
    "bun run setup:check",
    "bun run setup:local",
    "bun run setup:ubuntu",
    "bun run setup:systemd",
    "bun run proof",
    "bun run doctor",
    "```",
    "",
  ].join("\n");
}

export async function runSetup(options: SetupCliOptions): Promise<{ actions: SetupAction[]; reportPath: string }> {
  const platform = await detectPlatform();
  const actions: SetupAction[] = [];
  const env = await loadDotenvIntoProcessEnv(".env");
  const config = loadConfig(env);

  const doctorResults = await runDoctor({
    env,
    requireCredentials: options.mode === "systemd" || (options.mode === "ubuntu" && options.apply),
    includeExternalChecks: options.mode !== "local" && options.mode !== "check",
  });

  actions.push({
    name: "doctor",
    status: doctorPassed(doctorResults) ? "PASS" : "FAIL",
    detail: options.mode === "local" || options.mode === "check" || options.mode === "vps" ? "Doctor was run with setup-safe defaults." : "Doctor was run with deployment checks.",
  });

  if (options.mode === "local") {
    actions.push(...(await applyLocalSetup(options, config)));
  } else if (options.mode === "ubuntu") {
    actions.push(...(await applyUbuntuSetup(options)));
  } else if (options.mode === "systemd") {
    actions.push(...(await applySystemdSetup(options, platform)));
  } else if (options.mode === "vps") {
    actions.push(...(await applyVpsWizard(options, env)));
  } else {
    actions.push({ name: "setup check", status: "PASS", detail: "No filesystem or service changes requested." });
  }

  const proofResult = options.mode === "local" || options.mode === "ubuntu" || options.mode === "vps" ? await runProofCommand(actions) : undefined;
  const serviceStatuses = options.mode === "systemd" || options.mode === "ubuntu" || options.mode === "vps" ? await checkServiceStatuses(platform) : [];
  const discordChecklist = buildDiscordChecklist(env);

  const report = formatSetupReport({
    generatedAt: new Date(),
    options,
    platform,
    actions,
    doctorResults,
    proofResult,
    serviceStatuses,
    discordChecklist,
  });

  await writeFileWithDirectory(options.reportPath, report);
  actions.push({ name: "setup report", status: "PASS", detail: `Wrote ${options.reportPath}.` });

  return { actions, reportPath: options.reportPath };
}

async function applyLocalSetup(options: SetupCliOptions, config: ReturnType<typeof loadConfig>): Promise<SetupAction[]> {
  const actions: SetupAction[] = [];
  await ensureEnvExampleCopied(actions, options);
  await ensureDirectory(path.dirname(config.DATABASE_PATH), actions, options, "Database directory");
  await ensureDirectory(config.OBSIDIAN_VAULT_PATH, actions, options, "Obsidian Vault");
  await ensureDirectory(config.PROJECT_ROOT, actions, options, "Project Root");
  await ensureDirectory(config.ATTACHMENTS_DIR, actions, options, "Attachments directory");
  await ensureDirectory("docs/proof", actions, options, "Proof directory");
  return actions;
}

async function applyUbuntuSetup(options: SetupCliOptions): Promise<SetupAction[]> {
  const actions: SetupAction[] = [];
  const commands = [
    "sudo apt-get update",
    "sudo apt-get install -y git curl unzip",
    "curl -fsSL https://bun.sh/install | bash",
    `sudo mkdir -p ${DEFAULT_INSTALL_DIR}`,
    `sudo chown -R "$USER":"$USER" ${DEFAULT_INSTALL_DIR}`,
    `git clone ${DEFAULT_REPO_URL} ${DEFAULT_INSTALL_DIR} || true`,
    `cd ${DEFAULT_INSTALL_DIR} && git pull --ff-only || true`,
    `cd ${DEFAULT_INSTALL_DIR} && bun install`,
  ];

  for (const command of commands) {
    if (options.apply) {
      const shouldRun = options.yes || (await confirm(`Run: ${command}?`, options.interactive, false));
      if (!shouldRun) {
        actions.push({ name: command, status: "SKIP", detail: "Skipped by prompt." });
        continue;
      }
      const result = await runShellCommand({ command, timeoutMs: 600000 });
      actions.push({ name: command, status: result.ok ? "PASS" : "FAIL", detail: summarizeCommandResult(result) });
    } else {
      actions.push({ name: command, status: "PLAN", detail: "Run with --apply to execute." });
    }
  }

  return actions;
}

async function applySystemdSetup(options: SetupCliOptions, platform: PlatformInfo): Promise<SetupAction[]> {
  const actions: SetupAction[] = [];
  if (!platform.isLinux) {
    actions.push({ name: "systemd platform", status: "SKIP", detail: "systemd setup is only supported on Linux." });
    return actions;
  }

  if (!platform.hasSystemd) {
    actions.push({ name: "systemd availability", status: "FAIL", detail: "systemctl was not found." });
    return actions;
  }

  const commands = [
    "sudo cp deploy/systemd/agentrunner.service /etc/systemd/system/agentrunner.service",
    "sudo cp deploy/systemd/agentrunner-worker@.service /etc/systemd/system/agentrunner-worker@.service",
    "sudo systemctl daemon-reload",
    "sudo systemctl enable agentrunner",
    "sudo systemctl enable agentrunner-worker@director agentrunner-worker@builder agentrunner-worker@factory",
    "sudo systemctl restart agentrunner",
    "sudo systemctl restart agentrunner-worker@director agentrunner-worker@builder agentrunner-worker@factory",
  ];

  for (const command of commands) {
    if (!options.apply) {
      actions.push({ name: command, status: "PLAN", detail: "Run with --apply to execute." });
      continue;
    }

    const shouldRun = options.yes || (await confirm(`Run: ${command}?`, options.interactive, false));
    if (!shouldRun) {
      actions.push({ name: command, status: "SKIP", detail: "Skipped by prompt." });
      continue;
    }

    const result = await runShellCommand({ command, timeoutMs: 120000 });
    actions.push({ name: command, status: result.ok ? "PASS" : "FAIL", detail: summarizeCommandResult(result) });
  }

  return actions;
}

async function applyVpsWizard(options: SetupCliOptions, env: NodeJS.ProcessEnv): Promise<SetupAction[]> {
  const actions: SetupAction[] = [];
  actions.push({ name: "VPS install directory", status: "PLAN", detail: process.env.AGENTRUNNER_INSTALL_DIR || DEFAULT_INSTALL_DIR });
  actions.push({ name: "Repository URL", status: "PLAN", detail: process.env.AGENTRUNNER_REPO_URL || DEFAULT_REPO_URL });

  const missingRequired = buildDiscordChecklist(env).filter((item) => !item.configured && (item.name === "Director bot token" || item.name === "Director channel"));
  if (missingRequired.length > 0) {
    actions.push({
      name: "Discord minimum config",
      status: "FAIL",
      detail: `Missing: ${missingRequired.map((item) => item.name).join(", ")}.`,
    });
  } else {
    actions.push({ name: "Discord minimum config", status: "PASS", detail: "Required Director token and channel are configured." });
  }

  if (options.apply) {
    actions.push(...(await applyLocalSetup(options, loadConfig(env))));
  } else {
    actions.push({ name: "VPS wizard apply", status: "PLAN", detail: "Run with --apply after .env is ready to create local paths and proof artifacts." });
  }

  return actions;
}

async function runProofCommand(actions: SetupAction[]): Promise<ShellCommandResult> {
  const result = await runShellCommand({ command: "bun run proof", timeoutMs: 300000 });
  actions.push({ name: "runtime proof", status: result.ok ? "PASS" : "FAIL", detail: summarizeCommandResult(result) });
  return result;
}

async function checkServiceStatuses(platform: PlatformInfo): Promise<ServiceStatus[]> {
  if (!platform.hasSystemd) return [];
  const services = ["agentrunner", ...WORKER_ROLES.map((role) => `agentrunner-worker@${role}`)];

  const statuses: ServiceStatus[] = [];
  for (const service of services) {
    const result = await runShellCommand({ command: `systemctl is-active ${service}`, timeoutMs: 10000 });
    statuses.push({
      service,
      active: result.ok && result.stdout.trim() === "active",
      detail: result.ok ? result.stdout.trim() : result.stderr.trim() || result.stdout.trim() || "inactive",
    });
  }

  return statuses;
}

async function ensureEnvExampleCopied(actions: SetupAction[], options: SetupCliOptions): Promise<void> {
  if (existsSync(".env")) {
    actions.push({ name: ".env file", status: "PASS", detail: ".env already exists." });
    return;
  }

  if (!existsSync(".env.example")) {
    actions.push({ name: ".env file", status: "FAIL", detail: ".env.example is missing." });
    return;
  }

  if (!options.apply && options.mode !== "local") {
    actions.push({ name: ".env file", status: "PLAN", detail: "Copy .env.example to .env with --apply." });
    return;
  }

  await copyFile(".env.example", ".env");
  actions.push({ name: ".env file", status: "PASS", detail: "Created .env from .env.example." });
}

async function ensureDirectory(directory: string, actions: SetupAction[], options: SetupCliOptions, name: string): Promise<void> {
  if (!options.apply && options.mode !== "local") {
    actions.push({ name, status: "PLAN", detail: `Create ${directory} with --apply.` });
    return;
  }

  await mkdir(directory, { recursive: true });
  await access(directory, constants.W_OK);
  actions.push({ name, status: "PASS", detail: `${directory} exists and is writable.` });
}

async function writeFileWithDirectory(filePath: string, content: string): Promise<void> {
  const directory = path.dirname(filePath);
  if (directory !== ".") await mkdir(directory, { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

async function loadDotenvIntoProcessEnv(dotenvPath: string): Promise<NodeJS.ProcessEnv> {
  const env = { ...process.env };
  if (!existsSync(dotenvPath)) return env;

  const text = await readFile(dotenvPath, "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (!key) continue;
    const rawValue = valueParts.join("=");
    env[key] = rawValue.replace(/^["']|["']$/g, "");
  }

  return env;
}

async function confirm(question: string, interactive: boolean, defaultValue: boolean): Promise<boolean> {
  if (!interactive || !process.stdin.isTTY) return defaultValue;
  process.stdout.write(`${question} ${defaultValue ? "[Y/n]" : "[y/N]"} `);
  const answer = await readStdinLine();
  if (!answer.trim()) return defaultValue;
  return ["y", "yes"].includes(answer.trim().toLowerCase());
}

async function readStdinLine(): Promise<string> {
  const reader = process.stdin;
  reader.setEncoding("utf-8");
  reader.resume();

  return await new Promise((resolve) => {
    const onData = (chunk: string) => {
      reader.pause();
      reader.off("data", onData);
      resolve(chunk);
    };
    reader.on("data", onData);
  });
}

function summarizeCommandResult(result: ShellCommandResult): string {
  if (result.timedOut) return "Command timed out.";
  if (result.ok) return result.stdout.trim() || "Command completed successfully.";
  return result.stderr.trim() || result.stdout.trim() || `Command failed with exit code ${result.exitCode ?? "unknown"}.`;
}

function escapeTable(value: string): string {
  return escapeInline(value).replaceAll("|", "\\|");
}

function escapeInline(value: string): string {
  return value.replaceAll("\n", " ").replace(/\s+/g, " ").trim();
}

async function main(): Promise<void> {
  const options = parseSetupArgs(process.argv.slice(2));
  const { actions, reportPath } = await runSetup(options);

  console.log("AgentRunner setup");
  console.log("=================");
  for (const action of actions) {
    console.log(`${action.status} ${action.name}: ${action.detail}`);
  }
  console.log("");
  console.log(`Setup report written to ${reportPath}.`);

  if (actions.some((action) => action.status === "FAIL")) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
