// calculator.ts — Pure functions for monetary arithmetic using Decimal.js
// All monetary values are strings, never binary float

import { Decimal } from "decimal.js";

// ── Configuration ──────────────────────────────────────────────────────

/** Currency precision: 2 decimal places */
const PRECISION = 2;

/** Rounding mode: standard half-up rounding */
const ROUNDING = Decimal.ROUND_HALF_UP;

// ── Helpers ────────────────────────────────────────────────────────────

/** Parse a monetary string into a Decimal, or zero if empty/null */
function toDecimal(value: string): Decimal {
  return new Decimal(value || "0");
}

/** Format a Decimal to a fixed-point monetary string (2 decimal places) */
function formatDecimal(d: Decimal): string {
  return d.toFixed(PRECISION, ROUNDING);
}

// ── Public Calculation Functions ───────────────────────────────────────

/**
 * Calculate the line total for an item.
 * lineTotal = unitPrice × quantity
 */
export function calculateLineTotal(unitPrice: string, quantity: number): string {
  const price = toDecimal(unitPrice);
  const qty = new Decimal(quantity);
  return formatDecimal(price.mul(qty));
}

/**
 * Calculate the subtotal from all items.
 * subtotal = sum of all line totals
 */
export function calculateSubtotal(items: Array<{ lineTotal: string }>): string {
  let total = new Decimal(0);
  for (const item of items) {
    total = total.add(toDecimal(item.lineTotal));
  }
  return formatDecimal(total);
}

/**
 * Calculate discount totals and taxable amount.
 *
 * Discount floor invariant (I-06): if discount total > subtotal,
 * cap discount total at subtotal so taxable amount is never negative.
 *
 * Tax AFTER discounts (I-07): tax is computed on (subtotal - discountTotal).
 *
 * Returns { discountTotal, taxableAmount } as formatted strings.
 */
export function calculateDiscounts(
  subtotalStr: string,
  discounts: Array<{ type: "percentage" | "fixed"; value: string }>
): { discountTotal: string; taxableAmount: string } {
  const subtotal = toDecimal(subtotalStr);
  let totalDiscount = new Decimal(0);

  for (const discount of discounts) {
    if (discount.type === "percentage") {
      const rate = toDecimal(discount.value);
      totalDiscount = totalDiscount.add(subtotal.mul(rate));
    } else {
      // Fixed discount
      const amount = toDecimal(discount.value);
      totalDiscount = totalDiscount.add(amount);
    }
  }

  // Discount floor: cap total discount at subtotal
  // This ensures taxable amount >= 0
  if (totalDiscount.greaterThan(subtotal)) {
    totalDiscount = subtotal;
  }

  const taxableAmount = subtotal.sub(totalDiscount);

  return {
    discountTotal: formatDecimal(totalDiscount),
    taxableAmount: formatDecimal(taxableAmount),
  };
}

/**
 * Calculate the tax total.
 * taxTotal = taxableAmount × taxRate (rounded to 2 decimal places)
 */
export function calculateTax(taxableAmount: string, taxRate: string): string {
  const amount = toDecimal(taxableAmount);
  const rate = toDecimal(taxRate);
  return formatDecimal(amount.mul(rate));
}

/**
 * Calculate the grand total.
 * grandTotal = subtotal - discountTotal + taxTotal
 */
export function calculateGrandTotal(
  subtotal: string,
  discountTotal: string,
  taxTotal: string
): string {
  const s = toDecimal(subtotal);
  const d = toDecimal(discountTotal);
  const t = toDecimal(taxTotal);
  return formatDecimal(s.sub(d).add(t));
}

/**
 * Perform a full order calculation in one call.
 * Returns { subtotal, discountTotal, taxableAmount, taxTotal, grandTotal }
 * with all monetary values as formatted 2-decimal strings.
 */
export function calculateOrderTotals(
  items: Array<{ lineTotal: string }>,
  discounts: Array<{ type: "percentage" | "fixed"; value: string }>,
  taxRate: string
): {
  subtotal: string;
  discountTotal: string;
  taxableAmount: string;
  taxTotal: string;
  grandTotal: string;
} {
  const subtotal = calculateSubtotal(items);
  const { discountTotal, taxableAmount } = calculateDiscounts(subtotal, discounts);
  const taxTotal = calculateTax(taxableAmount, taxRate);
  const grandTotal = calculateGrandTotal(subtotal, discountTotal, taxTotal);

  return { subtotal, discountTotal, taxableAmount, taxTotal, grandTotal };
}
