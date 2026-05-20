import { z } from "zod";

import { ConnxioClient } from "../../connxio/client.js";
import { resolveContext } from "../../connxio/contexts.js";

export const contextIdSchema = z.string().describe("Connxio context id. Required for write tools.");
export const optionalContextIdSchema = z
  .string()
  .optional()
  .describe("Optional Connxio context id.");
export const confirmSchema = z
  .literal(true)
  .describe("Must be true to confirm this destructive action.");
export const jsonObjectSchema = z
  .record(z.string(), z.unknown())
  .describe("JSON request body for the Connxio API operation.");

export async function getClient(contextId?: string): Promise<ConnxioClient> {
  return new ConnxioClient(await resolveContext(contextId));
}

export async function withToolErrors(action: () => Promise<unknown>) {
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
