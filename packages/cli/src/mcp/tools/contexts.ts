import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { listPublicContexts, resolveContext } from "../../connxio/contexts.js";
import { hasApiKey } from "../../connxio/credentials.js";

import { optionalContextIdSchema, withToolErrors } from "./shared.js";

export function registerContextTools(server: McpServer): void {
  server.registerTool(
    "list_contexts",
    { description: "List configured Connxio contexts without exposing API keys." },
    async () =>
      withToolErrors(async () => ({
        contexts: await listPublicContexts(),
      })),
  );

  server.registerTool(
    "get_current_context",
    {
      description: "Get the resolved Connxio context. Uses the default context when available.",
      inputSchema: { contextId: optionalContextIdSchema },
    },
    async ({ contextId }) =>
      withToolErrors(async () => {
        const context = await resolveContext(contextId);

        return {
          context: {
            baseUrl: context.baseUrl,
            companyId: context.companyId,
            companyName: context.companyName,
            hasCredential: await hasApiKey(context.apiKeyRef),
            id: context.id,
            name: context.name,
            subscriptionId: context.subscriptionId,
            subscriptionName: context.subscriptionName,
          },
        };
      }),
  );
}
