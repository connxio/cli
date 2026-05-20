export function allowInsecureTlsIfLocal(url: URL): void {
  if (!isInsecureTlsAllowed() && !isLocalhost(url.hostname)) {
    return;
  }

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

export function getInsecureTlsHelp(): string {
  return "Localhost URLs allow self-signed certificates automatically. For other local development endpoints, set CONNXIO_INSECURE_TLS=true. Do not use this for production.";
}

function isInsecureTlsAllowed(): boolean {
  const value = process.env.CONNXIO_INSECURE_TLS?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
