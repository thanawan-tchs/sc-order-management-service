process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://app:app@localhost:5433/orders_test";

process.env.LOG_LEVEL = "silent";
