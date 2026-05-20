import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  updateComponentInIntegration,
  uploadCodeComponent,
} from "../../connxio/code-components.js";
import {
  confirmSchema,
  contextIdSchema,
  getClient,
  optionalContextIdSchema,
  withToolErrors,
} from "./shared.js";

export function registerCodeComponentTools(server: McpServer): void {
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
    "upload_code_component",
    {
      description:
        "Upload a local .dll or .zip file as a Connxio code component. Requires contextId.",
      inputSchema: {
        autoZip: z
          .boolean()
          .optional()
          .describe(
            "Whether to zip the containing directory when uploading a .dll. Defaults to true when the existing component was previously uploaded as a .zip.",
          ),
        contextId: contextIdSchema,
        filePath: z.string().describe("Absolute or relative path to a local .dll or .zip file."),
        name: z.string().describe("Code component display name."),
        type: z
          .string()
          .optional()
          .describe("Optional code component type. Defaults to the existing type or Map."),
        version: z
          .string()
          .optional()
          .describe(
            "Optional version. When omitted, the latest version is looked up and the patch version is incremented.",
          ),
      },
    },
    async ({ autoZip, contextId, filePath, name, type, version }) =>
      withToolErrors(async () => ({
        upload: await uploadCodeComponent(await getClient(contextId), {
          autoZip,
          filePath,
          name,
          type,
          version,
        }),
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
    "update_component_in_integration",
    {
      description:
        "Update the version of a code component used inside an integration. Requires contextId.",
      inputSchema: {
        componentName: z.string().describe("Code component display name to update."),
        contextId: contextIdSchema,
        integrationId: z.string().describe("Integration id."),
        newVersion: z.string().describe("New code component version to set."),
        oldVersion: z.string().describe("Current code component version to replace."),
      },
    },
    async ({ componentName, contextId, integrationId, newVersion, oldVersion }) =>
      withToolErrors(async () => ({
        update: await updateComponentInIntegration(await getClient(contextId), {
          componentName,
          integrationId,
          newVersion,
          oldVersion,
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
