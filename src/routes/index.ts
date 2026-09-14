import Router from "@koa/router";
import healthRoute from "./health.route";

/**
 * Root router. Each domain gets its own file under routes/ and is mounted here —
 * e.g. future `POST /v1/orders/quote` will live in `orders.route.ts` per SYSTEM-DESIGN.md.
 */
const router = new Router();

router.use(healthRoute.routes(), healthRoute.allowedMethods());

export default router;
