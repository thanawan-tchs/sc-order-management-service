# Ticket 09 — POST /v1/orders/quote

## Objective
Expose order verification through HTTP.

## Request
```json
{
  "quantity": 50,
  "shippingAddress": {
    "latitude": 40.7128,
    "longitude": -74.006
  }
}
```

## Response
```json
{
  "valid": true,
  "quantity": 50,
  "pricing": {
    "subtotalCents": 750000,
    "discountRate": 0.10,
    "discountCents": 75000,
    "amountAfterDiscountCents": 675000,
    "shippingCents": 444,
    "totalCents": 675444
  },
  "shipping": {
    "totalWeightKg": 18.25,
    "allocations": []
  },
  "invalidReason": null
}
```

## Technical Design
Controller responsibilities:
1. Parse request.
2. Validate.
3. Call quote application service.
4. Map result to HTTP response.

No pricing or allocation logic belongs in the controller.

## HTTP Behavior
- `200 OK` for successfully calculated quote, even if business-invalid.
- `400 Bad Request` for malformed input.

## Acceptance Criteria
- Endpoint returns correct quote.
- Endpoint has no side effects.
- Validation errors are consistent.
- Integration tests exist.

## Dependencies
Ticket 08.

## Definition of Done
API is wired through router → controller → application service.
