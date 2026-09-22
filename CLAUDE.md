# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A ScreenCloud-style order management backend: Node.js + TypeScript + Koa + PostgreSQL. It exposes
three API endpoints (`POST /v1/orders/quote`, `POST /v1/orders`, `GET /v1/orders/:orderNumber`)
that price an order, allocate it across warehouses by lowest shipping cost, and persist it
atomically. See `README.md` for full endpoint docs and `order-management-service-ticket-plan/SYSTEM-DESIGN.md`
for the original architecture brief. The codebase was built incrementally against a 17-ticket plan
in `order-management-service-ticket-plan/*.md` (`01-project-bootstrap.md` … `17-observability-production-readiness.md`);
each ticket file documents the specific acceptance criteria behind a given slice of the code, and
is worth reading when working in that area.

## Commands

```bash
npm install
cp .env.example .env
npm run db:up          # starts Postgres via docker-compose (host port 5433)

npm run dev             # dev server with auto-reload (tsx watch)
npm run build            # tsc -p tsconfig.build.json -> dist/
npm start                 # node dist/server.js

npm test                  # test:unit then test:api (test:api requires npm run db:up first)
npm run test:unit          # mocha                    — co-located unit/service/repository/middleware tests
npm run test:api            # vitest run tests/integration — full HTTP integration tests
npm run test:watch          # mocha --watch (unit tests only)
npm run coverage             # coverage:unit (c8 + mocha) then coverage:api (vitest --coverage)

npm run lint
npm run typecheck
```

Run a single unit test file: `npx mocha src/domain/pricing.test.ts`. Run by name:
`npx mocha --grep "insufficient stock"`. Run a single integration test file:
`npx vitest run tests/integration/orderQuote.api.test.ts`.

**Unit tests (`npm run test:unit`, mocha + chai + sinon) never touch a real database** — every
repository/service/infrastructure test injects a fake `QueryExecutor` (or stubs `getPool`/`pg.Pool`
directly via sinon) rather than hitting Postgres; see `.mocharc.json` (loader: `ts-node/register`
— NOT `tsx`, whose esbuild-based CJS output makes exports non-configurable and unstubbable by
sinon) and `tests/mochaSetup.ts` (registers `chai-as-promised`). **Only `test:api` (vitest,
`tests/integration/`) hits the real Postgres `orders_test` database**; `npm run db:up` must be
running first for that suite. CI (`.github/workflows/ci.yml`) runs `typecheck`, `lint`, `build`,
`test:unit`, `test:api` as separate steps, with a `postgres:16-alpine` service container available
for `test:api`.

## Architecture

**Layering** (controllers never contain business logic; each layer only talks to the one below it):

```
routes/ -> controllers/ -> application/ (services) -> repositories/ -> infrastructure/db/ (pg)
                                 |
                              domain/ (pure functions/types, no I/O)
```

- **`domain/`** — pure, side-effect-free business logic and types: `pricing.ts` (subtotal/volume
  discount), `distance.ts` (Haversine), `shipping.ts` (per-allocation cost), `allocation.ts`
  (greedy lowest-cost-first multi-warehouse fulfillment), `validity.ts` (the 15%
  shipping-cost-vs-order-value rule), `money.ts` (`Money` — a branded integer-cents type; never use
  raw floats for currency), `errors.ts` (every `AppError` subclass), `validation/` (zod request
  schemas).
- **`application/`** — orchestrates domain + repositories: `orderQuoteService` (read stock -> price
  -> allocate -> check validity -> return, no writes) and `orderSubmissionService` (the same
  calculation, but run inside one DB transaction, followed by inventory decrements + order
  creation only if valid). `orderSubmissionService` reuses `orderQuoteService`'s functions directly
  rather than duplicating the calculation — this is the load-bearing reason the two must stay
  API-compatible.
- **`repositories/`** — the only layer that writes raw SQL. Every function takes an optional
  `executor: QueryExecutor` (defaults to the shared pool) so a caller can pass an in-flight
  transaction `PoolClient` instead — this is how `orderSubmissionService` composes multiple
  repository calls into one atomic unit.
- **`middleware/errorHandler.ts`** is the *only* place an error becomes an HTTP status/body.
  Controllers and services never set `ctx.status`/`ctx.body` on failure — they throw a typed
  `AppError` subclass (`domain/errors.ts`, each carrying its own `status` + `code`) and let it
  propagate. Adding a new failure mode means adding a new `AppError` subclass, not touching a
  switch statement.

**Koa middleware order matters** (`app.ts`, onion model — earlier wraps later):
`requestContext -> errorHandler -> bodyParser -> router`. `requestContext` must be outermost so it
observes the *final* status after `errorHandler` decides it (it logs one structured "request
completed" line per request and records `http_requests_total`/`http_request_duration_seconds`).

**Money and quantities are always integers.** `Money` (`domain/money.ts`) is a branded `number` —
build one via `toMoney()`, which throws on non-integer input. Never do currency arithmetic in
floating dollars.

**The critical invariant for `POST /v1/orders`:** it never trusts a client-supplied
price/discount/shipping/allocation — the only inputs read from the request are `quantity` and
`shippingAddress`. Everything else is recalculated from scratch inside the transaction, against
freshly-read stock, because a prior quote does not reserve inventory.

**Concurrency safety is achieved without explicit locking**, via three independent
guarded/atomic operations:
- `warehouseRepository.decrementInventory` — a single `UPDATE ... WHERE stock >= $1` (an
  affected-row-count of 0 means "insufficient stock", surfaced as `InsufficientStockError`).
- `order_number_seq` — a Postgres sequence; `nextval()` is atomic under concurrent callers.
- `idempotency_keys` — a `PRIMARY KEY` on `key`; a losing concurrent claim raises
  `IdempotencyKeyConflictError` internally, which `orderSubmissionService` catches and turns into
  "return the winner's order" rather than an error (both concurrent callers see success).

All three failure modes roll back the *entire* transaction (`infrastructure/db/transaction.ts`'s
`withTransaction`), including any inventory decrements already applied earlier in the same call —
a failed submission never leaves partial state or a claimed-but-orphaned idempotency key.

**Database migrations** live in `src/infrastructure/db/migrations/`, one file per version
(`0001_*.ts`, `0002_*.ts`, ...), each exporting a `{ id, statements }` `Migration`. `migrate.ts`
tracks applied ids in a `schema_migrations` table and runs each new one inside its own transaction
— safe to call on every startup and every test reset. **Never edit an already-applied migration**
(a database that ran it won't re-run it); add a new migration file instead, and append it to
`migrations/index.ts`.

**Observability** (`observability/`): `logger.ts` is a shared `pino` instance (structured JSON,
redacts `databaseUrl`/`*.password`). `middleware/requestContext.ts` logs one structured "request
completed" line per request, using the matched route *pattern* (`ctx.routerPath`), not the literal
request path, so the log field stays low-cardinality.

**Graceful shutdown** (`infrastructure/gracefulShutdown.ts`) is a pure, dependency-injected
function (`createShutdownHandler({ server, closePool, exit, logger, timeoutMs })`) rather than
inline logic in `server.ts`, specifically so it's unit-testable without a real server/process.

## Testing conventions

- Unit/service/repository/middleware tests are **co-located** next to the file they test
  (`src/domain/pricing.ts` + `src/domain/pricing.test.ts`). Only true integration tests (an HTTP
  flow spanning many files) live under `tests/integration/`.
- `vitest.config.ts` sets `fileParallelism: false` — multiple test files share one real Postgres
  database and reset it via `tests/helpers/db.ts`'s `resetTestDb()` in `beforeEach`; running files
  in parallel would let one file's truncate race another's in-flight queries.
- Application-service tests that don't need a live DB inject fake dependencies (e.g.
  `orderQuoteService`'s `deps.readWarehouseCandidates`) rather than mocking the database driver.
- Tests asserting on a genuine database race (two concurrent requests for the same stock/key)
  assert the *outcome* (final stock, exactly one order/claim), not which of two valid code paths
  produced it — the timing is nondeterministic by design.


# Code Style Guidelines
- **Do not add code comments** (no `//`, `#`, or block comments) unless explicitly requested.
- Code must be self-documenting with clear, expressive variable and function names.
- If you must modify code, strip out any conversational or explanatory comments you introduce.