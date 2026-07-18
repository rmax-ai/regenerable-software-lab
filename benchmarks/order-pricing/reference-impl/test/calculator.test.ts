// calculator.test.ts — Unit tests for pure calculator functions
import { describe, it, expect } from "vitest";
import {
  calculateLineTotal,
  calculateSubtotal,
  calculateDiscounts,
  calculateTax,
  calculateGrandTotal,
  calculateOrderTotals,
} from "../src/calculator.js";

// ── calculateLineTotal ──────────────────────────────────────────────────

describe("calculateLineTotal", () => {
  it("multiplies unit price by quantity", () => {
    expect(calculateLineTotal("10.00", 3)).toBe("30.00");
  });

  it("handles fractional unit price", () => {
    expect(calculateLineTotal("10.50", 2)).toBe("21.00");
  });

  it("rounds to two decimal places (I-09)", () => {
    // 10.00 × 1 = 10.00
    expect(calculateLineTotal("10.00", 1)).toBe("10.00");
  });

  it("handles zero price", () => {
    expect(calculateLineTotal("0.00", 5)).toBe("0.00");
  });

  it("handles large quantities", () => {
    expect(calculateLineTotal("0.01", 100)).toBe("1.00");
  });
});

// ── calculateSubtotal ───────────────────────────────────────────────────

describe("calculateSubtotal", () => {
  it("sums line totals", () => {
    expect(
      calculateSubtotal([
        { lineTotal: "10.00" },
        { lineTotal: "20.00" },
        { lineTotal: "30.00" },
      ])
    ).toBe("60.00");
  });

  it("returns 0.00 for empty items", () => {
    expect(calculateSubtotal([])).toBe("0.00");
  });

  it("handles a single item", () => {
    expect(calculateSubtotal([{ lineTotal: "15.50" }])).toBe("15.50");
  });
});

// ── calculateDiscounts ──────────────────────────────────────────────────

describe("calculateDiscounts", () => {
  it("calculates percentage discounts", () => {
    const result = calculateDiscounts("100.00", [
      { type: "percentage", value: "0.10" },
    ]);
    expect(result.discountTotal).toBe("10.00");
    expect(result.taxableAmount).toBe("90.00");
  });

  it("calculates fixed discounts", () => {
    const result = calculateDiscounts("100.00", [
      { type: "fixed", value: "25.00" },
    ]);
    expect(result.discountTotal).toBe("25.00");
    expect(result.taxableAmount).toBe("75.00");
  });

  it("combines multiple discounts", () => {
    const result = calculateDiscounts("100.00", [
      { type: "percentage", value: "0.10" },
      { type: "fixed", value: "5.00" },
    ]);
    expect(result.discountTotal).toBe("15.00");
    expect(result.taxableAmount).toBe("85.00");
  });

  it("caps discount at subtotal — discount floor (I-06)", () => {
    const result = calculateDiscounts("10.00", [
      { type: "fixed", value: "15.00" },
    ]);
    expect(result.discountTotal).toBe("10.00");
    expect(result.taxableAmount).toBe("0.00");
  });

  it("caps percentage discounts that would exceed subtotal (I-06)", () => {
    const result = calculateDiscounts("10.00", [
      { type: "percentage", value: "2.00" },
    ]);
    expect(result.discountTotal).toBe("10.00");
    expect(result.taxableAmount).toBe("0.00");
  });

  it("handles no discounts", () => {
    const result = calculateDiscounts("100.00", []);
    expect(result.discountTotal).toBe("0.00");
    expect(result.taxableAmount).toBe("100.00");
  });

  it("handles zero subtotal with discounts", () => {
    const result = calculateDiscounts("0.00", [
      { type: "fixed", value: "5.00" },
    ]);
    expect(result.discountTotal).toBe("0.00");
    expect(result.taxableAmount).toBe("0.00");
  });
});

// ── calculateTax ────────────────────────────────────────────────────────

describe("calculateTax", () => {
  it("calculates tax on taxable amount", () => {
    expect(calculateTax("100.00", "0.08")).toBe("8.00");
  });

  it("rounds to two decimal places (I-09)", () => {
    // 0.0833 × 10.00 = 0.833 → rounds to 0.83
    expect(calculateTax("10.00", "0.0833")).toBe("0.83");
  });

  it("handles zero tax rate", () => {
    expect(calculateTax("100.00", "0.00")).toBe("0.00");
  });

  it("handles zero taxable amount", () => {
    expect(calculateTax("0.00", "0.08")).toBe("0.00");
  });

  it("handles 100% tax rate", () => {
    expect(calculateTax("100.00", "1.00")).toBe("100.00");
  });
});

// ── calculateGrandTotal ─────────────────────────────────────────────────

describe("calculateGrandTotal", () => {
  it("computes subtotal - discountTotal + taxTotal", () => {
    expect(calculateGrandTotal("100.00", "10.00", "7.20")).toBe("97.20");
  });

  it("non-negative grand total when tax is zero (I-08)", () => {
    expect(calculateGrandTotal("10.00", "10.00", "0.00")).toBe("0.00");
  });

  it("handles zero values", () => {
    expect(calculateGrandTotal("0.00", "0.00", "0.00")).toBe("0.00");
  });
});

// ── calculateOrderTotals (integration) ──────────────────────────────────

describe("calculateOrderTotals", () => {
  it("computes full order totals (I-07: tax after discounts)", () => {
    // Subtotal: 100.00
    // Discount: 10% → 10.00
    // Taxable: 90.00
    // Tax at 8%: 7.20 (NOT 8.00 — that would be tax before discounts)
    // Grand total: 100.00 - 10.00 + 7.20 = 97.20
    const result = calculateOrderTotals(
      [{ lineTotal: "100.00" }],
      [{ type: "percentage", value: "0.10" }],
      "0.08"
    );
    expect(result.subtotal).toBe("100.00");
    expect(result.discountTotal).toBe("10.00");
    expect(result.taxableAmount).toBe("90.00");
    expect(result.taxTotal).toBe("7.20");
    expect(result.grandTotal).toBe("97.20");
  });

  it("ensures total consistency (I-16)", () => {
    const result = calculateOrderTotals(
      [
        { lineTotal: "10.00" },
        { lineTotal: "20.00" },
        { lineTotal: "30.00" },
      ],
      [{ type: "percentage", value: "0.05" }],
      "0.08"
    );
    const expectedGrand = (
      parseFloat(result.subtotal) -
      parseFloat(result.discountTotal) +
      parseFloat(result.taxTotal)
    ).toFixed(2);
    expect(result.grandTotal).toBe(expectedGrand);
  });

  it("handles empty items and no discounts", () => {
    const result = calculateOrderTotals([], [], "0.08");
    expect(result.subtotal).toBe("0.00");
    expect(result.discountTotal).toBe("0.00");
    expect(result.taxableAmount).toBe("0.00");
    expect(result.taxTotal).toBe("0.00");
    expect(result.grandTotal).toBe("0.00");
  });

  it("applies discount floor for fixed discount exceeding subtotal (I-06)", () => {
    const result = calculateOrderTotals(
      [{ lineTotal: "10.00" }],
      [{ type: "fixed", value: "15.00" }],
      "0.08"
    );
    expect(result.discountTotal).toBe("10.00");
    expect(result.taxableAmount).toBe("0.00");
    expect(result.taxTotal).toBe("0.00");
    expect(result.grandTotal).toBe("0.00");
  });

  it("applies rounding at each step (I-09)", () => {
    // 0.0833 × 10.00 = 0.833 → 0.83
    const result = calculateOrderTotals(
      [{ lineTotal: "10.00" }],
      [],
      "0.0833"
    );
    expect(result.taxTotal).toBe("0.83");
    expect(result.grandTotal).toBe("10.83");
  });
});
