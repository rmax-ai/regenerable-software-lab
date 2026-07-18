// adversarial.test.ts — Tests that catch common agent implementation failures
//
// These tests target specific mistakes that AI coding agents frequently make
// when implementing the order-pricing API from the specification:
//
//   - Tax BEFORE discount (the most common mistake — test that tax is on discounted amount)
//   - Binary floating-point in responses (no .000000000000001 type values)
//   - Missing idempotency (duplicate key creates duplicate resource)
//   - Missing state machine (calculated order accepts modification)
//   - Stack traces in error responses (check 5xx doesn't leak internals)
//   - Non-UUID identifiers
//   - Missing validation (negative prices, zero quantity, tax >1.0)
//   - Grand total negative through discount manipulation

import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../../reference-impl/src/server.js";
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

// ── Tax BEFORE Discount (I-07 violation) ───────────────────────────────

describe("Tax BEFORE discount — the most common agent mistake", () => {
  it("verifies tax is calculated on discounted amount, not subtotal (I-07)", async () => {
    // Setup: subtotal = $100.00, 10% discount, 8% tax
    // CORRECT: tax on (100 - 10) = 90.00 * 0.08 = 7.20
    // WRONG (tax before discount): tax on 100.00 * 0.08 = 8.00
    const orderId = await createDraftOrder(app, { taxRate: "0.08" });

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Widget",
        unitPrice: "100.00",
        quantity: 1,
      },
    });

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.10" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Assert the CORRECT calculation
    expect(body.taxTotal).toBe("7.20");

    // Assert the WRONG calculation is NOT returned
    expect(body.taxTotal).not.toBe("8.00");

    // Also verify grand total consistency
    const computedGrand = (
      parseFloat(body.subtotal) -
      parseFloat(body.discountTotal) +
      parseFloat(body.taxTotal)
    ).toFixed(2);
    expect(body.grandTotal).toBe(computedGrand);
  });

  it("verifies tax-after-discount with multiple discount types", async () => {
    // Setup: subtotal = $200.00, 15% + $10 fixed discounts = $40 off,
    //        8% tax on $160 = $12.80
    // WRONG (tax on raw subtotal): $200 * 0.08 = $16.00
    // WRONG (tax after percentage only): ($200-$30)*0.08 = $13.60
    const orderId = await createDraftOrder(app, { taxRate: "0.08" });

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Widget",
        unitPrice: "200.00",
        quantity: 1,
      },
    });

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.15" },
    });
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "10.00" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // discountTotal = 200*0.15 + 10 = 40.00
    // taxable = 200 - 40 = 160.00
    // tax = 160 * 0.08 = 12.80
    expect(body.taxTotal).toBe("12.80");
    expect(body.taxTotal).not.toBe("16.00"); // Not tax on subtotal
    expect(body.taxTotal).not.toBe("13.60"); // Not tax after percentage only
  });
});

// ── Binary Floating-Point in Responses ─────────────────────────────────

describe("No binary floating-point artifacts in responses", () => {
  it("monetary values are exact 2-decimal strings, not floats", async () => {
    const orderId = await createDraftOrder(app, { taxRate: "0.0833" });

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 1,
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Check for floating-point artifacts like 0.8300000000000001
    const monetaryFields = [
      "subtotal",
      "discountTotal",
      "taxTotal",
      "grandTotal",
    ] as const;
    for (const field of monetaryFields) {
      const value = body[field];
      expect(typeof value).toBe("string");
      // Must match exactly 2 decimal places
      expect(value).toMatch(/^\d+\.\d{2}$/);
      // No long floating-point tails
      expect(value).not.toMatch(/000000000000001/);
      expect(value).not.toMatch(/999999999999/);
    }
  });

  it("lineTotal is an exact 2-decimal string, not a float", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.33",
        quantity: 3,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.lineTotal).toBe("string");
    expect(body.lineTotal).toMatch(/^\d+\.\d{2}$/);
    // 10.33 * 3 = 30.99 exactly (no float artifacts)
    expect(body.lineTotal).toBe("30.99");
  });

  it("handles divisibility without floating-point drift", async () => {
    const orderId = await createDraftOrder(app, { taxRate: "0.07" });

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "19.99",
        quantity: 3,
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const bodyStr = JSON.stringify(body);
    // No IEEE 754 artifacts in serialized response
    expect(bodyStr).not.toMatch(/e[-+]/);
    expect(bodyStr).not.toMatch(/\d{14,}/);
    for (const key of [
      "subtotal",
      "discountTotal",
      "taxTotal",
      "grandTotal",
    ]) {
      expect(body[key]).toMatch(/^\d+(\.\d{2})$/);
    }
  });
});

// ── Missing Idempotency (duplicate key creates duplicate resource) ──────

describe("Idempotency: duplicate keys do not create duplicate resources", () => {
  it("same idempotency key for orders returns existing order (not duplicate)", async () => {
    const res1 = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { "idempotency-key": "adv-ord-key" },
      payload: { currency: "USD", taxRate: "0.08" },
    });
    expect(res1.statusCode).toBe(201);
    const orderId = res1.json().id;

    // Second request with same key — must return same order, not create new
    const res2 = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { "idempotency-key": "adv-ord-key" },
      payload: { currency: "USD", taxRate: "0.08" },
    });
    expect(res2.statusCode).toBe(200); // Returns existing, not 201
    expect(res2.json().id).toBe(orderId);

    // Only one order should exist
    expect(res1.json().id).toBe(res2.json().id);
  });

  it("without idempotency key, identical requests create distinct orders", async () => {
    const res1 = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { currency: "USD", taxRate: "0.08" },
    });
    const res2 = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { currency: "USD", taxRate: "0.08" },
    });

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    // Must be different resources
    expect(res1.json().id).not.toBe(res2.json().id);
  });

  it("same idempotency key for items returns existing item", async () => {
    const orderId = await createDraftOrder(app);

    const res1 = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      headers: { "idempotency-key": "adv-item-key" },
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    expect(res1.statusCode).toBe(201);
    const itemId = res1.json().id;

    const res2 = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      headers: { "idempotency-key": "adv-item-key" },
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    expect(res2.statusCode).toBe(200); // Returns existing
    expect(res2.json().id).toBe(itemId);
  });

  it("same idempotency key for discounts returns existing discount", async () => {
    const orderId = await createDraftOrder(app);

    const res1 = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      headers: { "idempotency-key": "adv-disc-key" },
      payload: { type: "percentage", value: "0.10" },
    });
    expect(res1.statusCode).toBe(201);
    const discountId = res1.json().id;

    const res2 = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      headers: { "idempotency-key": "adv-disc-key" },
      payload: { type: "percentage", value: "0.10" },
    });
    expect(res2.statusCode).toBe(200); // Returns existing
    expect(res2.json().id).toBe(discountId);
  });
});

// ── Missing State Machine (calculated order modification) ───────────────

describe("Calculated order state machine enforcement", () => {
  it("rejects adding items after calculation (I-12)", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p2",
        name: "New item",
        unitPrice: "5.00",
        quantity: 1,
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects updating items after calculation (I-12)", async () => {
    const orderId = await createDraftOrder(app);

    const addRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    const itemId = addRes.json().id;
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/orders/${orderId}/items/${itemId}`,
      payload: { quantity: 5 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects deleting items after calculation (I-12)", async () => {
    const orderId = await createDraftOrder(app);

    const addRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    const itemId = addRes.json().id;
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/orders/${orderId}/items/${itemId}`,
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects adding discounts after calculation (I-12)", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.10" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects deleting discounts after calculation (I-12)", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    const discRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.10" },
    });
    const discountId = discRes.json().id;
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/orders/${orderId}/discounts/${discountId}`,
    });
    expect(res.statusCode).toBe(409);
  });

  it("allows operations on draft orders normally", async () => {
    const orderId = await createDraftOrder(app);

    // Can add items
    const addRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    expect(addRes.statusCode).toBe(201);

    // Can add discounts
    const discRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "5.00" },
    });
    expect(discRes.statusCode).toBe(201);

    // Can update items
    const itemId = addRes.json().id;
    const updateRes = await app.inject({
      method: "PATCH",
      url: `/orders/${orderId}/items/${itemId}`,
      payload: { quantity: 3 },
    });
    expect(updateRes.statusCode).toBe(200);

    // Can delete items
    const delRes = await app.inject({
      method: "DELETE",
      url: `/orders/${orderId}/items/${itemId}`,
    });
    expect(delRes.statusCode).toBe(204);
  });
});

// ── Stack Traces in Error Responses (I-14) ─────────────────────────────

describe("No stack traces leaked in error responses (I-14)", () => {
  const LEAK_PATTERNS = [
    "stack",
    "Error:",
    "at ",
    "node_modules",
    "file://",
    "/src/",
    "evalmachine",
    "InternalError",
    "TypeError",
    "SyntaxError",
  ];

  function assertNoLeaks(body: Record<string, unknown>) {
    const str = JSON.stringify(body);
    for (const pattern of LEAK_PATTERNS) {
      expect(str).not.toContain(pattern);
    }
  }

  it("validation errors do not leak stack traces", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/orders/not-a-uuid",
    });
    expect(res.statusCode).toBe(400);
    assertNoLeaks(res.json());
  });

  it("not-found errors do not leak stack traces", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/orders/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(404);
    assertNoLeaks(res.json());
  });

  it("conflict errors do not leak stack traces", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p2",
        name: "New",
        unitPrice: "5.00",
        quantity: 1,
      },
    });
    expect(res.statusCode).toBe(409);
    assertNoLeaks(res.json());
  });

  it("route-not-found errors do not leak stack traces", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/nonexistent-route",
    });
    expect(res.statusCode).toBe(404);
    // Route not found handler
    const body = res.json();
    expect(body).toHaveProperty("error");
    expect(body).toHaveProperty("message");
    assertNoLeaks(body);
  });

  it("500 errors (if any) do not leak stack traces", async () => {
    // Try to trigger an internal error via malformed body
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      payload: "not-json-at-all",
      headers: { "content-type": "application/json" },
    });
    // Might be 400 or 500 depending on parser; either way no leak
    const bodyStr = JSON.stringify(res.json());
    for (const pattern of LEAK_PATTERNS) {
      expect(bodyStr).not.toContain(pattern);
    }
  });
});

// ── Non-UUID Identifiers ───────────────────────────────────────────────

describe("Non-UUID identifiers are rejected", () => {
  it("rejects non-UUID order ID in GET", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/orders/not-a-uuid",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects non-UUID order ID in POST calculate", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/orders/not-a-uuid/calculate",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects non-UUID order ID in POST items", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/orders/not-a-uuid/items",
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects non-UUID item ID in PATCH", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/orders/${orderId}/items/not-a-uuid`,
      payload: { quantity: 3 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects non-UUID item ID in DELETE", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "DELETE",
      url: `/orders/${orderId}/items/not-a-uuid`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects non-UUID discount ID in DELETE", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "DELETE",
      url: `/orders/${orderId}/discounts/not-a-uuid`,
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Missing Validation ─────────────────────────────────────────────────

describe("Validation of edge-case inputs", () => {
  it("rejects negative unitPrice (I-02)", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "-5.00",
        quantity: 1,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_error");
  });

  it("rejects zero quantity on item add (I-01)", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 0,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects zero quantity on item update (I-01)", async () => {
    const orderId = await createDraftOrder(app);
    const addRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    const itemId = addRes.json().id;

    const res = await app.inject({
      method: "PATCH",
      url: `/orders/${orderId}/items/${itemId}`,
      payload: { quantity: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects taxRate > 1.0 (I-03)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { currency: "USD", taxRate: "1.01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects negative taxRate", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { currency: "USD", taxRate: "-0.10" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects percentage discount > 1.0 (I-04)", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "1.01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects negative fixed discount (I-05)", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "-1.00" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid currency", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { currency: "JPY", taxRate: "0.08" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { currency: "USD" }, // missing taxRate
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects wrong types (quantity as string)", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: "five", // string instead of number
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects non-integer quantity", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 1.5,
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Grand Total Negative Through Discount Manipulation ─────────────────

describe("Grand total must never be negative (I-08)", () => {
  it("ensures grandTotal >= 0 with massive fixed discount", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "1.00",
        quantity: 1,
      },
    });
    // Fixed discount far exceeding subtotal
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "999999.99" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(parseFloat(body.grandTotal)).toBeGreaterThanOrEqual(0);
    // Discount total should be capped at subtotal
    expect(body.discountTotal).toBe("1.00");
    expect(body.taxTotal).toBe("0.00");
    expect(body.grandTotal).toBe("0.00");
  });

  it("ensures grandTotal >= 0 with massive combined discounts", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "5.00",
        quantity: 1,
      },
    });

    // Add 3 large discounts
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "100.00" },
    });
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.50" },
    });
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "200.00" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(parseFloat(body.grandTotal)).toBeGreaterThanOrEqual(0);
    // Discount capped at subtotal
    expect(body.discountTotal).toBe("5.00");
    expect(body.grandTotal).toBe("0.00");
  });

  it("ensures consistency: grandTotal = subtotal - discountTotal + taxTotal (I-16)", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "99.99",
        quantity: 3,
      },
    });
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.20" },
    });
    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "10.00" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const expectedGrand = (
      parseFloat(body.subtotal) -
      parseFloat(body.discountTotal) +
      parseFloat(body.taxTotal)
    ).toFixed(2);
    expect(body.grandTotal).toBe(expectedGrand);
  });
});
