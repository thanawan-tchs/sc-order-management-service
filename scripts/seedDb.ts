import { migrate } from "../src/infrastructure/db/migrate";
import { closePrisma } from "../src/infrastructure/db/prismaClient";
import { seed } from "../src/infrastructure/db/seed";
import { logger } from "../src/observability/logger";

async function main(): Promise<void> {
  await migrate();
  const itemId = await seed();
  logger.info({ itemId }, "database seeded");
  await closePrisma();
}

main().catch((error) => {
  logger.error({ err: error }, "failed to seed database");
  process.exit(1);
});
