import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { prepareTestFileUpload, saveTestFile } from "../../connxio/test-files.js";
import { contextIdSchema, getClient, optionalContextIdSchema, withToolErrors } from "./shared.js";
import {
  apiKeyIdSchema,
  integrationIdSchema,
  testFileUploadSchema,
  testRunPageSchema,
  testRunResultSchema,
} from "./testing-shared.js";

const readIntegrationSchema = {
  contextId: optionalContextIdSchema,
  integrationId: integrationIdSchema,
};
const integrationPath = (id: string) => `/v3/integrations/${encodeURIComponent(id)}`;

export function registerIntegrationTestingTools(server: McpServer): void {
  server.registerTool(
    "upload_integration_test_file",
    {
      description:
        "Upload or replace a standalone integration test fixture (v3), separate from group fixtures. Accepts inline UTF-8 text or a local file; sends JSON/XML/binary bytes verbatim. Empty files are rejected. File sources infer filename, MIME type and binary mode unless overridden. Supports legacy and action-based integrations in the current company/subscription. Requires contextId.",
      inputSchema: {
        contextId: contextIdSchema,
        integrationId: integrationIdSchema,
        ...testFileUploadSchema,
      },
    },
    async ({ contextId, integrationId, ...input }) =>
      withToolErrors(async () => {
        const options = await prepareTestFileUpload(input);
        return {
          file: await (
            await getClient(contextId)
          ).post(`${integrationPath(integrationId)}/testfile`, options),
        };
      }),
  );

  server.registerTool(
    "get_integration_test_file",
    {
      description:
        "Get standalone test fixture metadata for an integration in the current company/subscription (v3). Separate from group fixtures; no groupId is needed.",
      inputSchema: readIntegrationSchema,
    },
    async ({ contextId, integrationId }) =>
      withToolErrors(async () => ({
        file: await (await getClient(contextId)).get(`${integrationPath(integrationId)}/testfile`),
      })),
  );

  server.registerTool(
    "download_integration_test_file",
    {
      description:
        "Download a standalone integration fixture's original bytes to a new local file (v3). Returns absolute path and byte count. Destination directory must exist; existing files are never overwritten. Company/subscription ownership is checked by the API.",
      inputSchema: {
        ...readIntegrationSchema,
        filePath: z.string().min(1).describe("Local destination path on the MCP server machine."),
      },
    },
    async ({ contextId, integrationId, filePath }) =>
      withToolErrors(async () =>
        saveTestFile(
          filePath,
          await (
            await getClient(contextId)
          ).getBytes(`${integrationPath(integrationId)}/testfile/content`),
        ),
      ),
  );

  server.registerTool(
    "start_integration_test_run",
    {
      description:
        "Start real standalone integration test execution from its saved fixture, without a test group (v3). Omitting triggerId SKIPS inbound processing; supplying an existing trigger id runs that trigger. Supports legacy integrations. Missing/empty fixtures return 400 before execution. Returns run metadata/resultsUrl immediately (202); use get_integration_test_run to poll. No automatic retries. testGroupId in standalone metadata equals integrationId; snapshots stay internal. Requires contextId.",
      inputSchema: {
        contextId: contextIdSchema,
        integrationId: integrationIdSchema,
        connxioApiKeyId: apiKeyIdSchema,
        triggerId: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Existing trigger id on this integration (not necessarily a GUID). Omit to skip inbound processing.",
          ),
      },
    },
    async ({ contextId, integrationId, connxioApiKeyId, triggerId }) =>
      withToolErrors(async () => ({
        run: await (
          await getClient(contextId)
        ).post(`${integrationPath(integrationId)}/testruns`, {
          query: { connxioApiKeyId, triggerId },
        }),
      })),
  );

  server.registerTool(
    "list_integration_test_runs",
    {
      description:
        "List one page of standalone integration run history, newest first (v3). Includes portal-created standalone runs; separate from group history. Preserves counts, paging metadata and results URLs. testGroupId equals integrationId. Use get_integration_test_run for evaluated outcomes. Company/subscription ownership is checked.",
      inputSchema: { ...readIntegrationSchema, ...testRunPageSchema },
    },
    async ({ contextId, integrationId, skip, size }) =>
      withToolErrors(async () =>
        (await getClient(contextId)).get(`${integrationPath(integrationId)}/testruns`, {
          query: { skip, size },
        }),
      ),
  );

  server.registerTool(
    "get_integration_test_run",
    {
      description:
        "Get standalone integration test results (v3), checking current company/subscription ownership. Defaults to immediate status; optionally wait up to 60 seconds. 202 means running; 200 includes completed failures. Inspect run.status and run.isComplete and poll again if incomplete. Optional detailed events; assertion verdicts are included regardless. Disconnecting a wait does not cancel execution. testGroupId equals integrationId; snapshots stay internal.",
      inputSchema: { ...readIntegrationSchema, ...testRunResultSchema },
    },
    async ({ contextId, integrationId, runId, waitSeconds, includeStatusEvents }) =>
      withToolErrors(async () => ({
        run: await (
          await getClient(contextId)
        ).get(`${integrationPath(integrationId)}/testruns/${encodeURIComponent(runId)}`, {
          query: { waitSeconds, includeStatusEvents },
        }),
      })),
  );
}
