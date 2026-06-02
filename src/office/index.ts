import { loadConfig } from "../config";
import { RuntimeStore } from "../db/runtime-store";
import { startOfficeServer } from "./server";

async function main(): Promise<void> {
  const config = loadConfig({ ...process.env, OFFICE_ENABLED: "true" });
  const store = await RuntimeStore.open(config.DATABASE_PATH);

  startOfficeServer({
    store,
    host: config.OFFICE_HOST,
    port: config.OFFICE_PORT,
    accessCode: config.OFFICE_ACCESS_CODE,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
