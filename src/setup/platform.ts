import { existsSync } from "node:fs";
import os from "node:os";
import { runShellCommand } from "../utils/command";

export interface PlatformInfo {
  platform: NodeJS.Platform;
  arch: string;
  release: string;
  isWindows: boolean;
  isMacOS: boolean;
  isLinux: boolean;
  isWsl: boolean;
  hasSystemd: boolean;
}

export async function detectPlatform(): Promise<PlatformInfo> {
  const platform = process.platform;
  const isLinux = platform === "linux";
  const isWsl = isLinux && (existsSync("/proc/sys/fs/binfmt_misc/WSLInterop") || os.release().toLowerCase().includes("microsoft"));
  const hasSystemd = isLinux && (await commandOk("command -v systemctl"));

  return {
    platform,
    arch: process.arch,
    release: os.release(),
    isWindows: platform === "win32",
    isMacOS: platform === "darwin",
    isLinux,
    isWsl,
    hasSystemd,
  };
}

async function commandOk(command: string): Promise<boolean> {
  const result = await runShellCommand({ command, timeoutMs: 5000 });
  return result.ok;
}
