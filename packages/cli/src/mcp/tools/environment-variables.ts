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

export function registerEnvironmentVariableTools(server: McpServer): void {
  server.registerTool(
    "list_environment_variables",
    {
      description: "List all Connxio environment variables.",
      inputSchema: { contextId: optionalContextIdSchema },
    },
    async ({ contextId }) =>
      withToolErrors(async () => ({
        environmentVariables: await (await getClient(contextId)).get("/v2/environmentvariables"),
      })),
  );

  server.registerTool(
    "get_environment_variable",
    {
      description: "Get a Connxio environment variable by id.",
      inputSchema: {
        contextId: optionalContextIdSchema,
        id: z.string().describe("Environment variable id."),
      },
    },
    async ({ contextId, id }) =>
      withToolErrors(async () => ({
        environmentVariable: await (
          await getClient(contextId)
        ).get(`/v2/environmentvariables/${encodeURIComponent(id)}`),
      })),
  );

  server.registerTool(
    "create_environment_variable",
    {
      description: "Create a Connxio environment variable. Requires contextId.",
      inputSchema: { contextId: contextIdSchema, environmentVariable: jsonObjectSchema },
    },
    async ({ contextId, environmentVariable }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).put("/v2/environmentvariables", { body: environmentVariable }),
      })),
  );

  server.registerTool(
    "delete_environment_variable",
    {
      description:
        "Delete a Connxio environment variable by id. Requires contextId and confirm: true.",
      inputSchema: {
        contextId: contextIdSchema,
        id: z.string().describe("Environment variable id."),
        confirm: confirmSchema,
      },
    },
    async ({ contextId, id }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).delete(`/v2/environmentvariables/${encodeURIComponent(id)}`),
      })),
  );
}
