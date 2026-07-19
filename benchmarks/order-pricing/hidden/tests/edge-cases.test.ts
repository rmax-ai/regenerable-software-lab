// edge-cases.test.ts — Hidden edge-case tests that a lazy agent would miss
//
// These test scenarios that work correctly for typical inputs but break
// for boundary, extreme, or unusual values.
//
// Coverage: large quantities, tiny tax rates, bulk items, combined discounts,
// multi-currency rounding, empty discounts, boundary tax rates, 100% discount,
// zero-priced items.

import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "@candidate/server.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeEach(async () => {
  app = buildApp();
});

async function createDraftOrder(
  a: FastifyInstance,
  opts?: { currency?: string; taxRate?: string }
): Promise<string> {
  const res = await a.inject({
    method: "POST",
    url: "/orders",
    payload: {
      currency: opts?.currency ?? "USD",
      taxRate: opts?.taxRate ?? "0.08",
    },
  });
  return res.json().id;
}

// ── Very Large Quantities ──────────────────────────────────────────────

describe("Large quantities", () => {
  it("handles quantity 999999 correctly", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "bulk-1",
        name: "Bulk item",
        unitPrice: "0.01",
        quantity: 999999,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().quantity).toBe(999999);
    // 0.01 * 999999 = 9999.99
    expect(res.json().lineTotal).toBe("9999.99");
  });

  it("correctly calculates total with large quantities", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "bulk-1",
        name: "Bulk item",
        unitPrice: "1.00",
        quantity: 999999,
      },
    });

    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    // 999999 * 1.00 = 999999.00
    expect(body.subtotal).toBe("999999.00");
    // No discounts
    expect(body.discountTotal).toBe("0.00");
    // Tax: 999999.00 * 0.08 = 79999.92
    expect(body.taxTotal).toBe("79999.92");
    // Grand total = 999999.00 + 79999.92 = 1079998.92
    expect(body.grandTotal).toBe("1079998.92");
  });
});

// ── Very Small Tax Rates ───────────────────────────────────────────────

describe("Very small tax rates", () => {
  it("handles tax rate 0.0001 correctly", async () => {
    const orderId = await createDraftOrder(app, { taxRate: "0.0001" });

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "100.00",
        quantity: 1,
      },
    });

    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    // 100.00 * 0.0001 = 0.01
    expect(body.taxTotal).toBe("0.01");
    expect(body.grandTotal).toBe("100.01");
  });

  it("handles tax rate 0.00001 rounding to 0.00", async () => {
    const orderId = await createDraftOrder(app, { taxRate: "0.00001" });

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Cheap item",
        unitPrice: "1.00",
        quantity: 1,
      },
    });

    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    // 1.00 * 0.00001 = 0.00001 → rounds to 0.00
    expect(body.taxTotal).toBe("0.00");
    expect(body.grandTotal).toBe("1.00");
  });
});

// ── Orders with 100 Items ──────────────────────────────────────────────

describe("Orders with 100 items", () => {
  it("accepts an order with 100 items", async () => {
    const orderId = await createDraftOrder(app);

    for (let i = 0; i < 100; i++) {
      const res = await app.inject({
        method: "POST",
        url: `/orders/${orderId}/items`,
        payload: {
          productId: `prod-${i}`,
          name: `Item ${i}`,
          unitPrice: "1.00",
          quantity: 1,
        },
      });
      expect(res.statusCode).toBe(201);
    }

    // Verify all 100 items are present
    const getRes = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
    });
    expect(getRes.json().items).toHaveLength(100);
  });

  it("calculates order with 100 items correctly", async () => {
    const orderId = await createDraftOrder(app);

    for (let i = 0; i < 100; i++) {
      await app.inject({
        method: "POST",
        url: `/orders/${orderId}/items`,
        payload: {
          productId: `prod-${i}`,
          name: `Item ${i}`,
          unitPrice: "0.50",
          quantity: 2,
        },
      });
    }

    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    // 100 items * (0.50 * 2) = 100.00 subtotal
    expect(body.subtotal).toBe("100.00");
    // Total consistency check
    const expectedGrand = (
      parseFloat(body.subtotal) -
      parseFloat(body.discountTotal) +
      parseFloat(body.taxTotal)
    ).toFixed(2);
    expect(body.grandTotal).toBe(expectedGrand);
  });
});

// ── Multiple Percentage + Fixed Discounts Simultaneously ────────────────

describe("Multiple percentage + fixed discounts simultaneously", () => {
  it("applies both percentage and fixed discounts in calculation", async () => {
    const orderId = await createDraftOrder(app);

    // Add an item: subtotal = 200.00
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Expensive item",
        unitPrice: "200.00",
        quantity: 1,
      },
    });

    // Add 15% percentage discount
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.15" },
    });

    // Add $10.00 fixed discount
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "10.00" },
    });

    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    expect(body.subtotal).toBe("200.00");
    // discountTotal = 200*0.15 + 10 = 30 + 10 = 40.00
    expect(body.discountTotal).toBe("40.00");
    // taxable = 200 - 40 = 160.00
    // tax = 160 * 0.08 = 12.80
    expect(body.taxTotal).toBe("12.80");
    // grandTotal = 200 - 40 + 12.80 = 172.80
    expect(body.grandTotal).toBe("172.80");
  });

  it("applies multiple percentage discounts cumulatively", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "100.00",
        quantity: 1,
      },
    });

    // Two percentage discounts: 10% + 5% = 15%
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.10" },
    });
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.05" },
    });

    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    expect(body.discountTotal).toBe("15.00"); // 100*0.10 + 100*0.05 = 15.00
    expect(body.taxableAmount ?? body.subtotal).toBeDefined();
  });

  it("applies multiple fixed discounts", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "100.00",
        quantity: 1,
      },
    });

    // Two fixed discounts
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "15.00" },
    });
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "25.00" },
    });

    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    expect(body.discountTotal).toBe("40.00");
  });
});

// ── All Currencies with Correct Rounding ───────────────────────────────

describe("All currencies with correct rounding", () => {
  for (const currency of ["USD", "EUR", "GBP"] as const) {
    it(`handles ${currency} currency correctly`, async () => {
      const orderId = await createDraftOrder(app, {
        currency,
        taxRate: "0.08",
      });

      await app.inject({
        method: "POST",
        url: `/orders/${orderId}/items`,
        payload: {
          productId: "p1",
          name: "Item",
          unitPrice: "99.99",
          quantity: 1,
        },
      });

      const calcRes = await app.inject({
        method: "POST",
        url: `/orders/${orderId}/calculate`,
      });

      expect(calcRes.statusCode).toBe(200);
      const body = calcRes.json();
      expect(body.currency).toBe(currency);
      // All monetary values should be strings with 2 decimal places
      expect(body.subtotal).toMatch(/^\d+\.\d{2}$/);
      expect(body.discountTotal).toMatch(/^\d+\.\d{2}$/);
      expect(body.taxTotal).toMatch(/^\d+\.\d{2}$/);
      expect(body.grandTotal).toMatch(/^\d+\.\d{2}$/);
    });
  }
});

// ── Empty Discount List ────────────────────────────────────────────────

describe("Empty discount list behavior", () => {
  it("calculates correctly with no discounts added", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "50.00",
        quantity: 2,
      },
    });

    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    expect(body.subtotal).toBe("100.00");
    expect(body.discountTotal).toBe("0.00");
    expect(body.taxTotal).toBe("8.00"); // 100 * 0.08
    expect(body.grandTotal).toBe("108.00");
    expect(body.discounts).toEqual([]);
  });
});

// ── Tax Rate Boundaries ────────────────────────────────────────────────

describe("Tax rate boundaries", () => {
  it("handles tax rate exactly 0.00 (zero tax)", async () => {
    // The reference implementation schema accepts "0.00" via regex ^0\\.\\d+$
    const orderId = await createDraftOrder(app, { taxRate: "0.00" });

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "100.00",
        quantity: 1,
      },
    });

    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    expect(body.taxTotal).toBe("0.00");
    expect(body.grandTotal).toBe("100.00");
  });

  it("rejects tax rate exactly 1.00 (outside schema regex)", async () => {
    // Reference impl regex is ^0\\.\\d+$ so 1.00 is rejected
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { currency: "USD", taxRate: "1.00" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects tax rate above 1.00", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { currency: "USD", taxRate: "1.01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("handles tax rate exactly 0.00 via calculator", async () => {
    // Use the calculator directly to verify 0% tax rate edge case
    const { calculateOrderTotals } = await import(
      "../../reference-impl/src/calculator.js"
    );
    const result = calculateOrderTotals(
      [{ lineTotal: "100.00" }],
      [],
      "0.00"
    );
    expect(result.taxTotal).toBe("0.00");
    expect(result.grandTotal).toBe("100.00");
  });
});

// ── Discount of Exactly 100% ───────────────────────────────────────────

describe("Discount of exactly 100%", () => {
  it("handles percentage discount of exactly 100% (1.00)", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "100.00",
        quantity: 1,
      },
    });

    // 100% percentage discount — this is valid per the discount schema
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "1.00" },
    });

    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    expect(body.subtotal).toBe("100.00");
    expect(body.discountTotal).toBe("100.00"); // All discounted
    expect(body.taxTotal).toBe("0.00"); // Taxable amount = 0
    expect(body.grandTotal).toBe("0.00");
  });

  it("handles fixed discount that exactly equals subtotal", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "50.00",
        quantity: 1,
      },
    });

    // Fixed discount exactly equal to subtotal
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "50.00" },
    });

    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    expect(body.discountTotal).toBe("50.00");
    expect(body.taxTotal).toBe("0.00");
    expect(body.grandTotal).toBe("0.00");
  });
});

// ── Item with Unit Price of Exactly 0.00 ───────────────────────────────

describe("Item with unit price of exactly 0.00", () => {
  it("accepts a free item with unit price 0.00", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "freebie",
        name: "Free item",
        unitPrice: "0.00",
        quantity: 5,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().unitPrice).toBe("0.00");
    expect(res.json().lineTotal).toBe("0.00");
  });

  it("calculates order with only free items correctly", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "freebie-1",
        name: "Free item 1",
        unitPrice: "0.00",
        quantity: 10,
      },
    });
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "freebie-2",
        name: "Free item 2",
        unitPrice: "0.00",
        quantity: 5,
      },
    });

    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    expect(body.subtotal).toBe("0.00");
    expect(body.discountTotal).toBe("0.00");
    expect(body.taxTotal).toBe("0.00");
    expect(body.grandTotal).toBe("0.00");
  });
});
