import Router from "@koa/router";
import { quoteOrder } from "../controllers/orders.controller";
import { orderRequestSchema } from "../domain/validation/orderRequest.schema";
import { validateBody } from "../middleware/validateBody";

/**
 * The /orders resource (mounted under /v1 — see routes/index.ts). Ticket 09 adds `POST /quote`;
 * later tickets (submit, get-by-order-number) add their handlers to this same router rather than
 * spawning parallel per-endpoint route files, since they're all the same REST resource.
 */
const router = new Router({ prefix: "/orders" });

router.post("/quote", validateBody(orderRequestSchema), quoteOrder);

export default router;
