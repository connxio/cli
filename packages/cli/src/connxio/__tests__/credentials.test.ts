import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keyringState = vi.hoisted(() => ({
  available: true,
  store: new Map<string, string>(),
}));

vi.mock("@napi-rs/keyring", () => {
  class AsyncEntry {
    readonly #service: string;
    readonly #username: string;

    constructor(service: string, username: string) {
      this.#service = service;
      this.#username = username;
    }

    async deleteCredential(): Promise<boolean> {
      return keyringState.store.delete(`${this.#service}:${this.#username}`);
    }

    async getPassword(): Promise<string | undefined> {
      return keyringState.store.get(`${this.#service}:${this.#username}`);
    }

    async setPassword(password: string): Promise<void> {
      keyringState.store.set(`${this.#service}:${this.#username}`, password);
    }
  }

  const findCredentialsAsync = vi.fn(async (service: string) => {
    if (!keyringState.available) {
      throw new Error("secure storage unavailable");
    }

    return [...keyringState.store.entries()]
      .filter(([key]) => key.startsWith(`${service}:`))
      .map(([key, password]) => ({
        account: key.slice(service.length + 1),
        password,
      }));
  });

  return {
    AsyncEntry,
    default: { AsyncEntry, findCredentialsAsync },
    findCredentialsAsync,
  };
});

type CredentialsModule = typeof import("../credentials.js");

let savedConfigDir: string | undefined;
let tempDir: string;

beforeEach(async () => {
  vi.resetModules();
  keyringState.available = true;
  keyringState.store.clear();
  savedConfigDir = process.env.CONNXIO_CONFIG_DIR;
  tempDir = await mkdtemp(join(tmpdir(), "connxio-credentials-test-"));
  process.env.CONNXIO_CONFIG_DIR = tempDir;
});

afterEach(async () => {
  if (savedConfigDir === undefined) delete process.env.CONNXIO_CONFIG_DIR;
  else process.env.CONNXIO_CONFIG_DIR = savedConfigDir;
  vi.restoreAllMocks();
  await rm(tempDir, { force: true, recursive: true });
});

describe("keyring-backed credentials", () => {
  it("round-trips a stored api key in the OS keyring", async () => {
    const credentials = await loadCredentials();

    await credentials.setApiKey("ctx-a", "secret-a");

    expect(await credentials.getApiKey("ctx-a")).toBe("secret-a");
    expect(await credentials.hasApiKey("ctx-a")).toBe(true);
    expect(await credentials.getCredentialStoreDescription()).toBe("OS keyring");
    expect(keyringState.store.get(keyringRef("api-key", "ctx-a"))).toBe("secret-a");
  });

  it("round-trips a stored OAuth client secret in the OS keyring", async () => {
    const credentials = await loadCredentials();

    await credentials.setOAuthClientSecret("default", "csecret");

    expect(await credentials.getOAuthClientSecret("default")).toBe("csecret");
    expect(await credentials.hasOAuthClientSecret("default")).toBe(true);
    expect(keyringState.store.get(keyringRef("oauth-client-secret", "default"))).toBe("csecret");
  });

  it("trims values before writing them to the keyring", async () => {
    const credentials = await loadCredentials();

    await credentials.setApiKey("ctx-a", "  secret-a  ");
    await credentials.setOAuthClientSecret("default", "  csecret  ");

    expect(await credentials.getApiKey("ctx-a")).toBe("secret-a");
    expect(await credentials.getOAuthClientSecret("default")).toBe("csecret");
  });

  it("rejects empty values", async () => {
    const credentials = await loadCredentials();

    await expect(credentials.setApiKey("ctx-a", "   ")).rejects.toThrow(/API key cannot be empty/);
    await expect(credentials.setOAuthClientSecret("default", "   ")).rejects.toThrow(
      /OAuth client secret cannot be empty/,
    );
  });

  it("migrates an api key from the legacy credentials file into the keyring", async () => {
    await writeLegacyCredentialFile({ apiKeys: { "ctx-a": "secret-a" }, oauthClientSecrets: {} });
    const credentials = await loadCredentials();

    expect(await credentials.getApiKey("ctx-a")).toBe("secret-a");
    expect(keyringState.store.get(keyringRef("api-key", "ctx-a"))).toBe("secret-a");
    await expect(hasLegacyCredentialFile()).resolves.toBe(false);
  });

  it("migrates an OAuth secret from the legacy credentials file and removes the file when empty", async () => {
    await writeLegacyCredentialFile({ apiKeys: {}, oauthClientSecrets: { default: "csecret" } });
    const credentials = await loadCredentials();

    expect(await credentials.getOAuthClientSecret("default")).toBe("csecret");
    expect(keyringState.store.get(keyringRef("oauth-client-secret", "default"))).toBe("csecret");
    await expect(hasLegacyCredentialFile()).resolves.toBe(false);
  });

  it("deletes both the keyring entry and legacy file entry during migration", async () => {
    await writeLegacyCredentialFile({ apiKeys: { "ctx-a": "legacy-a" }, oauthClientSecrets: {} });
    keyringState.store.set(keyringRef("api-key", "ctx-a"), "secret-a");
    const credentials = await loadCredentials();

    await credentials.deleteApiKey("ctx-a");

    expect(await credentials.hasApiKey("ctx-a")).toBe(false);
    expect(keyringState.store.has(keyringRef("api-key", "ctx-a"))).toBe(false);
    await expect(hasLegacyCredentialFile()).resolves.toBe(false);
  });

  it("throws helpful missing-credential errors", async () => {
    const credentials = await loadCredentials();

    await expect(credentials.getApiKey("missing")).rejects.toThrow(/connxio context add missing/);
    await expect(credentials.getOAuthClientSecret("default")).rejects.toThrow(
      /connxio auth configure/,
    );
  });
});

describe("file fallback credentials", () => {
  it("falls back to the local file store when secure storage is unavailable", async () => {
    keyringState.available = false;
    const credentials = await loadCredentials();

    await credentials.setApiKey("ctx-a", "secret-a");
    await credentials.setOAuthClientSecret("default", "csecret");

    expect(await credentials.getApiKey("ctx-a")).toBe("secret-a");
    expect(await credentials.getOAuthClientSecret("default")).toBe("csecret");
    expect(await credentials.hasApiKey("ctx-a")).toBe(true);
    expect(await credentials.hasOAuthClientSecret("default")).toBe(true);
    expect(await credentials.getCredentialStoreDescription()).toContain("credentials.json");
    await expect(readLegacyCredentialFile()).resolves.toEqual({
      apiKeys: { "ctx-a": "secret-a" },
      oauthClientSecrets: { default: "csecret" },
    });
  });

  it("warns once when it falls back to file storage", async () => {
    keyringState.available = false;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const credentials = await loadCredentials();

    await credentials.hasApiKey("ctx-a");
    await credentials.hasOAuthClientSecret("default");
    await credentials.getCredentialStoreDescription();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("falling back to local file storage");
  });

  it("tolerates deleting a missing ref", async () => {
    keyringState.available = false;
    const credentials = await loadCredentials();

    await expect(credentials.deleteApiKey("never-added")).resolves.toBeUndefined();
    await expect(credentials.deleteOAuthClientSecret("never-added")).resolves.toBeUndefined();
    expect(await credentials.hasApiKey("never-added")).toBe(false);
    expect(await credentials.hasOAuthClientSecret("never-added")).toBe(false);
  });
});

async function loadCredentials(): Promise<CredentialsModule> {
  return import("../credentials.js");
}

function getCredentialPath(): string {
  return join(tempDir, "credentials.json");
}

function keyringRef(kind: "api-key" | "oauth-client-secret", ref: string): string {
  return `com.connxio.cli:${kind}:${ref}`;
}

async function readLegacyCredentialFile(): Promise<unknown> {
  return JSON.parse(await readFile(getCredentialPath(), "utf8"));
}

async function hasLegacyCredentialFile(): Promise<boolean> {
  try {
    await readFile(getCredentialPath(), "utf8");
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function writeLegacyCredentialFile(value: {
  apiKeys: Record<string, string>;
  oauthClientSecrets: Record<string, string>;
}): Promise<void> {
  await writeFile(getCredentialPath(), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
