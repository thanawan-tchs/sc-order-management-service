import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { migrate } from "../src/infrastructure/db/migrate";

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

  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  await migrate();
}

export async function teardown(): Promise<void> {
  await pg?.stop();
}
