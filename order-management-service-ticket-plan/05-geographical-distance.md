# Ticket 05 — Geographical Distance Calculator

## Objective
Calculate geographical distance between a warehouse and shipping destination.

## Technical Design
Use the Haversine formula.

Input:
```text
warehouse latitude/longitude
destination latitude/longitude
```

Output:
```text
distance in kilometers
```

Keep the calculator pure and independent of Koa/database code.

Use a consistent Earth-radius constant.

## Acceptance Criteria
- Same coordinates return approximately 0 km.
- Distances are returned in kilometers.
- Coordinate conversion is correct.
- Calculation is deterministic.

## Test Cases
- Same point.
- Short distance.
- Long distance.
- Northern/southern hemispheres.
- Eastern/western coordinates.

## Dependencies
Ticket 02.

## Definition of Done
Calculator has isolated unit tests and documented assumptions.
