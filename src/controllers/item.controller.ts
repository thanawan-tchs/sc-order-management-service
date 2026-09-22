import { Context } from "koa";
import { z } from "zod";
import * as itemService from "../application/items/itemService";
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

export async function listItems(ctx: Context): Promise<void> {
  const items = await itemService.getAllItems();

  ctx.status = 200;
  ctx.body = items.map(toItemResponse);
}

const itemIdParamSchema = z.string().uuid();

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
