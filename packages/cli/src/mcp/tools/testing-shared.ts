import { z } from "zod";

export const integrationIdSchema = z.uuid().describe("Integration configuration correlation id.");
export const apiKeyIdSchema = z
  .uuid()
  .optional()
  .describe("Optional API key id (GUID), never the API key secret.");
export const testFileUploadSchema = {
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), content: z.string().min(1) }),
    z.object({ type: z.literal("file"), filePath: z.string().min(1) }),
  ]),
  fileName: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional filename override. Inline text otherwise uses the API default: {integrationId}.txt. The API normalizes filenames to printable ASCII basenames.",
    ),
  contentType: z
    .string()
    .min(1)
    .regex(/^[^\r\n]+$/)
    .optional()
    .describe("Optional MIME type override. Inline text defaults to text/plain; charset=utf-8."),
  isBinary: z.boolean().optional().describe("Override binary detection, including explicit false."),
};
export const testRunPageSchema = {
  skip: z
    .number()
    .int()
    .min(0)
    .max(100_000)
    .optional()
    .describe("Records to omit. API default: 0."),
  size: z
    .number()
    .int()
    .min(1)
    .max(1_000)
    .optional()
    .describe("Page size. API default: 100. Increase skip by size while hasNextPage is true."),
};
export const testRunResultSchema = {
  runId: z.uuid().describe("Test run id."),
  waitSeconds: z
    .number()
    .int()
    .min(0)
    .max(60)
    .default(0)
    .describe("Seconds to wait for completion; MCP default: 0."),
  includeStatusEvents: z.boolean().optional(),
};
