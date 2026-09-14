import { Context } from "koa";

/**
 * Liveness check. Deliberately trivial — no business logic belongs in a route handler,
 * only request/response wiring (see ticket 01 acceptance criteria).
 */
export function getHealth(ctx: Context): void {
  ctx.status = 200;
  ctx.body = { status: "ok" };
}
