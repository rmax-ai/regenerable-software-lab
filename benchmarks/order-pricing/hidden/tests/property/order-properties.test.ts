// order-properties.test.ts — Property-based tests for order pricing via HTTP
//
// These properties test via HTTP (using fastify's app.inject()) to exercise
// the full request/response pipeline including Zod validation.
//
// Properties (SPEC.md §10 + domain invariants):
//   2. Discount Monotonicity (P2)
//   3. Tax Monotonicity (P3)
//   4. Item Permutation (P4)
//   10. Line Item Sum (P10)
//   12. Order Item Idempotency (P12)

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { Decimal } from "decimal.js";
import { buildApp } from "../../../reference-impl/src/server.js";
import type { FastifyInstance } from "fastify";
import {
  arbCreateOrderParams,
  arbAddItemParams,
  arbAddDiscountParams,
  arbMonetaryString,
  arbTaxRate,
} from "./arbitraries.js";

let app: FastifyInstance;

beforeEach(async () => {
  app = buildApp();
});

// ── Helpers ─────────────────────────────────────────────────────────────

/** Create a draft order and return its ID. */
async function createOrder(
  params?: { currency?: string; taxRate?: string }
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/orders",
    payload: {
      currency: params?.currency ?? "USD",
      taxRate: params?.taxRate ?? "0.08",
    },
  });
  return res.json().id;
}

/** Add an item to an order and return the response body. */
async function addItem(
  orderId: string,
  item: { productId: string; name: string; unitPrice: string; quantity: number }
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "POST",
    url: `/orders/${orderId}/items`,
    payload: item,
  });
  return res.json();
}

/** Add a discount to an order. */
async function addDiscount(
  orderId: string,
  discount: { type: "percentage" | "fixed"; value: string }
): Promise<void> {
  await app.inject({
    method: "POST",
    url: `/orders/${orderId}/discounts`,
    payload: discount,
  });
}

/** Calculate an order and return the response body. */
async function calculateOrder(
  orderId: string
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "POST",
    url: `/orders/${orderId}/calculate`,
  });
  return res.json();
}

/** Get an order by ID. */
async function getOrder(orderId: string): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "GET",
    url: `/orders/${orderId}`,
  });
  return res.json();
}

/** Format a Decimal to a 2-decimal string (matches calculator.ts). */
function fmt(d: Decimal): string {
  return d.toFixed(2, Decimal.ROUND_HALF_UP);
}

// ════════════════════════════════════════════════════════════════════════
// P2: Discount Monotonicity
// ════════════════════════════════════════════════════════════════════════
//
// Adding a discount never increases grand total.
// That is: if order A is a subset of order B's discounts,
// then grandTotal(B) <= grandTotal(A).

describe("P2: Discount Monotonicity", () => {
  it("adding a discount never increases grand total", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .tuple(
            fc.array(arbAddItemParams(), { minLength: 1, maxLength: 3 }),
            arbTaxRate(),
            arbAddDiscountParams()
          )
          .filter(([_items, _rate, discount]) => {
            // Skip "0" value discounts — they don't change anything
            const val = discount.value === "0" || discount.value === "0.00"
              || discount.value === "0.0";
            return !val;
          }),
        async ([items, taxRate, extraDiscount]) => {
          // Create order and add items
          const orderId = await createOrder({ taxRate });
          for (const item of items) {
            await addItem(orderId, item);
          }

          // Calculate without extra discount
          const before = await calculateOrder(orderId);
          const grandBefore = new Decimal(before.grandTotal as string);

          // Add the extra discount
          // Note: after calculate, order is "calculated" — can't modify.
          // So we need to add the discount before calculating.
          // But calculate() transitions status to "calculated".
          // Property: create order with baseline discounts, calculate,
          // then create a *new* order with same items + extra discount, calculate.
          // Wait — the property says "Adding a discount never increases grand total"
          // so we need to compare the SAME order before and after adding a discount.
          // Problem: after calculate(), the order becomes "calculated" and can't be modified.
          //
          // Alternative approach: create TWO identical orders (same items, same baseline discounts),
          // but one has an EXTRA discount. Compare their grand totals.

          // Let's restart: create two orders with identical items
          const orderA = await createOrder({ taxRate });
          for (const item of items) {
            await addItem(orderA, item);
          }

          const orderB = await createOrder({ taxRate });
          for (const item of items) {
            await addItem(orderB, item);
          }

          // Calculate order A (without extra discount)
          const resultA = await calculateOrder(orderA);
          const grandA = new Decimal(resultA.grandTotal as string);

          // Add extra discount to order B, then calculate
          await addDiscount(orderB, extraDiscount);
          const resultB = await calculateOrder(orderB);
          const grandB = new Decimal(resultB.grandTotal as string);

          // Adding a discount should not increase grand total
          expect(grandB.lessThanOrEqualTo(grandA)).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ════════════════════════════════════════════════════════════════════════
// P3: Tax Monotonicity
// ════════════════════════════════════════════════════════════════════════
//
// For identical taxable amounts, increasing tax rate never decreases tax total.
// Given two orders with the same items and discounts (hence same taxable amount),
// if taxRate1 < taxRate2, then taxTotal(taxRate1) <= taxTotal(taxRate2).

describe("P3: Tax Monotonicity", () => {
  it("higher tax rate produces >= tax total for identical orders", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .tuple(
            fc.array(arbAddItemParams(), { minLength: 1, maxLength: 3 }),
            arbTaxRate(),
            arbTaxRate()
          )
          .filter(([_items, r1, r2]) => {
            // r1 and r2 must be valid tax rates where r2 > r1
            const d1 = new Decimal(r1);
            const d2 = new Decimal(r2);
            return d2.greaterThan(d1);
          }),
        async ([items, taxRateLow, taxRateHigh]) => {
          // Create two orders with identical items but different tax rates
          const orderA = await createOrder({ taxRate: taxRateLow });
          for (const item of items) {
            await addItem(orderA, item);
          }

          const orderB = await createOrder({ taxRate: taxRateHigh });
          for (const item of items) {
            await addItem(orderB, item);
          }

          // Calculate both
          const resultA = await calculateOrder(orderA);
          const resultB = await calculateOrder(orderB);

          // Both orders have same items, so same subtotal
          // Taxable amounts may differ if percentage discounts are involved
          // (since they depend on subtotal which is same).
          // Same items => same subtotal => with same discounts, same taxable amount
          const taxA = new Decimal(resultA.taxTotal as string);
          const taxB = new Decimal(resultB.taxTotal as string);

          // Higher tax rate should give >= tax total
          expect(taxB.greaterThanOrEqualTo(taxA)).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ════════════════════════════════════════════════════════════════════════
// P4: Item Permutation
// ════════════════════════════════════════════════════════════════════════
//
// Reordering items doesn't change calculated totals.
// The subtotal is a sum, which is commutative.

describe("P4: Item Permutation", () => {
  it("reordering items produces identical financial totals", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .tuple(
            fc.array(arbAddItemParams(), { minLength: 2, maxLength: 5 }),
            arbTaxRate()
          ),
        async ([items, taxRate]) => {
          // Create first order with items in original order
          const orderA = await createOrder({ taxRate });
          for (const item of items) {
            await addItem(orderA, item);
          }

          // Create second order with items in reverse order
          const orderB = await createOrder({ taxRate });
          for (const item of [...items].reverse()) {
            await addItem(orderB, item);
          }

          const resultA = await calculateOrder(orderA);
          const resultB = await calculateOrder(orderB);

          // All financial totals should be identical
          expect(resultB.subtotal).toBe(resultA.subtotal);
          expect(resultB.discountTotal).toBe(resultA.discountTotal);
          expect(resultB.taxableAmount).toBe(resultA.taxableAmount);
          expect(resultB.taxTotal).toBe(resultA.taxTotal);
          expect(resultB.grandTotal).toBe(resultA.grandTotal);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ════════════════════════════════════════════════════════════════════════
// P10: Line Item Sum
// ════════════════════════════════════════════════════════════════════════
//
// subtotal equals sum of all item lineTotals.

describe("P10: Line Item Sum", () => {
  it("subtotal equals sum of all item lineTotals", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .tuple(
            fc.array(arbAddItemParams(), { minLength: 1, maxLength: 5 }),
            arbTaxRate()
          ),
        async ([items, taxRate]) => {
          const orderId = await createOrder({ taxRate });
          for (const item of items) {
            await addItem(orderId, item);
          }

          const result = await calculateOrder(orderId);
          const subtotal = new Decimal(result.subtotal as string);

          // Get order to read item lineTotals
          const order = await getOrder(orderId);
          const orderItems = order.items as Array<{ lineTotal: string }>;
          const lineTotalSum = orderItems.reduce(
            (acc, item) => acc.add(new Decimal(item.lineTotal)),
            new Decimal(0)
          );

          expect(fmt(lineTotalSum)).toBe(fmt(subtotal));
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ════════════════════════════════════════════════════════════════════════
// P12: Order Item Idempotency
// ════════════════════════════════════════════════════════════════════════
//
// Adding the same item twice with different idempotency keys creates
// two different items (distinct IDs) in the order.

describe("P12: Order Item Idempotency", () => {
  it("adding same item with different keys creates two distinct items", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .tuple(
            arbAddItemParams(),
            arbTaxRate()
          ),
        async ([item, taxRate]) => {
          const orderId = await createOrder({ taxRate });

          // Add the same item twice with different idempotency keys
          const res1 = await app.inject({
            method: "POST",
            url: `/orders/${orderId}/items`,
            headers: { "idempotency-key": `key-a-${Date.now()}` },
            payload: item,
          });
          const res2 = await app.inject({
            method: "POST",
            url: `/orders/${orderId}/items`,
            headers: { "idempotency-key": `key-b-${Date.now()}` },
            payload: item,
          });

          expect(res1.statusCode).toBe(201);
          expect(res2.statusCode).toBe(201);

          const body1 = res1.json() as { id: string };
          const body2 = res2.json() as { id: string };

          // Different IDs means two distinct items
          expect(body1.id).not.toBe(body2.id);

          // Both items should be present in the order
          const order = await getOrder(orderId);
          const items = order.items as Array<{ id: string }>;
          expect(items.length).toBe(2);
          const itemIds = items.map((i) => i.id);
          expect(itemIds).toContain(body1.id);
          expect(itemIds).toContain(body2.id);
        }
      ),
      { numRuns: 50 }
    );
  });
});
