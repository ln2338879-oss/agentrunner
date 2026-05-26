import type { RuntimeConfig } from "../config";
import type { RuntimeStore } from "../db/runtime-store";
import type { RuntimeNotifier } from "../discord/notifier";
import type { VaultManager } from "../obsidian/vault-manager";
import type { AgentAdapter, AgentRole } from "../runtime/types";
import { StepExecutor, type StepExecutorResult } from "./step-executor";

export interface StepSchedulerOptions {
  store: RuntimeStore;
  vault: VaultManager;
  config: RuntimeConfig;
  agents: AgentAdapter[];
  ownerPrefix?: string;
  roleOrder?: AgentRole[];
  maxStepsPerCycle?: number;
  notifier?: RuntimeNotifier;
}

export interface StepSchedulerCycleResult {
  processed: number;
  idle: boolean;
  results: StepExecutorResult[];
}

export class StepScheduler {
  private readonly agents = new Map<AgentRole, AgentAdapter>();
  private readonly ownerPrefix: string;
  private readonly roleOrder: AgentRole[];
  private readonly maxStepsPerCycle: number;

  constructor(private readonly options: StepSchedulerOptions) {
    for (const agent of options.agents) this.agents.set(agent.role, agent);
    this.ownerPrefix = options.ownerPrefix ?? `scheduler:${process.pid}`;
    this.roleOrder = options.roleOrder ?? ["director", "builder", "factory", "designer", "director"];
    this.maxStepsPerCycle = options.maxStepsPerCycle ?? 20;
  }

  async runCycle(): Promise<StepSchedulerCycleResult> {
    const results: StepExecutorResult[] = [];
    let processed = 0;

    while (processed < this.maxStepsPerCycle) {
      const result = await this.runOneSweep();
      if (!result) break;
      results.push(result);
      processed += 1;
    }

    return { processed, idle: processed === 0, results };
  }

  async runLoop(input: { once?: boolean; intervalMs?: number; onCycle?: (result: StepSchedulerCycleResult) => void | Promise<void> } = {}): Promise<void> {
    const intervalMs = input.intervalMs ?? this.options.config.WORKER_POLL_INTERVAL_MS;
    if (input.once) {
      const result = await this.runCycle();
      await input.onCycle?.(result);
      return;
    }
    for (;;) {
      const result = await this.runCycle();
      await input.onCycle?.(result);
      await sleep(result.idle ? intervalMs : 0);
    }
  }

  private async runOneSweep(): Promise<StepExecutorResult | null> {
    const seenRolesThisSweep = new Set<AgentRole>();
    for (const role of this.roleOrder) {
      const agent = this.agents.get(role);
      if (!agent) continue;
      const result = await new StepExecutor({
        role,
        owner: `${this.ownerPrefix}:${role}`,
        store: this.options.store,
        vault: this.options.vault,
        agent,
        config: this.options.config,
        notifier: this.options.notifier,
      }).runOnce();
      if (result.claimed) return result;
      seenRolesThisSweep.add(role);
    }
    return seenRolesThisSweep.size > 0 ? null : null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
