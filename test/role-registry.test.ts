import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { createDefaultRoleRegistry, RoleRegistry } from "../src/roles/registry";

const tempDirs: string[] = [];

async function tempFile(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-roles-"));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  await writeFile(file, content, "utf-8");
  return file;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("RoleRegistry", () => {
  test("resolves default legacy aliases to generic roles", () => {
    const registry = createDefaultRoleRegistry();

    expect(registry.require("director").id).toBe("planner");
    expect(registry.require("builder").id).toBe("builder");
    expect(registry.require("factory").id).toBe("generator");
    expect(registry.require("arbiter").permissions.canArbitrate).toBe(true);
  });

  test("loads custom roles and aliases from YAML", async () => {
    const file = await tempFile(
      "roles.yaml",
      [
        "aliases:",
        "  writer: documenter",
        "roles:",
        "  - id: documenter",
        "    label: Documenter",
        "    provider: openai",
        "    model: gpt-4.1-mini",
        "    capabilities:",
        "      - research",
        "    permissions:",
        "      canWriteFiles: true",
        "      requiresReview: true",
      ].join("\n"),
    );

    const registry = await RoleRegistry.load({ path: file });

    expect(registry.require("writer").id).toBe("documenter");
    expect(registry.require("documenter").provider).toBe("openai");
    expect(registry.require("documenter").permissions.canWriteFiles).toBe(true);
  });
});
