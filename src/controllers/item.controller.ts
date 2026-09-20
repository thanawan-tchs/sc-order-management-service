import { Context } from "koa";
import { z } from "zod";
import * as itemService from "../application/itemService";
import { ItemNotFoundError, ValidationError } from "../domain/errors";
import { toMoney } from "../domain/money";
import { Item } from "../domain/types";
import { ItemRequestInput } from "../domain/validation/itemRequest.schema";

interface ItemResponseBody {
  id: string;
  name: string;
  priceCents: number;
  weightKg: number;
}

function toItemResponse(item: Item): ItemResponseBody {
  return { id: item.id, name: item.name, priceCents: item.priceCents, weightKg: item.weightKg };
}

/** POST /v1/items. Request body is already parsed/validated by `validateBody` (see items.route.ts)
 *  before this handler runs — all that's left is calling the application service and mapping its
 *  result to the wire format. */
export async function createItem(ctx: Context): Promise<void> {
  const input = ctx.state.validated as ItemRequestInput;
  const item = await itemService.createItem({
    name: input.name,
    priceCents: toMoney(input.priceCents),
    weightKg: input.weightKg,
  });

  ctx.status = 201;
  ctx.body = toItemResponse(item);
}

/** GET /v1/items. Lists the full catalog — no pagination/filtering yet, fine at today's scale. */
export async function listItems(ctx: Context): Promise<void> {
  const items = await itemService.getAllItems();

  ctx.status = 200;
  ctx.body = items.map(toItemResponse);
}

const itemIdParamSchema = z.string().uuid();

/** GET /v1/items/:itemId. `itemId` is a route param, not a request body, so it isn't covered by
 *  `validateBody` — checked here instead, and rejected the same way (400 `INVALID_ITEM_ID`) a
 *  malformed `itemId` in an order request body already is, rather than letting a non-UUID string
 *  reach the database and surface as an opaque 500. */
export async function getItem(ctx: Context): Promise<void> {
  const { itemId } = ctx.params;
  ctx.state.itemId = itemId;

  if (!itemIdParamSchema.safeParse(itemId).success) {
    throw new ValidationError("INVALID_ITEM_ID", "itemId must be a valid UUID.");
  }

  const item = await itemService.getItem(itemId);
  if (!item) {
    throw new ItemNotFoundError(itemId);
  }

  ctx.status = 200;
  ctx.body = toItemResponse(item);
}
