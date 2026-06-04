import { describe, expect, test } from "bun:test";
import { evaluateQualityBudgets, parseUploadedArtifactNames } from "../scripts/check-code-quality";

describe("code quality budget checker", () => {
  test("passes when repository metrics are inside configured budgets", () => {
    const result = evaluateQualityBudgets(
      {
        maxRuntimeStoreLines: 500,
        maxTypeScriptFileLines: 700,
        minTestFiles: 40,
        requiredCiArtifacts: ["typecheck-log", "lint-log", "test-log", "build-log"],
        preCommitHooks: "deferred",
      },
      {
        runtimeStoreLines: 320,
        maxTypeScriptFileLines: 650,
        testFiles: 46,
        ciArtifacts: ["typecheck-log", "lint-log", "test-log", "build-log"],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  test("reports every budget breach", () => {
    const result = evaluateQualityBudgets(
      {
        maxRuntimeStoreLines: 500,
        maxTypeScriptFileLines: 700,
        minTestFiles: 40,
        requiredCiArtifacts: ["typecheck-log", "lint-log", "test-log", "build-log"],
        preCommitHooks: "deferred",
      },
      {
        runtimeStoreLines: 520,
        maxTypeScriptFileLines: 720,
        testFiles: 39,
        ciArtifacts: ["typecheck-log", "test-log"],
      },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("runtime-store.ts has 520 lines; budget is 500.");
    expect(result.failures).toContain("Largest TypeScript file has 720 lines; budget is 700.");
    expect(result.failures).toContain("Repository has 39 test files; budget minimum is 40.");
    expect(result.failures).toContain("CI is missing required artifact upload: lint-log.");
    expect(result.failures).toContain("CI is missing required artifact upload: build-log.");
  });

  test("parses only upload-artifact names from workflow YAML", () => {
    const artifactNames = parseUploadedArtifactNames(`
name: AgentRunner Quality Gate
jobs:
  quality:
    steps:
      - name: lint-log
        run: echo "this step name must not count"
      - name: Upload lint diagnostics
        uses: actions/upload-artifact@v4
        with:
          name: lint-log
          path: lint.log
      - name: Upload build diagnostics
        uses: actions/upload-artifact@v4
        with:
          name: build-log
          path: build.log
`);

    expect(artifactNames).toEqual(["lint-log", "build-log"]);
  });
});
