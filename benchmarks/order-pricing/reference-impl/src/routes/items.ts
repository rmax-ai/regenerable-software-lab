// routes/items.ts — POST /orders/:id/items, PATCH /orders/:id/items/:itemId, DELETE /orders/:id/items/:itemId

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  OrderStore,
  NotFoundError,
  ConflictError,
  type AddItemParams,
  type UpdateItemParams,
} from "../order-store.js";

// ── Schemas ────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();

const addItemRequestSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
  quantity: z.number().int().min(1),
});

const updateItemRequestSchema = z.object({
  quantity: z.number().int().min(1),
});

const orderItemResponseSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().min(1),
  name: z.string().min(1),
  unitPrice: z.string(),
  quantity: z.number().int().min(1),
  lineTotal: z.string(),
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

export function itemRoutes(store: OrderStore): FastifyPluginAsyncZod {
  return async (app) => {
    // POST /orders/:orderId/items — Add a line item
    app.post(
      "/:orderId/items",
      {
        schema: {
          params: z.object({ orderId: uuidSchema }),
          body: addItemRequestSchema,
          response: {
            200: orderItemResponseSchema,
            201: orderItemResponseSchema,
            400: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { orderId } = request.params;
        const body = request.body as AddItemParams;

        const idempotencyKey = request.headers["idempotency-key"] as string | undefined;

        if (idempotencyKey) {
          const existing = store.getIdempotencyKey(idempotencyKey);
          if (existing) {
            const order = store.getOrder(orderId);
            if (order) {
              const item = order.items.find((i) => i.id === existing.resourceId);
              if (item) {
                return reply.status(200).send(item);
              }
            }
          }
        }

        try {
          const item = store.addItem(orderId, body);

          if (idempotencyKey) {
            store.setIdempotencyKey(idempotencyKey, {
              resourceType: "item",
              resourceId: item.id,
            });
          }

          return reply.status(201).send(item);
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

    // PATCH /orders/:orderId/items/:itemId — Update item quantity
    app.patch(
      "/:orderId/items/:itemId",
      {
        schema: {
          params: z.object({ orderId: uuidSchema, itemId: uuidSchema }),
          body: updateItemRequestSchema,
          response: {
            200: orderItemResponseSchema,
            400: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        try {
          const item = store.updateItem(
            request.params.orderId,
            request.params.itemId,
            request.body as UpdateItemParams
          );
          return reply.status(200).send(item);
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

    // DELETE /orders/:orderId/items/:itemId — Remove an item
    app.delete(
      "/:orderId/items/:itemId",
      {
        schema: {
          params: z.object({ orderId: uuidSchema, itemId: uuidSchema }),
          response: {
            204: z.undefined(),
            404: errorResponseSchema,
            409: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        try {
          store.removeItem(request.params.orderId, request.params.itemId);
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
