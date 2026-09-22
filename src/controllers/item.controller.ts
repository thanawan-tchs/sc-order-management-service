import { Context } from "koa";
import { z } from "zod";
import itemService from "@application/items/itemService";
import { ItemNotFoundError, ValidationError } from "@domain/errors";
import { toMoney } from "@domain/money";
import { Item } from "@domain/model/item";
import { ItemRequestInput } from "@domain/validation/itemRequest.schema";
import { toDisplayAmount } from "@utils/money";

interface ItemResponseBody {
  id: string;
  name: string;
  price: number;
  currency: string;
  weightKg: number;
}

function toItemResponse(item: Item): ItemResponseBody {
  return {
    id: item.id,
    name: item.name,
    price: toDisplayAmount(item.price),
    currency: item.currency,
    weightKg: item.weightKg,
  };
}

export async function createItem(ctx: Context): Promise<void> {
  const input = ctx.state.validated as ItemRequestInput;
  const item = await itemService.createItem({
    name: input.name,
    price: toMoney(input.price),
    currency: input.currency,
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
