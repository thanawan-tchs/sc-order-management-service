import { Context, Next } from "koa";
import { AppError } from "../domain/errors";

/**
 * Centralized error handling (ticket 15) — the only place that turns a thrown error into an HTTP
 * response. Must be the first middleware in app.ts so it wraps everything else.
 *
 * Known `AppError`s map to their own status/code/message. Anything else is logged in full
 * server-side but only ever returns a generic 500 to the client.
 */
export async function errorHandler(ctx: Context, next: Next): Promise<void> {
  try {
    await next();
  } catch (error) {
    if (error instanceof AppError) {
      ctx.status = error.status;
      ctx.body = { error: { code: error.code, message: error.message } };
      return;
    }

    // eslint-disable-next-line no-console -- the sanctioned place to log an unclassified error
    console.error("Unhandled error while processing request:", error);
    ctx.status = 500;
    ctx.body = {
      error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred." },
    };
  }
}
