import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  confirmSchema,
  contextIdSchema,
  getClient,
  optionalContextIdSchema,
  withToolErrors,
} from "./shared.js";

const idSchema = z.string().min(1).describe("Schema id.");
const versionSchema = z.string().min(1).describe("Schema version.");

export function registerSchemaTools(server: McpServer): void {
  server.registerTool(
    "list_schemas",
    {
      description: "List latest schema metadata for the current company, without content (v3).",
      inputSchema: { contextId: optionalContextIdSchema },
    },
    async ({ contextId }) =>
      withToolErrors(async () => ({
        schemas: await (await getClient(contextId)).get("/v3/schemas"),
      })),
  );

  server.registerTool(
    "get_schema",
    {
      description: "Get the latest schema version including its content (v3).",
      inputSchema: { contextId: optionalContextIdSchema, id: idSchema },
    },
    async ({ contextId, id }) =>
      withToolErrors(async () => ({
        schema: await (await getClient(contextId)).get(`/v3/schemas/${encodeURIComponent(id)}`),
      })),
  );

  server.registerTool(
    "get_schema_versions",
    {
      description: "List all schema versions, newest first, including each version's content (v3).",
      inputSchema: { contextId: optionalContextIdSchema, id: idSchema },
    },
    async ({ contextId, id }) =>
      withToolErrors(async () => ({
        versions: await (
          await getClient(contextId)
        ).get(`/v3/schemas/${encodeURIComponent(id)}/versions`),
      })),
  );

  server.registerTool(
    "get_schema_content",
    {
      description: "Get the content of one specific schema version (v3).",
      inputSchema: {
        contextId: optionalContextIdSchema,
        id: idSchema,
        schemaVersion: versionSchema,
      },
    },
    async ({ contextId, id, schemaVersion }) =>
      withToolErrors(async () => ({
        content: await (
          await getClient(contextId)
        ).get(
          `/v3/schemas/${encodeURIComponent(id)}/versions/${encodeURIComponent(schemaVersion)}/content`,
        ),
      })),
  );

  server.registerTool(
    "upload_schema",
    {
      description:
        "Create a schema or upload a new version (v3). Existing versions cannot be overwritten; name and type must match existing metadata. Requires contextId.",
      inputSchema: {
        contextId: contextIdSchema,
        schema: z.object({
          id: idSchema,
          name: z
            .string()
            .min(1)
            .regex(/^[A-Za-z0-9 -]+$/),
          description: z.string().nullable().optional(),
          version: versionSchema,
          type: z.string().min(1).describe("Connxio schema type."),
          webhookConnectionId: z.string().nullable().optional(),
          originalFilename: z.string().nullable().optional(),
          uploadedBy: z.string().nullable().optional(),
          content: z
            .base64()
            .min(1)
            .describe("Base64-encoded schema content (the API byte[] field)."),
        }),
      },
    },
    async ({ contextId, schema }) =>
      withToolErrors(async () => ({
        schema: await (await getClient(contextId)).put("/v3/schemas", { body: schema }),
      })),
  );

  server.registerTool(
    "deprecate_schema",
    {
      description:
        "Toggle a schema version's deprecated state (v3). Calling again restores the version. Requires contextId.",
      inputSchema: { contextId: contextIdSchema, id: idSchema, version: versionSchema },
    },
    async ({ contextId, id, version }) =>
      withToolErrors(async () => ({
        result: await (
          await getClient(contextId)
        ).put(`/v3/schemas/${encodeURIComponent(id)}/deprecate`, { query: { version } }),
      })),
  );

  server.registerTool(
    "delete_schema",
    {
      description:
        "Permanently delete a schema and all versions (v3). Fails if referenced by an integration. Requires contextId and confirm: true.",
      inputSchema: { contextId: contextIdSchema, id: idSchema, confirm: confirmSchema },
    },
    async ({ contextId, id }) =>
      withToolErrors(async () => ({
        result: await (await getClient(contextId)).delete(`/v3/schemas/${encodeURIComponent(id)}`),
      })),
  );
}
