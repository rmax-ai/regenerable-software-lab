// server.ts — Fastify HTTP server with Zod type provider

import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { OrderStore } from "./order-store.js";
import { orderRoutes } from "./routes/orders.js";
import { itemRoutes } from "./routes/items.js";
import { discountRoutes } from "./routes/discounts.js";
import { healthRoutes } from "./routes/health.js";

// ── Application Builder ────────────────────────────────────────────────

export function buildApp() {
  const store = new OrderStore();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      formatters: {
        level: (label: string) => ({ level: label }),
      },
    },
  }).withTypeProvider<ZodTypeProvider>();

  // Set up Zod serialization/validation
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // ── Global Error Handler ─────────────────────────────────────────────
  // Never expose stack traces or internal details (I-14)

  app.setErrorHandler((error, request, reply) => {
    // Zod validation errors → 400
    if (error instanceof z.ZodError) {
      const details = error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      return reply.status(400).send({
        error: "validation_error",
        message: "Request validation failed",
        details,
      });
    }

    // Fastify validation errors (e.g. schema validation)
    const errAny = error as unknown as Record<string, unknown>;
    if (errAny.validation !== undefined) {
      return reply.status(400).send({
        error: "validation_error",
        message: "Request validation failed",
      });
    }

    // Payload too large
    if (errAny.statusCode === 413) {
      return reply.status(413).send({
        error: "payload_too_large",
        message: "Request body too large",
      });
    }

    // Log the full error internally, but only expose sanitized response
    request.log.error({ err: error }, "Unhandled error");

    const statusCode =
      typeof errAny.statusCode === "number" ? errAny.statusCode : 500;

    return reply.status(statusCode).send({
      error: "internal_error",
      message: "An unexpected error occurred",
    });
  });

  // ── 404 Handler ──────────────────────────────────────────────────────

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      error: "not_found",
      message: "Route not found",
    });
  });

  // ── Register Routes ──────────────────────────────────────────────────

  app.register(healthRoutes);

  app.register(orderRoutes(store), { prefix: "/orders" });

  // Items and discounts are sub-routes of orders
  app.register(itemRoutes(store), { prefix: "/orders" });
  app.register(discountRoutes(store), { prefix: "/orders" });

  return app;
}

// ── Startup ────────────────────────────────────────────────────────────

async function start() {
  const app = buildApp();

  try {
    const port = parseInt(process.env.PORT ?? "3000", 10);
    await app.listen({ port, host: "0.0.0.0" });
    app.log.info(`Server listening on port ${port}`);
  } catch (err) {
    app.log.fatal({ err }, "Failed to start server");
    process.exit(1);
  }
}

// Only start the server if this is the entry point
const isMainModule = process.argv[1]?.endsWith("server.ts") ?? false;
if (isMainModule) {
  start();
}
