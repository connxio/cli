import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  confirmSchema,
  contextIdSchema,
  getClient,
  jsonObjectSchema,
  optionalContextIdSchema,
  withToolErrors,
} from "./shared.js";

export function registerIntegrationTools(server: McpServer): void {
  server.registerTool(
    "list_integrations",
    {
      description: "List all Connxio integrations.",
      inputSchema: { contextId: optionalContextIdSchema },
    },
    async ({ contextId }) =>
      withToolErrors(async () => ({
        integrations: await (await getClient(contextId)).get("/v2/integrations"),
      })),
  );

  server.registerTool(
    "get_integration",
    {
      description: "Get a Connxio integration by id.",
      inputSchema: {
        contextId: optionalContextIdSchema,
        id: z.string().describe("Integration id."),
        replaceVariables: z
          .boolean()
          .optional()
          .describe("Whether to replace environment variable strings with their values."),
      },
    },
    async ({ contextId, id, replaceVariables }) =>
      withToolErrors(async () => ({
        integration: await (
          await getClient(contextId)
        ).get(`/v2/integrations/${encodeURIComponent(id)}`, {
          query: { replaceVariables },
        }),
      })),
  );

  server.registerTool(
    "create_integration",
    {
      description: "Create a Connxio integration. Requires contextId.",
      inputSchema: { contextId: contextIdSchema, integration: jsonObjectSchema },
    },
    async ({ contextId, integration }) =>
      withToolErrors(async () => ({
        result: await (await getClient(contextId)).post("/v2/integrations", { body: integration }),
      })),
  );

  server.registerTool(
    "create_integration_no_validation",
    {
      description: "Create a Connxio integration without validation. Requires contextId.",
      inputSchema: { contextId: contextIdSchema, integration: jsonObjectSchema },
    },
    async ({ contextId, integration }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).post("/v2/integrations/novalidation", { body: integration }),
      })),
  );

  server.registerTool(
    "update_integration",
    {
      description: "Update an existing Connxio integration by id. Requires contextId.",
      inputSchema: {
        contextId: contextIdSchema,
        id: z.string().describe("Integration id."),
        integration: jsonObjectSchema,
      },
    },
    async ({ contextId, id, integration }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).put(`/v2/integrations/${encodeURIComponent(id)}`, { body: integration }),
      })),
  );

  server.registerTool(
    "delete_integration",
    {
      description: "Delete a Connxio integration by id. Requires contextId and confirm: true.",
      inputSchema: {
        contextId: contextIdSchema,
        id: z.string().describe("Integration id."),
        confirm: confirmSchema,
      },
    },
    async ({ contextId, id }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).delete(`/v2/integrations/${encodeURIComponent(id)}`),
      })),
  );
}
