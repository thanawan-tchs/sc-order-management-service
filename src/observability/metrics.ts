import client from "prom-client";

/**
 * In-process Prometheus metrics (ticket 17, "Metrics" — all recommended, not mandated, but cheap
 * enough to have for real once the counters/histograms exist). Exposed at GET /metrics in
 * Prometheus text exposition format; a real deployment points a Prometheus scraper at it.
 *
 * Everything registers to prom-client's default registry — this is a single-process service with
 * one metrics endpoint, so there's no need for a second, separate registry.
 */
export const registry = client.register;

client.collectDefaultMetrics({ register: registry });

/** Every HTTP request, labeled by method/route/status — the raw counter Prometheus's own `rate()`
 *  turns into "5xx rate" (a share of one label value over time), so this app doesn't compute a
 *  rate itself. `route` is the matched route pattern (e.g. "/v1/orders/:orderNumber"), not the
 *  literal path, so it doesn't explode into one label per distinct order number. */
export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests handled",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const quoteRequestsTotal = new client.Counter({
  name: "quote_requests_total",
  help: "Total POST /v1/orders/quote requests",
  registers: [registry],
});

export const submitRequestsTotal = new client.Counter({
  name: "submit_requests_total",
  help: "Total POST /v1/orders requests",
  registers: [registry],
});

export const ordersSuccessfulTotal = new client.Counter({
  name: "orders_successful_total",
  help: "Orders successfully submitted and persisted",
  registers: [registry],
});

/** `reason` is ticket 08's InvalidOrderReason (INSUFFICIENT_STOCK, SHIPPING_COST_EXCEEDS_15_PERCENT). */
export const ordersRejectedTotal = new client.Counter({
  name: "orders_rejected_total",
  help: "Orders rejected for a business-rule reason (422)",
  labelNames: ["reason"] as const,
  registers: [registry],
});

/** A concurrent submission losing a live race for the same stock (409), distinct from a durable
 *  business rejection above — see domain/errors.ts's InsufficientStockError doc comment. */
export const inventoryConflictsTotal = new client.Counter({
  name: "inventory_conflicts_total",
  help: "Order submissions that lost a live inventory race",
  registers: [registry],
});

/** Every submission's DB transaction outcome — commit vs. any rollback, whatever the cause
 *  (business rejection, inventory conflict, or a genuinely unexpected error). A general signal
 *  for "how often does the DB layer not commit," independent of the HTTP-level reason. */
export const transactionOutcomesTotal = new client.Counter({
  name: "transaction_outcomes_total",
  help: "Order submission transactions by outcome",
  labelNames: ["outcome"] as const, // "committed" | "rolled_back"
  registers: [registry],
});

export const databaseOperationDurationSeconds = new client.Histogram({
  name: "database_operation_duration_seconds",
  help: "Duration of a named database operation (e.g. a whole order-submission transaction)",
  labelNames: ["operation"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});
