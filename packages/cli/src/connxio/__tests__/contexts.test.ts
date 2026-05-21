import { beforeEach, describe, expect, it, vi } from "vitest";

type ContextConfig = {
  apiKeyRef: string;
  baseUrl: string;
  companyId: string;
  companyName: string;
  id: string;
  name: string;
  subscriptionId: string;
  subscriptionName: string;
};

type ConfigShape = {
  contexts: ContextConfig[];
  defaultContext?: string;
};

let mockConfig: ConfigShape;
let writtenConfig: ConfigShape | undefined;
let mockApiKeys: Record<string, string>;

vi.mock("../config.js", () => ({
  readConfig: vi.fn(async () => structuredClone(mockConfig)),
  writeConfig: vi.fn(async (next: ConfigShape) => {
    writtenConfig = structuredClone(next);
    mockConfig = structuredClone(next);
  }),
}));

vi.mock("../credentials.js", () => ({
  hasApiKey: vi.fn(async (ref: string) => Boolean(mockApiKeys[ref])),
}));

async function loadContexts(): Promise<typeof import("../contexts.js")> {
  return import("../contexts.js");
}

function makeInput(
  overrides: Partial<import("../contexts.js").AddContextInput> = {},
): import("../contexts.js").AddContextInput {
  return {
    baseUrl: "https://api.example.com",
    companyId: "co-1",
    companyName: "Acme",
    id: "ctx-1",
    name: "Context 1",
    subscriptionId: "sub-1",
    subscriptionName: "Sub 1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  mockConfig = { contexts: [] };
  writtenConfig = undefined;
  mockApiKeys = {};
});

describe("addContext", () => {
  it("adds a new context and sets it default when it is the only one", async () => {
    const { addContext } = await loadContexts();
    await addContext(makeInput());

    expect(writtenConfig?.contexts).toHaveLength(1);
    expect(writtenConfig?.contexts[0]).toMatchObject({
      apiKeyRef: "ctx-1",
      baseUrl: "https://api.example.com",
      id: "ctx-1",
      name: "Context 1",
    });
    expect(writtenConfig?.defaultContext).toBe("ctx-1");
  });

  it("does not change the default when adding an additional context without setDefault", async () => {
    mockConfig = {
      contexts: [
        {
          apiKeyRef: "ctx-1",
          baseUrl: "https://api.example.com",
          companyId: "co-1",
          companyName: "Acme",
          id: "ctx-1",
          name: "Context 1",
          subscriptionId: "sub-1",
          subscriptionName: "Sub 1",
        },
      ],
      defaultContext: "ctx-1",
    };

    const { addContext } = await loadContexts();
    await addContext(makeInput({ id: "ctx-2", name: "Context 2" }));

    expect(writtenConfig?.contexts).toHaveLength(2);
    expect(writtenConfig?.defaultContext).toBe("ctx-1");
  });

  it("promotes a new context to default when setDefault is true", async () => {
    mockConfig = {
      contexts: [
        {
          apiKeyRef: "ctx-1",
          baseUrl: "https://api.example.com",
          companyId: "co-1",
          companyName: "Acme",
          id: "ctx-1",
          name: "Context 1",
          subscriptionId: "sub-1",
          subscriptionName: "Sub 1",
        },
      ],
      defaultContext: "ctx-1",
    };

    const { addContext } = await loadContexts();
    await addContext(makeInput({ id: "ctx-2", name: "Context 2", setDefault: true }));

    expect(writtenConfig?.defaultContext).toBe("ctx-2");
  });

  it("replaces an existing context with the same id rather than duplicating", async () => {
    mockConfig = {
      contexts: [
        {
          apiKeyRef: "ctx-1",
          baseUrl: "https://old.example.com",
          companyId: "co-old",
          companyName: "Old",
          id: "ctx-1",
          name: "Old Name",
          subscriptionId: "sub-old",
          subscriptionName: "Old Sub",
        },
      ],
      defaultContext: "ctx-1",
    };

    const { addContext } = await loadContexts();
    await addContext(makeInput({ id: "ctx-1", name: "New Name" }));

    expect(writtenConfig?.contexts).toHaveLength(1);
    expect(writtenConfig?.contexts[0]).toMatchObject({
      baseUrl: "https://api.example.com",
      companyName: "Acme",
      name: "New Name",
    });
  });
});

describe("listPublicContexts", () => {
  it("returns each context with isDefault and hasCredential flags", async () => {
    mockConfig = {
      contexts: [
        {
          apiKeyRef: "ctx-1",
          baseUrl: "https://api.example.com",
          companyId: "co-1",
          companyName: "Acme",
          id: "ctx-1",
          name: "Context 1",
          subscriptionId: "sub-1",
          subscriptionName: "Sub 1",
        },
        {
          apiKeyRef: "ctx-2",
          baseUrl: "https://api.example.com",
          companyId: "co-2",
          companyName: "Other",
          id: "ctx-2",
          name: "Context 2",
          subscriptionId: "sub-2",
          subscriptionName: "Sub 2",
        },
      ],
      defaultContext: "ctx-2",
    };
    mockApiKeys["ctx-1"] = "secret";

    const { listPublicContexts } = await loadContexts();
    const result = await listPublicContexts();

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "ctx-1", isDefault: false, hasCredential: true });
    expect(result[1]).toMatchObject({ id: "ctx-2", isDefault: true, hasCredential: false });
    expect(result[0]).not.toHaveProperty("apiKeyRef");
  });

  it("returns an empty array when no contexts are configured", async () => {
    const { listPublicContexts } = await loadContexts();
    expect(await listPublicContexts()).toEqual([]);
  });
});

describe("removeContext", () => {
  it("removes the matching context and preserves defaultContext when it is a different context", async () => {
    mockConfig = {
      contexts: [
        {
          apiKeyRef: "ctx-1",
          baseUrl: "https://api.example.com",
          companyId: "co-1",
          companyName: "Acme",
          id: "ctx-1",
          name: "Context 1",
          subscriptionId: "sub-1",
          subscriptionName: "Sub 1",
        },
        {
          apiKeyRef: "ctx-2",
          baseUrl: "https://api.example.com",
          companyId: "co-2",
          companyName: "Other",
          id: "ctx-2",
          name: "Context 2",
          subscriptionId: "sub-2",
          subscriptionName: "Sub 2",
        },
      ],
      defaultContext: "ctx-1",
    };

    const { removeContext } = await loadContexts();
    await removeContext("ctx-2");

    expect(writtenConfig?.contexts).toHaveLength(1);
    expect(writtenConfig?.contexts[0]?.id).toBe("ctx-1");
    expect(writtenConfig?.defaultContext).toBe("ctx-1");
  });

  it("clears defaultContext when the removed context was the default", async () => {
    mockConfig = {
      contexts: [
        {
          apiKeyRef: "ctx-1",
          baseUrl: "https://api.example.com",
          companyId: "co-1",
          companyName: "Acme",
          id: "ctx-1",
          name: "Context 1",
          subscriptionId: "sub-1",
          subscriptionName: "Sub 1",
        },
      ],
      defaultContext: "ctx-1",
    };

    const { removeContext } = await loadContexts();
    await removeContext("ctx-1");

    expect(writtenConfig?.contexts).toEqual([]);
    expect(writtenConfig?.defaultContext).toBeUndefined();
  });

  it("throws ConnxioContextError when the context is not found", async () => {
    const { removeContext, ConnxioContextError } = await loadContexts();
    await expect(removeContext("missing")).rejects.toBeInstanceOf(ConnxioContextError);
    await expect(removeContext("missing")).rejects.toThrow(/Context not found: missing/);
  });
});

describe("resolveContext", () => {
  const ctx1 = {
    apiKeyRef: "ctx-1",
    baseUrl: "https://api.example.com",
    companyId: "co-1",
    companyName: "Acme",
    id: "ctx-1",
    name: "Context 1",
    subscriptionId: "sub-1",
    subscriptionName: "Sub 1",
  };
  const ctx2 = {
    apiKeyRef: "ctx-2",
    baseUrl: "https://api.example.com",
    companyId: "co-2",
    companyName: "Other",
    id: "ctx-2",
    name: "Context 2",
    subscriptionId: "sub-2",
    subscriptionName: "Sub 2",
  };

  it("returns the context matching the given id", async () => {
    mockConfig = { contexts: [ctx1, ctx2] };
    const { resolveContext } = await loadContexts();
    expect(await resolveContext("ctx-2")).toEqual(ctx2);
  });

  it("throws when the requested id does not exist", async () => {
    mockConfig = { contexts: [ctx1] };
    const { resolveContext, ConnxioContextError } = await loadContexts();
    await expect(resolveContext("missing")).rejects.toBeInstanceOf(ConnxioContextError);
    await expect(resolveContext("missing")).rejects.toThrow(/Context not found: missing/);
  });

  it("returns the default context when no id is given", async () => {
    mockConfig = { contexts: [ctx1, ctx2], defaultContext: "ctx-2" };
    const { resolveContext } = await loadContexts();
    expect(await resolveContext()).toEqual(ctx2);
  });

  it("throws when defaultContext points to a missing context", async () => {
    mockConfig = { contexts: [ctx1], defaultContext: "ctx-gone" };
    const { resolveContext, ConnxioContextError } = await loadContexts();
    await expect(resolveContext()).rejects.toBeInstanceOf(ConnxioContextError);
    await expect(resolveContext()).rejects.toThrow(/Default context not found: ctx-gone/);
  });

  it("falls back to the only context when no default is configured", async () => {
    mockConfig = { contexts: [ctx1] };
    const { resolveContext } = await loadContexts();
    expect(await resolveContext()).toEqual(ctx1);
  });

  it("throws when no contexts are configured", async () => {
    const { resolveContext, ConnxioContextError } = await loadContexts();
    await expect(resolveContext()).rejects.toBeInstanceOf(ConnxioContextError);
    await expect(resolveContext()).rejects.toThrow(/No contexts configured/);
  });

  it("throws when multiple contexts exist and no default is configured", async () => {
    mockConfig = { contexts: [ctx1, ctx2] };
    const { resolveContext, ConnxioContextError } = await loadContexts();
    await expect(resolveContext()).rejects.toBeInstanceOf(ConnxioContextError);
    await expect(resolveContext()).rejects.toThrow(/Multiple contexts exist/);
  });
});

describe("setDefaultContext", () => {
  it("updates defaultContext to the given id", async () => {
    mockConfig = {
      contexts: [
        {
          apiKeyRef: "ctx-1",
          baseUrl: "https://api.example.com",
          companyId: "co-1",
          companyName: "Acme",
          id: "ctx-1",
          name: "Context 1",
          subscriptionId: "sub-1",
          subscriptionName: "Sub 1",
        },
        {
          apiKeyRef: "ctx-2",
          baseUrl: "https://api.example.com",
          companyId: "co-2",
          companyName: "Other",
          id: "ctx-2",
          name: "Context 2",
          subscriptionId: "sub-2",
          subscriptionName: "Sub 2",
        },
      ],
      defaultContext: "ctx-1",
    };

    const { setDefaultContext } = await loadContexts();
    await setDefaultContext("ctx-2");

    expect(writtenConfig?.defaultContext).toBe("ctx-2");
    expect(writtenConfig?.contexts).toHaveLength(2);
  });

  it("throws when the context does not exist", async () => {
    const { setDefaultContext, ConnxioContextError } = await loadContexts();
    await expect(setDefaultContext("missing")).rejects.toBeInstanceOf(ConnxioContextError);
    await expect(setDefaultContext("missing")).rejects.toThrow(/Context not found: missing/);
  });
});
