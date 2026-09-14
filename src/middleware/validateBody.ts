import { Context, Next } from "koa";
import { ZodIssue, ZodSchema } from "zod";
import { ValidationError } from "../domain/errors";

/**
 * Maps a zod issue to one of ticket 15's field-specific error codes, with a generic fallback for
 * anything that isn't quantity/latitude/longitude (e.g. a missing shippingAddress object
 * entirely). Only the *first* issue becomes the response — the error contract (ticket 15) is one
 * `{ code, message }` pair, not a list, so multiple simultaneous problems report the first one a
 * client would need to fix (schema declaration order: quantity, then latitude, then longitude).
 */
function toValidationError(issues: ZodIssue[]): ValidationError {
  const [issue] = issues;
  const path = issue.path.join(".");

  if (path === "quantity") {
    return new ValidationError("INVALID_QUANTITY", "Quantity is required and must be a positive integer.");
  }
  if (path === "shippingAddress.latitude") {
    return new ValidationError(
      "INVALID_LATITUDE",
      "Latitude is required and must be between -90 and 90."
    );
  }
  if (path === "shippingAddress.longitude") {
    return new ValidationError(
      "INVALID_LONGITUDE",
      "Longitude is required and must be between -180 and 180."
    );
  }
  return new ValidationError("VALIDATION_ERROR", issue.message);
}

/**
 * Generic request-body validation middleware. Parses `ctx.request.body` against `schema`; on
 * success, attaches the typed, validated value to `ctx.state.validated` for the downstream
 * handler to read. On failure, throws a `ValidationError` — caught by the central error handler
 * (ticket 15), never sets `ctx.status`/`ctx.body` itself.
 *
 * Every write endpoint (quote, submit, ...) mounts this in front of its handler, so validation
 * rules live in one schema instead of being duplicated across controllers (ticket 02 DoD).
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return async (ctx: Context, next: Next): Promise<void> => {
    const result = schema.safeParse(ctx.request.body);

    if (!result.success) {
      throw toValidationError(result.error.issues);
    }

    ctx.state.validated = result.data;
    await next();
  };
}
