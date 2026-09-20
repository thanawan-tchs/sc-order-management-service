import Router from "@koa/router";
import { createItem, getItem, listItems } from "../controllers/item.controller";
import { itemRequestSchema } from "../domain/validation/itemRequest.schema";
import { validateBody } from "../middleware/validateBody";

/** The /items resource (mounted under /v1 — see routes/index.ts): create, list, and read catalog
 *  items (name/price/weight), which `orderRequestSchema`'s `itemId` refers to. */
const router = new Router({ prefix: "/items" });

router.post("/", validateBody(itemRequestSchema), createItem);
router.get("/", listItems);
router.get("/:itemId", getItem);

export default router;
