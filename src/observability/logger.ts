import pino from "pino";
import { config } from "@config";

export const logger = pino({
  level: config.logLevel,
  base: { service: "order-management-service" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: ["databaseUrl", "config.databaseUrl", "*.password"],
});
