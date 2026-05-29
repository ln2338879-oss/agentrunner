import type { RuntimeConfig } from "../config";
import {
  captureReviewSafetySnapshot,
  compareReviewSafetySnapshots,
} from "../review/review-safety";
import type { AgentAdapter, AgentRole, AgentRunInput, AgentRunResult } from "../runtime/types";
import { prepareStepWorkspace, type PreparedStepWorkspace } from "./worktree-isolation";

export function withTaskWorkspaceIsolation(agent: AgentAdapter, config: RuntimeConfig): AgentAdapter {
  return {
    role: agent.role,
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const action = inferAction(input.role, input.prompt);
      const workspace = await prepareStepWorkspace({
        taskId: input.taskId,
        role: input.role,
        action,
        config: input.runtimeConfig ?? config,
      });
      const prompt = appendWorkspaceContext(input.prompt, workspace);
      const before = shouldCaptureReadOnly(input.role, action)
        ? await captureReviewSafetySnapshot(workspace.path)
        : undefined;
      const result = await agent.run({
        ...input,
        prompt,
        workspacePath: workspace.path,
        runtimeConfig: input.runtimeConfig ?? config,
      });
      if (!before) return result;

      const after = await captureReviewSafetySnapshot(workspace.path);
      const safety = compareReviewSafetySnapshots(before, after);
      if (safety.ok) return result;

      return {
        ok: false,
        output: [
          result.output || result.error || "Agent returned no output.",
          "",
          "## Runtime Isolation Failure",
          safety.violation,
        ].join("\n"),
        error: "Read-only agent changed its isolated workspace.",
        errorKind: "runtime_isolation_violation",
      };
    },
  };
}

function inferAction(role: AgentRole, prompt: string): string {
  if (role === "director") {
    if (prompt.includes("Planning Step")) return "plan";
    if (prompt.includes("Arbitration Step")) return "arbitrate";
    return "review";
  }
  if (role === "builder") return "implement";
  if (role === "factory") return "generate";
  return "design";
}

function shouldCaptureReadOnly(role: AgentRole, action: string): boolean {
  return role === "director" && action !== "plan";
}

function appendWorkspaceContext(prompt: string, workspace: PreparedStepWorkspace): string {
  return [
    prompt,
    "",
    "## Runtime Workspace",
    `workspace_path: ${workspace.path}`,
    `workspace_mode: ${workspace.mode}`,
    `workspace_isolated: ${workspace.isolated}`,
    workspace.reason ? `workspace_note: ${workspace.reason}` : undefined,
  ].filter(Boolean).join("\n");
}
