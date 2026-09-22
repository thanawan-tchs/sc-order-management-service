import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function migrate(): Promise<void> {
  await execFileAsync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, CHECKPOINT_DISABLE: "1" },
  });
}
