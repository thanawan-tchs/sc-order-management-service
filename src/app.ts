import Koa from "koa";
import bodyParser from "koa-bodyparser";
import { errorHandler } from "./middleware/errorHandler";
import { requestContext } from "./middleware/requestContext";
import router from "./routes";

export function createApp(): Koa {
  const app = new Koa();

  app.use(requestContext);
  app.use(errorHandler);
  app.use(bodyParser());
  app.use(router.routes());
  app.use(router.allowedMethods());

  return app;
}
