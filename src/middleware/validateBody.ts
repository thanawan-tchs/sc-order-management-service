import { Context, Next } from "koa";
import { ZodIssue, ZodSchema } from "zod";
import exception, { ValidationError } from "@domain/errors";

const FIELD_OVERRIDES: Record<string, { code?: string; message?: string }> = {
  name: { code: "INVALID_ITEM_NAME" },
};

function toScreamingSnakeCase(field: string): string {
  return field.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

function toValidationError(issues: ZodIssue[]): ValidationError {
  const [issue] = issues;
  const field = issue.path.length > 0 ? String(issue.path[issue.path.length - 1]) : undefined;

  if (!field) {
    return new exception.ValidationError("VALIDATION_ERROR", issue.message);
  }

  const isMissing = issue.code === "invalid_type" && issue.received === "undefined";
  if (isMissing) {
    return new exception.ValidationError("VALIDATION_ERROR", `${field} is required`);
  }

  const override = FIELD_OVERRIDES[field];
  const code = override?.code ?? `INVALID_${toScreamingSnakeCase(field)}`;
  const message = override?.message ?? issue.message;
  return new exception.ValidationError(code, message);
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
