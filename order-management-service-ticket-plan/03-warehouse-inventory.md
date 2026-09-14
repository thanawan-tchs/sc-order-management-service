# Ticket 03 — Warehouse and Inventory Repository

## Objective
Persist and retrieve the six warehouses and their inventory.

## Warehouse Data

| Warehouse | Latitude | Longitude | Stock |
|---|---:|---:|---:|
| Los Angeles | 33.9425 | -118.408056 | 355 |
| New York | 40.639722 | -73.778889 | 578 |
| São Paulo | -23.435556 | -46.473056 | 265 |
| Paris | 49.009722 | 2.547778 | 694 |
| Warsaw | 52.165833 | 20.967222 | 245 |
| Hong Kong | 22.308889 | 113.914444 | 419 |

## Technical Design

Repository operations:
```text
getAllWarehouses()
getWarehouse(id)
getInventory(id)
decrementInventory(id, quantity)
```

`decrementInventory` must be atomic:

```sql
UPDATE inventory
SET stock = stock - :quantity
WHERE warehouse_id = :warehouseId
  AND stock >= :quantity;
```

Verify affected rows = 1.

## Acceptance Criteria
- All six warehouses exist.
- Stock matches initial requirements.
- Stock never becomes negative.
- Concurrent deductions cannot oversell inventory.

## Test Cases
- Retrieve all warehouses.
- Deduct valid quantity.
- Reject deduction larger than stock.
- Attempt concurrent deductions.

## Dependencies
Ticket 01, Ticket 02.

## Definition of Done
Repository is covered by integration tests against the chosen database.
