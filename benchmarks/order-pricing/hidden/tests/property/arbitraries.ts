// arbitrarily.ts — Custom fast-check arbitraries for order-pricing domain types
//
// All monetary values are generated as valid string representations suitable
// for the Zod schemas in the reference implementation.
//
// References:
//   - unitPrice:  /^\d+(\.\d{1,2})?$/        (items route schema)
//   - fixed discount: /^\d+(\.\d{1,2})?$/     (discounts route schema)
//   - percentage: /^(0(\.\d+)?|1(\.0+)?)$/   (discounts route schema)
//   - taxRate:    /^0\.\d+$/                  (orders route schema)
//   - quantity:   integer >= 1                (items route schema)

import * as fc from "fast-check";

// ── Helpers ─────────────────────────────────────────────────────────────

/** Generate a string from a fixed set of characters. */
function arbStringFromChars(
  chars: string[],
  minLength: number,
  maxLength: number
): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...chars), { minLength, maxLength })
    .map((a) => a.join(""));
}

/** Digit characters 0-9 */
const DIGITS = "0123456789".split("");

/** Product ID characters (alphanumeric + -_) */
const PROD_ID_CHARS =
  "abcdefghijklmnopqrstuvwxyz0123456789-_".split("");

/** Name characters (alphanumeric + space, -_) */
const NAME_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -_".split(
    ""
  );

// ── Primitive Monetary Arbitraries ───────────────────────────────────────

/**
 * Generate valid monetary strings for unitPrice and fixed discounts.
 * Format: digits with optional 1-2 decimal places.
 * Examples: "0", "10", "10.00", "10.5", "99.99"
 */
export function arbMonetaryString(): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.nat({ max: 100_000 }),   // integer part
      fc.option(fc.nat({ max: 99 }), { nil: undefined }) // fractional part
    )
    .map(([intPart, fracPart]) => {
      if (fracPart === undefined) {
        return String(intPart);
      }
      // Pad to 2 digits: e.g. 5 -> "05"
      return `${intPart}.${String(fracPart).padStart(2, "0")}`;
    })
    .filter((s) => /^\d+(\.\d{1,2})?$/.test(s));
}

/**
 * Generate valid monetary strings constrained to a smaller range for discounts.
 * Same format as arbMonetaryString but limited to 0..1000.
 */
export function arbDiscountMonetaryString(): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.nat({ max: 1000 }),       // integer part
      fc.option(fc.nat({ max: 99 }), { nil: undefined })
    )
    .map(([intPart, fracPart]) => {
      if (fracPart === undefined) return String(intPart);
      return `${intPart}.${String(fracPart).padStart(2, "0")}`;
    })
    .filter((s) => /^\d+(\.\d{1,2})?$/.test(s));
}

/**
 * Generate valid tax rate strings matching /^0\.\d+$/.
 * Examples: "0.00", "0.08", "0.125"
 * These are strings between 0 and 1 (inclusive of 0, exclusive of 1).
 */
export function arbTaxRate(): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.constant("0."),
      arbStringFromChars(DIGITS, 1, 6)
    )
    .map(([prefix, digits]) => `${prefix}${digits}`)
    .filter((s) => /^0\.\d+$/.test(s));
}

/**
 * Generate valid percentage discount value strings.
 * Matches /^(0(\.\d+)?|1(\.0+)?)$/
 * Examples: "0", "0.00", "0.5", "0.10", "1", "1.00"
 */
export function arbPercentageValue(): fc.Arbitrary<string> {
  return fc.oneof(
    // "0" or "0.xxx" (but not "0." which is invalid)
    fc
      .tuple(
        fc.constant("0"),
        fc.option(
          fc
            .tuple(
              fc.constant("."),
              arbStringFromChars(DIGITS, 1, 6)
            )
            .map(([dot, digits]) => `${dot}${digits}`),
          { nil: undefined }
        )
      )
      .map(([zero, frac]) => (frac ? `${zero}${frac}` : zero)),
    // "1", "1.0", "1.00", "1.000", ...
    fc
      .tuple(
        fc.constant("1"),
        fc.option(
          fc
            .tuple(
              fc.constant("."),
              arbStringFromChars([..."0"], 1, 4)
            )
            .map(([dot, zeros]) => `${dot}${zeros}`),
          { nil: undefined }
        )
      )
      .map(([one, frac]) => (frac ? `${one}${frac}` : one))
  )
  .filter((s) => /^(0(\.\d+)?|1(\.0+)?)$/.test(s));
}

// ── Domain Object Arbitraries ───────────────────────────────────────────

/**
 * Parameters for adding an item via HTTP POST /orders/:id/items.
 */
export interface ArbitraryAddItemParams {
  productId: string;
  name: string;
  unitPrice: string;
  quantity: number;
}

/**
 * Generate valid AddItemParams that pass the Zod schema.
 */
export function arbAddItemParams(): fc.Arbitrary<ArbitraryAddItemParams> {
  return fc
    .tuple(
      arbStringFromChars(PROD_ID_CHARS, 1, 20),
      arbStringFromChars(NAME_CHARS, 1, 30),
      arbMonetaryString(),
      fc.nat({ max: 100 }).filter((n) => n >= 1)
    )
    .map(([productId, name, unitPrice, quantity]) => ({
      productId,
      name,
      unitPrice,
      quantity,
    }));
}

/**
 * Generate valid discount parameters for adding via HTTP.
 */
export function arbAddDiscountParams(): fc.Arbitrary<{
  type: "percentage" | "fixed";
  value: string;
}> {
  return fc.oneof(
    // Percentage discount
    arbPercentageValue().map((value) => ({
      type: "percentage" as const,
      value,
    })),
    // Fixed discount
    arbDiscountMonetaryString().map((value) => ({
      type: "fixed" as const,
      value,
    }))
  );
}

/**
 * Generate complete order parameters suitable for calculator tests.
 * These don't need to pass HTTP validation — they just need valid types.
 */
export function arbCalculatorOrderParams(): fc.Arbitrary<{
  items: Array<{ unitPrice: string; quantity: number }>;
  discounts: Array<{ type: "percentage" | "fixed"; value: string }>;
  taxRate: string;
}> {
  return fc
    .tuple(
      // Items: array of { unitPrice, quantity } objects
      fc
        .array(
          fc.tuple(arbMonetaryString(), fc.nat({ max: 100 }).filter((n) => n >= 1)),
          { minLength: 0, maxLength: 5 }
        )
        .map((tuples) =>
          tuples.map(([unitPrice, quantity]) => ({ unitPrice, quantity }))
        ),
      // Discounts: array of discount params
      fc.array(arbAddDiscountParams(), { minLength: 0, maxLength: 4 }),
      // Tax rate: any numeric string between 0 and 1
      fc
        .tuple(
          fc.constant("0."),
          arbStringFromChars(DIGITS, 1, 6)
        )
        .map(([prefix, digits]) => `${prefix}${digits}`)
    )
    .map(([items, discounts, taxRate]) => ({ items, discounts, taxRate }));
}

/**
 * Generate valid order creation params for HTTP testing.
 */
export function arbCreateOrderParams(): fc.Arbitrary<{
  currency: "USD" | "EUR" | "GBP";
  taxRate: string;
}> {
  return fc
    .tuple(
      fc.constantFrom("USD" as const, "EUR" as const, "GBP" as const),
      arbTaxRate()
    )
    .map(([currency, taxRate]) => ({ currency, taxRate }));
}
