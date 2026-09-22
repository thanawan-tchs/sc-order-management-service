import { Context, Next } from "koa";
import { AppError } from "../domain/errors";
import { logger } from "../observability/logger";

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
