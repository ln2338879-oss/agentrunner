import { loadConfig } from "../config";
import { RuntimeStore } from "../db/runtime-store";
import { startDashboardServer } from "./server";

async function main(): Promise<void> {
  const config = loadConfig({ ...process.env, DASHBOARD_ENABLED: "true" });
  const store = await RuntimeStore.open(config.DATABASE_PATH);
  startDashboardServer({ config, store });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
