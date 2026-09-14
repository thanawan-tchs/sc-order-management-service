# Ticket 11 — Atomic Order Submission

## Objective
Submit an order while updating inventory atomically.

## Flow
```text
POST /orders
   ↓
Validate
   ↓
BEGIN TRANSACTION
   ↓
Read current inventory
   ↓
Calculate allocation
   ↓
Calculate pricing
   ↓
Validate 15% rule
   ↓
Atomically deduct inventory
   ↓
Create order
   ↓
Create allocations
   ↓
COMMIT
```

## Critical Rule
The server must recalculate the order at submission time.

Never trust price, discount, shipping, or allocation values sent by a client.

## Failure
If any inventory update fails:
```text
ROLLBACK
```

No partial inventory deduction and no order should remain.

## Concurrency
Use row locking or conditional atomic updates depending on database design.

## Acceptance Criteria
- Successful submission creates order.
- Inventory decreases immediately.
- Multi-warehouse deduction is supported.
- Invalid orders do not modify inventory.
- Inventory conflict rolls back the complete transaction.

## Test Cases
- Successful single warehouse.
- Successful multiple warehouses.
- Insufficient stock.
- Inventory conflict.
- Database failure after inventory update.
- Transaction rollback.

## Dependencies
Tickets 07, 08, 10.

## Definition of Done
Transaction behavior is verified with integration tests against a real database.
