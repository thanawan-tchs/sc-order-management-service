import { Context } from "koa";
import { checkReadiness } from "../application/readinessService";

/**
 * Liveness check. Deliberately trivial — no business logic belongs in a route handler,
 * only request/response wiring (see ticket 01 acceptance criteria).
 */
export function getHealth(ctx: Context): void {
  ctx.status = 200;
  ctx.body = { status: "ok" };
}

/**
 * Readiness check (ticket 17) — distinct from /health: the process can be alive but not yet able
 * to serve traffic (e.g. the database is unreachable). `200` when ready, `503` when not, so a
 * load balancer/orchestrator can stop routing traffic here without killing the process.
 */
export async function getReadiness(ctx: Context): Promise<void> {
  const result = await checkReadiness();

  if (result.ready) {
    ctx.status = 200;
    ctx.body = { status: "ready" };
    return;
  }

  ctx.status = 503;
  ctx.body = { status: "not ready", reason: result.reason };
}
