import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

const execFileAsync = promisify(execFile);

const PORT = 54329;
const USER = "app";
const PASSWORD = "app";
const DATABASE = "orders_test";

let pg: EmbeddedPostgres | undefined;

export async function setup(): Promise<void> {
  if (!process.env.TEST_DATABASE_URL) {
    pg = new EmbeddedPostgres({
      databaseDir: path.join(os.tmpdir(), `order-management-system-test-db-${process.pid}`),
      user: USER,
      password: PASSWORD,
      port: PORT,
      persistent: false,
      onLog: () => undefined,
    });

    await pg.initialise();
    await pg.start();
    await pg.createDatabase(DATABASE);

    process.env.TEST_DATABASE_URL = `postgres://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}`;
  }

  await execFileAsync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
}

export async function teardown(): Promise<void> {
  await pg?.stop();
}
