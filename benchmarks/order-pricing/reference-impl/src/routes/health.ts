// routes/health.ts — GET /health

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const healthResponseSchema = z.object({
  status: z.literal("healthy"),
  uptime: z.number().optional(),
});

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async (_request, _reply) => {
      return {
        status: "healthy" as const,
        uptime: process.uptime(),
      };
    }
  );
};
