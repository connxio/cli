import { readConfig, writeConfig } from "./config.js";
import {
  deleteOAuthClientSecret,
  getOAuthClientSecret,
  hasOAuthClientSecret,
  setOAuthClientSecret,
} from "./credentials.js";
import { allowInsecureTlsIfLocal, getInsecureTlsHelp } from "./http.js";

const OAUTH_CLIENT_SECRET_REF = "default";
export const DEFAULT_OAUTH_TOKEN_URL = "https://api.connxio.com/oauth/token";
export const DEFAULT_OAUTH_SCOPE = "api://connxio/.default";
const TOKEN_EXPIRY_SKEW_MS = 60_000;

type OAuthCredentials = {
  clientId: string;
  clientSecret: string;
  scope: string;
  source: "config" | "env";
  tokenUrl: string;
};

type CachedAccessToken = {
  expiresAt: number;
  token: string;
};

let cachedAccessToken: CachedAccessToken | undefined;

export type ConfigureOAuthInput = {
  clientId: string;
  clientSecret: string;
  scope: string;
};

export type OAuthStatus = {
  configured: boolean;
  hasClientSecret: boolean;
  scope?: string;
  source?: "config" | "env";
  tokenUrl?: string;
};

export async function configureOAuth(input: ConfigureOAuthInput): Promise<void> {
  const clientId = input.clientId.trim();
  const scope = normalizeScope(input.scope);

  if (!clientId) {
    throw new Error("OAuth client id cannot be empty.");
  }

  await setOAuthClientSecret(OAUTH_CLIENT_SECRET_REF, input.clientSecret);

  const config = await readConfig();
  await writeConfig({
    ...config,
    oauth: {
      clientId,
      clientSecretRef: OAUTH_CLIENT_SECRET_REF,
      scope,
    },
  });

  cachedAccessToken = undefined;
}

export async function clearOAuth(): Promise<void> {
  const config = await readConfig();
  const clientSecretRef = config.oauth?.clientSecretRef ?? OAUTH_CLIENT_SECRET_REF;
  const { oauth: _oauth, ...nextConfig } = config;

  await deleteOAuthClientSecret(clientSecretRef);
  await writeConfig(nextConfig);
  cachedAccessToken = undefined;
}

export async function getOAuthStatus(): Promise<OAuthStatus> {
  const envCredentials = getEnvOAuthCredentials();

  if (envCredentials) {
    return {
      configured: true,
      hasClientSecret: true,
      scope: envCredentials.scope,
      source: "env",
      tokenUrl: envCredentials.tokenUrl,
    };
  }

  const config = await readConfig();

  if (!config.oauth) {
    return { configured: false, hasClientSecret: false };
  }

  return {
    configured: true,
    hasClientSecret: await hasOAuthClientSecret(config.oauth.clientSecretRef),
    scope: config.oauth.scope ?? DEFAULT_OAUTH_SCOPE,
    source: "config",
    tokenUrl: config.oauth.tokenUrl ?? DEFAULT_OAUTH_TOKEN_URL,
  };
}

export async function getOAuthAccessToken(): Promise<string> {
  const now = Date.now();

  if (cachedAccessToken && cachedAccessToken.expiresAt > now + TOKEN_EXPIRY_SKEW_MS) {
    return cachedAccessToken.token;
  }

  const credentials = await resolveOAuthCredentials();
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: "client_credentials",
    scope: credentials.scope,
  });

  const tokenUrl = new URL(credentials.tokenUrl);
  allowInsecureTlsIfLocal(tokenUrl);
  const response = await fetch(tokenUrl, {
    body,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  }).catch((error: unknown) => {
    throw new Error(
      `Connxio OAuth token request failed before receiving a response: POST ${credentials.tokenUrl}: ${formatError(error)}`,
    );
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Connxio OAuth token request failed (${response.status} ${response.statusText}): ${text.slice(0, 500)}`,
    );
  }

  const token = parseTokenResponse(await response.json());
  cachedAccessToken = token;

  return token.token;
}

async function resolveOAuthCredentials(): Promise<OAuthCredentials> {
  const envCredentials = getEnvOAuthCredentials();

  if (envCredentials) {
    return envCredentials;
  }

  const config = await readConfig();

  if (!config.oauth) {
    throw new Error(
      "OAuth is not configured. Run `connxio auth configure` or set CONNXIO_OAUTH_TOKEN_URL, CONNXIO_OAUTH_CLIENT_ID, and CONNXIO_OAUTH_CLIENT_SECRET.",
    );
  }

  return {
    clientId: config.oauth.clientId,
    clientSecret: await getOAuthClientSecret(config.oauth.clientSecretRef),
    scope: config.oauth.scope ?? DEFAULT_OAUTH_SCOPE,
    source: "config",
    tokenUrl: config.oauth.tokenUrl ?? DEFAULT_OAUTH_TOKEN_URL,
  };
}

function getEnvOAuthCredentials(): OAuthCredentials | undefined {
  const tokenUrl = process.env.CONNXIO_OAUTH_TOKEN_URL?.trim();
  const clientId = process.env.CONNXIO_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.CONNXIO_OAUTH_CLIENT_SECRET?.trim();
  const scope = process.env.CONNXIO_OAUTH_SCOPE?.trim();

  if (!tokenUrl && !clientId && !clientSecret && !scope) {
    return undefined;
  }

  if (!clientId || !clientSecret) {
    throw new Error(
      "Incomplete OAuth environment configuration. Set CONNXIO_OAUTH_CLIENT_ID and CONNXIO_OAUTH_CLIENT_SECRET. CONNXIO_OAUTH_TOKEN_URL and CONNXIO_OAUTH_SCOPE are optional overrides.",
    );
  }

  return {
    clientId,
    clientSecret,
    scope: normalizeScope(scope),
    source: "env",
    tokenUrl: normalizeTokenUrl(tokenUrl ?? DEFAULT_OAUTH_TOKEN_URL),
  };
}

function normalizeScope(value: string | undefined): string {
  const scope = value?.trim() || DEFAULT_OAUTH_SCOPE;

  if (!scope) {
    throw new Error("OAuth scope cannot be empty.");
  }

  return scope;
}

function normalizeTokenUrl(value: string): string {
  try {
    const url = new URL(value.trim());

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsupported protocol.");
    }

    return url.toString();
  } catch {
    throw new Error("OAuth token URL must be a valid HTTP or HTTPS URL.");
  }
}

function parseTokenResponse(value: unknown): CachedAccessToken {
  if (!isRecord(value) || typeof value.access_token !== "string") {
    throw new Error("Connxio OAuth token response did not include an access token.");
  }

  const expiresIn = typeof value.expires_in === "number" ? value.expires_in : 3600;

  return {
    expiresAt: Date.now() + expiresIn * 1000,
    token: value.access_token,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = error.cause instanceof Error ? ` Cause: ${error.cause.message}` : "";
  const message = `${error.message}${cause}`;

  if (message.toLowerCase().includes("self-signed certificate")) {
    return `${message}. ${getInsecureTlsHelp()}`;
  }

  return message;
}
