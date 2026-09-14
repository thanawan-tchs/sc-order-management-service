import { Context, Next } from "koa";
import { AppError } from "../domain/errors";

/**
 * Centralized error handling (ticket 15). Every error — thrown by a controller, an application
 * service, a repository, or `validateBody` — flows up to exactly this one place, which is the
 * only code in the app that decides an HTTP status/body for a failure. Nothing downstream (no
 * controller) should catch an error just to shape a response; they either succeed or throw.
 *
 * Must be the FIRST middleware registered in app.ts, so Koa's onion model wraps every other
 * middleware (bodyParser, the router, every handler) inside this one's try/catch.
 *
 * - A known `AppError` -> its own `status`/`code`/`message`, verbatim.
 * - Anything else (a bug, a database outage, whatever) -> logged in full server-side (message,
 *   stack, the works) so it's diagnosable, but the client only ever sees a generic 500 with no
 *   internal detail — never a stack trace or a raw database error message.
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

    // eslint-disable-next-line no-console -- the one sanctioned place in the app to log a raw,
    // unclassified error; every other layer either handles its own errors or lets them bubble
    // here.
    console.error("Unhandled error while processing request:", error);
    ctx.status = 500;
    ctx.body = {
      error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred." },
    };
  }
}
