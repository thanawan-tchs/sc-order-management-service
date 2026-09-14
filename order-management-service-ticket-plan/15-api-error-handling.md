# Ticket 15 — API Error Handling

## Objective
Create consistent error handling across Koa APIs.

## Error Shape
```json
{
  "error": {
    "code": "INVALID_QUANTITY",
    "message": "Quantity must be greater than 0"
  }
}
```

## Error Codes
```text
INVALID_QUANTITY
INVALID_LATITUDE
INVALID_LONGITUDE
INSUFFICIENT_STOCK
SHIPPING_COST_EXCEEDS_15_PERCENT
INVENTORY_CONFLICT
ORDER_NOT_FOUND
IDEMPOTENCY_KEY_REUSED
```

## Technical Design
Implement centralized Koa error middleware.

Application/domain errors should be mapped to HTTP responses centrally.

Do not expose stack traces or internal database errors.

## Acceptance Criteria
- Known errors return consistent JSON.
- Unknown errors return generic 500.
- Controllers do not duplicate error handling.
- Logs contain internal diagnostic information without leaking it to clients.

## Test Cases
- Validation error.
- Business error.
- Not found.
- Inventory conflict.
- Unexpected exception.

## Dependencies
Tickets 09, 12, 14.

## Definition of Done
All APIs use the same error contract.
