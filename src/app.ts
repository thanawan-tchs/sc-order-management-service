import Koa from "koa";
import bodyParser from "koa-bodyparser";
import router from "./routes";

/**
 * Builds the Koa application without binding a port, so it can be imported directly by tests
 * (via supertest) without starting a real server. See server.ts for the runtime entrypoint.
 */
export function createApp(): Koa {
  const app = new Koa();

  app.use(bodyParser());
  app.use(router.routes());
  app.use(router.allowedMethods());

  return app;
}
