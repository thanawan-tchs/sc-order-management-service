# Ticket 17 — Observability and Production Readiness

## Objective
Make the service operable and diagnosable in production.

## Logging

Use structured logs.

Include:
- requestId
- operation
- duration
- orderNumber when available
- error code
- database operation timing where useful

Do not log sensitive data unnecessarily.

## Metrics

Recommended:
- quote request count
- quote latency
- submit request count
- successful orders
- rejected orders
- insufficient-stock count
- inventory-conflict count
- transaction failures
- database latency
- 5xx rate

## Health

```http
GET /health
GET /ready
```

`/health` indicates the process is alive.

`/ready` indicates dependencies required to serve traffic are available.

## Production Concerns
- environment-based configuration
- graceful shutdown
- connection-pool configuration
- request timeout
- database timeout
- structured logging
- metrics
- tracing/correlation IDs
- Docker image
- CI pipeline

## Acceptance Criteria
- Health/readiness endpoints exist.
- Logs are structured.
- Requests can be correlated.
- Critical business failures are measurable.
- Graceful shutdown closes database connections.
- CI executes build and tests.

## Dependencies
All previous tickets.

## Definition of Done
Service has the minimum observability and operational controls required for deployment.
