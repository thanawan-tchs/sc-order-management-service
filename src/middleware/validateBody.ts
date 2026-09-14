import { Context, Next } from "koa";
import { ZodSchema } from "zod";

/**
 * Generic request-body validation middleware. Parses `ctx.request.body` against `schema`; on
 * success, attaches the typed, validated value to `ctx.state.validated` for the downstream
 * handler to read. On failure, responds 400 with the validation issues and never calls `next()`.
 *
 * Every write endpoint (quote, submit, ...) mounts this in front of its handler, so validation
 * rules live in one schema instead of being duplicated across controllers (ticket 02 DoD).
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return async (ctx: Context, next: Next): Promise<void> => {
    const result = schema.safeParse(ctx.request.body);

    if (!result.success) {
      ctx.status = 400;
      ctx.body = {
        error: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      };
      return;
    }

    ctx.state.validated = result.data;
    await next();
  };
}
