# Ticket 06 — Shipping Cost Calculator

## Objective
Calculate shipping cost for an allocation.

## Rule
Shipping rate:
```text
$0.01 per kilogram per kilometer
```

Device:
```text
0.365 kg
```

Formula:
```text
weightKg = quantity * 0.365
shippingCost = distanceKm * weightKg * 0.01
```

For a multi-warehouse order:
```text
totalShipping = SUM(each warehouse shipping cost)
```

## Technical Design
Implement a pure function:
```ts
calculateShippingCost(
  distanceKm,
  quantity,
  unitWeightKg,
  ratePerKgPerKm
)
```

Use a single monetary rounding policy.

## Acceptance Criteria
- Shipping cost is correct.
- Quantity and distance are handled correctly.
- Multi-warehouse costs can be summed.
- Quote and submit use the same calculator.

## Test Cases
- Zero distance.
- One device.
- Large quantity.
- Multiple allocations.
- Monetary rounding.

## Dependencies
Ticket 04, Ticket 05.

## Definition of Done
Unit tests verify formula and rounding behavior.
