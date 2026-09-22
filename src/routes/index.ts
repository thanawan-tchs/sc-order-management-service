import Router from "@koa/router";
import healthRoute from "./health.route";
import itemsRoute from "./items.route";
import ordersRoute from "./orders.route";

/**
 * Root router. Each domain gets its own file under routes/ and is mounted here. `/health` is
 * unversioned (an operational endpoint, not part of the public API); the actual API surface is
 * versioned under /v1, per SYSTEM-DESIGN.md's `POST /v1/orders/quote` etc.
 */
const router = new Router();

router.use(healthRoute.routes(), healthRoute.allowedMethods());

const v1Router = new Router({ prefix: "/v1" });
v1Router.use(ordersRoute.routes(), ordersRoute.allowedMethods());
v1Router.use(itemsRoute.routes(), itemsRoute.allowedMethods());
router.use(v1Router.routes(), v1Router.allowedMethods());

export default router;
