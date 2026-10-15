import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import type { ConnxioRequestOptions } from "./client.js";

export type TestFileSource = { type: "text"; content: string } | { type: "file"; filePath: string };

export async function prepareTestFileUpload(input: {
  source: TestFileSource;
  contentType?: string | undefined;
  fileName?: string | undefined;
  isBinary?: boolean | undefined;
}): Promise<ConnxioRequestOptions> {
  const content =
    input.source.type === "file"
      ? await readFile(input.source.filePath)
      : Buffer.from(input.source.content, "utf8");
  if (content.length === 0) {
    throw new Error("Test file content cannot be empty.");
  }
  const fileName =
    input.fileName ?? (input.source.type === "file" ? basename(input.source.filePath) : undefined);
  const contentType =
    input.contentType ??
    (input.source.type === "file"
      ? inferContentType(input.source.filePath)
      : "text/plain; charset=utf-8");
  return {
    rawBody: { content, contentType },
    query: {
      fileName,
      isBinary:
        input.isBinary ??
        contentType.split(";")[0]?.trim().toLowerCase() === "application/octet-stream",
    },
  };
}

export async function saveTestFile(filePath: string, content: Uint8Array) {
  const destination = resolve(filePath);
  await writeFile(destination, content, { flag: "wx", mode: 0o600 });
  return { filePath: destination, byteLength: content.byteLength };
}

function inferContentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".json":
      return "application/json";
    case ".xml":
      return "application/xml";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
