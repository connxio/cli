import { z } from "zod";

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
import { registerDiagnosticTools } from "../diagnostics.js";
import { registerSchemaTools } from "../schemas.js";
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

const inputSchemas = new Map<string, z.ZodObject>();

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
    inputSchemas.set(name, z.object((config as { inputSchema: z.ZodRawShape }).inputSchema));
    return { name } as unknown as ReturnType<typeof original>;
  }) as typeof server.registerTool);

  registerCliTools(server);
  registerContextTools(server);
  registerSubscriptionTools(server);
  registerIntegrationTools(server);
  registerSchemaTools(server);
  registerDiagnosticTools(server);
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
    expect(JSON.parse(call?.init?.body as string)).toEqual(body);
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
  return handler(inputSchemas.get(name)!.parse(input));
}

describe("MCP tool registration wires tools to ConnxioClient HTTP routes", () => {
  it("registers all expected tools", () => {
    const names = [...handlers.keys()].sort();
    expect(names).toEqual(
      [
        "check_cli_update",
        "list_schemas",
        "get_schema",
        "get_schema_versions",
        "get_schema_content",
        "upload_schema",
        "deprecate_schema",
        "delete_schema",
        "list_company_performance_metrics",
        "list_subscription_performance_metrics",
        "list_integration_performance_metrics",
        "get_interchange_performance_metric",
        "list_subscription_errors",
        "list_integration_errors",
        "get_interchange_error",

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

describe("v3 management tools", () => {
  const guid = "5e980872-28ca-4afb-bd35-19c76ad65942";

  it.each([
    ["list_integrations", {}, "GET", "/v3/integrations", undefined],
    [
      "get_integration",
      { id: guid, replaceVariables: false },
      "GET",
      `/v3/integrations/${guid}?replaceVariables=false`,
      undefined,
    ],
    [
      "create_integration",
      { integration: { isActionBased: true } },
      "POST",
      "/v3/integrations",
      { isActionBased: true },
    ],
    [
      "create_integration_no_validation",
      { integration: { isActionBased: true } },
      "POST",
      "/v3/integrations/novalidation",
      { isActionBased: true },
    ],
    [
      "update_integration",
      { id: guid, integration: { isActionBased: true } },
      "PUT",
      `/v3/integrations/${guid}`,
      { isActionBased: true },
    ],
    [
      "delete_integration",
      { id: guid, confirm: true },
      "DELETE",
      `/v3/integrations/${guid}`,
      undefined,
    ],
  ] as const)("%s supports action-based integrations", async (name, input, method, path, body) => {
    const { calls } = installFetch(() => makeResponse({ ok: true }));
    expectSuccess(await invoke(name, { ...input, contextId: "ctx-1", apiVersion: "v3" }));
    expectCall(calls[0], method, path, body);
    expect(calls[0]?.init?.headers).toMatchObject({
      Accept: "application/json; x-api-version=3.0",
    });
    if (body)
      expect(calls[0]?.init?.headers).toMatchObject({
        "Content-Type": "application/json; x-api-version=3.0",
      });
  });

  it.each([
    ["list_schemas", {}, "GET", "/v3/schemas"],
    ["get_schema", { id: "schema/one" }, "GET", "/v3/schemas/schema%2Fone"],
    ["get_schema_versions", { id: "schema/one" }, "GET", "/v3/schemas/schema%2Fone/versions"],
    [
      "get_schema_content",
      { id: "schema/one", schemaVersion: "1/2" },
      "GET",
      "/v3/schemas/schema%2Fone/versions/1%2F2/content",
    ],
    [
      "deprecate_schema",
      { contextId: "ctx-1", id: "schema/one", version: "1.0" },
      "PUT",
      "/v3/schemas/schema%2Fone/deprecate?version=1.0",
    ],
    [
      "delete_schema",
      { contextId: "ctx-1", id: "schema/one", confirm: true },
      "DELETE",
      "/v3/schemas/schema%2Fone",
    ],
    [
      "get_interchange_performance_metric",
      { interchangeId: guid },
      "GET",
      `/v3/performance/interchange/${guid}`,
    ],
    ["get_interchange_error", { interchangeId: guid }, "GET", `/v3/error/interchange/${guid}`],
  ] as const)("%s uses its API route", async (name, input, method, path) => {
    const { calls } = installFetch(() => makeResponse({ ok: true }));
    expectSuccess(await invoke(name, input));
    expectCall(calls[0], method, path);
  });

  it("uploads base64 content and preserves nullable and optional metadata", async () => {
    const { calls } = installFetch(() => makeResponse({ id: "schema-1" }));
    const schema = {
      id: "schema-1",
      name: "Orders",
      version: "1.0.0",
      type: "Json",
      content: "e30=",
      description: null,
      webhookConnectionId: null,
      originalFilename: "orders.json",
      uploadedBy: "Operator",
    };
    expectSuccess(await invoke("upload_schema", { contextId: "ctx-1", schema }));
    expectCall(calls[0], "PUT", "/v3/schemas", schema);
    const { description: _description, ...withoutDescription } = schema;
    await invoke("upload_schema", { contextId: "ctx-1", schema: withoutDescription });
    expectCall(calls[1], "PUT", "/v3/schemas", withoutDescription);
  });

  it.each([
    ["list_company_performance_metrics", {}, "/v3/performance/company"],
    ["list_subscription_performance_metrics", {}, "/v3/performance/subscription"],
    [
      "list_integration_performance_metrics",
      { integrationId: guid },
      `/v3/performance/integration/${guid}`,
    ],
    ["list_subscription_errors", {}, "/v3/error/subscription"],
    ["list_integration_errors", { integrationId: guid }, `/v3/error/integration/${guid}`],
  ] as const)("%s forwards filters and preserves paging metadata", async (name, input, path) => {
    const page = {
      metrics: [],
      errors: [],
      skip: 100,
      size: 25,
      totalCount: 200,
      hasNextPage: true,
    };
    const { calls } = installFetch(() => makeResponse(page));
    const from = "2026-10-01T00:00:00+02:00";
    const to = "2026-10-02T00:00:00Z";
    const result = await invoke(name, {
      ...input,
      contextId: "ctx-1",
      from,
      to,
      skip: 100,
      size: 25,
    });
    expectSuccess(result);
    expectCall(
      calls[0],
      "GET",
      `${path}?${new URLSearchParams({ from, to, skip: "100", size: "25" })}`,
    );
    expect(JSON.parse(result.content[0]!.text)).toEqual(page);
    await invoke(name, input);
    expectCall(calls[1], "GET", path);
  });

  it.each([
    { size: 0 },
    { size: 1001 },
    { size: 1.5 },
    { skip: -1 },
    { skip: 100001 },
    { from: "invalid" },
  ])("rejects invalid paging/date inputs %j before HTTP", async (input) => {
    const { calls } = installFetch(() => makeResponse({}));
    await expect(invoke("list_subscription_errors", input)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("rejects reversed date ranges before HTTP", async () => {
    const { calls } = installFetch(() => makeResponse({}));
    const result = await invoke("list_company_performance_metrics", {
      from: "2026-10-02T00:00:00Z",
      to: "2026-10-01T00:00:00Z",
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it.each([
    [
      "upload_schema",
      { schema: { id: "x", name: "X", version: "1.0", type: "Json", content: "e30=" } },
    ],
    ["deprecate_schema", { id: "x", version: "1.0" }],
    ["delete_schema", { id: "x", confirm: true }],
    ["delete_schema", { id: "x", contextId: "ctx-1" }],
    ["delete_schema", { id: "x", contextId: "ctx-1", confirm: false }],
    ["get_interchange_error", { interchangeId: "not-a-guid" }],
    ["list_integration_performance_metrics", { integrationId: "not-a-guid" }],
    ["list_integrations", { apiVersion: "v4" }],
    [
      "upload_schema",
      {
        contextId: "ctx-1",
        schema: { id: "x", name: "X", version: "1.0", type: "Json", content: "not base64" },
      },
    ],
  ])("%s validates required context, confirmation, and API inputs", async (name, input) => {
    const { calls } = installFetch(() => makeResponse({}));
    await expect(invoke(name, input)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
