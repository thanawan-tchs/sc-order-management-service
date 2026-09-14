import Router from "@koa/router";
import { getOrder } from "../controllers/getOrder.controller";
import { quoteOrder } from "../controllers/orderQuote.controller";
import { submitOrder } from "../controllers/orderSubmission.controller";
import { orderRequestSchema } from "../domain/validation/orderRequest.schema";
import { validateBody } from "../middleware/validateBody";

/**
 * The /orders resource (mounted under /v1 — see routes/index.ts). Ticket 09 added `POST /quote`;
 * ticket 12 added `POST /` (submit); ticket 14 adds `GET /:orderNumber`. All on this same router
 * rather than spawning parallel per-endpoint route files, since they're all the same REST
 * resource. The two POST routes share the same request schema (quote and submit take identical
 * input — see orderRequest.schema.ts); GET has no body to validate.
 */
const router = new Router({ prefix: "/orders" });

router.post("/quote", validateBody(orderRequestSchema), quoteOrder);
router.post("/", validateBody(orderRequestSchema), submitOrder);
router.get("/:orderNumber", getOrder);

export default router;
