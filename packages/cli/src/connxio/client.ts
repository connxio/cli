import { getOAuthAccessToken } from "./auth.js";
import { getApiKey } from "./credentials.js";
import { allowInsecureTlsIfLocal, getInsecureTlsHelp } from "./http.js";

export type ConnxioSubscription = {
  active: boolean;
  companyId: string;
  companyName: string;
  id: string;
  name: string;
};

export type ConnxioClientContext = {
  apiKeyRef: string;
  baseUrl: string;
};

export type ConnxioRequestOptions = {
  body?: unknown;
  query?: Record<string, boolean | number | string | undefined>;
};

export class ConnxioClient {
  readonly #context: ConnxioClientContext;

  constructor(context: ConnxioClientContext) {
    this.#context = context;
  }

  async get(path: string, options?: ConnxioRequestOptions): Promise<unknown> {
    return this.request("GET", path, options);
  }

  async post(path: string, options?: ConnxioRequestOptions): Promise<unknown> {
    return this.request("POST", path, options);
  }

  async put(path: string, options?: ConnxioRequestOptions): Promise<unknown> {
    return this.request("PUT", path, options);
  }

  async delete(path: string, options?: ConnxioRequestOptions): Promise<unknown> {
    return this.request("DELETE", path, options);
  }

  async request(
    method: "DELETE" | "GET" | "POST" | "PUT",
    path: string,
    options: ConnxioRequestOptions = {},
  ): Promise<unknown> {
    return requestWithApiKey(
      this.#context.baseUrl,
      method,
      path,
      await getApiKey(this.#context.apiKeyRef),
      options,
    );
  }

  async listSubscriptions(): Promise<ConnxioSubscription[]> {
    return listSubscriptionsWithApiKey(
      this.#context.baseUrl,
      await getApiKey(this.#context.apiKeyRef),
    );
  }

  async getCurrentSubscription(): Promise<ConnxioSubscription> {
    return getCurrentSubscriptionWithApiKey(
      this.#context.baseUrl,
      await getApiKey(this.#context.apiKeyRef),
    );
  }
}

export async function getCurrentSubscriptionWithApiKey(
  baseUrl: string,
  apiKey: string,
): Promise<ConnxioSubscription> {
  return parseSubscription(
    await requestWithApiKey(baseUrl, "GET", "/v2/subscriptions/current", apiKey),
  );
}

export async function listSubscriptionsWithApiKey(
  baseUrl: string,
  apiKey: string,
): Promise<ConnxioSubscription[]> {
  const data = await requestWithApiKey(baseUrl, "GET", "/v2/subscriptions", apiKey);

  if (!Array.isArray(data)) {
    throw new Error("Connxio subscriptions response was not an array.");
  }

  return data.map(parseSubscription);
}

async function requestWithApiKey(
  baseUrl: string,
  method: "DELETE" | "GET" | "POST" | "PUT",
  requestPath: string,
  apiKey: string,
  options: ConnxioRequestOptions = {},
): Promise<unknown> {
  const url = buildRequestUrl(baseUrl, requestPath);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const accessToken = await getOAuthAccessToken();
  allowInsecureTlsIfLocal(url);
  const headers: Record<string, string> = {
    Accept: "application/json; x-api-version=2.0",
    Authorization: `Bearer ${accessToken}`,
    "Connxio-Api-Key": apiKey,
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json; x-api-version=2.0";
  }

  const response = await fetch(url, {
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    headers,
    method,
    redirect: "manual",
  }).catch((error: unknown) => {
    throw new Error(
      `Connxio API request failed before receiving a response: ${method} ${url.toString()}: ${formatError(error)}`,
    );
  });

  debugRequest(method, url, headers, response.status);

  if (isRedirect(response.status)) {
    return followRedirect({
      headers,
      method,
      options,
      redirectCount: 0,
      response,
      url,
    });
  }

  return parseResponse(response);
}

async function followRedirect(input: {
  headers: Record<string, string>;
  method: "DELETE" | "GET" | "POST" | "PUT";
  options: ConnxioRequestOptions;
  redirectCount: number;
  response: Response;
  url: URL;
}): Promise<unknown> {
  if (input.redirectCount > 5) {
    throw new Error(`Connxio API request redirected too many times from ${input.url.toString()}.`);
  }

  const location = input.response.headers.get("location");

  if (!location) {
    throw new Error(
      `Connxio API request received redirect ${input.response.status} without a Location header from ${input.url.toString()}.`,
    );
  }

  const nextUrl = new URL(location, input.url);
  allowInsecureTlsIfLocal(nextUrl);

  const response = await fetch(nextUrl, {
    ...(input.options.body === undefined ? {} : { body: JSON.stringify(input.options.body) }),
    headers: input.headers,
    method: input.method,
    redirect: "manual",
  }).catch((error: unknown) => {
    throw new Error(
      `Connxio API request failed before receiving a response: ${input.method} ${nextUrl.toString()}: ${formatError(error)}`,
    );
  });

  debugRedirect(input.url, nextUrl, response.status);
  debugRequest(input.method, nextUrl, input.headers, response.status);

  if (isRedirect(response.status)) {
    return followRedirect({
      ...input,
      redirectCount: input.redirectCount + 1,
      response,
      url: nextUrl,
    });
  }

  return parseResponse(response);
}

async function parseResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Connxio API request failed (${response.status} ${response.statusText}): ${body.slice(0, 500)}${formatAuthFailureHeaders(response)}`,
    );
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function debugRequest(
  method: "DELETE" | "GET" | "POST" | "PUT",
  url: URL,
  headers: Record<string, string>,
  status: number,
): void {
  if (!isHttpDebugEnabled()) {
    return;
  }

  console.error(
    `[connxio:http] ${method} ${url.toString()} -> ${status}; headers: Authorization=${headers.Authorization ? "present" : "missing"}, Connxio-Api-Key=${headers["Connxio-Api-Key"] ? "present" : "missing"}, Accept=${headers.Accept}`,
  );
}

function debugRedirect(from: URL, to: URL, status: number): void {
  if (!isHttpDebugEnabled()) {
    return;
  }

  console.error(`[connxio:http] redirect ${from.toString()} -> ${to.toString()} -> ${status}`);
}

function formatAuthFailureHeaders(response: Response): string {
  if (response.status !== 401 && response.status !== 403) {
    return "";
  }

  const wwwAuthenticate = response.headers.get("www-authenticate");
  const requestId =
    response.headers.get("x-request-id") ?? response.headers.get("x-correlation-id");
  const parts = [
    wwwAuthenticate ? `WWW-Authenticate: ${wwwAuthenticate}` : undefined,
    requestId ? `Request id: ${requestId}` : undefined,
  ].filter((part) => part !== undefined);

  return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
}

function isHttpDebugEnabled(): boolean {
  const value = process.env.CONNXIO_DEBUG_HTTP?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function parseSubscription(value: unknown): ConnxioSubscription {
  if (!isRecord(value)) {
    throw new Error("Connxio subscriptions response contained an invalid subscription.");
  }

  if (
    typeof value.active !== "boolean" ||
    typeof value.companyId !== "string" ||
    typeof value.companyName !== "string" ||
    typeof value.id !== "string" ||
    typeof value.name !== "string"
  ) {
    throw new Error("Connxio subscriptions response contained an invalid subscription.");
  }

  return {
    active: value.active,
    companyId: value.companyId,
    companyName: value.companyName,
    id: value.id,
    name: value.name,
  };
}

function buildRequestUrl(baseUrl: string, requestPath: string): URL {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = requestPath.startsWith("/") ? requestPath.slice(1) : requestPath;

  return new URL(normalizedPath, normalizedBaseUrl);
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
