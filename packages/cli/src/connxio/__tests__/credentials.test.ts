import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deleteApiKey,
  deleteOAuthClientSecret,
  getApiKey,
  getCredentialStoreDescription,
  getOAuthClientSecret,
  hasApiKey,
  hasOAuthClientSecret,
  setApiKey,
  setOAuthClientSecret,
} from "../credentials.js";

let savedConfigDir: string | undefined;
let tempDir: string;

beforeEach(async () => {
  savedConfigDir = process.env.CONNXIO_CONFIG_DIR;
  tempDir = await mkdtemp(join(tmpdir(), "connxio-credentials-test-"));
  process.env.CONNXIO_CONFIG_DIR = tempDir;
});

afterEach(async () => {
  if (savedConfigDir === undefined) delete process.env.CONNXIO_CONFIG_DIR;
  else process.env.CONNXIO_CONFIG_DIR = savedConfigDir;
  await rm(tempDir, { force: true, recursive: true });
});

describe("api key credentials", () => {
  it("round-trips a stored api key", async () => {
    await setApiKey("ctx-a", "secret-a");
    expect(await getApiKey("ctx-a")).toBe("secret-a");
  });

  it("trims whitespace from the stored api key", async () => {
    await setApiKey("ctx-a", "  secret-a  ");
    expect(await getApiKey("ctx-a")).toBe("secret-a");
  });

  it("rejects empty api keys", async () => {
    await expect(setApiKey("ctx-a", "   ")).rejects.toThrow(/API key cannot be empty/);
  });

  it("stores multiple refs side by side", async () => {
    await setApiKey("ctx-a", "secret-a");
    await setApiKey("ctx-b", "secret-b");

    expect(await getApiKey("ctx-a")).toBe("secret-a");
    expect(await getApiKey("ctx-b")).toBe("secret-b");
  });

  it("throws a helpful error mentioning `connxio context add` when the key is missing", async () => {
    await expect(getApiKey("missing")).rejects.toThrow(/connxio context add missing/);
  });

  it("does not crash when the credential file does not exist yet", async () => {
    expect(await hasApiKey("ctx-a")).toBe(false);
    await expect(getApiKey("ctx-a")).rejects.toThrow(/Missing credential/);
  });

  it("deletes one ref but leaves others", async () => {
    await setApiKey("ctx-a", "secret-a");
    await setApiKey("ctx-b", "secret-b");

    await deleteApiKey("ctx-a");

    expect(await hasApiKey("ctx-a")).toBe(false);
    expect(await hasApiKey("ctx-b")).toBe(true);
    expect(await getApiKey("ctx-b")).toBe("secret-b");
  });

  it("hasApiKey returns true for stored keys and false otherwise", async () => {
    expect(await hasApiKey("ctx-a")).toBe(false);
    await setApiKey("ctx-a", "secret-a");
    expect(await hasApiKey("ctx-a")).toBe(true);
    expect(await hasApiKey("ctx-other")).toBe(false);
  });

  it("tolerates deleting a missing ref", async () => {
    await expect(deleteApiKey("never-added")).resolves.toBeUndefined();
    expect(await hasApiKey("never-added")).toBe(false);
  });
});

describe("oauth client secret credentials", () => {
  it("round-trips a stored client secret", async () => {
    await setOAuthClientSecret("default", "csecret");
    expect(await getOAuthClientSecret("default")).toBe("csecret");
  });

  it("trims whitespace from the stored client secret", async () => {
    await setOAuthClientSecret("default", "  csecret  ");
    expect(await getOAuthClientSecret("default")).toBe("csecret");
  });

  it("rejects empty client secrets", async () => {
    await expect(setOAuthClientSecret("default", "   ")).rejects.toThrow(
      /OAuth client secret cannot be empty/,
    );
  });

  it("throws a helpful error mentioning `connxio auth configure` when missing", async () => {
    await expect(getOAuthClientSecret("default")).rejects.toThrow(/connxio auth configure/);
  });

  it("hasOAuthClientSecret reflects stored state", async () => {
    expect(await hasOAuthClientSecret("default")).toBe(false);
    await setOAuthClientSecret("default", "csecret");
    expect(await hasOAuthClientSecret("default")).toBe(true);
  });

  it("deletes one client secret ref but leaves others", async () => {
    await setOAuthClientSecret("default", "csecret");
    await setOAuthClientSecret("alt", "alt-secret");

    await deleteOAuthClientSecret("default");

    expect(await hasOAuthClientSecret("default")).toBe(false);
    expect(await hasOAuthClientSecret("alt")).toBe(true);
    expect(await getOAuthClientSecret("alt")).toBe("alt-secret");
  });

  it("coexists with api keys in the same store", async () => {
    await setApiKey("ctx-a", "secret-a");
    await setOAuthClientSecret("default", "csecret");

    expect(await getApiKey("ctx-a")).toBe("secret-a");
    expect(await getOAuthClientSecret("default")).toBe("csecret");

    await deleteApiKey("ctx-a");
    expect(await hasOAuthClientSecret("default")).toBe(true);
  });
});

describe("getCredentialStoreDescription", () => {
  it("returns a string that mentions the configured directory", () => {
    const description = getCredentialStoreDescription();
    expect(typeof description).toBe("string");
    expect(description).toContain(tempDir);
    expect(description).toContain("credentials.json");
  });
});
