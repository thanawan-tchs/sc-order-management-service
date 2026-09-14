# Ticket 13 — Idempotency and Concurrency Protection

## Objective
Prevent duplicate orders from retries and prevent inventory overselling.

## Idempotency

Request header:
```http
Idempotency-Key: <client-generated-key>
```

Persist the key with the order.

Repeated request with the same key should return the same result rather than create another order.

## Important
A unique database constraint should enforce idempotency at persistence level.

## Concurrency

Example:
```text
Stock = 10

Request A wants 8
Request B wants 8
```

Both must not succeed.

Use:
```sql
UPDATE inventory
SET stock = stock - 8
WHERE warehouse_id = ?
  AND stock >= 8;
```

or row locking inside a transaction.

## Acceptance Criteria
- Same idempotency key cannot create two orders.
- Inventory cannot become negative.
- Concurrent submissions produce correct results.
- Failed transaction does not consume idempotency state incorrectly.

## Test Cases
- Same request twice.
- Same key concurrently.
- Different keys competing for same stock.
- Exactly enough stock.
- More demand than stock.

## Dependencies
Ticket 11, Ticket 12.

## Definition of Done
Concurrency tests are automated and database constraints are in place.
