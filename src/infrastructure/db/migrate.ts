import { MIGRATIONS } from "./migrations";
import { getPool } from "./pool";
import { withTransaction } from "./transaction";

const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export async function migrate(): Promise<void> {
  const pool = getPool();
  await pool.query(MIGRATIONS_TABLE_SQL);

  const { rows } = await pool.query<{ id: string }>("SELECT id FROM schema_migrations");
  const applied = new Set(rows.map((row) => row.id));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;

    await withTransaction(async (client) => {
      for (const statement of migration.statements) {
        await client.query(statement);
      }
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
    }, `migration:${migration.id}`);
  }
}
