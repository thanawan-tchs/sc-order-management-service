import Koa from "koa";
import bodyParser from "koa-bodyparser";
import { errorHandler } from "./middleware/errorHandler";
import { requestContext } from "./middleware/requestContext";
import router from "./routes";

/**
 * Builds the Koa application without binding a port, so it can be imported directly by tests
 * (via supertest) without starting a real server. See server.ts for the runtime entrypoint.
 *
 * Middleware order (Koa's onion model — earlier wraps later):
 *   requestContext -> errorHandler -> bodyParser -> router
 * `requestContext` is outermost so it can log/measure the *final* status after `errorHandler`
 * has decided it (errorHandler always resolves normally, never rethrows). `errorHandler` still
 * wraps everything inside it — bodyParser and every route handler.
 */
export function createApp(): Koa {
  const app = new Koa();

  app.use(requestContext);
  app.use(errorHandler);
  app.use(bodyParser());
  app.use(router.routes());
  app.use(router.allowedMethods());

  return app;
}
