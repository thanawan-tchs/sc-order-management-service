# Ticket 14 — GET /v1/orders/:orderNumber

## Objective
Retrieve a previously submitted order.

## Endpoint
```http
GET /v1/orders/:orderNumber
```

## Response
Return:
- order number
- status
- quantity
- destination
- subtotal
- discount
- amount after discount
- shipping cost
- total
- allocations
- createdAt

## Important
Return the persisted calculation snapshot.

Do not recalculate historical pricing, distance, or discount.

## HTTP Behavior
- `200 OK` when found.
- `404 Not Found` when order does not exist.

## Acceptance Criteria
- Correct order is returned.
- Stored pricing is returned exactly.
- Allocation details are included.
- Unknown order returns 404.

## Test Cases
- Existing order.
- Unknown order.
- Multi-warehouse order.
- Historical price after changing current pricing configuration.

## Dependencies
Ticket 10.

## Definition of Done
Repository, service, controller, route, and integration tests are complete.
