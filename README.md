# Order Management Service

Node.js + TypeScript + Koa + PostgreSQL backend that prices an order, allocates it across
warehouses by lowest shipping cost, and persists it atomically. See
[`order-management-service-ticket-plan/`](order-management-service-ticket-plan/) for the original
system design and the incremental ticket history.

## Requirements

- Node.js 20+
- npm
- Docker (for local Postgres)

## Setup

```bash
npm install         # postinstall runs `prisma generate`
cp .env.example .env
npm run db:up        # starts Postgres via docker-compose, migrates, and seeds it (host port 5433)
```

`db:up` provisions two databases on first start — `orders` (dev) and `orders_test` (integration
tests) — waits for Postgres to be healthy, then migrates and seeds `orders`. Seeding is a one-time,
idempotent step tied to starting the database, not the app: data persists in the docker volume, and
re-running `db:up` is a no-op once it's already seeded.

## Run

```bash
npm run dev     # start with auto-reload (tsx watch)
```

On startup the service runs `prisma migrate deploy` (idempotent, safe on every boot) before binding
`PORT` (default `3000`). It does not seed — that only happens via `db:up`/`db:seed`.

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

## Build & run compiled output

```bash
npm run build
npm start
```

## Test

```bash
npm test              # test:unit, then test:api
npm run test:unit      # mocha — co-located unit/service/repository/middleware tests
npm run test:api        # vitest — full HTTP integration tests against a real Postgres
npm run test:watch
npm run coverage         # coverage:unit (c8), then coverage:api (vitest --coverage)
```

`test:unit` never touches a real database (every repository/service test injects a fake or stubs
Prisma). `test:api` needs a real Postgres, but doesn't require `db:up`/Docker: it boots one
automatically via `embedded-postgres` (a real `postgres` binary run as a subprocess) unless
`TEST_DATABASE_URL` already points at one — CI sets it to a `postgres:16-alpine` service container.

## Lint & typecheck

```bash
npm run lint
npm run typecheck
```

## Project structure

```text
prisma/
  schema.prisma              # Item/Warehouse/Inventory/Order/OrderAllocation/IdempotencyKey models
  migrations/                 # prisma migrate history (one folder per migration)
scripts/
  seedDb.ts                  # `npm run db:seed` — migrate + seed the database directly, once
src/
  app.ts                    # builds the Koa app (no listen()) — importable by tests
  server.ts                 # runtime entrypoint: migrate -> listen (no seeding)
  routes/                   # /health (unversioned), /v1/orders/*, /v1/items/* (versioned API)
  controllers/               # parse/validate -> call a service -> map result to HTTP
  application/
    items/                    # itemService
    orders/                   # orderQuoteService, orderSubmissionService, getOrderService
    internal/                 # readinessService (GET /ready)
  domain/                    # pure types, validation schemas, errors, pricing/distance/shipping/allocation
  repositories/               # itemRepository, warehouseRepository, orderRepository — Prisma Client only
  infrastructure/
    db/                       # Prisma Client, seed.ts, withTransaction()
    closeDependencies.ts      # closes Prisma + Redis on shutdown
    cache/                    # optional Redis read-through cache
  observability/              # logger.ts (pino)
  middleware/                 # errorHandler, validateBody, requestContext
  config/                     # environment/config loading, seed data
  **/*.test.ts                # unit/service/repository/middleware tests, co-located next to what they test
tests/
  integration/                # HTTP-level tests spanning multiple files/whole endpoints
  helpers/db.ts               # resetTestDb() — truncate + reseed, used in beforeEach
  helpers/geo.ts              # places a point at an exact distance from an origin (fixtures)
```

`app.ts` is kept separate from `server.ts` so the Koa app can be imported and exercised in tests
(via `supertest`) without binding a real port. Layering:
`routes → controllers → application (services) → repositories → infrastructure/db`, with `domain/`
as pure, side-effect-free logic used throughout. `src/middleware/errorHandler.ts` is the only place
an error becomes an HTTP response — every other layer just throws a typed `AppError` subclass
(`src/domain/errors.ts`) and lets it propagate.

## API

Every order request takes `itemId` (a UUID from the `items` catalog), `quantity`, and
`shippingAddress` — price, discount, and item details are always looked up server-side, never
accepted from the client. The seed data inserts one item ("Standard Unit"); use `POST /v1/items`
to add more, or `GET /v1/orders/:orderNumber` on any existing order to find a valid `itemId`.

**`POST /v1/items`** — add a catalog item. `201` with the created item; `400` for a malformed body
(`INVALID_ITEM_NAME`, `INVALID_PRICE`, `INVALID_CURRENCY`, `INVALID_WEIGHT_KG`). `price` in the
request is an integer number of cents; every money field in every *response* is a display-friendly
decimal amount in the major currency unit.

```bash
curl -X POST http://localhost:3000/v1/items \
  -H "Content-Type: application/json" \
  -d '{"name": "Premium Unit", "price": 30000, "currency": "USD", "weightKg": 2.5}'
# {"id":"<uuid>","name":"Premium Unit","price":300,"currency":"USD","weightKg":2.5}
```

**`GET /v1/items`** — list the full catalog. **`GET /v1/items/:itemId`** — a single item; `400`
(`INVALID_ITEM_ID`) for a malformed UUID, `404` (`ITEM_NOT_FOUND`) otherwise.

**`POST /v1/orders/quote`** — price/validate an order with no side effects. `200` with
`valid: false` and an `invalidReason` (`INSUFFICIENT_STOCK` or `SHIPPING_COST_EXCEEDS_15_PERCENT`)
for a business-invalid order; `400`/`404` for a malformed request or unknown `itemId`.

```bash
curl -X POST http://localhost:3000/v1/orders/quote \
  -H "Content-Type: application/json" \
  -d '{"itemId": "<uuid>", "quantity": 50, "shippingAddress": {"latitude": 40.7128, "longitude": -74.006}}'
```

```json
{
  "valid": true,
  "item": { "id": "<uuid>", "name": "Standard Unit", "price": 150, "currency": "USD" },
  "quantity": 50,
  "pricing": { "subtotal": 7500, "discountRate": 0.05, "discount": 375, "amountAfterDiscount": 7125, "shippingCost": 42, "total": 7167, "currency": "USD" },
  "shipping": { "totalWeightKg": 18.25, "allocations": [{ "warehouseId": 2, "quantity": 50, "distanceKm": 8.4, "shippingCost": 42, "currency": "USD" }] },
  "invalidReason": null
}
```

**`POST /v1/orders`** — submit an order. Recalculates everything server-side from
`itemId`/`quantity`/`shippingAddress` only — any other field is ignored, and a prior quote never
reserves inventory. `201` on success (same shape as the quote, plus `orderNumber`/`status`); `422`
when the recalculated order fails a business rule; `409` (`INVENTORY_CONFLICT`) on a transient race
for the same stock; `400`/`404` for a malformed request or unknown `itemId`.

```bash
curl -X POST http://localhost:3000/v1/orders \
  -H "Content-Type: application/json" \
  -d '{"itemId": "<uuid>", "quantity": 100, "shippingAddress": {"latitude": 40.7128, "longitude": -74.006}}'
```

An optional `Idempotency-Key` header makes retries safe: repeating a request with the same key
returns the original order (still `201`) instead of creating a second one.

```bash
curl -X POST http://localhost:3000/v1/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: <client-generated-uuid>" \
  -d '{"itemId": "<uuid>", "quantity": 100, "shippingAddress": {"latitude": 40.7128, "longitude": -74.006}}'
```

**`GET /v1/orders/:orderNumber`** — retrieve a previously submitted order. Returns exactly the
persisted snapshot (never recalculates), even if the catalog has since changed. `200` when found
(adds `destination`/`createdAt`), `404` (`ORDER_NOT_FOUND`) otherwise.

```bash
curl http://localhost:3000/v1/orders/ORD-0000001
```

### Error handling

Every error response has the same shape:

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "Order cannot be submitted: INSUFFICIENT_STOCK" } }
```

| Status | Codes |
|---|---|
| 400 | `INVALID_ITEM_ID`, `INVALID_QUANTITY`, `INVALID_LATITUDE`, `INVALID_LONGITUDE`, `INVALID_ITEM_NAME`, `INVALID_PRICE`, `INVALID_CURRENCY`, `INVALID_WEIGHT_KG`, `VALIDATION_ERROR` (generic fallback) |
| 404 | `ORDER_NOT_FOUND`, `ITEM_NOT_FOUND` |
| 409 | `INVENTORY_CONFLICT` (lost a concurrent race for stock), `IDEMPOTENCY_KEY_REUSED` (same key, different request body — a *matching* retry is not an error) |
| 422 | `INSUFFICIENT_STOCK`, `SHIPPING_COST_EXCEEDS_15_PERCENT` |
| 500 | `INTERNAL_SERVER_ERROR` — the real error is logged server-side; the client never sees more than this generic code |
