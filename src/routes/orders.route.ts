import Router from "@koa/router";
import { quoteOrder } from "../controllers/orderQuote.controller";
import { submitOrder } from "../controllers/orderSubmission.controller";
import { orderRequestSchema } from "../domain/validation/orderRequest.schema";
import { validateBody } from "../middleware/validateBody";

/**
 * The /orders resource (mounted under /v1 — see routes/index.ts). Ticket 09 added `POST /quote`;
 * ticket 12 adds `POST /` (submit); a later ticket (get-by-order-number) adds its handler to this
 * same router too, rather than spawning parallel per-endpoint route files, since they're all the
 * same REST resource. Both POST routes share the same request schema (quote and submit take
 * identical input — see orderRequest.schema.ts).
 */
const router = new Router({ prefix: "/orders" });

router.post("/quote", validateBody(orderRequestSchema), quoteOrder);
router.post("/", validateBody(orderRequestSchema), submitOrder);

export default router;
