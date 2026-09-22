import Router from "@koa/router";
import { createItem, getItem, listItems } from "@controllers/item.controller";
import { itemRequestSchema } from "@domain/validation/itemRequest.schema";
import { validateBody } from "@middleware/validateBody";

const router = new Router({ prefix: "/items" });

router.post("/", validateBody(itemRequestSchema), createItem);
router.get("/", listItems);
router.get("/:itemId", getItem);

export default router;
