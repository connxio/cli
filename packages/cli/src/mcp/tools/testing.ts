import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { prepareTestFileUpload, saveTestFile } from "../../connxio/test-files.js";
import {
  confirmSchema,
  contextIdSchema,
  getClient,
  optionalContextIdSchema,
  withToolErrors,
} from "./shared.js";

import {
  apiKeyIdSchema,
  integrationIdSchema,
  testFileUploadSchema,
  testRunPageSchema,
  testRunResultSchema,
} from "./testing-shared.js";

const groupIdSchema = z.uuid().describe("Test group id.");

const groupSchema = z
  .object({
    name: z.string().trim().min(1),
    integrationIds: z
      .array(z.uuid())
      .min(1)
      .refine(
        (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
        "Integration ids must be unique.",
      ),
    assertions: z
      .record(z.uuid(), z.record(z.string().min(1), z.string().min(1)))
      .optional()
      .describe(
        "Integration id -> node id -> CxMaL assertion. Nodes may be inbound integration ids or trigger/action ids.",
      ),
  })
  .refine(
    (group) =>
      Object.keys(group.assertions ?? {}).every((id) =>
        group.integrationIds.some((member) => member.toLowerCase() === id.toLowerCase()),
      ),
    "Assertions must reference integrations in the group.",
  );
const readGroupSchema = { contextId: optionalContextIdSchema, groupId: groupIdSchema };
const fileSchema = { ...readGroupSchema, integrationId: integrationIdSchema };
const groupPath = (id: string) => `/v3/testgroups/${encodeURIComponent(id)}`;
const filePath = (groupId: string, integrationId: string) =>
  `${groupPath(groupId)}/files/${encodeURIComponent(integrationId)}`;

export function registerTestingTools(server: McpServer): void {
  server.registerTool(
    "list_test_groups",
    {
      description: "List test groups in the current subscription (v3).",
      inputSchema: { contextId: optionalContextIdSchema },
    },
    async ({ contextId }) =>
      withToolErrors(async () => ({
        groups: await (await getClient(contextId)).get("/v3/testgroups"),
      })),
  );

  server.registerTool(
    "get_test_group",
    {
      description: "Get a subscription's test group, including assertions and latest run id (v3).",
      inputSchema: readGroupSchema,
    },
    async ({ contextId, groupId }) =>
      withToolErrors(async () => ({
        group: await (await getClient(contextId)).get(groupPath(groupId)),
      })),
  );

  server.registerTool(
    "create_test_group",
    {
      description:
        "Create a subscription-scoped test group with integrations and optional assertions (v3). Requires contextId.",
      inputSchema: { contextId: contextIdSchema, group: groupSchema },
    },
    async ({ contextId, group }) =>
      withToolErrors(async () => ({
        group: await (await getClient(contextId)).post("/v3/testgroups", { body: group }),
      })),
  );

  server.registerTool(
    "update_test_group",
    {
      description:
        "Replace a test group's name, integrations, and assertions (v3). Omitted or empty assertions clears existing assertions. On 409, reload before editing again. Existing run snapshots are unchanged. Requires contextId.",
      inputSchema: { contextId: contextIdSchema, groupId: groupIdSchema, group: groupSchema },
    },
    async ({ contextId, groupId, group }) =>
      withToolErrors(async () => ({
        group: await (await getClient(contextId)).put(groupPath(groupId), { body: group }),
      })),
  );

  server.registerTool(
    "delete_test_group",
    {
      description:
        "Permanently delete a test group and clean retained run history (v3). Requires contextId and confirm: true.",
      inputSchema: { contextId: contextIdSchema, groupId: groupIdSchema, confirm: confirmSchema },
    },
    async ({ contextId, groupId }) =>
      withToolErrors(async () => ({
        result: await (await getClient(contextId)).delete(groupPath(groupId)),
      })),
  );

  server.registerTool(
    "upload_test_file",
    {
      description:
        "Upload or replace a group member's test fixture using inline UTF-8 text or a local file (v3). JSON/XML and binary bytes are sent verbatim. Empty content is rejected. File sources infer filename and content type from the path, and mark application/octet-stream as binary unless overridden. Requires contextId.",
      inputSchema: {
        contextId: contextIdSchema,
        groupId: groupIdSchema,
        integrationId: integrationIdSchema,
        ...testFileUploadSchema,
      },
    },
    async ({ contextId, groupId, integrationId, ...input }) =>
      withToolErrors(async () => {
        const options = await prepareTestFileUpload(input);
        return {
          file: await (await getClient(contextId)).post(filePath(groupId, integrationId), options),
        };
      }),
  );

  server.registerTool(
    "get_test_file",
    {
      description:
        "Get uploaded test file metadata for a group/integration pair in the current subscription (v3).",
      inputSchema: fileSchema,
    },
    async ({ contextId, groupId, integrationId }) =>
      withToolErrors(async () => ({
        file: await (await getClient(contextId)).get(filePath(groupId, integrationId)),
      })),
  );

  server.registerTool(
    "download_test_file",
    {
      description:
        "Download original test file bytes to a new local file (v3). Returns its absolute path and byte count. The destination directory must exist; existing files are never overwritten.",
      inputSchema: {
        ...fileSchema,
        filePath: z.string().min(1).describe("Local destination path for the downloaded file."),
      },
    },
    async ({ contextId, groupId, integrationId, filePath: destination }) =>
      withToolErrors(async () =>
        saveTestFile(
          destination,
          await (
            await getClient(contextId)
          ).getBytes(`${filePath(groupId, integrationId)}/content`),
        ),
      ),
  );

  server.registerTool(
    "start_test_run",
    {
      description:
        "Start real execution of all integrations in a test group (v3). Every member needs a nonempty uploaded fixture; missing files return 400 before any execution starts. Returns run metadata and resultsUrl immediately (HTTP 202); use get_test_run to poll. Does not retry submissions. Requires contextId.",
      inputSchema: {
        contextId: contextIdSchema,
        groupId: groupIdSchema,
        connxioApiKeyId: apiKeyIdSchema,
      },
    },
    async ({ contextId, groupId, connxioApiKeyId }) =>
      withToolErrors(async () => ({
        run: await (
          await getClient(contextId)
        ).post(`${groupPath(groupId)}/testruns`, { query: { connxioApiKeyId } }),
      })),
  );

  server.registerTool(
    "list_test_runs",
    {
      description:
        "List one page of test run history, newest first (v3). Preserves paging metadata. History has run metadata and results URLs; use get_test_run for evaluated outcomes.",
      inputSchema: {
        ...readGroupSchema,
        ...testRunPageSchema,
      },
    },
    async ({ contextId, groupId, skip, size }) =>
      withToolErrors(async () =>
        (await getClient(contextId)).get(`${groupPath(groupId)}/testruns`, {
          query: { skip, size },
        }),
      ),
  );

  server.registerTool(
    "get_test_run",
    {
      description:
        "Get evaluated test run results (v3). Defaults to an immediate check; optionally wait up to 60 seconds. HTTP 202 means running; HTTP 200 includes failed completed tests. Inspect status and isComplete; poll again if incomplete. A disconnected wait does not cancel execution. Detailed events are optional; assertion verdicts are always included.",
      inputSchema: {
        ...readGroupSchema,
        ...testRunResultSchema,
      },
    },
    async ({ contextId, groupId, runId, waitSeconds, includeStatusEvents }) =>
      withToolErrors(async () => ({
        run: await (
          await getClient(contextId)
        ).get(`${groupPath(groupId)}/testruns/${encodeURIComponent(runId)}`, {
          query: { waitSeconds, includeStatusEvents },
        }),
      })),
  );
}
