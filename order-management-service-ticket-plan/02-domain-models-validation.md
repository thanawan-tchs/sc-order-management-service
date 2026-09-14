# Ticket 02 — Domain Models and Request Validation

## Objective
Define the core domain types and validate order requests.

## Background
Every API depends on the same domain concepts, so these should be explicit and strongly typed.

## Technical Design

Core types:
- Item
- Warehouse
- Inventory
- ShippingAddress
- ShippingAllocation
- OrderQuote
- Order
- Money

Request:
```json
{
  "quantity": 50,
  "shippingAddress": {
    "latitude": 40.7128,
    "longitude": -74.006
  }
}
```

Validation:
- quantity is an integer > 0
- latitude is between -90 and 90
- longitude is between -180 and 180
- reject missing, NaN, Infinity, and invalid types

Use a schema validation library rather than handwritten validation scattered through controllers.

## Acceptance Criteria
- Invalid requests are rejected consistently.
- Valid requests produce typed domain input.
- Validation is reusable by quote and submit APIs.

## Test Cases
Cover zero, negative, decimal, missing quantity; invalid latitude/longitude; valid boundary coordinates.

## Dependencies
Ticket 01.

## Definition of Done
Validation tests cover all boundaries and controllers do not duplicate validation logic.
