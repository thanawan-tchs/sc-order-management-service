# Order Management Service — System Design

## Architecture

```text
                    ┌──────────────────┐
                    │   Sales Rep/UI   │
                    └────────┬─────────┘
                             │ HTTPS
                             ▼
                    ┌──────────────────┐
                    │   Koa REST API   │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ Controllers      │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ Application      │
                    │ Services         │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
     ┌──────────┐      ┌───────────┐      ┌────────────┐
     │ Pricing  │      │ Shipping  │      │ Allocation │
     └──────────┘      └───────────┘      └────────────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             ▼
                    ┌──────────────────┐
                    │ Repositories     │
                    ├──────────────────┤
                    │ Order            │
                    │ Inventory        │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   PostgreSQL     │
                    └──────────────────┘
```

## API

```text
POST /v1/orders/quote
POST /v1/orders
GET  /v1/orders/:orderNumber
```

## Quote vs Submit

Quote:
```text
validate
→ calculate
→ return
→ NO side effects
```

Submit:
```text
validate
→ BEGIN TRANSACTION
→ read current stock
→ calculate
→ validate
→ atomic inventory deduction
→ create order
→ create allocations
→ COMMIT
```

The submit operation must recalculate instead of trusting an earlier quote because inventory may have changed.

## Pricing

```text
subtotal = quantity × $150
discount = volume discount
amountAfterDiscount = subtotal - discount
weight = quantity × 0.365 kg
```

Shipping:
```text
shipping = distanceKm × weightKg × $0.01
```

Multi-warehouse:
```text
totalShipping = sum(shipping cost for every allocation)
```

Validity:
```text
shipping <= amountAfterDiscount × 15%
```

## Allocation

Because shipping cost is linear per unit and all devices have identical weight:

```text
calculate cost per unit
→ sort ascending
→ allocate from cheapest warehouse first
→ continue until fulfilled
```

This is optimal under the stated requirements.

## Database

PostgreSQL is recommended because submission requires atomic changes to multiple inventory rows plus order persistence.

Suggested schema:

```text
items
warehouses
inventory
orders
order_allocations
idempotency_keys
```

Important constraints:

```text
inventory.stock >= 0
orders.order_number UNIQUE
idempotency_keys.key UNIQUE
```

## Money

Use integer cents:

```text
$150 = 15000 cents
```

Persist the exact calculated financial snapshot on the order.

## Main Risks

### Quote becomes stale
A quote does not reserve stock. Submit must recalculate.

### Concurrent orders
Use transaction + row locking or atomic conditional inventory updates.

### Partial inventory update
All inventory changes and order creation must be in one transaction.

### Duplicate submit
Use idempotency keys with a unique database constraint.

### Future pricing changes
Store historical price/discount/shipping snapshot rather than recalculating old orders.
