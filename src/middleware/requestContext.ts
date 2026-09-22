import { randomUUID } from "crypto";
import { Context, Next } from "koa";
import { logger } from "../observability/logger";

const REQUEST_ID_HEADER = "X-Request-Id";

function getRoutePattern(ctx: Context): string {
  const withRouterPath = ctx as unknown as { routerPath?: string; _matchedRoute?: string };
  return withRouterPath.routerPath ?? withRouterPath._matchedRoute ?? ctx.path;
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
