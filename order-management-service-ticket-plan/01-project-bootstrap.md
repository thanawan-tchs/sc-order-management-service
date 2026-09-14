# Ticket 01 — Project Bootstrap

## Objective
Create the Node.js + TypeScript + Koa service foundation.

## Background
We need a maintainable service structure that keeps HTTP concerns separate from business logic and infrastructure.

## Technical Design
Create:
```text
src/
  app.ts
  server.ts
  routes/
  controllers/
  application/
  domain/
  repositories/
  infrastructure/
  middleware/
  config/
  utils/
tests/
```

Configure TypeScript, Koa, router, body parsing, linting, formatting, and test tooling.

Separate `app.ts` from `server.ts` so the Koa application can be imported by tests without starting a real server.

## API
`GET /health` → `200 OK`

## Acceptance Criteria
- TypeScript compiles.
- Application starts successfully.
- `/health` returns 200.
- Test command works.
- Lint/build commands work.
- No business logic exists in route handlers.

## Test Cases
- Application boots.
- Health endpoint returns expected response.

## Dependencies
None.

## Definition of Done
Code, tests, scripts, and README setup are committed and runnable locally.
