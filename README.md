# Order Management Service

ScreenCloud order management backend — Node.js + TypeScript + Koa + PostgreSQL.

> Status: Tickets 01–10 (project bootstrap, domain models & request validation, warehouse/inventory
> repository, pricing & volume discount, geographical distance, shipping cost, lowest-cost
> warehouse allocation, order quote application service, `POST /v1/orders/quote`, order
> persistence & order numbers). See
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
  controllers/        # thin HTTP handlers — parse/validate (via middleware) -> call an
                        # application service -> map its result to the HTTP response. No
                        # pricing/allocation logic lives here.
  application/         # orderQuoteService — the full side-effect-free quote flow (ticket 08):
                        # read stock -> price -> allocate -> check the 15% rule -> return a quote.
                        # No HTTP, no order/inventory writes. The submit service (a later ticket)
                        # will reuse the same domain calculators for its own recompute-then-write.
  domain/              # core types (Item, Warehouse, Inventory, OrderQuote, Order, Money, ...),
                        # request validation schemas (zod), domain error types, pricing.ts
                        # (subtotal/discount), distance.ts (Haversine), shipping.ts (per-allocation
                        # cost + multi-warehouse sum), allocation.ts (greedy lowest-cost
                        # multi-warehouse fulfillment), and validity.ts (the 15% shipping-cost rule).
  repositories/        # warehouseRepository (warehouse + inventory data access) and
                        # orderRepository (ticket 10: persists an already-computed OrderQuote as
                        # an Order + its allocations, generates a unique order number). Pure
                        # persistence — no validation, no inventory writes; the atomic
                        # decrement-and-submit flow is a later ticket.
  infrastructure/
    db/                # pg Pool, schema (DDL), migrate, seed
  middleware/          # validateBody — generic Koa validation middleware, reused by every
                        # write endpoint. Error-handling middleware lands in a later ticket.
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
  so a later ticket's atomic submit flow can run inventory decrements and order creation in one
  transaction without duplicating queries.
- **v1 scope**: `inventory` is keyed by warehouse only (no item column) — there's exactly one SKU
  for v1. The domain-level `Inventory` type still carries an `itemId` (`DEFAULT_ITEM_ID`) for
  forward compatibility if multi-SKU support is added later.
