import { Context, Next } from "koa";
import { AppError } from "../domain/errors";
import { logger } from "../observability/logger";

/**
 * Centralized error handling (ticket 15) — the only place that turns a thrown error into an HTTP
 * response. Registered outside `requestContext` in app.ts (so `requestContext` can log/measure
 * the final status this middleware decides) but still wraps bodyParser/the router.
 *
 * Known `AppError`s map to their own status/code/message; the code is also stashed on
 * `ctx.state.errorCode` so `requestContext`'s completion log line includes it. Anything else is
 * logged in full server-side (via the request-scoped logger when available) but only ever
 * returns a generic 500 to the client — never a stack trace or a raw internal error message.
 */
export async function errorHandler(ctx: Context, next: Next): Promise<void> {
  try {
    await next();
  } catch (error) {
    if (error instanceof AppError) {
      ctx.state.errorCode = error.code;
      ctx.status = error.status;
      ctx.body = { error: { code: error.code, message: error.message } };
      return;
    }

    const log = (ctx.state.log as typeof logger | undefined) ?? logger;
    log.error({ err: error }, "unhandled error while processing request");
    ctx.state.errorCode = "INTERNAL_SERVER_ERROR";
    ctx.status = 500;
    ctx.body = {
      error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred." },
    };
  }
}
