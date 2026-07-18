// items.test.ts — Integration tests for item endpoints
// POST /orders/:id/items, PATCH /orders/:id/items/:itemId, DELETE /orders/:id/items/:itemId
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

// ── POST /orders/:id/items — Add Item ──────────────────────────────────

describe("POST /orders/:id/items", () => {
  it("adds an item to a draft order", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "prod-1",
        name: "Widget",
        unitPrice: "10.00",
        quantity: 3,
      },
    });

    expect(res.statusCode).toBe(201);
    const item = res.json();
    expect(item.id).toBeDefined();
    expect(item.productId).toBe("prod-1");
    expect(item.name).toBe("Widget");
    expect(item.unitPrice).toBe("10.00");
    expect(item.quantity).toBe(3);
    expect(item.lineTotal).toBe("30.00");
  });

  it("returns 404 for non-existent order", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/orders/00000000-0000-0000-0000-000000000000/items`,
      payload: {
        productId: "prod-1",
        name: "Widget",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not_found");
  });

  it("returns 409 for calculated order (I-12)", async () => {
    const orderId = await createDraftOrder(app);

    // Add an item and calculate
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
      url: `/orders/${orderId}/items`,
      payload: { productId: "p2", name: "New", unitPrice: "5.00", quantity: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("conflict");
  });

  it("returns 400 for empty productId", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: { productId: "", name: "Item", unitPrice: "10.00", quantity: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for empty name", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: { productId: "p1", name: "", unitPrice: "10.00", quantity: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for quantity zero (I-01)", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: { productId: "p1", name: "Item", unitPrice: "10.00", quantity: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_error");
  });

  it("returns 400 for negative quantity", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: { productId: "p1", name: "Item", unitPrice: "10.00", quantity: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for negative unitPrice (I-02)", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "-1.00",
        quantity: 1,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_error");
  });

  it("returns 400 for invalid unitPrice format", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "abc",
        quantity: 1,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for non-integer quantity", async () => {
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

  // ── Idempotency (I-11) ──────────────────────────────────────────────

  it("returns existing item for duplicate idempotency key (I-11)", async () => {
    const orderId = await createDraftOrder(app);

    const res1 = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      headers: { "idempotency-key": "key-item-1" },
      payload: { productId: "p1", name: "Item", unitPrice: "10.00", quantity: 1 },
    });
    expect(res1.statusCode).toBe(201);
    const itemId = res1.json().id;

    const res2 = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      headers: { "idempotency-key": "key-item-1" },
      payload: { productId: "p1", name: "Item", unitPrice: "10.00", quantity: 1 },
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().id).toBe(itemId);
  });
});

// ── PATCH /orders/:id/items/:itemId — Update Item ───────────────────────

describe("PATCH /orders/:id/items/:itemId", () => {
  it("updates item quantity and recalculates line total", async () => {
    const orderId = await createDraftOrder(app);

    const addRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: { productId: "p1", name: "Item", unitPrice: "10.00", quantity: 1 },
    });
    const itemId = addRes.json().id;

    const updateRes = await app.inject({
      method: "PATCH",
      url: `/orders/${orderId}/items/${itemId}`,
      payload: { quantity: 5 },
    });

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().quantity).toBe(5);
    expect(updateRes.json().lineTotal).toBe("50.00");
  });

  it("returns 404 for non-existent item", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/orders/${orderId}/items/00000000-0000-0000-0000-000000000000`,
      payload: { quantity: 3 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not_found");
  });

  it("returns 404 for non-existent order", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/orders/00000000-0000-0000-0000-000000000000/items/00000000-0000-0000-0000-000000000000`,
      payload: { quantity: 3 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 for calculated order (I-12)", async () => {
    const orderId = await createDraftOrder(app);

    const addRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: { productId: "p1", name: "Item", unitPrice: "10.00", quantity: 1 },
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

  it("returns 400 for quantity zero (I-01)", async () => {
    const orderId = await createDraftOrder(app);
    const addRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: { productId: "p1", name: "Item", unitPrice: "10.00", quantity: 1 },
    });
    const itemId = addRes.json().id;

    const res = await app.inject({
      method: "PATCH",
      url: `/orders/${orderId}/items/${itemId}`,
      payload: { quantity: 0 },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── DELETE /orders/:id/items/:itemId — Remove Item ──────────────────────

describe("DELETE /orders/:id/items/:itemId", () => {
  it("removes an item from the order", async () => {
    const orderId = await createDraftOrder(app);

    const addRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: { productId: "p1", name: "Item", unitPrice: "10.00", quantity: 1 },
    });
    const itemId = addRes.json().id;

    const delRes = await app.inject({
      method: "DELETE",
      url: `/orders/${orderId}/items/${itemId}`,
    });
    expect(delRes.statusCode).toBe(204);

    // Verify item is gone
    const orderRes = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
    });
    expect(orderRes.json().items).toHaveLength(0);
  });

  it("returns 404 for non-existent item", async () => {
    const orderId = await createDraftOrder(app);
    const res = await app.inject({
      method: "DELETE",
      url: `/orders/${orderId}/items/00000000-0000-0000-0000-000000000000`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for non-existent order", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/orders/00000000-0000-0000-0000-000000000000/items/00000000-0000-0000-0000-000000000000`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 for calculated order (I-12)", async () => {
    const orderId = await createDraftOrder(app);

    const addRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: { productId: "p1", name: "Item", unitPrice: "10.00", quantity: 1 },
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
});
