import { z } from "zod";

export const PolicyActionSchema = z.enum([
  "code_changes",
  "content_generation",
  "image_generation",
  "write_files",
  "run_shell_command",
  "run_tests",
  "run_build",
  "approved_task_command",
  "systemd_restart",
  "network_access",
]);

export const RuntimePolicySchema = z.object({
  allowCodeChanges: z.boolean().default(true),
  allowContentGeneration: z.boolean().default(true),
  allowImageGeneration: z.boolean().default(true),
  requireDirectorReview: z.boolean().default(true),
  allowFileWrites: z.boolean().default(true),
  allowShellCommands: z.boolean().default(true),
  allowTests: z.boolean().default(true),
  allowBuilds: z.boolean().default(true),
  allowApprovedTaskCommand: z.boolean().default(true),
  allowSystemdRestart: z.boolean().default(false),
  allowNetworkAccess: z.boolean().default(false),
  requireHumanApprovalFor: z.array(PolicyActionSchema).default([]),
});

export type PolicyAction = z.infer<typeof PolicyActionSchema>;
export type RuntimePolicy = z.infer<typeof RuntimePolicySchema>;
export type PolicyDecisionStatus = "allowed" | "denied" | "needs_human";

export const DefaultRuntimePolicy: RuntimePolicy = {
  allowCodeChanges: true,
  allowContentGeneration: true,
  allowImageGeneration: true,
  requireDirectorReview: true,
  allowFileWrites: true,
  allowShellCommands: true,
  allowTests: true,
  allowBuilds: true,
  allowApprovedTaskCommand: true,
  allowSystemdRestart: false,
  allowNetworkAccess: false,
  requireHumanApprovalFor: [],
};

export interface PolicyDecision {
  status: PolicyDecisionStatus;
  action: PolicyAction;
  reason: string;
}
