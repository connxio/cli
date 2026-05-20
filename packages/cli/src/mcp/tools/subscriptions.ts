import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getClient, optionalContextIdSchema, withToolErrors } from "./shared.js";

export function registerSubscriptionTools(server: McpServer): void {
  server.registerTool(
    "list_subscriptions",
    {
      description: "List the Connxio subscription associated with the selected context API key.",
      inputSchema: { contextId: optionalContextIdSchema },
    },
    async ({ contextId }) =>
      withToolErrors(async () => ({
        subscriptions: await (await getClient(contextId)).listSubscriptions(),
      })),
  );

  server.registerTool(
    "get_current_subscription",
    {
      description: "Get the Connxio subscription associated with the selected context API key.",
      inputSchema: { contextId: optionalContextIdSchema },
    },
    async ({ contextId }) =>
      withToolErrors(async () => ({
        subscription: await (await getClient(contextId)).getCurrentSubscription(),
      })),
  );
}
