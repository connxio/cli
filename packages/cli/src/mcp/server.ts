import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import updateNotifier from "update-notifier";
import { z } from "zod";

import pkg from "../../package.json" with { type: "json" };

import { ConnxioClient } from "../connxio/client.js";
import { listPublicContexts, resolveContext } from "../connxio/contexts.js";
import { hasApiKey } from "../connxio/credentials.js";

const execFileAsync = promisify(execFile);

const contextIdSchema = z.string().describe("Connxio context id. Required for write tools.");
const optionalContextIdSchema = z.string().optional().describe("Optional Connxio context id.");
const confirmSchema = z.literal(true).describe("Must be true to confirm this destructive action.");
const jsonObjectSchema = z
  .record(z.string(), z.unknown())
  .describe("JSON request body for the Connxio API operation.");

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

function registerCliTools(server: McpServer): void {
  server.registerTool(
    "check_cli_update",
    {
      description:
        "Check whether a newer version of the Connxio CLI is available on npm. " +
        "Call this proactively to let the user know if an update is available.",
    },
    async () =>
      withToolErrors(async () => {
        const info = await updateNotifier({ pkg, updateCheckInterval: 0 }).fetchInfo();
        const updateAvailable = info.type !== "latest";
        return {
          current: info.current,
          latest: info.latest,
          updateAvailable,
          updateType: updateAvailable ? info.type : null,
          installCommand: updateAvailable ? `npm install -g ${pkg.name}` : null,
        };
      }),
  );

  server.registerTool(
    "install_cli_update",
    {
      description:
        "Install the latest version of the Connxio CLI via npm. " +
        "Only use after check_cli_update confirms an update is available. Requires confirm: true.",
      inputSchema: { confirm: confirmSchema },
    },
    async () =>
      withToolErrors(async () => {
        const { stdout, stderr } = await execFileAsync("npm", [
          "install",
          "-g",
          `${pkg.name}@latest`,
        ]);
        return { stdout: stdout.trim(), stderr: stderr.trim() };
      }),
  );
}

function registerContextTools(server: McpServer): void {
  server.registerTool(
    "list_contexts",
    { description: "List configured Connxio contexts without exposing API keys." },
    async () => jsonToolResult({ contexts: await listPublicContexts() }),
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

function registerSubscriptionTools(server: McpServer): void {
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

function registerIntegrationTools(server: McpServer): void {
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
    "upsert_integration",
    {
      description: "Create or update a Connxio integration. Requires contextId.",
      inputSchema: { contextId: contextIdSchema, integration: jsonObjectSchema },
    },
    async ({ contextId, integration }) =>
      withToolErrors(async () => ({
        result: await (await getClient(contextId)).post("/v2/integrations", { body: integration }),
      })),
  );

  server.registerTool(
    "upsert_integration_no_validation",
    {
      description: "Create or update a Connxio integration without validation. Requires contextId.",
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

function registerCodeComponentTools(server: McpServer): void {
  server.registerTool(
    "list_code_components",
    {
      description: "List all Connxio code components.",
      inputSchema: { contextId: optionalContextIdSchema },
    },
    async ({ contextId }) =>
      withToolErrors(async () => ({
        codeComponents: await (await getClient(contextId)).get("/v2/codecomponents"),
      })),
  );

  server.registerTool(
    "get_code_component",
    {
      description: "Get the newest Connxio code component by id.",
      inputSchema: {
        contextId: optionalContextIdSchema,
        id: z.string().describe("Code component id."),
      },
    },
    async ({ contextId, id }) =>
      withToolErrors(async () => ({
        codeComponent: await (
          await getClient(contextId)
        ).get(`/v2/codecomponents/${encodeURIComponent(id)}`),
      })),
  );

  server.registerTool(
    "get_code_component_versions",
    {
      description: "List all versions of a Connxio code component by id.",
      inputSchema: {
        contextId: optionalContextIdSchema,
        id: z.string().describe("Code component id."),
      },
    },
    async ({ contextId, id }) =>
      withToolErrors(async () => ({
        versions: await (
          await getClient(contextId)
        ).get(`/v2/codecomponents/${encodeURIComponent(id)}/versions`),
      })),
  );

  server.registerTool(
    "upsert_code_component",
    {
      description: "Create or update a Connxio code component. Requires contextId.",
      inputSchema: { contextId: contextIdSchema, codeComponent: jsonObjectSchema },
    },
    async ({ contextId, codeComponent }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).put("/v2/codecomponents", { body: codeComponent }),
      })),
  );

  server.registerTool(
    "deprecate_code_component",
    {
      description: "Deprecate a Connxio code component by id. Requires contextId.",
      inputSchema: {
        contextId: contextIdSchema,
        id: z.string().describe("Code component id."),
        version: z.string().optional().describe("Optional version to deprecate."),
      },
    },
    async ({ contextId, id, version }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).put(`/v2/codecomponents/${encodeURIComponent(id)}/deprecate`, {
          query: { version },
        }),
      })),
  );

  server.registerTool(
    "rename_code_component",
    {
      description: "Update a Connxio code component name by id. Requires contextId.",
      inputSchema: {
        contextId: contextIdSchema,
        id: z.string().describe("Code component id."),
        name: z.string().describe("New code component name."),
      },
    },
    async ({ contextId, id, name }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).put(`/v2/codecomponents/${encodeURIComponent(id)}/updatename`, {
          query: { name },
        }),
      })),
  );

  server.registerTool(
    "delete_code_component",
    {
      description: "Delete a Connxio code component by id. Requires contextId and confirm: true.",
      inputSchema: {
        contextId: contextIdSchema,
        id: z.string().describe("Code component id."),
        confirm: confirmSchema,
      },
    },
    async ({ contextId, id }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).delete(`/v2/codecomponents/${encodeURIComponent(id)}`),
      })),
  );
}

function registerEnvironmentVariableTools(server: McpServer): void {
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
    "upsert_environment_variable",
    {
      description: "Create or update a Connxio environment variable. Requires contextId.",
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

function registerSecurityConfigTools(server: McpServer): void {
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
    "upsert_security_config",
    {
      description: "Create or update a Connxio security configuration. Requires contextId.",
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

async function getClient(contextId?: string): Promise<ConnxioClient> {
  return new ConnxioClient(await resolveContext(contextId));
}

async function withToolErrors(action: () => Promise<unknown>) {
  try {
    return jsonToolResult(await action());
  } catch (error: unknown) {
    return errorToolResult(error instanceof Error ? error.message : String(error));
  }
}

function jsonToolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorToolResult(message: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
    isError: true,
  };
}
