# Order Management Service

ScreenCloud order management backend — Node.js + TypeScript + Koa + PostgreSQL.

> Status: Tickets 01–15 (project bootstrap, domain models & request validation, warehouse/inventory
> repository, pricing & volume discount, geographical distance, shipping cost, lowest-cost
> warehouse allocation, order quote application service, `POST /v1/orders/quote`, order
> persistence & order numbers, atomic order submission, `POST /v1/orders`, idempotency &
> concurrency protection, `GET /v1/orders/:orderNumber`, centralized API error handling). See
> [`order-management-service-ticket-plan/`](order-management-service-ticket-plan/) for the full
> system design and ticket breakdown; functionality lands incrementally, ticket by ticket.

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

On startup the service runs migrations and seeds the 6 warehouses (if the `warehouses` table is
empty) before binding the port. The service listens on `PORT` (default `3000`). Verify it's up:

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

Requires Postgres running (`npm run db:up`) — the integration suite exercises the repository
layer, and the full HTTP API, against the real `orders_test` database.

```bash
npm test          # run once
npm run test:watch
```

## Lint & typecheck

```bash
npm run lint
npm run typecheck
```

## Project structure

```text
src/
  app.ts              # builds the Koa app (no listen()) — importable by tests
  server.ts           # runtime entrypoint: migrate -> seed -> listen
  routes/             # route definitions: /health (unversioned), /v1/orders/* (versioned API)
  controllers/        # one file per controller: orderQuote.controller.ts, orderSubmission.
                        # controller.ts, getOrder.controller.ts, health.controller.ts. Each
                        # handler: parse/validate (via middleware) -> call an application service
                        # -> map its result (and, for submit, its thrown error type) to the HTTP
                        # response. No pricing/allocation logic lives here.
  application/         # orderQuoteService (ticket 08) — side-effect-free quote flow: read stock
                        # -> price -> allocate -> check the 15% rule -> return a quote. No HTTP,
                        # no writes. orderSubmissionService (ticket 11) — the same calculation,
                        # reused as-is (readWarehouseCandidates + getOrderQuote), but run inside a
                        # single DB transaction and, only if the result is valid, followed by the
                        # inventory decrements + order creation, all through that same
                        # transaction's client (see "Database" below for how atomicity works).
                        # getOrderService (ticket 14) — thin read-only wrapper over
                        # orderRepository.getOrderByNumber; never recalculates anything.
  domain/              # core types (Item, Warehouse, Inventory, OrderQuote, Order, Money, ...),
                        # request validation schemas (zod), errors.ts (every AppError subclass —
                        # ValidationError, OrderSubmissionError, InsufficientStockError,
                        # IdempotencyKeyReusedError, OrderNotFoundError — each carrying its own
                        # HTTP status + error code, ticket 15), pricing.ts (subtotal/discount),
                        # distance.ts (Haversine), shipping.ts (per-allocation cost +
                        # multi-warehouse sum), allocation.ts (greedy lowest-cost multi-warehouse
                        # fulfillment), and validity.ts (the 15% shipping-cost rule).
  repositories/        # warehouseRepository (warehouse + inventory data access, incl.
                        # decrementInventory) and orderRepository (ticket 10: persists an
                        # already-computed OrderQuote as an Order + its allocations, generates a
                        # unique order number). Every function takes an optional `executor` (pool
                        # or an already-checked-out transaction client) so ticket 11 can run
                        # several of these calls as one atomic unit.
  infrastructure/
    db/                # pg Pool, schema (DDL), migrate, seed, and transaction.ts's
                        # withTransaction() — BEGIN/COMMIT/ROLLBACK wrapper used by ticket 11
  middleware/          # errorHandler (ticket 15) — the ONLY place an error becomes an HTTP
                        # response; registered first in app.ts so it wraps everything else.
                        # validateBody — throws a typed ValidationError on a bad request body
                        # rather than shaping a response itself, same as every other layer.
  config/              # environment/config loading, seed data
  utils/                # (empty — shared helpers as needed)
tests/
  helpers/db.ts         # resetTestDb() — migrate + truncate + reseed, used in beforeEach
  setupEnv.ts            # points DATABASE_URL at the test DB before any test file loads
```

`app.ts` is kept separate from `server.ts` specifically so the Koa app can be imported and exercised
in tests (via `supertest`) without binding a real port.

### API

`POST /v1/orders/quote` — verify a potential order (price, discount, shipping, validity) with no
side effects. `200` with `valid: false` and an `invalidReason` (`"INSUFFICIENT_STOCK"` or
`"SHIPPING_COST_EXCEEDS_15_PERCENT"`) for a business-invalid order; `400` only for a malformed
request body.

```bash
curl -X POST http://localhost:3000/v1/orders/quote \
  -H "Content-Type: application/json" \
  -d '{"quantity": 50, "shippingAddress": {"latitude": 40.7128, "longitude": -74.006}}'
```

`POST /v1/orders` — submit an order (ticket 12). Recalculates everything server-side from
`quantity`/`shippingAddress` only — any other field in the request body (a price, a discount, an
allocation) is silently ignored, never trusted. `201` on success; `422` (`ORDER_INVALID`) when the
recalculated order fails a business rule (insufficient stock and/or shipping over 15%); `409`
(`INVENTORY_CONFLICT`) when a concurrent submission wins a race for the same stock after this one
was otherwise valid — a transient, retry-friendly conflict, distinct from `422`'s durable
rejection; `400` for a malformed request body.

```bash
curl -X POST http://localhost:3000/v1/orders \
  -H "Content-Type: application/json" \
  -d '{"quantity": 100, "shippingAddress": {"latitude": 40.7128, "longitude": -74.006}}'
```

`POST /v1/orders` also accepts an optional `Idempotency-Key` header (ticket 13). Repeating a
request with the same key returns the original order (identical response, still `201`) instead of
creating a second one — safe to retry after a dropped connection or timeout without double-billing
a customer.

```bash
curl -X POST http://localhost:3000/v1/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: <client-generated-uuid>" \
  -d '{"quantity": 100, "shippingAddress": {"latitude": 40.7128, "longitude": -74.006}}'
```

`GET /v1/orders/:orderNumber` — retrieve a previously submitted order (ticket 14). Returns exactly
the persisted calculation snapshot; never recalculates pricing, distance, or discount, so the
order's numbers don't shift even if the business's current rates change after it was placed. `200`
when found, `404` (`ORDER_NOT_FOUND`) otherwise.

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
| 400 | `INVALID_QUANTITY`, `INVALID_LATITUDE`, `INVALID_LONGITUDE`, `VALIDATION_ERROR` (generic fallback, e.g. a missing `shippingAddress`) |
| 404 | `ORDER_NOT_FOUND` |
| 409 | `INVENTORY_CONFLICT` (a concurrent submission won a live race for the same stock), `IDEMPOTENCY_KEY_REUSED` (the same `Idempotency-Key` was sent with a different `quantity`/`shippingAddress` than the request it was originally claimed for — a *matching* retry is not an error, see ticket 13) |
| 422 | `INSUFFICIENT_STOCK`, `SHIPPING_COST_EXCEEDS_15_PERCENT` (the recalculated order fails a business rule) |
| 500 | `INTERNAL_SERVER_ERROR` — anything unexpected. The real error (message, stack) is logged server-side via `console.error`; the client never sees more than this generic code/message, regardless of what actually failed (a bug, a database outage, whatever) |

All of this is decided in exactly one place, `src/middleware/errorHandler.ts` — controllers and
services never set `ctx.status`/`ctx.body` for a failure themselves, they just throw a typed
`AppError` subclass (`src/domain/errors.ts`) and let it propagate. `errorHandler` is registered
first in `app.ts` so Koa's onion model wraps every other middleware inside its `try/catch`.

### Testing notes

- Multiple test files share one real Postgres `orders_test` database, each resetting it in
  `beforeEach` (`tests/helpers/db.ts`). Vitest's default is to run test *files* in parallel, which
  let two files' resets/queries race each other against those shared tables — `vitest.config.ts`
  sets `fileParallelism: false` to serialize file execution and remove that race.

### Database

- **Engine**: PostgreSQL, via `pg` (no ORM — raw parameterized SQL) so query/locking behavior stays
  explicit.
- **Concurrency**: `warehouseRepository.decrementInventory` uses a single guarded `UPDATE ...
  WHERE stock >= $1` statement — atomic by construction, so concurrent deductions can never oversell
  a warehouse's stock without needing an explicit transaction/row lock (verified by a concurrency
  test in `tests/repositories/warehouseRepository.test.ts`).
- **Order numbers**: generated from a standalone Postgres sequence (`order_number_seq`), whose
  `nextval()` is atomic under concurrent callers with no application-level locking — verified by a
  25-concurrent-creation test in `tests/repositories/orderRepository.test.ts`. Formatted as
  `ORD-<7-digit sequence value>`; also enforced `UNIQUE` at the schema level as a backstop.
- **Snapshot principle**: `orderRepository.createOrder` persists exactly the `OrderQuote` it's
  given — it never recalculates pricing/discount/shipping, so a later change to discount tiers or
  the shipping rate can't retroactively alter a historical order (ticket 10). Every repository
  function accepts an optional `executor` (a pool or an already-checked-out transaction client),
  which is exactly how ticket 11 composes them.
- **Atomic submission** (ticket 11): `orderSubmissionService.submitOrder` wraps the whole flow —
  re-reading inventory, recalculating price/allocation/validity, decrementing stock per
  allocation line, and creating the order — in a single `withTransaction` call
  (`infrastructure/db/transaction.ts`). It never trusts a client-supplied price, discount,
  shipping, or allocation (the input is only `quantity`/`shippingAddress` — there's nothing else
  to trust). If the recalculated order is invalid, or a concurrent submission wins a race for the
  same stock (a guarded decrement affecting 0 rows), the whole transaction rolls back — including
  any decrements already applied earlier in the same call — so a failed submission never leaves
  partial inventory changes or an orphaned order row. Verified against a real database in
  `tests/application/orderSubmissionService.test.ts` (single/multi-warehouse success, insufficient
  stock, shipping >15%, concurrent conflicts) and `tests/infrastructure/db/transaction.test.ts`
  (the rollback mechanism itself, isolated from order-specific logic).
- **Idempotency** (ticket 13): an `idempotency_keys` table (`key TEXT PRIMARY KEY`, `order_number`
  referencing `orders`) maps a client's `Idempotency-Key` to the order it produced.
  `orderRepository.recordIdempotencyKey` is called with the *same* transaction client as the
  `createOrder` call it's claiming a key for, so the claim and the order live or die together —
  a rolled-back submission (business rejection, lost inventory race) never leaves a key claimed,
  so retrying that same key is a fresh attempt, not a permanent dead end. The PRIMARY KEY
  constraint is what actually resolves *concurrent* submissions using the same key (identical to
  how `order_number_seq`/`decrementInventory` resolve their own races): whichever transaction's
  claim commits first wins; the loser's whole transaction rolls back (including its own inventory
  decrements) and `orderSubmissionService.submitOrder` transparently returns the winner's order
  instead of erroring — both callers see the same successful result. Verified in
  `tests/repositories/orderRepository.test.ts` (the constraint itself),
  `tests/application/orderSubmissionService.test.ts`, and
  `tests/integration/orderSubmission.api.test.ts` (sequential replay, concurrent same-key racing,
  and a failed attempt not blocking a later retry with the same key).
- **v1 scope**: `inventory` is keyed by warehouse only (no item column) — there's exactly one SKU
  for v1. The domain-level `Inventory` type still carries an `itemId` (`DEFAULT_ITEM_ID`) for
  forward compatibility if multi-SKU support is added later.
