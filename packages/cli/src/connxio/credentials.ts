import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getConfigDir } from "./config.js";

type CredentialFile = {
  apiKeys: Record<string, string>;
  oauthClientSecrets: Record<string, string>;
};

export function getCredentialStoreDescription(): string {
  return `local file (${getCredentialPath()})`;
}

export async function deleteApiKey(ref: string): Promise<void> {
  const store = await readCredentialFile();
  delete store.apiKeys[ref];
  await writeCredentialFile(store);
}

export async function deleteOAuthClientSecret(ref: string): Promise<void> {
  const store = await readCredentialFile();
  delete store.oauthClientSecrets[ref];
  await writeCredentialFile(store);
}

export async function getApiKey(ref: string): Promise<string> {
  const store = await readCredentialFile();
  const apiKey = store.apiKeys[ref];

  if (!apiKey) {
    throw new Error(`Missing credential for context ${ref}. Run \`connxio context add ${ref}\`.`);
  }

  return apiKey;
}

export async function getOAuthClientSecret(ref: string): Promise<string> {
  const store = await readCredentialFile();
  const clientSecret = store.oauthClientSecrets[ref];

  if (!clientSecret) {
    throw new Error("Missing OAuth client secret. Run `connxio auth configure`.");
  }

  return clientSecret;
}

export async function hasApiKey(ref: string): Promise<boolean> {
  const store = await readCredentialFile();
  return typeof store.apiKeys[ref] === "string" && store.apiKeys[ref].length > 0;
}

export async function hasOAuthClientSecret(ref: string): Promise<boolean> {
  const store = await readCredentialFile();
  return (
    typeof store.oauthClientSecrets[ref] === "string" && store.oauthClientSecrets[ref].length > 0
  );
}

export async function setApiKey(ref: string, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();

  if (!trimmed) {
    throw new Error("API key cannot be empty.");
  }

  const store = await readCredentialFile();
  store.apiKeys[ref] = trimmed;
  await writeCredentialFile(store);
}

export async function setOAuthClientSecret(ref: string, clientSecret: string): Promise<void> {
  const trimmed = clientSecret.trim();

  if (!trimmed) {
    throw new Error("OAuth client secret cannot be empty.");
  }

  const store = await readCredentialFile();
  store.oauthClientSecrets[ref] = trimmed;
  await writeCredentialFile(store);
}

function getCredentialPath(): string {
  return path.join(getConfigDir(), "credentials.json");
}

async function readCredentialFile(): Promise<CredentialFile> {
  try {
    const data = await readFile(getCredentialPath(), "utf8");
    const parsed: unknown = JSON.parse(data);

    if (!isCredentialFile(parsed)) {
      throw new Error(`Invalid Connxio credential store at ${getCredentialPath()}.`);
    }

    return parsed;
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return emptyCredentialFile();
    }

    throw error;
  }
}

async function writeCredentialFile(store: CredentialFile): Promise<void> {
  const configDir = getConfigDir();
  const credentialPath = getCredentialPath();
  const temporaryPath = `${credentialPath}.tmp`;

  if (
    Object.keys(store.apiKeys).length === 0 &&
    Object.keys(store.oauthClientSecrets).length === 0
  ) {
    await rm(credentialPath, { force: true });
    return;
  }

  await mkdir(configDir, { mode: 0o700, recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, credentialPath);
}

function isCredentialFile(value: unknown): value is CredentialFile {
  if (!isRecord(value) || !isStringRecord(value.apiKeys)) {
    return false;
  }

  const oauthClientSecrets = value.oauthClientSecrets === undefined ? {} : value.oauthClientSecrets;

  if (!isStringRecord(oauthClientSecrets)) {
    return false;
  }

  value.oauthClientSecrets = oauthClientSecrets;

  return true;
}

function emptyCredentialFile(): CredentialFile {
  return { apiKeys: {}, oauthClientSecrets: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
