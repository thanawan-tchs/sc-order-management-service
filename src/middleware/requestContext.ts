import { randomUUID } from "crypto";
import { Context, Next } from "koa";
import { logger } from "../observability/logger";
import { httpRequestDurationSeconds, httpRequestsTotal } from "../observability/metrics";

const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * `@koa/router` stamps the matched route *pattern* (e.g. "/v1/orders/:orderNumber", not the
 * literal path) onto the context at runtime, but doesn't type it — read it defensively, with the
 * literal path as a fallback so an unmatched request (a 404 for a route that doesn't exist at
 * all) still gets a label instead of `undefined`. Using the pattern, not the literal path, is
 * what keeps `route` a low-cardinality metrics label (one series per endpoint, not one per order
 * number).
 */
function getRoutePattern(ctx: Context): string {
  const withRouterPath = ctx as unknown as { routerPath?: string; _matchedRoute?: string };
  return withRouterPath.routerPath ?? withRouterPath._matchedRoute ?? ctx.path;
}

/**
 * Establishes per-request observability (ticket 17): a correlation/request ID (from the
 * `X-Request-Id` request header if the caller supplies one, so a request can be traced across
 * services; generated otherwise) available to the rest of the app as `ctx.state.requestId` and
 * echoed back on the response, plus a child logger at `ctx.state.log` that every log line for
 * this request should use instead of the bare `logger`, so every line carries the request ID
 * automatically.
 *
 * Must be registered BEFORE errorHandler (outside it in Koa's onion model) — errorHandler always
 * resolves `next()` normally (it never rethrows), so this middleware's `finally` block runs after
 * the final `ctx.status` is already decided, whether that was a success or a handled error.
 *
 * Logs exactly one structured line per request, on completion: requestId, operation
 * (`METHOD /route/pattern`), duration, status, and — when a controller set them —
 * `orderNumber` and the error `code`. Also records the two HTTP-level metrics
 * (`http_requests_total`, `http_request_duration_seconds`).
 */
export async function requestContext(ctx: Context, next: Next): Promise<void> {
  const requestId = ctx.get(REQUEST_ID_HEADER) || randomUUID();
  ctx.state.requestId = requestId;
  ctx.set(REQUEST_ID_HEADER, requestId);
  ctx.state.log = logger.child({ requestId });

  const start = process.hrtime.bigint();
  try {
    await next();
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = getRoutePattern(ctx);
    const status = String(ctx.status);

    httpRequestsTotal.inc({ method: ctx.method, route, status });
    httpRequestDurationSeconds.observe({ method: ctx.method, route, status }, durationSeconds);

    const errorCode = ctx.state.errorCode as string | undefined;
    const orderNumber = ctx.state.orderNumber as string | undefined;
    const level = ctx.status >= 500 ? "error" : "info";
    ctx.state.log[level](
      {
        operation: `${ctx.method} ${route}`,
        duration: Math.round(durationSeconds * 1000),
        status: ctx.status,
        ...(orderNumber ? { orderNumber } : {}),
        ...(errorCode ? { errorCode } : {}),
      },
      "request completed"
    );
  }
}
