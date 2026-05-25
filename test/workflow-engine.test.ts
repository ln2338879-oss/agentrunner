import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { RoleRegistry } from "../src/roles/registry";
import { createDefaultWorkflowRegistry, WorkflowRegistry } from "../src/workflows/engine";

const tempDirs: string[] = [];

async function tempFile(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-workflows-"));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  await writeFile(file, content, "utf-8");
  return file;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("WorkflowRegistry", () => {
  test("selects default workflows by task type and resolves role aliases", () => {
    const registry = createDefaultWorkflowRegistry();

    const implementationPlan = registry.plan(undefined, "implementation");
    expect(implementationPlan.workflowId).toBe("plan-build-review");
    expect(implementationPlan.steps.map((step) => step.resolvedRoleId)).toEqual(["planner", "builder", "reviewer", "arbiter"]);

    const contentPlan = registry.plan(undefined, "content");
    expect(contentPlan.workflowId).toBe("plan-generate-review");
    expect(contentPlan.steps.find((step) => step.id === "generate")?.resolvedRoleId).toBe("generator");
  });

  test("reports unknown roles and dependencies", () => {
    const registry = new WorkflowRegistry([
      {
        id: "bad-workflow",
        steps: [
          {
            id: "first",
            role: "missing-role",
            action: "plan",
            dependsOn: ["missing-step"],
            required: true,
            continueOnFailure: false,
          },
        ],
        defaultForTaskTypes: [],
      },
    ]);

    const issues = registry.validate("bad-workflow");
    expect(issues.map((issue) => issue.message)).toContain("Unknown role: missing-role.");
    expect(issues.map((issue) => issue.message)).toContain("Unknown dependency: missing-step.");
  });

  test("loads custom workflow YAML and uses custom default workflow", async () => {
    const roleRegistry = new RoleRegistry();
    const file = await tempFile(
      "workflows.yaml",
      [
        "defaultWorkflow: custom-review",
        "workflows:",
        "  - id: custom-review",
        "    label: Custom Review",
        "    steps:",
        "      - id: plan",
        "        role: director",
        "        action: plan",
        "      - id: review",
        "        role: reviewer",
        "        action: review",
        "        dependsOn:",
        "          - plan",
      ].join("\n"),
    );

    const registry = await WorkflowRegistry.load({ path: file, roleRegistry });
    const plan = registry.plan();

    expect(plan.workflowId).toBe("custom-review");
    expect(plan.steps[0]?.resolvedRoleId).toBe("planner");
    expect(plan.steps[1]?.resolvedRoleId).toBe("reviewer");
  });
});
