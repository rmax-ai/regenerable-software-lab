// routes/discounts.ts — POST /orders/:id/discounts, DELETE /orders/:id/discounts/:discountId

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  OrderStore,
  NotFoundError,
  ConflictError,
  type AddDiscountParams,
} from "../order-store.js";

// ── Schemas ────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();

const percentageDiscountRequestSchema = z.object({
  type: z.literal("percentage"),
  value: z.string().regex(/^(0(\.\d+)?|1(\.0+)?)$/),
});

const fixedDiscountRequestSchema = z.object({
  type: z.literal("fixed"),
  value: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

// Use z.union for better type inference with fastify-type-provider-zod
const addDiscountRequestSchema = z.union([
  percentageDiscountRequestSchema,
  fixedDiscountRequestSchema,
]);

const percentageDiscountResponseSchema = z.object({
  id: z.string().uuid(),
  type: z.literal("percentage"),
  value: z.string(),
});

const fixedDiscountResponseSchema = z.object({
  id: z.string().uuid(),
  type: z.literal("fixed"),
  value: z.string(),
});

const discountResponseSchema = z.discriminatedUnion("type", [
  percentageDiscountResponseSchema,
  fixedDiscountResponseSchema,
]);

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

export function discountRoutes(store: OrderStore): FastifyPluginAsyncZod {
  return async (app) => {
    // POST /orders/:orderId/discounts — Apply a discount
    app.post(
      "/:orderId/discounts",
      {
        schema: {
          params: z.object({ orderId: uuidSchema }),
          body: addDiscountRequestSchema,
          response: {
            200: discountResponseSchema,
            201: discountResponseSchema,
            400: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { orderId } = request.params;
        const body = request.body as AddDiscountParams;

        const idempotencyKey = request.headers["idempotency-key"] as string | undefined;

        if (idempotencyKey) {
          const existing = store.getIdempotencyKey(idempotencyKey);
          if (existing) {
            const order = store.getOrder(orderId);
            if (order) {
              const discount = order.discounts.find(
                (d) => d.id === existing.resourceId
              );
              if (discount) {
                return reply.status(200).send(discount);
              }
            }
          }
        }

        try {
          const discount = store.addDiscount(orderId, body);

          if (idempotencyKey) {
            store.setIdempotencyKey(idempotencyKey, {
              resourceType: "discount",
              resourceId: discount.id,
            });
          }

          return reply.status(201).send(discount);
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

    // DELETE /orders/:orderId/discounts/:discountId — Remove a discount
    app.delete(
      "/:orderId/discounts/:discountId",
      {
        schema: {
          params: z.object({ orderId: uuidSchema, discountId: uuidSchema }),
          response: {
            204: z.undefined(),
            404: errorResponseSchema,
            409: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        try {
          store.removeDiscount(request.params.orderId, request.params.discountId);
          return reply.status(204).send();
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
