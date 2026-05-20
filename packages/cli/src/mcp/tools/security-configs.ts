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

export function registerSecurityConfigTools(server: McpServer): void {
  server.registerTool(
    "list_security_configs",
    {
      description: "List all Connxio security configurations.",
      inputSchema: { contextId: optionalContextIdSchema },
    },
    async ({ contextId }) =>
      withToolErrors(async () => ({
        securityConfigs: await (await getClient(contextId)).get("/v2/securityconfigs"),
      })),
  );

  server.registerTool(
    "get_security_config",
    {
      description: "Get a Connxio security configuration by id.",
      inputSchema: {
        contextId: optionalContextIdSchema,
        id: z.string().describe("Security configuration id."),
      },
    },
    async ({ contextId, id }) =>
      withToolErrors(async () => ({
        securityConfig: await (
          await getClient(contextId)
        ).get(`/v2/securityconfigs/${encodeURIComponent(id)}`),
      })),
  );

  server.registerTool(
    "create_security_config",
    {
      description: "Create a Connxio security configuration. Requires contextId.",
      inputSchema: { contextId: contextIdSchema, securityConfig: jsonObjectSchema },
    },
    async ({ contextId, securityConfig }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).put("/v2/securityconfigs", { body: securityConfig }),
      })),
  );

  server.registerTool(
    "delete_security_config",
    {
      description:
        "Delete a Connxio security configuration by id. Requires contextId and confirm: true.",
      inputSchema: {
        contextId: contextIdSchema,
        id: z.string().describe("Security configuration id."),
        confirm: confirmSchema,
      },
    },
    async ({ contextId, id }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).delete(`/v2/securityconfigs/${encodeURIComponent(id)}`),
      })),
  );
}
