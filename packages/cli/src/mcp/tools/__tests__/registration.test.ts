import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../connxio/contexts.js", () => ({
  listPublicContexts: vi.fn(async () => [{ id: "ctx-1", name: "ctx-1" }]),
  resolveContext: vi.fn(async () => ({
    apiKeyRef: "ctx-1",
    baseUrl: "https://api.example.com",
    id: "ctx-1",
    name: "ctx-1",
  })),
}));

vi.mock("../../../connxio/credentials.js", () => ({
  getApiKey: vi.fn(async (ref: string) => `api-key-for-${ref}`),
  hasApiKey: vi.fn(async () => true),
}));

vi.mock("../../../connxio/auth.js", () => ({
  getOAuthAccessToken: vi.fn(async () => "test-access-token"),
}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCliTools } from "../cli.js";
import { registerCodeComponentTools } from "../code-components.js";
import { registerContextTools } from "../contexts.js";
import { registerEnvironmentVariableTools } from "../environment-variables.js";
import { registerIntegrationTools } from "../integrations.js";
import { registerSecurityConfigTools } from "../security-configs.js";
import { registerSubscriptionTools } from "../subscriptions.js";

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  content: { text: string; type: "text" }[];
  isError?: boolean;
}>;

type FetchCall = {
  init: RequestInit | undefined;
  url: URL;
};

function makeResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
    statusText: "OK",
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

function collectHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const original = server.registerTool.bind(server);
  vi.spyOn(server, "registerTool").mockImplementation(((
    name: string,
    config: unknown,
    cb: unknown,
  ) => {
    handlers.set(name, cb as ToolHandler);
    return { name } as unknown as ReturnType<typeof original>;
  }) as typeof server.registerTool);

  registerCliTools(server);
  registerContextTools(server);
  registerSubscriptionTools(server);
  registerIntegrationTools(server);
  registerCodeComponentTools(server);
  registerEnvironmentVariableTools(server);
  registerSecurityConfigTools(server);

  return handlers;
}

function expectSuccess(result: { content: { text: string; type: "text" }[]; isError?: boolean }) {
  expect(result.isError).toBeUndefined();
  expect(result.content[0]?.type).toBe("text");
}

function expectCall(
  call: FetchCall | undefined,
  method: string,
  pathAndQuery: string,
  body?: unknown,
) {
  expect(call).toBeDefined();
  expect(call?.init?.method).toBe(method);
  const base = "https://api.example.com";
  expect(call?.url.toString()).toBe(`${base}${pathAndQuery}`);
  if (body !== undefined) {
    expect(call?.init?.body).toBe(JSON.stringify(body));
  } else {
    expect(call?.init?.body).toBeUndefined();
  }
}

let handlers: Map<string, ToolHandler>;

beforeEach(() => {
  vi.unstubAllGlobals();
  handlers = collectHandlers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function invoke(name: string, input: Record<string, unknown> = {}) {
  const handler = handlers.get(name);
  if (!handler) {
    throw new Error(`tool not registered: ${name}`);
  }
  return handler(input);
}

describe("MCP tool registration wires tools to ConnxioClient HTTP routes", () => {
  it("registers all expected tools", () => {
    const names = [...handlers.keys()].sort();
    expect(names).toEqual(
      [
        "check_cli_update",
        "create_environment_variable",
        "create_integration",
        "create_integration_no_validation",
        "create_security_config",
        "delete_code_component",
        "delete_environment_variable",
        "delete_integration",
        "delete_security_config",
        "deprecate_code_component",
        "get_code_component",
        "get_code_component_versions",
        "get_current_context",
        "get_current_subscription",
        "get_environment_variable",
        "get_integration",
        "get_security_config",
        "install_cli_update",
        "list_code_components",
        "list_contexts",
        "list_environment_variables",
        "list_integrations",
        "list_security_configs",
        "list_subscriptions",
        "rename_code_component",
        "update_component_in_integration",
        "update_integration",
        "upload_code_component",
      ].sort(),
    );
  });

  it("list_integrations -> GET /v2/integrations", async () => {
    const { calls } = installFetch(() => makeResponse([]));
    const result = await invoke("list_integrations", {});
    expectSuccess(result);
    expectCall(calls[0], "GET", "/v2/integrations");
  });

  it("get_integration encodes id and forwards replaceVariables query", async () => {
    const { calls } = installFetch(() => makeResponse({ id: "abc/def" }));
    const result = await invoke("get_integration", { id: "abc/def", replaceVariables: true });
    expectSuccess(result);
    expectCall(calls[0], "GET", "/v2/integrations/abc%2Fdef?replaceVariables=true");
  });

  it("create_integration -> POST /v2/integrations with JSON body", async () => {
    const { calls } = installFetch(() => makeResponse({ ok: true }));
    const result = await invoke("create_integration", {
      contextId: "ctx-1",
      integration: { foo: 1 },
    });
    expectSuccess(result);
    expectCall(calls[0], "POST", "/v2/integrations", { foo: 1 });
  });

  it("create_integration_no_validation -> POST /v2/integrations/novalidation", async () => {
    const { calls } = installFetch(() => makeResponse({ ok: true }));
    await invoke("create_integration_no_validation", {
      contextId: "ctx-1",
      integration: { foo: 2 },
    });
    expectCall(calls[0], "POST", "/v2/integrations/novalidation", { foo: 2 });
  });

  it("update_integration -> PUT /v2/integrations/<id>", async () => {
    const { calls } = installFetch(() => makeResponse({ ok: true }));
    await invoke("update_integration", {
      contextId: "ctx-1",
      id: "int-1",
      integration: { name: "x" },
    });
    expectCall(calls[0], "PUT", "/v2/integrations/int-1", { name: "x" });
  });

  it("delete_integration -> DELETE /v2/integrations/<id>", async () => {
    const { calls } = installFetch(() => makeResponse(null, 204));
    await invoke("delete_integration", { confirm: true, contextId: "ctx-1", id: "int-1" });
    expectCall(calls[0], "DELETE", "/v2/integrations/int-1");
  });

  it("list_code_components -> GET /v2/codecomponents", async () => {
    const { calls } = installFetch(() => makeResponse([]));
    await invoke("list_code_components", {});
    expectCall(calls[0], "GET", "/v2/codecomponents");
  });

  it("get_code_component -> GET /v2/codecomponents/<id>", async () => {
    const { calls } = installFetch(() => makeResponse({ id: "cc-1" }));
    await invoke("get_code_component", { id: "cc-1" });
    expectCall(calls[0], "GET", "/v2/codecomponents/cc-1");
  });

  it("get_code_component_versions -> GET /v2/codecomponents/<id>/versions", async () => {
    const { calls } = installFetch(() => makeResponse([]));
    await invoke("get_code_component_versions", { id: "cc/1" });
    expectCall(calls[0], "GET", "/v2/codecomponents/cc%2F1/versions");
  });

  it("deprecate_code_component -> PUT /v2/codecomponents/<id>/deprecate?version=...", async () => {
    const { calls } = installFetch(() => makeResponse({ ok: true }));
    await invoke("deprecate_code_component", { contextId: "ctx-1", id: "cc-1", version: "1.2.3" });
    expectCall(calls[0], "PUT", "/v2/codecomponents/cc-1/deprecate?version=1.2.3");
  });

  it("rename_code_component -> PUT /v2/codecomponents/<id>/updatename?name=...", async () => {
    const { calls } = installFetch(() => makeResponse({ ok: true }));
    await invoke("rename_code_component", { contextId: "ctx-1", id: "cc-1", name: "newName" });
    expectCall(calls[0], "PUT", "/v2/codecomponents/cc-1/updatename?name=newName");
  });

  it("delete_code_component -> DELETE /v2/codecomponents/<id>", async () => {
    const { calls } = installFetch(() => makeResponse(null, 204));
    await invoke("delete_code_component", { confirm: true, contextId: "ctx-1", id: "cc-1" });
    expectCall(calls[0], "DELETE", "/v2/codecomponents/cc-1");
  });

  it("list_environment_variables -> GET /v2/environmentvariables", async () => {
    const { calls } = installFetch(() => makeResponse([]));
    await invoke("list_environment_variables", {});
    expectCall(calls[0], "GET", "/v2/environmentvariables");
  });

  it("create_environment_variable -> PUT /v2/environmentvariables with body", async () => {
    const { calls } = installFetch(() => makeResponse({ ok: true }));
    await invoke("create_environment_variable", {
      contextId: "ctx-1",
      environmentVariable: { key: "K", value: "V" },
    });
    expectCall(calls[0], "PUT", "/v2/environmentvariables", { key: "K", value: "V" });
  });

  it("list_security_configs -> GET /v2/securityconfigs", async () => {
    const { calls } = installFetch(() => makeResponse([]));
    await invoke("list_security_configs", {});
    expectCall(calls[0], "GET", "/v2/securityconfigs");
  });

  it("get_security_config -> GET /v2/securityconfigs/<id>", async () => {
    const { calls } = installFetch(() => makeResponse({ id: "sc-1" }));
    await invoke("get_security_config", { id: "sc-1" });
    expectCall(calls[0], "GET", "/v2/securityconfigs/sc-1");
  });

  it("list_subscriptions -> GET /v2/subscriptions", async () => {
    const { calls } = installFetch(() =>
      makeResponse([{ active: true, companyId: "c1", companyName: "Acme", id: "s1", name: "Sub" }]),
    );
    const result = await invoke("list_subscriptions", {});
    expectSuccess(result);
    expectCall(calls[0], "GET", "/v2/subscriptions");
  });

  it("get_current_subscription -> GET /v2/subscriptions/current", async () => {
    const { calls } = installFetch(() =>
      makeResponse({ active: true, companyId: "c1", companyName: "Acme", id: "s1", name: "Sub" }),
    );
    const result = await invoke("get_current_subscription", {});
    expectSuccess(result);
    expectCall(calls[0], "GET", "/v2/subscriptions/current");
  });

  it("get_current_context resolves context without hitting the API", async () => {
    const { calls } = installFetch(() => makeResponse({}));
    const result = await invoke("get_current_context", {});
    expectSuccess(result);
    expect(calls).toHaveLength(0);
    const payload = JSON.parse(result.content[0]!.text) as {
      context: { baseUrl: string; hasCredential: boolean; id: string };
    };
    expect(payload.context.id).toBe("ctx-1");
    expect(payload.context.baseUrl).toBe("https://api.example.com");
    expect(payload.context.hasCredential).toBe(true);
  });

  it("list_contexts returns the configured contexts without hitting the API", async () => {
    const { calls } = installFetch(() => makeResponse({}));
    const result = await invoke("list_contexts", {});
    expectSuccess(result);
    expect(calls).toHaveLength(0);
    const payload = JSON.parse(result.content[0]!.text) as {
      contexts: { id: string }[];
    };
    expect(payload.contexts[0]?.id).toBe("ctx-1");
  });

  it("wraps failures via withToolErrors and returns isError: true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    const result = await invoke("list_integrations", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/boom/);
  });
});
