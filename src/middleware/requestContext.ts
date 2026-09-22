import { randomUUID } from "crypto";
import { Context, Next } from "koa";
import { logger } from "../observability/logger";

const REQUEST_ID_HEADER = "X-Request-Id";

function getRoutePattern(ctx: Context): string {
  const withRouterPath = ctx as unknown as { routerPath?: string; _matchedRoute?: string };
  return withRouterPath.routerPath ?? withRouterPath._matchedRoute ?? ctx.path;
}

function isEmptyObject(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0
  );
}

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

    const errorCode = ctx.state.errorCode as string | undefined;
    const orderNumber = ctx.state.orderNumber as string | undefined;
    const level = ctx.status >= 500 ? "error" : "info";
    const requestBody = ctx.request.body;
    const responseBody = ctx.body;
    ctx.state.log[level](
      {
        operation: `${ctx.method} ${route}`,
        duration: Math.round(durationSeconds * 1000),
        status: ctx.status,
        ip: ctx.ip,
        userAgent: ctx.get("User-Agent") || undefined,
        requestContentLength: ctx.request.length,
        responseContentLength: ctx.length,
        ...(isEmptyObject(requestBody) ? {} : { requestBody }),
        ...(responseBody === undefined ? {} : { responseBody }),
        ...(orderNumber ? { orderNumber } : {}),
        ...(errorCode ? { errorCode } : {}),
      },
      "request completed"
    );
  }
}
