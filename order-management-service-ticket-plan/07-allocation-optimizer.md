# Ticket 07 — Lowest-Cost Warehouse Allocation

## Objective
Find the lowest-cost way to fulfill an order across warehouses.

## Business Rule
A single order may use multiple warehouses.

We always want the lowest total shipping cost.

## Technical Design

Because:
- every device has the same weight
- shipping rate is linear
- there is no warehouse setup fee

the optimal algorithm is greedy.

Steps:
1. Calculate distance to each warehouse.
2. Calculate shipping cost per device.
3. Sort warehouses ascending by cost per device.
4. Take as many units as possible from the cheapest warehouse.
5. Continue until quantity is fulfilled.

Example:
```text
A: 100 stock, $1/unit
B: 50 stock,  $2/unit
C: 200 stock, $3/unit

Order: 120

A = 100
B = 20
C = 0
```

Do not mutate inventory in this ticket.

## Acceptance Criteria
- Allocation never exceeds warehouse stock.
- Allocation sums to requested quantity when possible.
- Cheapest warehouses are preferred.
- Multiple warehouses are supported.
- Insufficient total stock is detected.

## Test Cases
- Single warehouse.
- Two warehouses.
- Three warehouses.
- Exact stock.
- Insufficient stock.
- Equal shipping cost.
- Large order.

## Dependencies
Ticket 03, Ticket 05, Ticket 06.

## Definition of Done
Optimizer is a pure application/domain function with comprehensive unit tests.
