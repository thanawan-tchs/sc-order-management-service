import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PRISMA_CLI_PATH = require.resolve("prisma/build/index.js");

export async function migrate(signal?: AbortSignal): Promise<void> {
  await execFileAsync(process.execPath, [PRISMA_CLI_PATH, "migrate", "deploy"], {
    env: { ...process.env, CHECKPOINT_DISABLE: "1" },
    signal,
  });
}
