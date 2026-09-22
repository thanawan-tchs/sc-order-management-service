import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const PORT = 54329;
const USER = "app";
const PASSWORD = "app";
const DATABASE = "orders_test";

let pg: EmbeddedPostgres | undefined;

export async function setup(): Promise<void> {
  if (process.env.TEST_DATABASE_URL) return;

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

export async function teardown(): Promise<void> {
  await pg?.stop();
}
