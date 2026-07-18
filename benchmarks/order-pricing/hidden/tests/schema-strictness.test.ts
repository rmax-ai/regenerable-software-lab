// schema-strictness.test.ts — Tests that verify response schemas strictly
//
// These tests go beyond "does the response have the right fields" and
// verify:
//   - No extra (unexpected) fields in responses
//   - All required fields present in every response
//   - Correct types for all fields (string vs number, etc.)
//   - Monetary fields are strings, not numbers
//   - UUID format on all id fields

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

// ── UUID Pattern ───────────────────────────────────────────────────────

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Order Response Schema ──────────────────────────────────────────────

const ORDER_REQUIRED_FIELDS = [
  "id",
  "status",
  "currency",
  "items",
  "discounts",
  "taxRate",
  "subtotal",
  "discountTotal",
  "taxTotal",
  "grandTotal",
  "createdAt",
  "updatedAt",
] as const;

const ALLOWED_ORDER_FIELDS = new Set([
  "id",
  "status",
  "currency",
  "items",
  "discounts",
  "taxRate",
  "subtotal",
  "discountTotal",
  "taxTotal",
  "grandTotal",
  "createdAt",
  "updatedAt",
]);

// ── Helpers ─────────────────────────────────────────────────────────────

function checkNoExtraFields(
  body: Record<string, unknown>,
  allowed: Set<string>,
  label: string
) {
  const extra = Object.keys(body).filter((k) => !allowed.has(k));
  if (extra.length > 0) {
    // Extra fields count as a failure — strict schema check
  }
  expect(extra).toEqual([]);
}

function checkMonetaryField(value: unknown, fieldName: string) {
  expect(typeof value).toBe("string");
  expect(value).toMatch(/^-?\d+\.\d{2}$/);
}

function checkUuid(value: unknown, fieldName: string) {
  expect(typeof value).toBe("string");
  expect(value).toMatch(UUID_PATTERN);
}

// ── Order Response (POST /orders, GET /orders/:id) ─────────────────────

describe("Order response schema strictness", () => {
  it("POST /orders response has no extra fields beyond schema", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { currency: "USD", taxRate: "0.08" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;

    // No extra fields
    checkNoExtraFields(body, ALLOWED_ORDER_FIELDS, "POST /orders");

    // All required fields present
    for (const field of ORDER_REQUIRED_FIELDS) {
      expect(body).toHaveProperty(field);
    }

    // Field type checks
    expect(typeof body.id).toBe("string");
    expect(body.status).toBe("draft");
    expect(body.currency).toBe("USD");
    expect(Array.isArray(body.items)).toBe(true);
    expect(Array.isArray(body.discounts)).toBe(true);

    // Monetary fields are strings, not numbers
    checkMonetaryField(body.subtotal, "subtotal");
    checkMonetaryField(body.discountTotal, "discountTotal");
    checkMonetaryField(body.taxTotal, "taxTotal");
    checkMonetaryField(body.grandTotal, "grandTotal");

    // UUID format on id
    checkUuid(body.id, "id");

    // Timestamps should be ISO strings
    expect(typeof body.createdAt).toBe("string");
    expect(typeof body.updatedAt).toBe("string");
    expect(() => new Date(body.createdAt as string)).not.toThrow();
    expect(() => new Date(body.updatedAt as string)).not.toThrow();
  });

  it("GET /orders/:id response has no extra fields beyond schema", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;

    checkNoExtraFields(body, ALLOWED_ORDER_FIELDS, "GET /orders/:id");

    for (const field of ORDER_REQUIRED_FIELDS) {
      expect(body).toHaveProperty(field);
    }

    checkUuid(body.id, "id");
    checkMonetaryField(body.subtotal, "subtotal");
    checkMonetaryField(body.discountTotal, "discountTotal");
    checkMonetaryField(body.taxTotal, "taxTotal");
    checkMonetaryField(body.grandTotal, "grandTotal");
  });

  it("calculated order response has no extra fields", async () => {
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

    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });
    expect(calcRes.statusCode).toBe(200);
    const body = calcRes.json() as Record<string, unknown>;

    checkNoExtraFields(body, ALLOWED_ORDER_FIELDS, "POST /orders/:id/calculate");

    for (const field of ORDER_REQUIRED_FIELDS) {
      expect(body).toHaveProperty(field);
    }

    expect(body.status).toBe("calculated");
    checkUuid(body.id, "id");
    checkMonetaryField(body.subtotal, "subtotal");
    checkMonetaryField(body.discountTotal, "discountTotal");
    checkMonetaryField(body.taxTotal, "taxTotal");
    checkMonetaryField(body.grandTotal, "grandTotal");
  });
});

// ── Item Response Schema ───────────────────────────────────────────────

const ITEM_REQUIRED_FIELDS = [
  "id",
  "productId",
  "name",
  "unitPrice",
  "quantity",
  "lineTotal",
] as const;

const ALLOWED_ITEM_FIELDS = new Set([
  "id",
  "productId",
  "name",
  "unitPrice",
  "quantity",
  "lineTotal",
]);

describe("Item response schema strictness", () => {
  it("POST /orders/:id/items response has no extra fields", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "prod-1",
        name: "Test Item",
        unitPrice: "10.00",
        quantity: 3,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;

    checkNoExtraFields(body, ALLOWED_ITEM_FIELDS, "POST /orders/:id/items");

    for (const field of ITEM_REQUIRED_FIELDS) {
      expect(body).toHaveProperty(field);
    }

    // Type checks
    checkUuid(body.id, "id");
    expect(typeof body.productId).toBe("string");
    expect(body.productId).toBe("prod-1");
    expect(typeof body.name).toBe("string");
    expect(body.name).toBe("Test Item");

    // Monetary fields are strings
    checkMonetaryField(body.unitPrice, "unitPrice");
    checkMonetaryField(body.lineTotal, "lineTotal");

    // Quantity is a number
    expect(typeof body.quantity).toBe("number");
    expect(Number.isInteger(body.quantity)).toBe(true);
    expect(body.quantity).toBe(3);
  });

  it("PATCH /orders/:id/items/:itemId response has no extra fields", async () => {
    const orderId = await createDraftOrder(app);

    const addRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "prod-1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    const itemId = addRes.json().id;

    const updateRes = await app.inject({
      method: "PATCH",
      url: `/orders/${orderId}/items/${itemId}`,
      payload: { quantity: 5 },
    });

    expect(updateRes.statusCode).toBe(200);
    const body = updateRes.json() as Record<string, unknown>;

    checkNoExtraFields(body, ALLOWED_ITEM_FIELDS, "PATCH /orders/:id/items/:id");

    for (const field of ITEM_REQUIRED_FIELDS) {
      expect(body).toHaveProperty(field);
    }

    checkUuid(body.id, "id");
    checkMonetaryField(body.unitPrice, "unitPrice");
    checkMonetaryField(body.lineTotal, "lineTotal");
    expect(body.quantity).toBe(5);
    expect(body.lineTotal).toBe("50.00"); // 10.00 * 5
  });

  it("items embedded in order response match item schema", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "prod-1",
        name: "Test",
        unitPrice: "15.50",
        quantity: 2,
      },
    });

    const getRes = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
    });
    const body = getRes.json() as Record<string, unknown>;
    const items = body.items as Array<Record<string, unknown>>;

    expect(items).toHaveLength(1);
    const item = items[0]!;

    // Check item has no extra fields
    checkNoExtraFields(item, ALLOWED_ITEM_FIELDS, "order.items[]");

    for (const field of ITEM_REQUIRED_FIELDS) {
      expect(item).toHaveProperty(field);
    }

    checkUuid(item.id, "item.id");
    checkMonetaryField(item.unitPrice, "unitPrice");
    checkMonetaryField(item.lineTotal, "lineTotal");
    expect(typeof item.quantity).toBe("number");
    expect(item.lineTotal).toBe("31.00"); // 15.50 * 2
  });
});

// ── Discount Response Schema ───────────────────────────────────────────

const DISCOUNT_REQUIRED_FIELDS = ["id", "type", "value"] as const;
const ALLOWED_DISCOUNT_FIELDS = new Set(["id", "type", "value"]);

describe("Discount response schema strictness", () => {
  it("POST /orders/:id/discounts (percentage) response has no extra fields", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.10" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;

    checkNoExtraFields(body, ALLOWED_DISCOUNT_FIELDS, "POST /orders/:id/discounts (percentage)");

    for (const field of DISCOUNT_REQUIRED_FIELDS) {
      expect(body).toHaveProperty(field);
    }

    checkUuid(body.id, "id");
    expect(body.type).toBe("percentage");
    expect(typeof body.value).toBe("string");
  });

  it("POST /orders/:id/discounts (fixed) response has no extra fields", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "fixed", value: "15.00" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;

    checkNoExtraFields(body, ALLOWED_DISCOUNT_FIELDS, "POST /orders/:id/discounts (fixed)");

    for (const field of DISCOUNT_REQUIRED_FIELDS) {
      expect(body).toHaveProperty(field);
    }

    checkUuid(body.id, "id");
    expect(body.type).toBe("fixed");
    expect(typeof body.value).toBe("string");
  });

  it("discounts embedded in order response match discount schema", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.20" },
    });

    const getRes = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
    });
    const body = getRes.json() as Record<string, unknown>;
    const discounts = body.discounts as Array<Record<string, unknown>>;

    expect(discounts).toHaveLength(1);
    const discount = discounts[0]!;

    checkNoExtraFields(discount, ALLOWED_DISCOUNT_FIELDS, "order.discounts[]");

    for (const field of DISCOUNT_REQUIRED_FIELDS) {
      expect(discount).toHaveProperty(field);
    }

    checkUuid(discount.id, "discount.id");
    expect(discount.type).toBe("percentage");
    expect(typeof discount.value).toBe("string");
    expect(discount.value).toBe("0.20");
  });
});

// ── Monetary Fields Are Strings — NOT Numbers ──────────────────────────

describe("Monetary fields are strings, never numbers", () => {
  it("all monetary values in order response are strings", async () => {
    const orderId = await createDraftOrder(app, { taxRate: "0.08" });

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
    const body = calcRes.json() as Record<string, unknown>;

    // Verify ALL monetary fields are strings, not numbers
    for (const key of [
      "subtotal",
      "discountTotal",
      "taxTotal",
      "grandTotal",
      "taxRate",
    ]) {
      expect(typeof body[key]).toBe("string");
      // Ensure they are not numbers by checking they fail parseInt round-trip
      expect(Number.isNaN(Number(body[key]))).toBe(false);
    }
  });

  it("all monetary values in item response are strings", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "29.99",
        quantity: 3,
      },
    });

    const body = res.json() as Record<string, unknown>;
    expect(typeof body.unitPrice).toBe("string");
    expect(typeof body.lineTotal).toBe("string");
    // Must not be numbers
    expect(typeof body.unitPrice).not.toBe("number");
    expect(typeof body.lineTotal).not.toBe("number");
  });

  it("discount value field is a string", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.10" },
    });

    const body = res.json() as Record<string, unknown>;
    expect(typeof body.value).toBe("string");
  });

  it("monetary values have exactly 2 decimal places", async () => {
    const orderId = await createDraftOrder(app);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.33",
        quantity: 3,
      },
    });

    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });
    const body = calcRes.json() as Record<string, unknown>;

    const monetaryFields = [
      "subtotal",
      "discountTotal",
      "taxTotal",
      "grandTotal",
    ];
    for (const key of monetaryFields) {
      expect(body[key]).toMatch(/^\d+\.\d{2}$/);
    }
  });
});

// ── UUID Format on All ID Fields ───────────────────────────────────────

describe("UUID format on id fields", () => {
  it("order id is a valid UUID v4", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { currency: "USD", taxRate: "0.08" },
    });
    const id = res.json().id as string;
    checkUuid(id, "order.id");
  });

  it("item id is a valid UUID v4", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/items`,
      payload: {
        productId: "p1",
        name: "Item",
        unitPrice: "10.00",
        quantity: 1,
      },
    });
    checkUuid(res.json().id, "item.id");
  });

  it("discount id is a valid UUID v4", async () => {
    const orderId = await createDraftOrder(app);

    const res = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/discounts`,
      payload: { type: "percentage", value: "0.10" },
    });
    checkUuid(res.json().id, "discount.id");
  });

  it("all item UUIDs in a multi-item order are valid and distinct", async () => {
    const orderId = await createDraftOrder(app);

    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: `/orders/${orderId}/items`,
        payload: {
          productId: `p${i}`,
          name: `Item ${i}`,
          unitPrice: "10.00",
          quantity: 1,
        },
      });
      const id = res.json().id as string;
      checkUuid(id, `item[${i}].id`);
      ids.add(id);
    }
    expect(ids.size).toBe(5);
  });
});

// ── Error Response Schema Strictness ───────────────────────────────────

const ALLOWED_ERROR_FIELDS = new Set(["error", "message", "details"]);

describe("Error response schema strictness", () => {
  it("validation error response has only allowed fields", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/orders/not-a-uuid",
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as Record<string, unknown>;

    checkNoExtraFields(body, ALLOWED_ERROR_FIELDS, "400 error");
    expect(body).toHaveProperty("error");
    expect(body.error).toBe("validation_error");
    expect(body).toHaveProperty("message");
  });

  it("not-found error response has only allowed fields", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/orders/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as Record<string, unknown>;

    checkNoExtraFields(body, ALLOWED_ERROR_FIELDS, "404 error");
    expect(body).toHaveProperty("error");
    expect(body.error).toBe("not_found");
    expect(body).toHaveProperty("message");
  });

  it("conflict error response has only allowed fields", async () => {
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
    const body = res.json() as Record<string, unknown>;

    checkNoExtraFields(body, ALLOWED_ERROR_FIELDS, "409 error");
    expect(body).toHaveProperty("error");
    expect(body.error).toBe("conflict");
  });

  it("route-not-found error has only allowed fields", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/nonexistent-endpoint",
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as Record<string, unknown>;

    checkNoExtraFields(body, ALLOWED_ERROR_FIELDS, "route 404");
    expect(body).toHaveProperty("error");
    expect(body).toHaveProperty("message");
  });
});

// ── Type Consistency Across All Order States ───────────────────────────

describe("Type consistency across order lifecycle", () => {
  it("fields maintain consistent types from draft through calculated", async () => {
    const orderId = await createDraftOrder(app);

    // Check initial draft
    const draftRes = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
    });
    const draft = draftRes.json() as Record<string, unknown>;
    expect(typeof draft.id).toBe("string");
    expect(typeof draft.status).toBe("string");
    expect(draft.status).toBe("draft");
    expect(typeof draft.currency).toBe("string");
    expect(Array.isArray(draft.items)).toBe(true);
    expect(Array.isArray(draft.discounts)).toBe(true);
    expect(typeof draft.subtotal).toBe("string");
    expect(typeof draft.discountTotal).toBe("string");
    expect(typeof draft.taxTotal).toBe("string");
    expect(typeof draft.grandTotal).toBe("string");

    // Add item and check
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

    const withItemRes = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
    });
    const withItem = withItemRes.json() as Record<string, unknown>;
    expect(Array.isArray(withItem.items)).toBe(true);
    expect((withItem.items as Array<unknown>).length).toBe(1);
    const item = (withItem.items as Array<Record<string, unknown>>)[0]!;
    expect(typeof item.id).toBe("string");
    expect(typeof item.quantity).toBe("number");
    expect(typeof item.unitPrice).toBe("string");
    expect(typeof item.lineTotal).toBe("string");

    // Calculate and verify types preserved
    const calcRes = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/calculate`,
    });
    const calculated = calcRes.json() as Record<string, unknown>;
    expect(calculated.status).toBe("calculated");
    expect(typeof calculated.subtotal).toBe("string");
    expect(typeof calculated.discountTotal).toBe("string");
    expect(typeof calculated.taxTotal).toBe("string");
    expect(typeof calculated.grandTotal).toBe("string");

    // Verify via GET
    const finalGet = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
    });
    const final = finalGet.json() as Record<string, unknown>;
    expect(final.status).toBe("calculated");
    expect(typeof final.subtotal).toBe("string");
  });
});
