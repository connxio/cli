import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  confirmSchema,
  contextIdSchema,
  getClient,
  optionalContextIdSchema,
  withToolErrors,
} from "./shared.js";

const apiVersionSchema = z
  .enum(["v2", "v3"])
  .default("v2")
  .describe("Use v2 for legacy integrations (default), or v3 for action-based integrations.");

const integrationWriteSchema = z
  .object({
    archived: z
      .boolean()
      .optional()
      .describe("Whether the configuration is archived. API default: false."),
  })
  .catchall(z.unknown())
  .describe(
    "Integration request body. Supports optional archived and all other integration properties.",
  );

export function registerIntegrationTools(server: McpServer): void {
  server.registerTool(
    "list_integrations",
    {
      description: "List Connxio integrations: v2 legacy or v3 action-based.",
      inputSchema: { contextId: optionalContextIdSchema, apiVersion: apiVersionSchema },
    },
    async ({ contextId, apiVersion = "v2" }) =>
      withToolErrors(async () => ({
        integrations: await (await getClient(contextId)).get(`/${apiVersion}/integrations`),
      })),
  );

  server.registerTool(
    "get_integration",
    {
      description: "Get a Connxio integration by id: v2 legacy or v3 action-based.",
      inputSchema: {
        apiVersion: apiVersionSchema,
        contextId: optionalContextIdSchema,
        id: z.string().describe("Integration id."),
        replaceVariables: z
          .boolean()
          .optional()
          .describe("Whether to replace environment variable strings with their values."),
      },
    },
    async ({ contextId, id, replaceVariables, apiVersion = "v2" }) =>
      withToolErrors(async () => ({
        integration: await (
          await getClient(contextId)
        ).get(`/${apiVersion}/integrations/${encodeURIComponent(id)}`, {
          query: { replaceVariables },
        }),
      })),
  );

  server.registerTool(
    "create_integration",
    {
      description:
        "Create or upsert a Connxio integration. Use v3 for action-based integrations with triggers/actions (isActionBased is computed). Requires contextId.",
      inputSchema: {
        contextId: contextIdSchema,
        apiVersion: apiVersionSchema,
        integration: integrationWriteSchema,
      },
    },
    async ({ contextId, integration, apiVersion = "v2" }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).post(`/${apiVersion}/integrations`, { body: integration }),
      })),
  );

  server.registerTool(
    "create_integration_no_validation",
    {
      description:
        "Create or upsert an integration without validation (v3 skips graph validation and disables invalid integrations). Use v3 for action-based integrations with triggers/actions (isActionBased is computed). Requires contextId.",
      inputSchema: {
        contextId: contextIdSchema,
        apiVersion: apiVersionSchema,
        integration: integrationWriteSchema,
      },
    },
    async ({ contextId, integration, apiVersion = "v2" }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).post(`/${apiVersion}/integrations/novalidation`, { body: integration }),
      })),
  );

  server.registerTool(
    "update_integration",
    {
      description: "Update an existing Connxio integration by id. Requires contextId.",
      inputSchema: {
        apiVersion: apiVersionSchema,
        contextId: contextIdSchema,
        id: z.string().describe("Integration id."),
        integration: integrationWriteSchema,
      },
    },
    async ({ contextId, id, integration, apiVersion = "v2" }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).put(`/${apiVersion}/integrations/${encodeURIComponent(id)}`, { body: integration }),
      })),
  );

  server.registerTool(
    "delete_integration",
    {
      description: "Delete a Connxio integration by id. Requires contextId and confirm: true.",
      inputSchema: {
        apiVersion: apiVersionSchema,
        contextId: contextIdSchema,
        id: z.string().describe("Integration id."),
        confirm: confirmSchema,
      },
    },
    async ({ contextId, id, apiVersion = "v2" }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).delete(`/${apiVersion}/integrations/${encodeURIComponent(id)}`),
      })),
  );
}
