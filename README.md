# Order Management Service

ScreenCloud order management backend — Node.js + TypeScript + Koa.

> Status: Ticket 01 (project bootstrap) only. See
> [`order-management-service-ticket-plan/`](order-management-service-ticket-plan/) for the full
> system design and ticket breakdown; functionality lands incrementally, ticket by ticket.

## Requirements

- Node.js 20+
- npm

## Setup

```bash
npm install
cp .env.example .env
```

## Run

```bash
npm run dev     # start with auto-reload (tsx watch)
```

The service listens on `PORT` (default `3000`). Verify it's up:

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
  app.ts            # builds the Koa app (no listen()) — importable by tests
  server.ts         # runtime entrypoint, binds the port
  routes/           # route definitions, mounted onto the root router
  controllers/       # thin HTTP handlers — no business logic
  application/       # (empty — application/use-case services land in later tickets)
  domain/             # (empty — pricing/shipping/allocation logic lands in later tickets)
  repositories/       # (empty — data access lands in later tickets)
  infrastructure/     # (empty — DB/external clients land in later tickets)
  middleware/         # (empty — error handling etc. lands in later tickets)
  config/             # environment/config loading
  utils/              # (empty — shared helpers as needed)
tests/
```

`app.ts` is kept separate from `server.ts` specifically so the Koa app can be imported and exercised
in tests (via `supertest`) without binding a real port.
