import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  test("loads defaults for optional runtime settings", () => {
    const config = loadConfig({});

    expect(config.DATABASE_PATH).toBe("./data/agentrunner.sqlite");
    expect(config.OBSIDIAN_VAULT_PATH).toBe("./vault/AgentRunnerVault");
    expect(config.PROJECT_ROOT).toBe("./game-project");
    expect(config.ATTACHMENTS_DIR).toBe("./data/attachments");
    expect(config.ENABLE_AGENT_FAILOVER).toBe(true);
    expect(config.AGENTRUNNER_WORKER_ROLE).toBeUndefined();
  });

  test("treats empty worker role as unset", () => {
    const config = loadConfig({ AGENTRUNNER_WORKER_ROLE: "" });
    expect(config.AGENTRUNNER_WORKER_ROLE).toBeUndefined();
  });

  test("parses worker role enum", () => {
    const config = loadConfig({ AGENTRUNNER_WORKER_ROLE: "builder" });
    expect(config.AGENTRUNNER_WORKER_ROLE).toBe("builder");
  });
});
