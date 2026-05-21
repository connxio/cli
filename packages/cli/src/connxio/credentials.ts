import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getConfigDir } from "./config.js";

const KEYRING_SERVICE_NAME = "com.connxio.cli";

type CredentialFile = {
  apiKeys: Record<string, string>;
  oauthClientSecrets: Record<string, string>;
};

type CredentialKind = "apiKey" | "oauthClientSecret";

type CredentialBackend = {
  description: string;
  type: "file" | "keyring";
  delete(kind: CredentialKind, ref: string): Promise<void>;
  get(kind: CredentialKind, ref: string): Promise<string | undefined>;
  has(kind: CredentialKind, ref: string): Promise<boolean>;
  set(kind: CredentialKind, ref: string, value: string): Promise<void>;
};

type KeyringEntry = {
  deleteCredential(signal?: AbortSignal | null): Promise<boolean>;
  getPassword(signal?: AbortSignal | null): Promise<string | undefined>;
  setPassword(password: string, signal?: AbortSignal | null): Promise<void>;
};

type KeyringModule = {
  AsyncEntry: new (service: string, username: string) => KeyringEntry;
  findCredentialsAsync(
    service: string,
    target?: string | null,
    signal?: AbortSignal | null,
  ): Promise<unknown>;
};

let credentialBackendPromise: Promise<CredentialBackend> | undefined;
let fileFallbackWarningEmitted = false;

export async function getCredentialStoreDescription(): Promise<string> {
  return (await getCredentialBackend()).description;
}

export async function deleteApiKey(ref: string): Promise<void> {
  await deleteCredential("apiKey", ref);
}

export async function deleteOAuthClientSecret(ref: string): Promise<void> {
  await deleteCredential("oauthClientSecret", ref);
}

export async function getApiKey(ref: string): Promise<string> {
  return getCredential("apiKey", ref);
}

export async function getOAuthClientSecret(ref: string): Promise<string> {
  return getCredential("oauthClientSecret", ref);
}

export async function hasApiKey(ref: string): Promise<boolean> {
  return hasCredential("apiKey", ref);
}

export async function hasOAuthClientSecret(ref: string): Promise<boolean> {
  return hasCredential("oauthClientSecret", ref);
}

export async function setApiKey(ref: string, apiKey: string): Promise<void> {
  await setCredential("apiKey", ref, apiKey);
}

export async function setOAuthClientSecret(ref: string, clientSecret: string): Promise<void> {
  await setCredential("oauthClientSecret", ref, clientSecret);
}

async function deleteCredential(kind: CredentialKind, ref: string): Promise<void> {
  const backend = await getCredentialBackend();

  await backend.delete(kind, ref);

  if (backend.type === "keyring") {
    await deleteLegacyCredentialQuietly(kind, ref);
  }
}

async function getCredential(kind: CredentialKind, ref: string): Promise<string> {
  const backend = await getCredentialBackend();
  const credential = await backend.get(kind, ref);

  if (credential) {
    return credential;
  }

  if (backend.type === "keyring") {
    const legacyCredential = await fileCredentialBackend.get(kind, ref);

    if (legacyCredential) {
      await backend.set(kind, ref, legacyCredential);
      await deleteLegacyCredentialQuietly(kind, ref);
      return legacyCredential;
    }
  }

  throw new Error(getMissingCredentialMessage(kind, ref));
}

async function getCredentialBackend(): Promise<CredentialBackend> {
  credentialBackendPromise ??= resolveCredentialBackend();
  return credentialBackendPromise;
}

function getCredentialFileKey(kind: CredentialKind): keyof CredentialFile {
  return kind === "apiKey" ? "apiKeys" : "oauthClientSecrets";
}

function getKeyringAccountName(kind: CredentialKind, ref: string): string {
  return kind === "apiKey" ? `api-key:${ref}` : `oauth-client-secret:${ref}`;
}

function getMissingCredentialMessage(kind: CredentialKind, ref: string): string {
  return kind === "apiKey"
    ? `Missing credential for context ${ref}. Run \`connxio context add ${ref}\`.`
    : "Missing OAuth client secret. Run `connxio auth configure`.";
}

async function hasCredential(kind: CredentialKind, ref: string): Promise<boolean> {
  const backend = await getCredentialBackend();

  if (await backend.has(kind, ref)) {
    return true;
  }

  return backend.type === "keyring" ? fileCredentialBackend.has(kind, ref) : false;
}

function normalizeKeyringModule(value: unknown): KeyringModule {
  const candidate = isRecord(value) ? value : undefined;
  const defaultCandidate =
    candidate &&
    Object.prototype.hasOwnProperty.call(candidate, "default") &&
    isRecord(candidate["default"])
      ? candidate["default"]
      : undefined;
  const normalizedCandidate = defaultCandidate ? { ...defaultCandidate, ...candidate } : candidate;

  if (
    !normalizedCandidate ||
    typeof normalizedCandidate.AsyncEntry !== "function" ||
    typeof normalizedCandidate.findCredentialsAsync !== "function"
  ) {
    throw new Error("@napi-rs/keyring did not expose the expected API.");
  }

  return {
    AsyncEntry: normalizedCandidate.AsyncEntry as KeyringModule["AsyncEntry"],
    findCredentialsAsync:
      normalizedCandidate.findCredentialsAsync as KeyringModule["findCredentialsAsync"],
  };
}

async function resolveCredentialBackend(): Promise<CredentialBackend> {
  try {
    const keyring = normalizeKeyringModule(await import("@napi-rs/keyring"));
    await keyring.findCredentialsAsync(KEYRING_SERVICE_NAME);
    return createKeyringCredentialBackend(keyring);
  } catch (error: unknown) {
    warnFileFallback(error);
    return fileCredentialBackend;
  }
}

async function setCredential(kind: CredentialKind, ref: string, value: string): Promise<void> {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(
      kind === "apiKey" ? "API key cannot be empty." : "OAuth client secret cannot be empty.",
    );
  }

  const backend = await getCredentialBackend();
  await backend.set(kind, ref, trimmed);

  if (backend.type === "keyring") {
    await deleteLegacyCredentialQuietly(kind, ref);
  }
}

function warnFileFallback(error: unknown): void {
  if (fileFallbackWarningEmitted) {
    return;
  }

  fileFallbackWarningEmitted = true;
  console.warn(
    `Connxio secure credential storage unavailable; falling back to local file storage at ${getCredentialPath()}: ${formatError(error)}`,
  );
}

async function deleteLegacyCredentialQuietly(kind: CredentialKind, ref: string): Promise<void> {
  try {
    await fileCredentialBackend.delete(kind, ref);
  } catch {
    // Keyring writes should not fail just because legacy file cleanup did.
  }
}

function createKeyringCredentialBackend(keyring: KeyringModule): CredentialBackend {
  const get = async (kind: CredentialKind, ref: string): Promise<string | undefined> => {
    const entry = new keyring.AsyncEntry(KEYRING_SERVICE_NAME, getKeyringAccountName(kind, ref));
    const credential = await entry.getPassword();
    return typeof credential === "string" && credential.length > 0 ? credential : undefined;
  };

  return {
    description: "OS keyring",
    type: "keyring",
    async delete(kind, ref) {
      const entry = new keyring.AsyncEntry(KEYRING_SERVICE_NAME, getKeyringAccountName(kind, ref));

      if ((await get(kind, ref)) === undefined) {
        return;
      }

      await entry.deleteCredential();
    },
    get,
    async has(kind, ref) {
      return (await get(kind, ref)) !== undefined;
    },
    async set(kind, ref, value) {
      const entry = new keyring.AsyncEntry(KEYRING_SERVICE_NAME, getKeyringAccountName(kind, ref));
      await entry.setPassword(value);
    },
  };
}

const fileCredentialBackend: CredentialBackend = {
  description: `local file (${getCredentialPath()})`,
  type: "file",
  async delete(kind, ref) {
    const store = await readCredentialFile();
    delete store[getCredentialFileKey(kind)][ref];
    await writeCredentialFile(store);
  },
  async get(kind, ref) {
    const store = await readCredentialFile();
    const credential = store[getCredentialFileKey(kind)][ref];
    return typeof credential === "string" && credential.length > 0 ? credential : undefined;
  },
  async has(kind, ref) {
    const store = await readCredentialFile();
    const credential = store[getCredentialFileKey(kind)][ref];
    return typeof credential === "string" && credential.length > 0;
  },
  async set(kind, ref, value) {
    const store = await readCredentialFile();
    store[getCredentialFileKey(kind)][ref] = value;
    await writeCredentialFile(store);
  },
};

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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
