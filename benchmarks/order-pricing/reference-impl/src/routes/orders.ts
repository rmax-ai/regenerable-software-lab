// routes/orders.ts — POST /orders, GET /orders/:id, POST /orders/:id/calculate

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { OrderStore, NotFoundError, ConflictError } from "../order-store.js";

// ── Schemas ────────────────────────────────────────────────────────────

const createOrderRequestSchema = z.object({
  currency: z.enum(["USD", "EUR", "GBP"]),
  taxRate: z.string().regex(/^0\.\d+$/),
});

const uuidSchema = z.string().uuid();

const orderItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().min(1),
  name: z.string().min(1),
  unitPrice: z.string(),
  quantity: z.number().int().min(1),
  lineTotal: z.string(),
});

const percentageDiscountSchema = z.object({
  id: z.string().uuid(),
  type: z.literal("percentage"),
  value: z.string(),
});

const fixedDiscountSchema = z.object({
  id: z.string().uuid(),
  type: z.literal("fixed"),
  value: z.string(),
});

const discountSchema = z.discriminatedUnion("type", [
  percentageDiscountSchema,
  fixedDiscountSchema,
]);

const orderResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["draft", "calculated"]),
  currency: z.enum(["USD", "EUR", "GBP"]),
  items: z.array(orderItemSchema),
  discounts: z.array(discountSchema),
  taxRate: z.string(),
  subtotal: z.string(),
  discountTotal: z.string(),
  taxTotal: z.string(),
  grandTotal: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      })
    )
    .optional(),
});

// ── Route Plugin ───────────────────────────────────────────────────────

export function orderRoutes(store: OrderStore): FastifyPluginAsyncZod {
  return async (app) => {
    // POST /orders — Create a new draft order
    app.post(
      "/",
      {
        schema: {
          body: createOrderRequestSchema,
          response: {
            200: orderResponseSchema,
            201: orderResponseSchema,
            400: errorResponseSchema,
            409: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const idempotencyKey = request.headers["idempotency-key"] as string | undefined;

        // Check idempotency
        if (idempotencyKey) {
          const existing = store.getIdempotencyKey(idempotencyKey);
          if (existing) {
            if (existing.resourceType !== "order") {
              return reply.status(409).send({
                error: "conflict",
                message: "Idempotency key already used for a different resource type",
              });
            }
            const order = store.getOrder(existing.resourceId);
            if (order) {
              return reply.status(200).send(order);
            }
          }
        }

        const order = store.createOrder(
          request.body as { currency: "USD" | "EUR" | "GBP"; taxRate: string }
        );

        if (idempotencyKey) {
          store.setIdempotencyKey(idempotencyKey, {
            resourceType: "order",
            resourceId: order.id,
          });
        }

        return reply.status(201).send(order);
      }
    );

    // GET /orders/:orderId — Retrieve an order
    app.get(
      "/:orderId",
      {
        schema: {
          params: z.object({ orderId: uuidSchema }),
          response: {
            200: orderResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const order = store.getOrder(request.params.orderId);
        if (!order) {
          return reply.status(404).send({
            error: "not_found",
            message: "Order not found",
          });
        }
        return reply.status(200).send(order);
      }
    );

    // POST /orders/:orderId/calculate — Calculate and finalize order
    app.post(
      "/:orderId/calculate",
      {
        schema: {
          params: z.object({ orderId: uuidSchema }),
          response: {
            200: orderResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        try {
          const order = store.calculateOrder(request.params.orderId);
          return reply.status(200).send(order);
        } catch (err) {
          if (err instanceof NotFoundError) {
            return reply.status(404).send({
              error: "not_found",
              message: err.message,
            });
          }
          if (err instanceof ConflictError) {
            return reply.status(409).send({
              error: "conflict",
              message: err.message,
            });
          }
          throw err;
        }
      }
    );
  };
}
