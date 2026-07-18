// discounts.test.ts — Integration tests for discount endpoints
// POST /orders/:id/discounts, DELETE /orders/:id/discounts/:discountId
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/server.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeEach(async () => {
  app = buildApp();
});

async function createDraftOrder(a: FastifyInstance): Promise<string> {
  const res = await a.inject({
    method: "POST",
    url: "/orders",
    payload: { currency: "USD", taxRate: "0.08" },
  });
  return res.json().id;
}

// ── POST /orders/:id/discounts — Add Discount ──────────────────────────

describe("POST /orders/:id/discounts", () => {
  it("adds a percentage discount", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.10" },
    });

    expect(res.statusCode).toBe(201);
    const discount = res.json();
    expect(discount.id).toBeDefined();
    expect(discount.type).toBe("percentage");
    expect(discount.value).toBe("0.10");
  });

  it("adds a fixed discount", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "15.00" },
    });

    expect(res.statusCode).toBe(201);
    const discount = res.json();
    expect(discount.type).toBe("fixed");
    expect(discount.value).toBe("15.00");
  });

  it("returns 404 for non-existent order", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/orders/00000000-0000-0000-0000-000000000000/discounts`,
      payload: { type: "percentage", value: "0.10" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not_found");
  });

  it("returns 409 for calculated order (I-12)", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: { productId: "p1", name: "Item", unitPrice: "10.00", quantity: 1 },
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

  // ── Validation (I-04, I-05) ──────────────────────────────────────────

  it("returns 400 for percentage discount > 1.0 (I-04)", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "1.01" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_error");
  });

  it("accepts percentage discount of 0.00 (I-04 positive case)", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.00" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().value).toBe("0.00");
  });

  it("accepts percentage discount of 1.00 (I-04 boundary)", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "1.00" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("returns 400 for negative fixed discount (I-05)", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "-1.00" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_error");
  });

  it("returns 400 for negative percentage discount", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "-0.10" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for discount value with too many decimal places (fixed)", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "10.123" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for unknown discount type", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "invalid", value: "10.00" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing type field", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { value: "10.00" },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── Idempotency (I-11) ──────────────────────────────────────────────

  it("returns existing discount for duplicate idempotency key (I-11)", async () => {
    const orderId = await createDraftOrder(app);

    const res1 = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      headers: { "idempotency-key": "key-disc-1" },
      payload: { type: "percentage", value: "0.10" },
    });
    expect(res1.statusCode).toBe(201);
    const discountId = res1.json().id;

    const res2 = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      headers: { "idempotency-key": "key-disc-1" },
      payload: { type: "percentage", value: "0.10" },
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().id).toBe(discountId);
  });

  it("creates distinct discounts with different idempotency keys", async () => {
    const orderId = await createDraftOrder(app);

    const res1 = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      headers: { "idempotency-key": "key-disc-a" },
      payload: { type: "percentage", value: "0.10" },
    });
    const res2 = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      headers: { "idempotency-key": "key-disc-b" },
      payload: { type: "fixed", value: "5.00" },
    });
    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res1.json().id).not.toBe(res2.json().id);
  });
});

// ── DELETE /orders/:id/discounts/:discountId — Remove Discount ──────────

describe("DELETE /orders/:id/discounts/:discountId", () => {
  it("removes a discount from the order", async () => {
    const orderId = await createDraftOrder(app);

    const addRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.10" },
    });
    const discountId = addRes.json().id;

    const delRes = await app.inject({
      method: "DELETE",
      url: `/orders/${orderId}/discounts/${discountId}`,
    });
    expect(delRes.statusCode).toBe(204);

    // Verify discount is gone
    const orderRes = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
    });
    expect(orderRes.json().discounts).toHaveLength(0);
  });

  it("returns 404 for non-existent discount", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "DELETE",
      url: `/orders/${orderId}/discounts/00000000-0000-0000-0000-000000000000`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not_found");
  });

  it("returns 404 for non-existent order", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/orders/00000000-0000-0000-0000-000000000000/discounts/00000000-0000-0000-0000-000000000000`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 for calculated order (I-12)", async () => {
    const orderId = await createDraftOrder(app);

    const addRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.10" },
    });
    const discountId = addRes.json().id;

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: { productId: "p1", name: "Item", unitPrice: "10.00", quantity: 1 },
    });
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
});
