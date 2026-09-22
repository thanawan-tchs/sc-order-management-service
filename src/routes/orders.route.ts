import Router from "@koa/router";
import { getOrder } from "@controllers/getOrder.controller";
import { quoteOrder } from "@controllers/orderQuote.controller";
import { submitOrder } from "@controllers/orderSubmission.controller";
import { orderRequestSchema } from "@domain/validation/orderRequest.schema";
import { validateBody } from "@middleware/validateBody";

const router = new Router({ prefix: "/orders" });

router.post("/quote", validateBody(orderRequestSchema), quoteOrder);
router.post("/", validateBody(orderRequestSchema), submitOrder);
router.get("/:orderNumber", getOrder);

export default router;
