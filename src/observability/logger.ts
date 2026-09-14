import pino from "pino";
import { config } from "../config";

/**
 * Structured JSON logging (ticket 17) — one logger for the whole process. Every line is a JSON
 * object (pino's default), safe for a log aggregator to parse rather than a free-text message.
 *
 * `redact` is defense-in-depth, not a response to a known leak today: this service has no
 * secrets in its domain data (no auth, no PII, no payment details) — the one real secret is
 * `config.databaseUrl` (embeds a password), which nothing currently logs, and these paths make
 * sure that stays true if something ever does log the config object wholesale.
 *
 * Request-scoped fields (requestId, operation, duration, orderNumber, error code) are added via
 * a child logger per request — see middleware/requestContext.ts — not here.
 */
export const logger = pino({
  level: config.logLevel,
  base: { service: "order-management-service" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: ["databaseUrl", "config.databaseUrl", "*.password"],
});
