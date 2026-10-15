import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getClient, optionalContextIdSchema, withToolErrors } from "./shared.js";

const pageSchema = {
  contextId: optionalContextIdSchema,
  from: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("Inclusive start as an ISO 8601 timestamp with UTC offset."),
  to: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("Inclusive end as an ISO 8601 timestamp with UTC offset."),
  skip: z
    .number()
    .int()
    .min(0)
    .max(100_000)
    .optional()
    .describe("Records to omit. API default: 0."),
  size: z
    .number()
    .int()
    .min(1)
    .max(1_000)
    .optional()
    .describe("Maximum records. API default: 100. Use hasNextPage to continue."),
};

function validateDateRange(from?: string, to?: string): void {
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new Error("from must not be later than to.");
  }
}

export function registerDiagnosticTools(server: McpServer): void {
  for (const scope of ["company", "subscription"] as const) {
    server.registerTool(
      `list_${scope}_performance_metrics`,
      {
        description: `List performance metrics for the current ${scope}, newest first (v3). Defaults to the last 24 hours. Returns one page with paging metadata.`,
        inputSchema: pageSchema,
      },
      async ({ contextId, from, to, skip, size }) =>
        withToolErrors(async () => {
          validateDateRange(from, to);
          return (await getClient(contextId)).get(`/v3/performance/${scope}`, {
            query: { from, to, skip, size },
          });
        }),
    );
  }

  server.registerTool(
    "list_integration_performance_metrics",
    {
      description:
        "List performance metrics for an integration across subscriptions in the current company, newest first (v3). Defaults to the last 24 hours. Returns one page with paging metadata.",
      inputSchema: { ...pageSchema, integrationId: z.uuid().describe("Integration id.") },
    },
    async ({ contextId, integrationId, from, to, skip, size }) =>
      withToolErrors(async () => {
        validateDateRange(from, to);
        return (await getClient(contextId)).get(
          `/v3/performance/integration/${encodeURIComponent(integrationId)}`,
          { query: { from, to, skip, size } },
        );
      }),
  );

  server.registerTool(
    "get_interchange_performance_metric",
    {
      description:
        "Get one interchange's performance metric within the current company (v3). Date and paging filters do not apply.",
      inputSchema: {
        contextId: optionalContextIdSchema,
        interchangeId: z.uuid().describe("Interchange id."),
      },
    },
    async ({ contextId, interchangeId }) =>
      withToolErrors(async () => ({
        metric: await (
          await getClient(contextId)
        ).get(`/v3/performance/interchange/${encodeURIComponent(interchangeId)}`),
      })),
  );

  server.registerTool(
    "list_subscription_errors",
    {
      description:
        "List persisted errors for the current subscription, newest first (v3). Without dates, includes all retained errors. Returns one page with paging metadata.",
      inputSchema: pageSchema,
    },
    async ({ contextId, from, to, skip, size }) =>
      withToolErrors(async () => {
        validateDateRange(from, to);
        return (await getClient(contextId)).get("/v3/error/subscription", {
          query: { from, to, skip, size },
        });
      }),
  );

  server.registerTool(
    "list_integration_errors",
    {
      description:
        "List persisted errors for an integration within the current subscription, newest first (v3). Without dates, includes all retained errors. An empty page can also mean the integration does not exist. Returns paging metadata.",
      inputSchema: { ...pageSchema, integrationId: z.uuid().describe("Integration id.") },
    },
    async ({ contextId, integrationId, from, to, skip, size }) =>
      withToolErrors(async () => {
        validateDateRange(from, to);
        return (await getClient(contextId)).get(
          `/v3/error/integration/${encodeURIComponent(integrationId)}`,
          { query: { from, to, skip, size } },
        );
      }),
  );

  server.registerTool(
    "get_interchange_error",
    {
      description:
        "Get one interchange's persisted error within the current subscription (v3). Date and paging filters do not apply.",
      inputSchema: {
        contextId: optionalContextIdSchema,
        interchangeId: z.uuid().describe("Interchange id."),
      },
    },
    async ({ contextId, interchangeId }) =>
      withToolErrors(async () => ({
        error: await (
          await getClient(contextId)
        ).get(`/v3/error/interchange/${encodeURIComponent(interchangeId)}`),
      })),
  );
}
