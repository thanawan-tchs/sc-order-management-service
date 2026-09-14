# Ticket 08 — Order Quote Application Service

## Objective
Build the complete side-effect-free order verification flow.

## Flow
```text
Request
  ↓
Validate
  ↓
Read current inventory
  ↓
Calculate pricing
  ↓
Calculate warehouse distances
  ↓
Optimize allocation
  ↓
Calculate shipping
  ↓
Check 15% rule
  ↓
Return quote
```

## Business Rule
```text
shippingCost <= amountAfterDiscount * 15%
```

If false:
```text
valid = false
invalidReason = SHIPPING_COST_EXCEEDS_15_PERCENT
```

Insufficient stock should also make the quote invalid.

## Important
This service must:
- not create orders
- not change inventory
- not reserve stock

## Acceptance Criteria
Quote returns:
- quantity
- subtotal
- discount rate
- discount amount
- amount after discount
- total weight
- shipping cost
- allocations
- validity
- invalid reason

## Test Cases
- Valid order.
- Discount boundaries.
- Multi-warehouse order.
- Insufficient stock.
- Shipping > 15%.
- Shipping exactly 15%.
- Shipping below 15%.

## Dependencies
Tickets 03–07.

## Definition of Done
Application service has isolated unit tests and no HTTP dependencies.
