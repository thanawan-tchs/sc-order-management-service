# Ticket 16 — Test Strategy and Integration Tests

## Objective
Provide confidence in all critical business rules and the complete order lifecycle.

## Unit Tests

Test independently:
- volume discount
- pricing
- Haversine distance
- shipping cost
- warehouse allocation
- 15% validity rule

## Integration Tests

Cover:
```text
POST /v1/orders/quote
POST /v1/orders
GET /v1/orders/:orderNumber
```

## Critical Scenarios

1. Quantity 1.
2. Quantity 24.
3. Quantity 25.
4. Quantity 49.
5. Quantity 50.
6. Quantity 99.
7. Quantity 100.
8. Quantity 249.
9. Quantity 250.
10. Single warehouse.
11. Multiple warehouses.
12. Insufficient stock.
13. Shipping exactly 15%.
14. Shipping above 15%.
15. Concurrent inventory deductions.
16. Transaction rollback.
17. Idempotent retry.
18. Historical price snapshot.

## Acceptance Criteria
- Business logic has high unit-test coverage.
- Critical HTTP flows have integration tests.
- Database transaction behavior is tested against a real database.
- Tests are deterministic.

## Dependencies
Tickets 04–15.

## Definition of Done
CI runs unit and integration tests automatically.
