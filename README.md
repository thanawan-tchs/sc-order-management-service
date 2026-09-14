# Order Management Service

ScreenCloud order management backend — Node.js + TypeScript + Koa + PostgreSQL.

> Status: Tickets 01–05 (project bootstrap, domain models & request validation, warehouse/inventory
> repository, pricing & volume discount, geographical distance). See
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
layer against the real `orders_test` database.

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
  routes/             # route definitions, mounted onto the root router
  controllers/        # thin HTTP handlers — no business logic
  application/        # (empty — application/use-case services land in later tickets)
  domain/              # core types (Item, Warehouse, Inventory, OrderQuote, Order, Money, ...),
                        # request validation schemas (zod), domain error types, pricing.ts
                        # (subtotal/discount — the shared pricing service), and distance.ts
                        # (Haversine great-circle distance). Shipping cost / allocation logic
                        # itself lands in later tickets.
  repositories/        # warehouseRepository — warehouse + inventory data access
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

### Database

- **Engine**: PostgreSQL, via `pg` (no ORM — raw parameterized SQL) so query/locking behavior stays
  explicit.
- **Concurrency**: `warehouseRepository.decrementInventory` uses a single guarded `UPDATE ...
  WHERE stock >= $1` statement — atomic by construction, so concurrent deductions can never oversell
  a warehouse's stock without needing an explicit transaction/row lock (verified by a concurrency
  test in `tests/repositories/warehouseRepository.test.ts`).
- **v1 scope**: `inventory` is keyed by warehouse only (no item column) — there's exactly one SKU
  for v1. The domain-level `Inventory` type still carries an `itemId` (`DEFAULT_ITEM_ID`) for
  forward compatibility if multi-SKU support is added later.
