# Order Management Service

Order management backend — Node.js + TypeScript + Koa + PostgreSQL.

> Status: Tickets 01–17 (project bootstrap, domain models & request validation, warehouse/inventory
> repository, pricing & volume discount, geographical distance, shipping cost, lowest-cost
> warehouse allocation, order quote application service, `POST /v1/orders/quote`, order
> persistence & order numbers, atomic order submission, `POST /v1/orders`, idempotency &
> concurrency protection, `GET /v1/orders/:orderNumber`, centralized API error handling, test
> strategy & CI, observability & production readiness). See
> [`order-management-service-ticket-plan/`](order-management-service-ticket-plan/) for the full
> system design and ticket breakdown; functionality lands incrementally, ticket by ticket.
>
> Since ticket 17, the catalog was generalized beyond the original single hard-coded SKU: an
> `items` table (name/price/weight, configured as data) backs a multi-item catalog, the order API
> takes a client-chosen `itemId` (UUID) per order, and every response includes the ordered item's
> details alongside a snapshot of it on the persisted order (so a later price change never
> retroactively changes a historical order).

## Requirements

- Node.js 20+
- npm
- Docker (for local Postgres)

## Setup

```bash
npm install
cp .env.example .env
npm run db:up      # starts Postgres via docker-compose, on host port 5433
```

`docker-compose.yml` provisions two databases on first start: `orders` (dev) and `orders_test`
(integration tests) — see `docker/init-test-db.sh`. Host port 5433 is used instead of the default
5432 to avoid clashing with any other local Postgres instance.

## Run

```bash
npm run dev     # start with auto-reload (tsx watch)
```

On startup the service runs migrations and seeds the catalog item and 6 warehouses (if the `items`/
`warehouses` tables are empty) before binding the port. The service listens on `PORT` (default
`3000`). Verify it's up:

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
npm run test:unit      # mocha — src/**/*.test.ts, co-located unit/service/repository/middleware tests
npm run test:api        # vitest — tests/integration/**/*.test.ts, full HTTP requests against all 3 endpoints
npm run test:watch
npm run coverage         # coverage:unit (c8 + mocha), then coverage:api (vitest --coverage)
```

`test:unit` (mocha + chai + sinon) never touches a real database — every repository/service/
infrastructure test injects a fake `QueryExecutor` or stubs `getPool`/`pg.Pool` with sinon instead.

`test:api` (vitest) exercises a real Postgres `orders_test` database, but doesn't need
`npm run db:up`/Docker for it: `tests/globalSetup.ts` boots one automatically via the
`embedded-postgres` package (a real `postgres` binary run as a plain subprocess) the first time
`TEST_DATABASE_URL` isn't already set, and shuts it down when the run finishes. Point
`TEST_DATABASE_URL` at your own Postgres (e.g. the docker-compose one, or CI's service container)
to use that instead — embedded-postgres only starts when nothing else is already configured.

CI (`.github/workflows/ci.yml`) runs `typecheck`, `lint`, `build`, `test:unit`, and `test:api` (as
separate steps, for clearer failure visibility) on every push and pull request, against a
`postgres:16-alpine` service container — the same recipe as local dev, just on port 5432 (free in
a clean runner) instead of 5433.

## Lint & typecheck

```bash
npm run lint
npm run typecheck
```

## Project structure

```text
src/
  app.ts                    # builds the Koa app (no listen()) — importable by tests
  server.ts                 # runtime entrypoint: migrate -> seed -> listen
  routes/                   # /health (unversioned), /v1/orders/*, /v1/items/* (versioned API)
  controllers/               # one file per controller — parse/validate -> call a service -> map to HTTP
  application/
    items/                    # itemService
    orders/                   # orderQuoteService, orderSubmissionService, getOrderService
    internal/                 # readinessService
  domain/                    # types, validation schemas, errors, pricing/distance/shipping/allocation/validity
  repositories/               # itemRepository, warehouseRepository, orderRepository
  infrastructure/
    db/                       # pg Pool, schema (DDL), migrate, seed, withTransaction()
    gracefulShutdown.ts       # SIGTERM/SIGINT handler
  observability/              # logger.ts (pino)
  middleware/                 # errorHandler, validateBody, requestContext
  config/                     # environment/config loading, seed data
  utils/                      # (empty — shared helpers as needed)
  **/*.test.ts                # unit/service/repository/middleware tests, co-located next to what they test
tests/
  integration/                # HTTP-level tests spanning multiple files/whole endpoints
  helpers/db.ts               # resetTestDb() — migrate + truncate + reseed, used in beforeEach
  helpers/geo.ts              # places a point at an exact distance from an origin (fixtures)
  setupEnv.ts                 # points DATABASE_URL at the test DB before any test file loads
```

`app.ts` is kept separate from `server.ts` specifically so the Koa app can be imported and exercised
in tests (via `supertest`) without binding a real port.

**`controllers/`** — one file per controller (`orderQuote`, `orderSubmission`, `getOrder`,
`health`). Each handler: parse/validate (via middleware) → call an application service → map its
result (and, for submit, its thrown error type) to the HTTP response. No pricing/allocation logic
lives here.

**`application/`** — grouped by what each service is about, not by ticket:
- `items/itemService` — thin wrapper over `itemRepository` (create/get/list catalog items).
- `orders/orderQuoteService` (ticket 08) — side-effect-free quote flow: read stock → price →
  allocate → check the 15% rule → return a quote. No HTTP, no writes.
- `orders/orderSubmissionService` (ticket 11) — the same calculation, reused as-is
  (`readWarehouseCandidates` + `getOrderQuote`), but run inside a single DB transaction and, only if
  the result is valid, followed by the inventory decrements + order creation, all through that same
  transaction's client (see "Database" below for how atomicity works).
- `orders/getOrderService` (ticket 14) — thin read-only wrapper over `orderRepository.getOrderByNumber`;
  never recalculates anything.
- `internal/readinessService` (ticket 17) — the `GET /ready` database check, injectable so it's
  unit-testable without a live database.

**`domain/`** — `model/` holds the core types split by category (`item.ts`: `Item`; `warehouse.ts`:
`Warehouse`, `Inventory`; `shipping.ts`: `ShippingAddress`, `ShippingAllocation`; `order.ts`:
`OrderQuote`, `OrderStatus`, `Order`) plus `Money` (`money.ts`), request validation schemas (zod,
incl. `itemId: z.string().uuid()`), `errors.ts` (every `AppError`
subclass — `ValidationError`, `OrderSubmissionError`, `InsufficientStockError`,
`IdempotencyKeyReusedError`, `OrderNotFoundError`, `ItemNotFoundError` — each carrying its own HTTP
status + error code, ticket 15), `pricing.ts` (subtotal/discount),
`distance.ts` (Haversine), `shipping.ts` (per-allocation cost + multi-warehouse sum), `allocation.ts`
(greedy lowest-cost multi-warehouse fulfillment), and `validity.ts` (the 15% shipping-cost rule).

**`repositories/`** — `itemRepository` (catalog lookups: `getItem`, `getAllItems`),
`warehouseRepository` (warehouse + inventory data access, incl. `decrementInventory`, keyed by
`(warehouseId, itemId)`) and `orderRepository` (ticket 10: persists an already-computed
`OrderQuote` as an `Order` + its allocations, including a snapshot of the ordered item's
name/price/weight at submission time, and generates a unique order number). Every function takes
an optional `executor` (pool or an already-checked-out transaction client) so ticket 11 can run
several of these calls as one atomic unit.

**`infrastructure/`**
- `db/` — pg `Pool` (ticket 17: pool size + timeouts from config), schema (DDL), migrate, seed, and
  `transaction.ts`'s `withTransaction()` — the `BEGIN`/`COMMIT`/`ROLLBACK` wrapper used by ticket 11.
- `gracefulShutdown.ts` (ticket 17) — dependency-injected `SIGTERM`/`SIGINT` handler (`server.close`
  → `closePool` → `exit(0)`, or force-exit `1` on timeout) — see `server.ts`.

**`observability/`** (ticket 17) — `logger.ts`, a shared pino instance.

**`middleware/`**
- `errorHandler` (ticket 15) — the ONLY place an error becomes an HTTP response; registered first
  in `app.ts` so it wraps everything else.
- `validateBody` — throws a typed `ValidationError` on a bad request body rather than shaping a
  response itself, same as every other layer.
- `requestContext` (ticket 17) — assigns/echoes `X-Request-Id`, attaches a per-request child logger
  to `ctx.state.log`, and logs one structured completion line per request; wraps `errorHandler` so
  it observes the final post-error-handling status.

### API

Every order request body takes `itemId` (a UUID identifying a row in the `items` catalog table),
`quantity`, and `shippingAddress` — no price, discount, or item name/weight is ever accepted from
the client; those are always looked up server-side from `items` by `itemId`. The seed data inserts
one item ("Standard Unit"); use `POST /v1/items` below to add more, or `GET /v1/orders/:orderNumber`
on any existing order to find a valid `itemId` for the order examples below.

`POST /v1/items` — add an item to the catalog. `201` with the created item (its `id` is a
server-generated UUID); `400` (`INVALID_ITEM_NAME`, `INVALID_PRICE`, `INVALID_CURRENCY`,
`INVALID_WEIGHT_KG`, or the generic `VALIDATION_ERROR` fallback) for a malformed request body.
`currency` must be one of a supported set of ISO 4217 codes — currently just `"USD"`
(`domain/money.ts`'s `CURRENCIES`, extendable by adding more values there) — and is the source of
truth for the currency of any order placed for this item — see `POST /v1/orders/quote` below.

```bash
curl -X POST http://localhost:3000/v1/items \
  -H "Content-Type: application/json" \
  -d '{"name": "Premium Unit", "price": 30000, "currency": "USD", "weightKg": 2.5}'
# {"id":"<uuid>","name":"Premium Unit","price":30000,"currency":"USD","weightKg":2.5}
```

`GET /v1/items` — list the full catalog. `200` with an array of items (no pagination/filtering
yet, fine at today's scale).

```bash
curl http://localhost:3000/v1/items
# [{"id":"<uuid>","name":"Standard Unit","price":15000,"currency":"USD","weightKg":0.365}, ...]
```

`GET /v1/items/:itemId` — retrieve a single catalog item. `200` with the item; `400`
(`INVALID_ITEM_ID`) if `itemId` isn't a well-formed UUID; `404` (`ITEM_NOT_FOUND`) if it is
well-formed but doesn't match any row.

```bash
curl http://localhost:3000/v1/items/<uuid>
```

`POST /v1/orders/quote` — verify a potential order (price, discount, shipping, validity) with no
side effects. `200` with `valid: false` and an `invalidReason` (`"INSUFFICIENT_STOCK"` or
`"SHIPPING_COST_EXCEEDS_15_PERCENT"`) for a business-invalid order; `400` for a malformed request
body; `404` (`ITEM_NOT_FOUND`) if `itemId` doesn't match any item in the catalog.

```bash
curl -X POST http://localhost:3000/v1/orders/quote \
  -H "Content-Type: application/json" \
  -d '{"itemId": "<uuid>", "quantity": 50, "shippingAddress": {"latitude": 40.7128, "longitude": -74.006}}'
```

```json
{
  "valid": true,
  "item": { "id": "<uuid>", "name": "Standard Unit", "price": 15000, "currency": "USD" },
  "quantity": 50,
  "pricing": { "subtotal": 750000, "discountRate": 0.05, "discount": 37500, "amountAfterDiscount": 712500, "shippingCost": 4200, "total": 716700, "currency": "USD" },
  "shipping": { "totalWeightKg": 18.25, "allocations": [{ "warehouseId": 2, "quantity": 50, "distanceKm": 8.4, "shippingCost": 4200, "currency": "USD" }] },
  "invalidReason": null
}
```

`POST /v1/orders` — submit an order (ticket 12). Recalculates everything server-side from
`itemId`/`quantity`/`shippingAddress` only — any other field in the request body (a price, a
discount, an allocation) is silently ignored, never trusted, and a prior quote never reserves
inventory. `201` on success (same `item`/`quantity`/`pricing`/`shipping` shape as the quote
response, plus `orderNumber`/`status`); `422` (`ORDER_INVALID`) when the recalculated order fails a
business rule (insufficient stock and/or shipping over 15%); `409` (`INVENTORY_CONFLICT`) when a
concurrent submission wins a race for the same stock after this one was otherwise valid — a
transient, retry-friendly conflict, distinct from `422`'s durable rejection; `400` for a malformed
request body; `404` (`ITEM_NOT_FOUND`) for an unknown `itemId`.

```bash
curl -X POST http://localhost:3000/v1/orders \
  -H "Content-Type: application/json" \
  -d '{"itemId": "<uuid>", "quantity": 100, "shippingAddress": {"latitude": 40.7128, "longitude": -74.006}}'
```

`POST /v1/orders` also accepts an optional `Idempotency-Key` header (ticket 13). Repeating a
request with the same key returns the original order (identical response, still `201`) instead of
creating a second one — safe to retry after a dropped connection or timeout without double-billing
a customer.

```bash
curl -X POST http://localhost:3000/v1/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: <client-generated-uuid>" \
  -d '{"itemId": "<uuid>", "quantity": 100, "shippingAddress": {"latitude": 40.7128, "longitude": -74.006}}'
```

`GET /v1/orders/:orderNumber` — retrieve a previously submitted order (ticket 14). Returns exactly
the persisted calculation snapshot — including the ordered item's name/price at submission time,
even if the `items` catalog has since changed — never recalculates pricing, distance, or discount.
`200` when found (adds `destination` and `createdAt` to the same `item`/`quantity`/`pricing`/
`shipping` shape), `404` (`ORDER_NOT_FOUND`) otherwise.

```bash
curl http://localhost:3000/v1/orders/ORD-0000001
```

### Error handling

Every error response across all three endpoints has the same shape (ticket 15):

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "Order cannot be submitted: INSUFFICIENT_STOCK" } }
```

| Status | Codes |
|---|---|
| 400 | `INVALID_ITEM_ID`, `INVALID_QUANTITY`, `INVALID_LATITUDE`, `INVALID_LONGITUDE`, `INVALID_ITEM_NAME`, `INVALID_PRICE`, `INVALID_CURRENCY`, `INVALID_WEIGHT_KG`, `VALIDATION_ERROR` (generic fallback, e.g. a missing `shippingAddress`) |
| 404 | `ORDER_NOT_FOUND`, `ITEM_NOT_FOUND` (`itemId` doesn't match any row in the `items` catalog) |
| 409 | `INVENTORY_CONFLICT` (a concurrent submission won a live race for the same stock), `IDEMPOTENCY_KEY_REUSED` (the same `Idempotency-Key` was sent with a different `itemId`/`quantity`/`shippingAddress` than the request it was originally claimed for — a *matching* retry is not an error, see ticket 13) |
| 422 | `INSUFFICIENT_STOCK`, `SHIPPING_COST_EXCEEDS_15_PERCENT` (the recalculated order fails a business rule) |
| 500 | `INTERNAL_SERVER_ERROR` — anything unexpected. The real error (message, stack) is logged server-side as structured JSON (see "Observability & production readiness" below); the client never sees more than this generic code/message, regardless of what actually failed (a bug, a database outage, whatever) |

All of this is decided in exactly one place, `src/middleware/errorHandler.ts` — controllers and
services never set `ctx.status`/`ctx.body` for a failure themselves, they just throw a typed
`AppError` subclass (`src/domain/errors.ts`) and let it propagate. `errorHandler` is registered
first in `app.ts` so Koa's onion model wraps every other middleware inside its `try/catch`.


### TODO: next 
- relocate validate request body function to stay in controller
- autogen API Spec
- apply ORM database
- integrate test with cucumber
- cleaning the comment from AI
- enhance security 
  - middleware verifyAuth
  - verify api policy
- enhance error handling format 
  - make it more simple to add new/use errorCode

