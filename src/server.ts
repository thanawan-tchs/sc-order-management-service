import { createApp } from "./app";
import { config } from "./config";
import { migrate } from "./infrastructure/db/migrate";
import { seed } from "./infrastructure/db/seed";

async function main(): Promise<void> {
  await migrate();
  await seed();

  const app = createApp();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`order-management-service listening on port ${config.port}`);
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start order-management-service:", error);
  process.exit(1);
});
