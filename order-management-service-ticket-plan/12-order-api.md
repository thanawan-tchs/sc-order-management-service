# Ticket 12 — POST /v1/orders

## Objective
Expose transactional order submission.

## Request
```json
{
  "quantity": 100,
  "shippingAddress": {
    "latitude": 40.7128,
    "longitude": -74.006
  }
}
```

## Success
Return:
```text
201 Created
```

Include:
- order number
- status
- quantity
- pricing snapshot
- warehouse allocations

## Suggested response
```json
{
  "orderNumber": "ORD-20260914-000001",
  "status": "CONFIRMED",
  "quantity": 100,
  "pricing": {
    "subtotalCents": 1500000,
    "discountCents": 225000,
    "shippingCents": 888,
    "totalCents": 1275888
  },
  "shipping": {
    "allocations": [
      {
        "warehouseId": "new-york",
        "quantity": 100
      }
    ]
  }
}
```

## HTTP Behavior
- `201` successful creation
- `400` invalid request
- `409` inventory conflict
- `422` may be used for business rejection if the team adopts that convention

## Acceptance Criteria
- Controller invokes transactional service.
- Client cannot override pricing.
- Inventory changes only after successful transaction.
- Integration tests verify end-to-end behavior.

## Dependencies
Ticket 11.

## Definition of Done
Endpoint is production-ready and documented.
