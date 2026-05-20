import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type ConnxioContextConfig = {
  apiKeyRef: string;
  baseUrl: string;
  companyId: string;
  companyName: string;
  id: string;
  name: string;
  subscriptionId: string;
  subscriptionName: string;
};

export type ConnxioConfig = {
  contexts: ConnxioContextConfig[];
  defaultContext?: string;
  oauth?: ConnxioOAuthConfig;
};

export type ConnxioOAuthConfig = {
  clientId: string;
  clientSecretRef: string;
  scope?: string;
  tokenUrl?: string;
};

export function getConfigDir(): string {
  if (process.env.CONNXIO_CONFIG_DIR) {
    return process.env.CONNXIO_CONFIG_DIR;
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "connxio");
  }

  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "connxio");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

export async function readConfig(): Promise<ConnxioConfig> {
  try {
    const data = await readFile(getConfigPath(), "utf8");
    return parseConfig(JSON.parse(data));
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { contexts: [] };
    }

    throw error;
  }
}

export async function writeConfig(config: ConnxioConfig): Promise<void> {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  const temporaryPath = `${configPath}.tmp`;

  await mkdir(configDir, { mode: 0o700, recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, configPath);
}

function parseConfig(value: unknown): ConnxioConfig {
  if (!isRecord(value)) {
    throw new Error(`Invalid Connxio config at ${getConfigPath()}: expected an object.`);
  }

  const contextsValue = value.contexts;
  const contexts = Array.isArray(contextsValue) ? contextsValue.map(parseContext) : [];
  const defaultContext =
    typeof value.defaultContext === "string" ? value.defaultContext : undefined;
  const oauth = value.oauth === undefined ? undefined : parseOAuth(value.oauth);

  return {
    contexts,
    ...(defaultContext === undefined ? {} : { defaultContext }),
    ...(oauth === undefined ? {} : { oauth }),
  };
}

function parseOAuth(value: unknown): ConnxioOAuthConfig {
  if (!isRecord(value)) {
    throw new Error(`Invalid Connxio config at ${getConfigPath()}: oauth must be an object.`);
  }

  if (
    typeof value.clientId !== "string" ||
    typeof value.clientSecretRef !== "string" ||
    (value.tokenUrl !== undefined && typeof value.tokenUrl !== "string")
  ) {
    throw new Error(`Invalid Connxio config at ${getConfigPath()}: oauth fields must be strings.`);
  }

  return {
    clientId: value.clientId,
    clientSecretRef: value.clientSecretRef,
    ...(typeof value.scope === "string" ? { scope: value.scope } : {}),
    ...(typeof value.tokenUrl === "string" ? { tokenUrl: value.tokenUrl } : {}),
  };
}

function parseContext(value: unknown): ConnxioContextConfig {
  if (!isRecord(value)) {
    throw new Error(`Invalid Connxio config at ${getConfigPath()}: context must be an object.`);
  }

  if (
    typeof value.apiKeyRef !== "string" ||
    typeof value.baseUrl !== "string" ||
    typeof value.companyId !== "string" ||
    typeof value.companyName !== "string" ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.subscriptionId !== "string" ||
    typeof value.subscriptionName !== "string"
  ) {
    throw new Error(
      `Invalid Connxio config at ${getConfigPath()}: context fields must be strings.`,
    );
  }

  return {
    apiKeyRef: value.apiKeyRef,
    baseUrl: value.baseUrl,
    companyId: value.companyId,
    companyName: value.companyName,
    id: value.id,
    name: value.name,
    subscriptionId: value.subscriptionId,
    subscriptionName: value.subscriptionName,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
