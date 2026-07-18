# Order-Pricing Domain Invariants

> **Version:** 0.1.0
> **Status:** Canonical — implementation-independent
> **Source:** SPEC.md §7
>
> These invariants define what "correct" means for the order-pricing domain.
> Every implementation must satisfy all invariants.
> Invariants are verified independently of any specific implementation.

---

## I-01: Positive Quantity

**Rule:** Quantity must be a positive integer (≥ 1).

**Scope:** `OrderItem.quantity`, `AddItemRequest.quantity`, `UpdateItemRequest.quantity`

**Rationale:** A line item with zero or negative quantity has no meaningful interpretation in an order-pricing context.

**Test:** Attempt to create or update an item with quantity ≤ 0. Expect HTTP 400.

---

## I-02: Non-Negative Unit Price

**Rule:** Unit price must be greater than or equal to zero.

**Scope:** `OrderItem.unitPrice`, `AddItemRequest.unitPrice`

**Rationale:** Negative unit prices would allow orders with negative totals, violating I-08.

**Test:** Attempt to create or update an item with negative unit price. Expect HTTP 400.

---

## I-03: Tax Rate Range

**Rule:** Tax rate must be between 0 and 1 inclusive, expressed as a decimal string.

**Scope:** `Order.taxRate`, `CreateOrderRequest.taxRate`

**Rationale:** Tax rates outside [0, 1] are invalid in any jurisdiction. 0 represents untaxed; 1 represents 100% tax.

**Test:** Attempt to create an order with tax rate -0.01 or 1.01. Expect HTTP 400.

---

## I-04: Percentage Discount Range

**Rule:** Percentage discounts must be between 0 and 1 inclusive.

**Scope:** `Discount.type = "percentage"`, `Discount.value`

**Rationale:** A percentage discount outside [0, 1] is nonsensical (negative discounts would increase the price; >100% would produce negative taxable amounts).

**Test:** Property test — for any valid order, adding a 0.5 discount should reduce grand total by ~50% of taxable amount.

---

## I-05: Fixed Discount Non-Negative

**Rule:** Fixed discounts must be non-negative (≥ 0).

**Scope:** `Discount.type = "fixed"`, `Discount.value`

**Rationale:** A negative fixed discount would add money to the order.

**Test:** Attempt to add a fixed discount of "-5.00". Expect HTTP 400.

---

## I-06: Discount Floor

**Rule:** Total discount must not reduce the taxable amount below zero.

**Scope:** Calculation of `taxTotal` during `POST /orders/{id}/calculate`

**Rationale:** Tax is calculated on (subtotal − discountTotal). If discountTotal exceeds subtotal, the taxable amount is zero — not negative.

**Test:** Order with subtotal 10.00, fixed discount 15.00. After calculate: discountTotal = 10.00 (capped), taxTotal = 0.00, grandTotal = 0.00.

---

## I-07: Tax After Discounts

**Rule:** Tax must be calculated after discounts are applied.

**Scope:** `POST /orders/{id}/calculate`

**Rationale:** In most jurisdictions, tax applies to the discounted price, not the pre-discount price. This is a domain rule that distinguishes correct from incorrect implementations.

**Test:** Order with subtotal 100.00, 10% discount, 8% tax. Expected: discountTotal = 10.00, taxableAmount = 90.00, taxTotal = 7.20, grandTotal = 97.20. Incorrect (tax before discount): taxTotal = 8.00, grandTotal = 98.00.

---

## I-08: Non-Negative Grand Total

**Rule:** Grand total must never be negative.

**Scope:** `Order.grandTotal`

**Rationale:** A customer should never be owed money by a simple purchase order.

**Test:** Property test — for any valid combination of items and discounts, grandTotal ≥ 0.

---

## I-09: Monetary Rounding

**Rule:** Monetary values must be rounded using the configured currency precision (2 decimal places for USD, EUR, GBP).

**Scope:** All monetary fields in Order response

**Rationale:** Financial calculations require consistent rounding. Half-up rounding (banker's rounding) to 2 decimal places.

**Test:** Verify that $10.00 × 0.0833 (8.33% tax) = $0.83, not $0.833.

---

## I-10: Calculation Idempotency

**Rule:** Repeating the same calculation must produce the same result.

**Scope:** `POST /orders/{id}/calculate`

**Rationale:** Calling calculate twice on an unchanged order must return identical monetary values. Implementation must not use non-deterministic floating-point operations or store mutable intermediate state.

**Test:** Call calculate, record grandTotal. Call calculate again. Assert grandTotal unchanged.

---

## I-11: Request Idempotency

**Rule:** Repeating an idempotent request must not create duplicate resources.

**Scope:** All POST endpoints with `Idempotency-Key` header.

**Rationale:** Network retries should not create duplicate orders, items, or discounts. The first request creates the resource; subsequent requests with the same key return the existing resource.

**Test:** POST /orders with key "abc". POST /orders again with key "abc". Assert only one order exists and both responses return HTTP 200 with the same order.

---

## I-12: Calculated Order Immutability

**Rule:** A calculated order cannot be modified unless explicitly reopened.

**Scope:** POST/PATCH/DELETE on items and discounts for orders with status "calculated".

**Rationale:** Once financial totals are computed and recorded, the order state must be locked to prevent inconsistencies.

**Test:** Calculate an order. Attempt to add an item. Expect HTTP 409.

---

## I-13: Schema Compliance

**Rule:** All persisted order state must satisfy the OpenAPI response schema defined in `openapi.yaml`.

**Scope:** All GET responses, POST /calculate response.

**Rationale:** Every response from the API must validate against the contract. This is verified by contract validation (Stage 6 of the verification pipeline).

**Test:** After every mutation, GET the order and validate the response against the OpenAPI schema.

---

## I-14: Error Response Safety

**Rule:** Error responses must not expose stack traces, environment details, file paths, or internal implementation information.

**Scope:** All 4xx and 5xx responses.

**Rationale:** Leaking internal details is a security and compliance risk. Error responses must contain only the fields defined in the `ErrorResponse` schema.

**Test:** Trigger various error conditions and verify responses contain only `error`, `message`, and optionally `details` fields. No `stack`, `sql`, `filePath`, or `env` fields.

---

## I-15: Unique Identifiers

**Rule:** Generated identifiers must be unique within the test run.

**Scope:** `Order.id`, `OrderItem.id`, `Discount.id`

**Rationale:** UUIDs are used to ensure no collisions. Implementations must use a proper UUID v4 generator.

**Test:** Create 1000 orders in a loop. Assert all IDs are unique.

---

## I-16: Total Consistency

**Rule:** Order totals must satisfy: `grandTotal = subtotal − discountTotal + taxTotal`

**Scope:** `Order` response after calculation.

**Rationale:** The monetary breakdown must be internally consistent. Any rounding must be applied consistently so this equation holds.

**Test:** Property test — for any valid order, after calculation, the sum of parts equals the grand total.

---

## I-17: Invalidation on Item Removal

**Rule:** Removing an item or altering quantities must invalidate previously calculated totals.

**Scope:** Order state after DELETE /items/{id} or PATCH /items/{id}.

**Rationale:** If an item is removed after calculation, the totals no longer reflect the order contents. The implementation must either prevent modifications to calculated orders (I-12) or detect and flag stale calculations.

**Test:** Calculate an order. Remove an item (if allowed). Assert that the order either rejects the modification or reflects the changed state.

---

## I-18: Deterministic Not-Found

**Rule:** Unknown order, item, and discount identifiers must produce deterministic not-found responses.

**Scope:** All GET/PATCH/DELETE endpoints with path parameters.

**Rationale:** Error responses must be consistent — the same missing identifier always produces the same HTTP 404 with the same error structure.

**Test:** Request GET /orders/nonexistent-id multiple times. Assert identical status codes and error message structures.
