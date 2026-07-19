// concurrency.test.ts — Basic concurrency edge cases
//
// These tests verify that the reference implementation handles rapid sequential
// operations, bulk operations, and interleaved idempotent requests correctly.
//
// Since we're using an in-memory store (no real concurrency), these tests
// focus on sequential rapid-fire scenarios and ordering invariants.

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

// ── Rapid Sequential Create + Calculate ─────────────────────────────────

describe("Rapid sequential create + calculate", () => {
  it("handles rapid create, add item, calculate sequence", async () => {
    const orderId = await createDraftOrder(app);

    // Rapid-fire: add item immediately after create
    const addRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "25.00",
        quantity: 4,
      },
    });
    expect(addRes.statusCode).toBe(201);

    // Calculate immediately after adding item
    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });
    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    expect(body.subtotal).toBe("100.00");
    expect(body.status).toBe("calculated");
  });

  it("handles rapid create + calculate on empty order", async () => {
    const orderId = await createDraftOrder(app);

    // Calculate empty order immediately
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
    expect(body.status).toBe("calculated");
  });

  it("handles rapid create, item, discount, calculate sequence", async () => {
    const orderId = await createDraftOrder(app);

    // Rapid sequential operations
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

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.10" },
    });

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "5.00" },
    });

    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });
    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    expect(body.subtotal).toBe("100.00");
    // 100*0.10 + 5 = 15.00
    expect(body.discountTotal).toBe("15.00");
    // (100-15) * 0.08 = 6.80
    expect(body.taxTotal).toBe("6.80");
    // 100 - 15 + 6.80 = 91.80
    expect(body.grandTotal).toBe("91.80");
  });

  it("handles multiple rapid creations of different orders", async () => {
    // Create 5 orders in rapid succession
    const orderIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await createDraftOrder(app, {
        currency: i % 3 === 0 ? "USD" : i % 3 === 1 ? "EUR" : "GBP",
        taxRate: "0.08",
      });
      orderIds.push(id);
    }

    // All orders should have different IDs
    const uniqueIds = new Set(orderIds);
    expect(uniqueIds.size).toBe(5);

    // Each order should exist and be retrievable
    for (const id of orderIds) {
      const getRes = await app.inject({
        method: "GET",
        url: `/orders/${id}`,
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().id).toBe(id);
    }
  });
});

// ── Many Items Added + Calculated ──────────────────────────────────────

describe("Many items added + calculated", () => {
  it("handles adding 50 items and calculating", async () => {
    const orderId = await createDraftOrder(app);

    // Add 50 items in sequence
    for (let i = 0; i < 50; i++) {
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

    // Calculate
    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });
    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json();
    expect(body.items).toHaveLength(50);
    expect(body.subtotal).toBe("50.00");
    expect(body.discountTotal).toBe("0.00");
    // Tax: 50.00 * 0.08 = 4.00
    expect(body.taxTotal).toBe("4.00");
    expect(body.grandTotal).toBe("54.00");
  });

  it("handles add, calculate, check immutability, then verify via GET", async () => {
    const orderId = await createDraftOrder(app);

    // Add some items and discounts
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: "POST",
        url: `/orders/${orderId}/items`,
        payload: {
          productId: `prod-${i}`,
          name: `Item ${i}`,
          unitPrice: "10.00",
          quantity: 1,
        },
      });
    }

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.10" },
    });

    // Calculate
    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });
    expect(calcRes.statusCode).toBe(200);
    const calcBody = calcRes.json();
    expect(calcBody.subtotal).toBe("100.00");
    expect(calcBody.discountTotal).toBe("10.00");
    expect(calcBody.status).toBe("calculated");

    // Verify via GET that state is preserved
    const getRes = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual(calcBody);

    // Verify recalculation is idempotent (I-10)
    const recalcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });
    expect(recalcRes.statusCode).toBe(200);
    expect(recalcRes.json()).toEqual(calcBody);
  });
});

// ── Multiple Idempotent Requests Interleaved ───────────────────────────

describe("Multiple idempotent requests interleaved", () => {
  it("interleaves idempotent creates for different keys", async () => {
    const resA1 = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { "idempotency-key": "con-1" },
      payload: { currency: "USD", taxRate: "0.08" },
    });
    expect(resA1.statusCode).toBe(201);

    const resB1 = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { "idempotency-key": "con-2" },
      payload: { currency: "EUR", taxRate: "0.05" },
    });
    expect(resB1.statusCode).toBe(201);

    // Repeat both in interleaved order
    const resA2 = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { "idempotency-key": "con-1" },
      payload: { currency: "USD", taxRate: "0.08" },
    });
    expect(resA2.statusCode).toBe(200);
    expect(resA2.json().id).toBe(resA1.json().id);

    const resB2 = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { "idempotency-key": "con-2" },
      payload: { currency: "EUR", taxRate: "0.05" },
    });
    expect(resB2.statusCode).toBe(200);
    expect(resB2.json().id).toBe(resB1.json().id);

    // Both should point to the same single resources (no duplicates)
  });

  it("interleaves idempotent item and discount operations", async () => {
    const orderId = await createDraftOrder(app);

    // Create first item with key
    const itemRes1 = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      headers: { "idempotency-key": "con-item-1" },
      payload: {
        productId: "p1",
        name: "Item 1",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    expect(itemRes1.statusCode).toBe(201);
    const itemId1 = itemRes1.json().id;

    // Create first discount with key
    const discRes1 = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      headers: { "idempotency-key": "con-disc-1" },
      payload: { type: "percentage", value: "0.10" },
    });
    expect(discRes1.statusCode).toBe(201);
    const discId1 = discRes1.json().id;

    // Create second item with different key
    const itemRes2 = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      headers: { "idempotency-key": "con-item-2" },
      payload: {
        productId: "p2",
        name: "Item 2",
        unitPrice: "20.00",
        quantity: 2,
      },
    });
    expect(itemRes2.statusCode).toBe(201);

    // Replay item 1 key — should return existing
    const itemReplay = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      headers: { "idempotency-key": "con-item-1" },
      payload: {
        productId: "p1",
        name: "Item 1",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    expect(itemReplay.statusCode).toBe(200);
    expect(itemReplay.json().id).toBe(itemId1);

    // Replay discount 1 key — should return existing
    const discReplay = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      headers: { "idempotency-key": "con-disc-1" },
      payload: { type: "percentage", value: "0.10" },
    });
    expect(discReplay.statusCode).toBe(200);
    expect(discReplay.json().id).toBe(discId1);

    // Verify order state: 2 items, 1 discount
    const getRes = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body.items).toHaveLength(2);
    expect(body.discounts).toHaveLength(1);

    // Calculate and verify totals
    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });
    expect(calcRes.statusCode).toBe(200);
    const calcBody = calcRes.json();
    // Item 1: 10.00 * 1 = 10.00, Item 2: 20.00 * 2 = 40.00, total = 50.00
    expect(calcBody.subtotal).toBe("50.00");
    // 10% discount on 50.00 = 5.00
    expect(calcBody.discountTotal).toBe("5.00");
    // Tax on 45.00 at 8% = 3.60
    expect(calcBody.taxTotal).toBe("3.60");
    // Grand = 50 - 5 + 3.60 = 48.60
    expect(calcBody.grandTotal).toBe("48.60");
  });

  it("handles repeated interleaved create/calculate cycles across multiple orders", async () => {
    const scenarios = [
      { currency: "USD" as const, taxRate: "0.08", price: 100, quantity: 1 },
      { currency: "EUR" as const, taxRate: "0.19", price: 50, quantity: 3 },
      { currency: "GBP" as const, taxRate: "0.05", price: 200, quantity: 2 },
    ];

    const orderIds: string[] = [];

    for (const s of scenarios) {
      const id = await createDraftOrder(app, {
        currency: s.currency,
        taxRate: s.taxRate,
      });
      orderIds.push(id);

      await app.inject({
        method: "POST",
        url: `/orders/${id}/items`,
        payload: {
          productId: "p1",
          name: "Item",
          unitPrice: String(s.price),
          quantity: s.quantity,
        },
      });
    }

    // Calculate each order
    for (let i = 0; i < orderIds.length; i++) {
      const res = await app.inject({
        method: "POST",
        url: `/orders/${orderIds[i]}/calculate`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const s = scenarios[i];
      const rawSubtotal = s.price * s.quantity;
      const expectedSubtotal = `${rawSubtotal.toFixed(2)}`;
      expect(body.subtotal).toBe(expectedSubtotal);
      expect(body.currency).toBe(s.currency);
    }

    // Re-calculate all (should be idempotent)
    for (let i = 0; i < orderIds.length; i++) {
      const res1 = await app.inject({
        method: "POST",
        url: `/orders/${orderIds[i]}/calculate`,
      });
      const res2 = await app.inject({
        method: "POST",
        url: `/orders/${orderIds[i]}/calculate`,
      });
      expect(res1.json()).toEqual(res2.json());
    }
  });
});
