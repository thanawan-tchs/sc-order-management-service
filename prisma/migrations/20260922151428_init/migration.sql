-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "weight_kg" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "warehouse_id" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "stock" INTEGER NOT NULL,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("warehouse_id","item_id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "order_number" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "item_name" TEXT NOT NULL,
    "item_price" INTEGER NOT NULL,
    "item_weight_kg" DOUBLE PRECISION NOT NULL,
    "destination_latitude" DOUBLE PRECISION NOT NULL,
    "destination_longitude" DOUBLE PRECISION NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "discount_rate" DOUBLE PRECISION NOT NULL,
    "discount" INTEGER NOT NULL,
    "amount_after_discount" INTEGER NOT NULL,
    "shipping" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_allocations" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "distance_km" DOUBLE PRECISION NOT NULL,
    "shipping" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,

    CONSTRAINT "order_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "order_allocations_order_id_idx" ON "order_allocations"("order_id");

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_order_number_fkey" FOREIGN KEY ("order_number") REFERENCES "orders"("order_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateSequence (used by orderRepository.generateOrderNumber, not modeled in schema.prisma)
CREATE SEQUENCE IF NOT EXISTS order_number_seq;

-- CheckConstraints (not expressible in schema.prisma; carried over from the pre-Prisma migrations)
ALTER TABLE "items" ADD CONSTRAINT "items_price_check" CHECK ("price" > 0);
ALTER TABLE "items" ADD CONSTRAINT "items_weight_kg_check" CHECK ("weight_kg" > 0);
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_stock_check" CHECK ("stock" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_quantity_check" CHECK ("quantity" > 0);
