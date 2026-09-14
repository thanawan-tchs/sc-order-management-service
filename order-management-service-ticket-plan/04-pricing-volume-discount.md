# Ticket 04 — Pricing and Volume Discount

## Objective
Implement item pricing and volume discounts as pure business logic.

## Rules

Unit price:
```text
$150
```

Device weight:
```text
0.365 kg
```

Discount:

| Quantity | Discount |
|---:|---:|
| 1–24 | 0% |
| 25–49 | 5% |
| 50–99 | 10% |
| 100–249 | 15% |
| 250+ | 20% |

## Technical Design

Implement pure functions:
```ts
calculateSubtotal(quantity)
getDiscountRate(quantity)
calculateDiscount(subtotal, rate)
calculateAmountAfterDiscount(subtotal, discount)
```

Represent money as integer cents.

## Acceptance Criteria
- Correct discount is returned.
- No floating-point money is persisted.
- Quote and submit use the same pricing service.

## Test Cases
Explicit boundary tests:
```text
24, 25, 49, 50, 99, 100, 249, 250
```

## Dependencies
Ticket 02.

## Definition of Done
All discount boundaries and monetary calculations have unit tests.
