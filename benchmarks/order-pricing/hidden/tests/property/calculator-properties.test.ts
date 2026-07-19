// calculator-properties.test.ts — Property-based tests for calculator functions
//
// These properties test the pure calculator functions directly (no HTTP).
//
// Properties (SPEC.md §10 + domain invariants):
//   1. Quantity Scaling (P1)
//   5. Repeated Calculation (P5)
//   6. Serialization Stability (P6)
//   7. Fixed Discount Floor (P7 / I-06)
//   8. Grand Total Non-Negative (I-08)
//   9. Total Consistency (I-16)
//   11. Discount Total Non-Negative (P11)

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { Decimal } from "decimal.js";
import {
  calculateLineTotal,
  calculateSubtotal,
  calculateDiscounts,
  calculateTax,
  calculateGrandTotal,
  calculateOrderTotals,
} from "@candidate/calculator.js";
import {
  arbMonetaryString,
  arbAddDiscountParams,
  arbCalculatorOrderParams,
  arbDiscountMonetaryString,
  arbTaxRate,
} from "./arbitraries.js";

// ── Helpers ─────────────────────────────────────────────────────────────

/** Parse a monetary string to Decimal for comparison */
function toDecimal(s: string): Decimal {
  return new Decimal(s || "0");
}

/** Format Decimal back to 2-decimal string (matches calculator.ts) */
function formatDecimal(d: Decimal): string {
  return d.toFixed(2, Decimal.ROUND_HALF_UP);
}

/** Build full item objects with calculated lineTotals */
function buildItems(
  tuples: Array<{ unitPrice: string; quantity: number }>
): Array<{ lineTotal: string }> {
  return tuples.map((t) => ({
    lineTotal: calculateLineTotal(t.unitPrice, t.quantity),
  }));
}

/**
 * Check if any discount in the list is a fixed discount.
 * Used by Quantity Scaling (P1) which requires no fixed discounts.
 */
function hasNoFixedDiscount(
  discounts: Array<{ type: "percentage" | "fixed"; value: string }>
): boolean {
  return discounts.every((d) => d.type !== "fixed");
}

// ════════════════════════════════════════════════════════════════════════
// P1: Quantity Scaling
// ════════════════════════════════════════════════════════════════════════
//
// For an order with no fixed discount, doubling all quantities should
// double the subtotal. This holds because:
//   - lineTotal = unitPrice × quantity (linear in quantity)
//   - subtotal = sum of lineTotals
//   - No fixed discount means no non-linear scaling in the subtotal path
//   - (Percentage discounts scale with subtotal but don't affect the
//     subtotal itself — they only affect discountTotal/taxableAmount)

describe("P1: Quantity Scaling", () => {
  it("doubling all quantities doubles subtotal (no fixed discounts)", () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            fc.array(
              fc.tuple(arbMonetaryString(), fc.nat({ max: 100 }).filter((n) => n >= 1)),
              { minLength: 0, maxLength: 5 }
            ),
            fc
              .array(arbAddDiscountParams(), { minLength: 0, maxLength: 4 })
              .filter(hasNoFixedDiscount),
            arbTaxRate()
          )
          .map(([items, discounts, taxRate]) => ({
            items: items.map(([unitPrice, quantity]) => ({ unitPrice, quantity })),
            discounts,
            taxRate,
          })),
        (order) => {
          // Original calculation
          const originalItems = buildItems(order.items);
          const originalSubtotal = calculateSubtotal(originalItems);

          // Doubled quantities
          const doubledItems = buildItems(
            order.items.map((item) => ({
              unitPrice: item.unitPrice,
              quantity: item.quantity * 2,
            }))
          );
          const doubledSubtotal = calculateSubtotal(doubledItems);

          // Assert: doubled = 2 × original
          const expectedDoubled = formatDecimal(
            toDecimal(originalSubtotal).mul(2)
          );
          expect(doubledSubtotal).toBe(expectedDoubled);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ════════════════════════════════════════════════════════════════════════
// P5: Repeated Calculation
// ════════════════════════════════════════════════════════════════════════
//
// Calculating an unchanged order twice returns identical totals.

describe("P5: Repeated Calculation", () => {
  it("calculating the same order twice returns identical results", () => {
    fc.assert(
      fc.property(arbCalculatorOrderParams(), (order) => {
        const items = buildItems(order.items);
        const result1 = calculateOrderTotals(items, order.discounts, order.taxRate);
        const result2 = calculateOrderTotals(items, order.discounts, order.taxRate);

        expect(result2).toEqual(result1);
      }),
      { numRuns: 100 }
    );
  });
});

// ════════════════════════════════════════════════════════════════════════
// P6: Serialization Stability
// ════════════════════════════════════════════════════════════════════════
//
// serialize → deserialize → calculate preserves all financial results.
// This simulates storing the order state and recalculating after loading.

describe("P6: Serialization Stability", () => {
  it("serialize-then-deserialize preserves calculation results", () => {
    fc.assert(
      fc.property(arbCalculatorOrderParams(), (order) => {
        const items = buildItems(order.items);

        // First calculation (original state)
        const original = calculateOrderTotals(items, order.discounts, order.taxRate);

        // Simulate serialization: JSON.stringify then JSON.parse
        const serialized = JSON.stringify({ items, discounts: order.discounts, taxRate: order.taxRate });
        const deserialized: {
          items: Array<{ lineTotal: string }>;
          discounts: Array<{ type: "percentage" | "fixed"; value: string }>;
          taxRate: string;
        } = JSON.parse(serialized);

        // Recalculate from deserialized state
        const restored = calculateOrderTotals(
          deserialized.items,
          deserialized.discounts,
          deserialized.taxRate
        );

        // All financial fields should match
        expect(restored.subtotal).toBe(original.subtotal);
        expect(restored.discountTotal).toBe(original.discountTotal);
        expect(restored.taxableAmount).toBe(original.taxableAmount);
        expect(restored.taxTotal).toBe(original.taxTotal);
        expect(restored.grandTotal).toBe(original.grandTotal);
      }),
      { numRuns: 100 }
    );
  });
});

// ════════════════════════════════════════════════════════════════════════
// P7: Fixed Discount Floor (I-06)
// ════════════════════════════════════════════════════════════════════════
//
// If the total discount (fixed or percentage) exceeds the subtotal,
// the discount total is capped at the subtotal, and taxable amount
// becomes zero. This invariant is enforced in calculateDiscounts.

describe("P7: Fixed Discount Floor (I-06)", () => {
  it("fixed discount > subtotal produces zero taxable amount", () => {
    fc.assert(
      fc.property(
        // Generate items and a fixed discount guaranteed to exceed subtotal
        arbMonetaryString()
          .chain((unitPrice) =>
            fc
              .tuple(
                fc.constant(unitPrice),
                fc.nat({ max: 100 }).filter((n) => n >= 1),
                // Generate a fixed discount value that is larger than unitPrice * quantity
                fc.nat({ max: 100_000 }).map((n) => String(n))
              )
              .filter(([price, qty, discountStr]) => {
                // Only keep cases where fixed discount > line total
                // Line total = price * qty (approx - we just need a rough check)
                const priceNum = parseFloat(price);
                const lineTotal = priceNum * qty;
                const discount = parseFloat(discountStr);
                return discount > lineTotal;
              })
          )
          .map(([unitPrice, quantity, fixedValue]) => ({
            items: [{ unitPrice, quantity }],
            fixedValue,
          })),
        (order) => {
          const items = buildItems(order.items);
          const subtotal = calculateSubtotal(items);

          const result = calculateDiscounts(subtotal, [
            { type: "fixed", value: order.fixedValue },
          ]);

          // Discount should be capped at subtotal
          expect(result.discountTotal).toBe(subtotal);
          // Taxable amount should be zero
          expect(result.taxableAmount).toBe("0.00");
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ════════════════════════════════════════════════════════════════════════
// I-08: Grand Total Non-Negative
// ════════════════════════════════════════════════════════════════════════
//
// For any valid order, grandTotal >= 0. The discount floor (I-06)
// ensures taxable amount is never negative, and tax is computed on
// non-negative amounts, so grandTotal = subtotal - discountTotal + taxTotal
// is also non-negative.

describe("I-08: Grand Total Non-Negative", () => {
  it("grand total is always >= 0 for any valid order", () => {
    fc.assert(
      fc.property(arbCalculatorOrderParams(), (order) => {
        const items = buildItems(order.items);
        const result = calculateOrderTotals(items, order.discounts, order.taxRate);

        expect(toDecimal(result.grandTotal).greaterThanOrEqualTo(0)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

// ════════════════════════════════════════════════════════════════════════
// I-16: Total Consistency
// ════════════════════════════════════════════════════════════════════════
//
// grandTotal = subtotal - discountTotal + taxTotal
// This must hold for every valid order.

describe("I-16: Total Consistency", () => {
  it("grandTotal equals subtotal - discountTotal + taxTotal", () => {
    fc.assert(
      fc.property(arbCalculatorOrderParams(), (order) => {
        const items = buildItems(order.items);
        const result = calculateOrderTotals(items, order.discounts, order.taxRate);

        const grandFromParts = formatDecimal(
          toDecimal(result.subtotal)
            .sub(toDecimal(result.discountTotal))
            .add(toDecimal(result.taxTotal))
        );

        expect(result.grandTotal).toBe(grandFromParts);
      }),
      { numRuns: 100 }
    );
  });
});

// ════════════════════════════════════════════════════════════════════════
// P11: Discount Total Non-Negative
// ════════════════════════════════════════════════════════════════════════
//
// discountTotal >= 0 for any valid discount combinations.
// This holds because all discount values are non-negative strings
// and the discount floor caps at subtotal (which is >= 0).

describe("P11: Discount Total Non-Negative", () => {
  it("discount total is always >= 0 for any discount combination", () => {
    fc.assert(
      fc.property(arbCalculatorOrderParams(), (order) => {
        const items = buildItems(order.items);
        const result = calculateOrderTotals(items, order.discounts, order.taxRate);

        expect(toDecimal(result.discountTotal).greaterThanOrEqualTo(0)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
