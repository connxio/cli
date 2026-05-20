// const DEFAULT_API_BASE_URL = "https://api.connxio.com";
const DEFAULT_API_BASE_URL =
  "https://app-cx-qp-zelda-api.azurewebsites.net/api";

export function getDefaultApiBaseUrl(): string {
  return normalizeApiBaseUrl(
    process.env.CONNXIO_API_BASE_URL ?? DEFAULT_API_BASE_URL,
  );
}

export function normalizeApiBaseUrl(value: string): string {
  try {
    const url = new URL(value.trim());

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsupported protocol.");
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error("Connxio API base URL must be a valid HTTP or HTTPS URL.");
  }
}
