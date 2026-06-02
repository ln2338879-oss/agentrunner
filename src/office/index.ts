import { loadConfig } from "../config";
import { RuntimeStore } from "../db/runtime-store";
import { startOfficeServer } from "./server";

function readPort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const store = await RuntimeStore.open(config.DATABASE_PATH);

  startOfficeServer({
    store,
    host: process.env.OFFICE_HOST || config.DASHBOARD_HOST || "127.0.0.1",
    port: readPort(process.env.OFFICE_PORT, 3000),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
