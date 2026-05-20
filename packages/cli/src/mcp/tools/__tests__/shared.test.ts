import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../connxio/contexts.js", () => ({
  resolveContext: vi.fn(),
}));

import { ConnxioClient } from "../../../connxio/client.js";
import { resolveContext } from "../../../connxio/contexts.js";
import {
  confirmSchema,
  contextIdSchema,
  getClient,
  jsonObjectSchema,
  optionalContextIdSchema,
  withToolErrors,
} from "../shared.js";

const resolveContextMock = vi.mocked(resolveContext);

beforeEach(() => {
  resolveContextMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withToolErrors", () => {
  it("wraps a resolved value as a JSON text content block without isError", async () => {
    const result = await withToolErrors(async () => ({ ok: true, count: 1 }));

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: true, count: 1 }, null, 2),
        },
      ],
    });
    expect(result).not.toHaveProperty("isError");
  });

  it("preserves nested structure through JSON serialization", async () => {
    const value = { a: { b: [1, 2, { c: "x" }] }, n: null };
    const result = await withToolErrors(async () => value);

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("\n  ");
    expect(JSON.parse(text)).toEqual(value);
  });

  it("returns the error message and sets isError for Error instances", async () => {
    const result = await withToolErrors(async () => {
      throw new Error("boom");
    });

    expect(result).toEqual({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    });
  });

  it("stringifies non-Error throws and sets isError", async () => {
    const result = await withToolErrors(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "nope";
    });

    expect(result).toEqual({
      content: [{ type: "text", text: "nope" }],
      isError: true,
    });
  });
});

describe("getClient", () => {
  it("passes the supplied contextId to resolveContext and returns a ConnxioClient", async () => {
    resolveContextMock.mockResolvedValue({ apiKeyRef: "ref-1", baseUrl: "https://api.example.com" });

    const client = await getClient("ctx-1");

    expect(resolveContextMock).toHaveBeenCalledExactlyOnceWith("ctx-1");
    expect(client).toBeInstanceOf(ConnxioClient);
  });

  it("passes undefined through when no contextId is given", async () => {
    resolveContextMock.mockResolvedValue({ apiKeyRef: "ref-1", baseUrl: "https://api.example.com" });

    const client = await getClient();

    expect(resolveContextMock).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(client).toBeInstanceOf(ConnxioClient);
  });

  it("propagates errors from resolveContext", async () => {
    resolveContextMock.mockRejectedValue(new Error("no such context"));

    await expect(getClient("missing")).rejects.toThrow(/no such context/);
  });
});

describe("schemas", () => {
  it("contextIdSchema accepts strings and rejects non-strings", () => {
    expect(contextIdSchema.parse("ctx-1")).toBe("ctx-1");
    expect(contextIdSchema.safeParse(123).success).toBe(false);
  });

  it("optionalContextIdSchema accepts strings and undefined", () => {
    expect(optionalContextIdSchema.parse("ctx-1")).toBe("ctx-1");
    expect(optionalContextIdSchema.parse(undefined)).toBeUndefined();
    expect(optionalContextIdSchema.safeParse(123).success).toBe(false);
  });

  it("confirmSchema accepts only the literal true", () => {
    expect(confirmSchema.parse(true)).toBe(true);
    expect(confirmSchema.safeParse(false).success).toBe(false);
    expect(confirmSchema.safeParse("true").success).toBe(false);
  });

  it("jsonObjectSchema accepts records with string keys and rejects non-objects", () => {
    expect(jsonObjectSchema.parse({ a: 1, b: "x", c: null })).toEqual({ a: 1, b: "x", c: null });
    expect(jsonObjectSchema.safeParse("string").success).toBe(false);
    expect(jsonObjectSchema.safeParse(42).success).toBe(false);
  });
});
