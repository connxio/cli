import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENV_KEYS = ["CONNXIO_CONFIG_DIR", "XDG_CONFIG_HOME", "APPDATA"] as const;

const tempDirectories: string[] = [];
let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let savedPlatform: PropertyDescriptor | undefined;

async function createTempDirectory(): Promise<string> {
  const directoryPath = await mkdtemp(path.join(tmpdir(), "connxio-config-test-"));
  tempDirectories.push(directoryPath);
  return directoryPath;
}

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value,
  });
}

async function loadConfig(): Promise<typeof import("../config.js")> {
  return import("../config.js");
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  savedPlatform = Object.getOwnPropertyDescriptor(process, "platform");
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  if (savedPlatform) {
    Object.defineProperty(process, "platform", savedPlatform);
  }
  await Promise.all(
    tempDirectories.map((directoryPath) => rm(directoryPath, { force: true, recursive: true })),
  );
  tempDirectories.length = 0;
});

describe("getConfigDir", () => {
  it("prefers CONNXIO_CONFIG_DIR over everything else", async () => {
    const tempDir = await createTempDirectory();
    process.env.CONNXIO_CONFIG_DIR = tempDir;
    process.env.XDG_CONFIG_HOME = "/should/not/use";
    process.env.APPDATA = "/should/not/use";
    setPlatform("win32");

    const { getConfigDir } = await loadConfig();
    expect(getConfigDir()).toBe(tempDir);
  });

  it("uses XDG_CONFIG_HOME on linux", async () => {
    setPlatform("linux");
    process.env.XDG_CONFIG_HOME = "/custom/xdg";

    const { getConfigDir } = await loadConfig();
    expect(getConfigDir()).toBe(path.join("/custom/xdg", "connxio"));
  });

  it("falls back to ~/.config on darwin when XDG_CONFIG_HOME is missing", async () => {
    setPlatform("darwin");

    const { getConfigDir } = await loadConfig();
    expect(getConfigDir().endsWith(path.join(".config", "connxio"))).toBe(true);
  });

  it("uses APPDATA on win32", async () => {
    setPlatform("win32");
    process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";

    const { getConfigDir } = await loadConfig();
    expect(getConfigDir()).toBe(path.join("C:\\Users\\test\\AppData\\Roaming", "connxio"));
  });

  it("falls back to homedir AppData on win32 when APPDATA is missing", async () => {
    setPlatform("win32");

    const { getConfigDir } = await loadConfig();
    expect(getConfigDir().includes(path.join("AppData", "Roaming", "connxio"))).toBe(true);
  });
});

describe("getConfigPath", () => {
  it("joins the config dir with config.json", async () => {
    const tempDir = await createTempDirectory();
    process.env.CONNXIO_CONFIG_DIR = tempDir;

    const { getConfigPath } = await loadConfig();
    expect(getConfigPath()).toBe(path.join(tempDir, "config.json"));
  });
});

describe("readConfig", () => {
  it("returns an empty config when the file is missing", async () => {
    const tempDir = await createTempDirectory();
    process.env.CONNXIO_CONFIG_DIR = tempDir;

    const { readConfig } = await loadConfig();
    expect(await readConfig()).toEqual({ contexts: [] });
  });

  it("parses an existing config file", async () => {
    const tempDir = await createTempDirectory();
    process.env.CONNXIO_CONFIG_DIR = tempDir;
    const data = {
      contexts: [
        {
          apiKeyRef: "ref-1",
          baseUrl: "https://api.connxio.com",
          companyId: "co-1",
          companyName: "Co One",
          id: "ctx-1",
          name: "ctx-one",
          subscriptionId: "sub-1",
          subscriptionName: "Sub One",
        },
      ],
      defaultContext: "ctx-one",
      oauth: {
        clientId: "cid",
        clientSecretRef: "default",
        scope: "api://x/.default",
        tokenUrl: "https://example.com/token",
      },
    };
    await writeFile(path.join(tempDir, "config.json"), JSON.stringify(data));

    const { readConfig } = await loadConfig();
    expect(await readConfig()).toEqual(data);
  });

  it("throws on malformed JSON", async () => {
    const tempDir = await createTempDirectory();
    process.env.CONNXIO_CONFIG_DIR = tempDir;
    await writeFile(path.join(tempDir, "config.json"), "{not json");

    const { readConfig } = await loadConfig();
    await expect(readConfig()).rejects.toThrow();
  });

  it("throws when the root is not an object", async () => {
    const tempDir = await createTempDirectory();
    process.env.CONNXIO_CONFIG_DIR = tempDir;
    await writeFile(path.join(tempDir, "config.json"), JSON.stringify("a string"));

    const { readConfig } = await loadConfig();
    await expect(readConfig()).rejects.toThrow(/expected an object/);
  });

  it("throws when a context is missing required fields", async () => {
    const tempDir = await createTempDirectory();
    process.env.CONNXIO_CONFIG_DIR = tempDir;
    await writeFile(
      path.join(tempDir, "config.json"),
      JSON.stringify({ contexts: [{ apiKeyRef: "ref" }] }),
    );

    const { readConfig } = await loadConfig();
    await expect(readConfig()).rejects.toThrow(/context fields must be strings/);
  });

  it("throws when oauth has wrong types", async () => {
    const tempDir = await createTempDirectory();
    process.env.CONNXIO_CONFIG_DIR = tempDir;
    await writeFile(
      path.join(tempDir, "config.json"),
      JSON.stringify({ contexts: [], oauth: { clientId: 1, clientSecretRef: "ref" } }),
    );

    const { readConfig } = await loadConfig();
    await expect(readConfig()).rejects.toThrow(/oauth fields must be strings/);
  });

  it("ignores a non-string defaultContext", async () => {
    const tempDir = await createTempDirectory();
    process.env.CONNXIO_CONFIG_DIR = tempDir;
    await writeFile(
      path.join(tempDir, "config.json"),
      JSON.stringify({ contexts: [], defaultContext: 42 }),
    );

    const { readConfig } = await loadConfig();
    expect(await readConfig()).toEqual({ contexts: [] });
  });
});

describe("writeConfig", () => {
  it("creates the config directory and round-trips through readConfig", async () => {
    const tempDir = await createTempDirectory();
    const nestedDir = path.join(tempDir, "nested", "connxio");
    process.env.CONNXIO_CONFIG_DIR = nestedDir;

    const { readConfig, writeConfig } = await loadConfig();
    const config = {
      contexts: [
        {
          apiKeyRef: "ref",
          baseUrl: "https://api.connxio.com",
          companyId: "co",
          companyName: "Co",
          id: "ctx",
          name: "ctx",
          subscriptionId: "sub",
          subscriptionName: "Sub",
        },
      ],
      defaultContext: "ctx",
    };

    await writeConfig(config);
    expect(await readConfig()).toEqual(config);
  });

  it("writes pretty JSON with a trailing newline", async () => {
    const tempDir = await createTempDirectory();
    process.env.CONNXIO_CONFIG_DIR = tempDir;

    const { writeConfig } = await loadConfig();
    await writeConfig({ contexts: [] });

    const contents = await readFile(path.join(tempDir, "config.json"), "utf8");
    expect(contents).toBe(`${JSON.stringify({ contexts: [] }, null, 2)}\n`);
  });

  it("uses an atomic rename so no .tmp file remains on success", async () => {
    const tempDir = await createTempDirectory();
    process.env.CONNXIO_CONFIG_DIR = tempDir;

    const { writeConfig } = await loadConfig();
    await writeConfig({ contexts: [] });

    await expect(readFile(path.join(tempDir, "config.json.tmp"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("overwrites an existing config file", async () => {
    const tempDir = await createTempDirectory();
    process.env.CONNXIO_CONFIG_DIR = tempDir;

    const { readConfig, writeConfig } = await loadConfig();
    await writeConfig({ contexts: [], defaultContext: "first" });
    await writeConfig({ contexts: [], defaultContext: "second" });

    const result = await readConfig();
    expect(result.defaultContext).toBe("second");
  });
});
