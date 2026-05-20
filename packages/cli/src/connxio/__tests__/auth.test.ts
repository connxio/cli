import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ConfigShape = {
  contexts: unknown[];
  oauth?: {
    clientId: string;
    clientSecretRef: string;
    scope?: string;
    tokenUrl?: string;
  };
};

let mockConfig: ConfigShape;
let writtenConfig: ConfigShape | undefined;
let mockClientSecrets: Record<string, string>;

vi.mock("../config.js", () => ({
  readConfig: vi.fn(async () => structuredClone(mockConfig)),
  writeConfig: vi.fn(async (next: ConfigShape) => {
    writtenConfig = structuredClone(next);
    mockConfig = structuredClone(next);
  }),
}));

vi.mock("../credentials.js", () => ({
  deleteOAuthClientSecret: vi.fn(async (ref: string) => {
    delete mockClientSecrets[ref];
  }),
  getOAuthClientSecret: vi.fn(async (ref: string) => {
    const secret = mockClientSecrets[ref];
    if (!secret) throw new Error(`Missing OAuth client secret for ref ${ref}.`);
    return secret;
  }),
  hasOAuthClientSecret: vi.fn(async (ref: string) => Boolean(mockClientSecrets[ref])),
  setOAuthClientSecret: vi.fn(async (ref: string, value: string) => {
    mockClientSecrets[ref] = value;
  }),
}));

vi.mock("../http.js", () => ({
  allowInsecureTlsIfLocal: vi.fn(),
  getInsecureTlsHelp: vi.fn(() => "tls-help"),
}));

async function loadAuth(): Promise<typeof import("../auth.js")> {
  return import("../auth.js");
}

function stubFetch(handler: (input: URL | string, init?: RequestInit) => Response | Promise<Response>): void {
  vi.stubGlobal("fetch", vi.fn(handler));
}

function tokenResponse(body: Record<string, unknown>, init?: { status?: number; statusText?: string }): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: init?.status ?? 200,
    statusText: init?.statusText ?? "OK",
  });
}

const ENV_KEYS = [
  "CONNXIO_OAUTH_TOKEN_URL",
  "CONNXIO_OAUTH_CLIENT_ID",
  "CONNXIO_OAUTH_CLIENT_SECRET",
  "CONNXIO_OAUTH_SCOPE",
] as const;

let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

beforeEach(() => {
  vi.resetModules();
  mockConfig = { contexts: [] };
  writtenConfig = undefined;
  mockClientSecrets = {};
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getOAuthAccessToken", () => {
  it("requests a token, caches it, and reuses it on subsequent calls", async () => {
    mockConfig = {
      contexts: [],
      oauth: { clientId: "cid", clientSecretRef: "default" },
    };
    mockClientSecrets.default = "csecret";
    const fetchMock = vi.fn(async () =>
      tokenResponse({ access_token: "tok-1", expires_in: 3600 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const auth = await loadAuth();
    expect(await auth.getOAuthAccessToken()).toBe("tok-1");
    expect(await auth.getOAuthAccessToken()).toBe("tok-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const body = init.body as URLSearchParams;
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe("csecret");
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("scope")).toBe("api://connxio/.default");
  });

  it("re-fetches when the cached token is within the expiry skew window", async () => {
    mockConfig = {
      contexts: [],
      oauth: { clientId: "cid", clientSecretRef: "default" },
    };
    mockClientSecrets.default = "csecret";
    let counter = 0;
    const fetchMock = vi.fn(async () =>
      tokenResponse({ access_token: `tok-${++counter}`, expires_in: 30 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const auth = await loadAuth();
    expect(await auth.getOAuthAccessToken()).toBe("tok-1");
    // expires_in is 30s but the skew is 60s, so the cache is treated as stale.
    expect(await auth.getOAuthAccessToken()).toBe("tok-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prefers env credentials over config", async () => {
    mockConfig = {
      contexts: [],
      oauth: { clientId: "cfg-cid", clientSecretRef: "default", scope: "cfg-scope" },
    };
    mockClientSecrets.default = "cfg-secret";
    process.env.CONNXIO_OAUTH_CLIENT_ID = "env-cid";
    process.env.CONNXIO_OAUTH_CLIENT_SECRET = "env-secret";
    process.env.CONNXIO_OAUTH_SCOPE = "env-scope";
    process.env.CONNXIO_OAUTH_TOKEN_URL = "https://env.example.com/token";

    const fetchMock = vi.fn(async () => tokenResponse({ access_token: "tok", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);

    const auth = await loadAuth();
    await auth.getOAuthAccessToken();

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://env.example.com/token");
    const body = init.body as URLSearchParams;
    expect(body.get("client_id")).toBe("env-cid");
    expect(body.get("client_secret")).toBe("env-secret");
    expect(body.get("scope")).toBe("env-scope");
  });

  it("throws when env partially configures OAuth", async () => {
    process.env.CONNXIO_OAUTH_CLIENT_ID = "env-cid";
    // Missing CONNXIO_OAUTH_CLIENT_SECRET.

    const auth = await loadAuth();
    await expect(auth.getOAuthAccessToken()).rejects.toThrow(/Incomplete OAuth environment/);
  });

  it("throws a helpful error when nothing is configured", async () => {
    const auth = await loadAuth();
    await expect(auth.getOAuthAccessToken()).rejects.toThrow(
      /OAuth is not configured.*connxio auth configure/,
    );
  });

  it("throws on non-OK token responses", async () => {
    mockConfig = { contexts: [], oauth: { clientId: "cid", clientSecretRef: "default" } };
    mockClientSecrets.default = "csecret";
    stubFetch(async () =>
      new Response("nope", { status: 400, statusText: "Bad Request" }),
    );

    const auth = await loadAuth();
    await expect(auth.getOAuthAccessToken()).rejects.toThrow(
      /OAuth token request failed \(400 Bad Request\): nope/,
    );
  });

  it("throws when the token response lacks access_token", async () => {
    mockConfig = { contexts: [], oauth: { clientId: "cid", clientSecretRef: "default" } };
    mockClientSecrets.default = "csecret";
    stubFetch(async () => tokenResponse({ not: "a token" }));

    const auth = await loadAuth();
    await expect(auth.getOAuthAccessToken()).rejects.toThrow(/did not include an access token/);
  });
});

describe("configureOAuth", () => {
  it("writes config, stores the client secret, and clears the cached token", async () => {
    mockConfig = { contexts: [], oauth: { clientId: "old", clientSecretRef: "default" } };
    mockClientSecrets.default = "old-secret";
    stubFetch(async () => tokenResponse({ access_token: "old-tok", expires_in: 3600 }));

    const auth = await loadAuth();
    expect(await auth.getOAuthAccessToken()).toBe("old-tok");

    vi.stubGlobal("fetch", vi.fn(async () => tokenResponse({ access_token: "new-tok", expires_in: 3600 })));
    await auth.configureOAuth({ clientId: "new-cid", clientSecret: "new-secret", scope: "" });

    expect(writtenConfig?.oauth).toEqual({
      clientId: "new-cid",
      clientSecretRef: "default",
      scope: "api://connxio/.default",
    });
    expect(mockClientSecrets.default).toBe("new-secret");
    // Cached token must be invalidated so the new credentials are used.
    expect(await auth.getOAuthAccessToken()).toBe("new-tok");
  });

  it("rejects empty client ids", async () => {
    const auth = await loadAuth();
    await expect(
      auth.configureOAuth({ clientId: "  ", clientSecret: "x", scope: "" }),
    ).rejects.toThrow(/client id cannot be empty/);
  });
});

describe("getOAuthStatus", () => {
  it("reports the env source when env variables are set", async () => {
    process.env.CONNXIO_OAUTH_CLIENT_ID = "env-cid";
    process.env.CONNXIO_OAUTH_CLIENT_SECRET = "env-secret";

    const auth = await loadAuth();
    expect(await auth.getOAuthStatus()).toEqual({
      configured: true,
      hasClientSecret: true,
      scope: "api://connxio/.default",
      source: "env",
      tokenUrl: "https://api.connxio.com/oauth/token",
    });
  });

  it("reports the config source with defaults when config is set", async () => {
    mockConfig = { contexts: [], oauth: { clientId: "cid", clientSecretRef: "default" } };
    mockClientSecrets.default = "csecret";

    const auth = await loadAuth();
    expect(await auth.getOAuthStatus()).toEqual({
      configured: true,
      hasClientSecret: true,
      scope: "api://connxio/.default",
      source: "config",
      tokenUrl: "https://api.connxio.com/oauth/token",
    });
  });

  it("reports unconfigured when nothing is set", async () => {
    const auth = await loadAuth();
    expect(await auth.getOAuthStatus()).toEqual({ configured: false, hasClientSecret: false });
  });
});

describe("clearOAuth", () => {
  it("removes oauth config and the client secret", async () => {
    mockConfig = { contexts: [], oauth: { clientId: "cid", clientSecretRef: "default" } };
    mockClientSecrets.default = "csecret";

    const auth = await loadAuth();
    await auth.clearOAuth();

    expect(writtenConfig?.oauth).toBeUndefined();
    expect(mockClientSecrets.default).toBeUndefined();
  });
});
