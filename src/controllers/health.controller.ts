import { Context } from "koa";
import { checkReadiness } from "../application/readinessService";

export function getHealth(ctx: Context): void {
  ctx.status = 200;
  ctx.body = { status: "ok" };
}

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
