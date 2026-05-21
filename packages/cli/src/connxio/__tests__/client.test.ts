import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth.js", () => ({
  getOAuthAccessToken: vi.fn(async () => "test-access-token"),
}));

vi.mock("../credentials.js", () => ({
  getApiKey: vi.fn(async (ref: string) => `api-key-for-${ref}`),
}));

import { ConnxioClient } from "../client.js";

type FetchCall = {
  init: RequestInit | undefined;
  url: URL;
};

function makeResponse(init: {
  body?: string;
  headers?: Record<string, string>;
  status?: number;
  statusText?: string;
}): Response {
  const headers = new Headers(init.headers);
  return new Response(init.body ?? null, {
    headers,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
  });
}

function installFetch(handler: (call: FetchCall) => Response | Promise<Response>): {
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const call: FetchCall = { init, url };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

const baseContext = {
  apiKeyRef: "ctx-1",
  baseUrl: "https://api.example.com",
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ConnxioClient.request", () => {
  it("sends required headers and parses JSON responses", async () => {
    const { calls } = installFetch(() =>
      makeResponse({
        body: JSON.stringify({ hello: "world" }),
        headers: { "content-type": "application/json" },
      }),
    );

    const client = new ConnxioClient(baseContext);
    const result = await client.get("/v2/integrations");

    expect(result).toEqual({ hello: "world" });
    expect(calls).toHaveLength(1);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Accept).toBe("application/json; x-api-version=2.0");
    expect(headers.Authorization).toBe("Bearer test-access-token");
    expect(headers["Connxio-Api-Key"]).toBe("api-key-for-ctx-1");
    expect(headers["Content-Type"]).toBeUndefined();
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.url.toString()).toBe("https://api.example.com/v2/integrations");
  });

  it("joins base URL and path regardless of trailing/leading slashes", async () => {
    const { calls } = installFetch(() => makeResponse({ status: 204 }));

    await new ConnxioClient({
      ...baseContext,
      baseUrl: "https://api.example.com/",
    }).get("v2/integrations");
    await new ConnxioClient({
      ...baseContext,
      baseUrl: "https://api.example.com",
    }).get("/v2/integrations");

    expect(calls[0]?.url.toString()).toBe("https://api.example.com/v2/integrations");
    expect(calls[1]?.url.toString()).toBe("https://api.example.com/v2/integrations");
  });

  it("appends query parameters and skips undefined values", async () => {
    const { calls } = installFetch(() => makeResponse({ body: "[]" }));

    await new ConnxioClient(baseContext).get("/v2/integrations", {
      query: { active: true, name: "foo", page: 2, skip: undefined },
    });

    const url = calls[0]?.url as URL;
    expect(url.searchParams.get("active")).toBe("true");
    expect(url.searchParams.get("name")).toBe("foo");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.has("skip")).toBe(false);
  });

  it("serializes a JSON body and sets Content-Type only when a body is present", async () => {
    const { calls } = installFetch(() => makeResponse({ status: 204 }));

    await new ConnxioClient(baseContext).put("/v2/codecomponents", {
      body: { name: "x" },
    });
    await new ConnxioClient(baseContext).post("/v2/codecomponents");

    expect(calls[0]?.init?.body).toBe(JSON.stringify({ name: "x" }));
    const headers0 = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers0?.["Content-Type"]).toBe("application/json; x-api-version=2.0");
    expect(calls[1]?.init?.body).toBeUndefined();
    const headers1 = calls[1]?.init?.headers as Record<string, string> | undefined;
    expect(headers1?.["Content-Type"]).toBeUndefined();
  });

  it("returns null for 204 and empty 200 bodies", async () => {
    installFetch(() => makeResponse({ status: 204 }));
    expect(await new ConnxioClient(baseContext).delete("/v2/x")).toBeNull();

    vi.unstubAllGlobals();
    installFetch(() => makeResponse({ body: "" }));
    expect(await new ConnxioClient(baseContext).get("/v2/x")).toBeNull();
  });

  it("returns raw text when the response is not JSON", async () => {
    installFetch(() => makeResponse({ body: "plain text" }));
    expect(await new ConnxioClient(baseContext).get("/v2/x")).toBe("plain text");
  });

  it("throws including status, body, and auth-failure headers on 401", async () => {
    installFetch(() =>
      makeResponse({
        body: "denied",
        headers: {
          "www-authenticate": 'Bearer realm="connxio"',
          "x-request-id": "req-123",
        },
        status: 401,
        statusText: "Unauthorized",
      }),
    );

    await expect(new ConnxioClient(baseContext).get("/v2/x")).rejects.toThrow(
      /401 Unauthorized.*denied.*WWW-Authenticate.*Request id: req-123/s,
    );
  });

  it("wraps network errors with the request method and URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    await expect(new ConnxioClient(baseContext).get("/v2/x")).rejects.toThrow(
      /Connxio API request failed before receiving a response: GET https:\/\/api\.example\.com\/v2\/x: ECONNREFUSED/,
    );
  });

  it("follows a redirect via the Location header", async () => {
    const { calls } = installFetch((call) => {
      if (call.url.pathname === "/v2/x") {
        return makeResponse({
          headers: { location: "https://api.example.com/v2/y" },
          status: 302,
        });
      }
      return makeResponse({ body: JSON.stringify({ ok: true }) });
    });

    const result = await new ConnxioClient(baseContext).get("/v2/x");

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url.toString()).toBe("https://api.example.com/v2/y");
    // Headers (including auth) must survive the redirect.
    const headers = calls[1]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-access-token");
    expect(headers["Connxio-Api-Key"]).toBe("api-key-for-ctx-1");
  });

  it("throws on a redirect without a Location header", async () => {
    installFetch(() => makeResponse({ status: 302 }));

    await expect(new ConnxioClient(baseContext).get("/v2/x")).rejects.toThrow(
      /redirect 302 without a Location header/,
    );
  });

  it("throws after too many redirects", async () => {
    installFetch((call) =>
      makeResponse({
        headers: { location: `${call.url.toString()}/next` },
        status: 302,
      }),
    );

    await expect(new ConnxioClient(baseContext).get("/v2/x")).rejects.toThrow(
      /redirected too many times/,
    );
  });
});

describe("ConnxioClient.listSubscriptions", () => {
  it("parses an array of subscriptions", async () => {
    installFetch(() =>
      makeResponse({
        body: JSON.stringify([
          {
            active: true,
            companyId: "c1",
            companyName: "Acme",
            id: "s1",
            name: "Sub",
          },
        ]),
      }),
    );

    const subs = await new ConnxioClient(baseContext).listSubscriptions();
    expect(subs).toEqual([
      {
        active: true,
        companyId: "c1",
        companyName: "Acme",
        id: "s1",
        name: "Sub",
      },
    ]);
  });

  it("throws when the response is not an array", async () => {
    installFetch(() => makeResponse({ body: JSON.stringify({ not: "an array" }) }));

    await expect(new ConnxioClient(baseContext).listSubscriptions()).rejects.toThrow(
      /was not an array/,
    );
  });

  it("throws when a subscription is missing required fields", async () => {
    installFetch(() => makeResponse({ body: JSON.stringify([{ id: "s1", name: "Sub" }]) }));

    await expect(new ConnxioClient(baseContext).listSubscriptions()).rejects.toThrow(
      /invalid subscription/,
    );
  });
});
