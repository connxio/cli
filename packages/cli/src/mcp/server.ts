import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCliTools } from "./tools/cli.js";
import { registerCodeComponentTools } from "./tools/code-components.js";
import { registerContextTools } from "./tools/contexts.js";
import { registerEnvironmentVariableTools } from "./tools/environment-variables.js";
import { registerIntegrationTools } from "./tools/integrations.js";
import { registerSecurityConfigTools } from "./tools/security-configs.js";
import { registerSubscriptionTools } from "./tools/subscriptions.js";

export async function serveMcp(): Promise<void> {
  const server = new McpServer({
    name: "connxio",
    version: "0.1.0",
  });

  registerCliTools(server);
  registerContextTools(server);
  registerSubscriptionTools(server);
  registerIntegrationTools(server);
  registerCodeComponentTools(server);
  registerEnvironmentVariableTools(server);
  registerSecurityConfigTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
