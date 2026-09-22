import Router from "@koa/router";
import healthRoute from "./health.route";
import itemsRoute from "./items.route";
import ordersRoute from "./orders.route";

const router = new Router();

router.use(healthRoute.routes(), healthRoute.allowedMethods());

const v1Router = new Router({ prefix: "/v1" });
v1Router.use(ordersRoute.routes(), ordersRoute.allowedMethods());
v1Router.use(itemsRoute.routes(), itemsRoute.allowedMethods());
router.use(v1Router.routes(), v1Router.allowedMethods());

export default router;
