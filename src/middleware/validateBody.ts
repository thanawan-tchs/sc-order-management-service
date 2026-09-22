import { Context, Next } from "koa";
import { ZodIssue, ZodSchema } from "zod";
import { ValidationError } from "../domain/errors";

function toValidationError(issues: ZodIssue[]): ValidationError {
  const [issue] = issues;
  const path = issue.path.join(".");

  if (path === "itemId") {
    return new ValidationError("INVALID_ITEM_ID", "itemId is required and must be a valid UUID.");
  }
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
  if (path === "name") {
    return new ValidationError("INVALID_ITEM_NAME", "name is required and must be a non-empty string.");
  }
  if (path === "priceCents") {
    return new ValidationError(
      "INVALID_PRICE_CENTS",
      "priceCents is required and must be a positive integer."
    );
  }
  if (path === "weightKg") {
    return new ValidationError("INVALID_WEIGHT_KG", "weightKg is required and must be a positive number.");
  }
  return new ValidationError("VALIDATION_ERROR", issue.message);
}

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
