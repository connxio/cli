import { Command, InvalidArgumentError } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  DEFAULT_OAUTH_SCOPE,
  clearOAuth,
  configureOAuth,
  getOAuthStatus,
} from "../../connxio/auth.js";
import { getDefaultApiBaseUrl, normalizeApiBaseUrl } from "../../connxio/base-url.js";
import { getCurrentSubscriptionWithApiKey } from "../../connxio/client.js";
import { getConfigPath } from "../../connxio/config.js";
import {
  addContext,
  listPublicContexts,
  removeContext,
  resolveContext,
  setDefaultContext,
} from "../../connxio/contexts.js";
import {
  deleteApiKey,
  getCredentialStoreDescription,
  hasApiKey,
  setApiKey,
} from "../../connxio/credentials.js";
import { serveMcp } from "../../mcp/server.js";

type ContextAddOptions = {
  apiKey?: string;
  baseUrl?: string;
  default?: boolean;
  name?: string;
};

type AuthConfigureOptions = {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
};

type ListOptions = {
  json?: boolean;
};

type RemoveOptions = {
  keepCredential?: boolean;
};

export function registerMcpCommands(program: Command): void {
  const mcp = program.command("mcp").description("Manage and run the Connxio MCP server.");

  mcp
    .command("serve")
    .description("Start the Connxio MCP server over stdio.")
    .action(async () => {
      await serveMcp();
    });

  const context = program.command("context").description("Manage Connxio contexts.");

  const auth = program.command("auth").description("Manage global Connxio OAuth credentials.");

  auth
    .command("configure")
    .description("Configure developer-local OAuth client credentials.")
    .option("--client-id <id>", "OAuth client id.")
    .option("--client-secret <secret>", "OAuth client secret. Prefer interactive input.")
    .option("--scope <scope>", `OAuth scope. Defaults to ${DEFAULT_OAUTH_SCOPE}.`)
    .action(async (options: AuthConfigureOptions) => {
      const clientId = options.clientId ?? (await promptVisible("OAuth client id: "));
      const scope =
        (options.scope ?? (await promptVisible(`OAuth scope [${DEFAULT_OAUTH_SCOPE}]: `))) ||
        DEFAULT_OAUTH_SCOPE;
      const clientSecret =
        options.clientSecret ??
        process.env.CONNXIO_OAUTH_CLIENT_SECRET ??
        (await promptHidden(
          "OAuth client secret: ",
          "CONNXIO_OAUTH_CLIENT_SECRET or --client-secret is required when stdin/stdout is not interactive.",
        ));

      await configureOAuth({ clientId, clientSecret, scope });

      console.log("OAuth configured.");
    });

  auth
    .command("status")
    .description("Show OAuth configuration status without exposing secrets.")
    .action(async () => {
      const status = await getOAuthStatus();

      if (!status.configured) {
        console.log("OAuth is not configured. Run `connxio auth configure`.");
        return;
      }

      console.log(`OAuth source: ${status.source}`);
      console.log(`OAuth token URL: ${status.tokenUrl}`);
      console.log(`OAuth scope: ${status.scope}`);
      console.log(`OAuth client secret: ${status.hasClientSecret ? "configured" : "missing"}`);
    });

  auth
    .command("clear")
    .description("Clear stored OAuth configuration and client secret.")
    .action(async () => {
      await clearOAuth();
      console.log("OAuth configuration cleared.");
    });

  context
    .command("add")
    .description("Add or update a Connxio context.")
    .argument("[id]", "Context identifier, for example contoso-prod.")
    .option("--name <name>", "Human-readable context name.")
    .option(
      "--base-url <url>",
      "Connxio API base URL. Defaults to CONNXIO_API_BASE_URL or https://api.connxio.com.",
    )
    .option("--api-key <apiKey>", "Connxio API key. Prefer interactive input or CONNXIO_API_KEY.")
    .option("--default", "Make this context the default context.")
    .action(async (id: string | undefined, options: ContextAddOptions) => {
      const baseUrl = normalizeApiBaseUrl(options.baseUrl ?? getDefaultApiBaseUrl());
      const apiKey =
        options.apiKey ??
        process.env.CONNXIO_API_KEY ??
        (await promptHidden(
          "Connxio API key: ",
          "CONNXIO_API_KEY or --api-key is required when stdin/stdout is not interactive.",
        ));
      const subscription = await getCurrentSubscriptionWithApiKey(baseUrl, apiKey);
      ensureActiveSubscription(subscription);
      const defaultContextId = slugify(subscription.name);
      const contextId = validateContextId(
        id ?? ((await promptVisible(`Context id [${defaultContextId}]: `)) || defaultContextId),
      );
      const name = options.name ?? subscription.name;

      await addContext({
        baseUrl,
        companyId: subscription.companyId,
        companyName: subscription.companyName,
        id: contextId,
        name: name.trim() || contextId,
        ...(options.default === undefined ? {} : { setDefault: options.default }),
        subscriptionId: subscription.id,
        subscriptionName: subscription.name,
      });
      await setApiKey(contextId, apiKey);

      console.log(
        `Context added: ${contextId} (${subscription.companyName} / ${subscription.name})`,
      );
    });

  context
    .command("list")
    .description("List configured Connxio contexts.")
    .option("--json", "Print contexts as JSON.")
    .action(async (options: ListOptions) => {
      const contexts = await listPublicContexts();

      if (options.json) {
        console.log(JSON.stringify(contexts, null, 2));
        return;
      }

      if (contexts.length === 0) {
        console.log("No Connxio contexts configured. Run `connxio context add`.");
        return;
      }

      for (const context of contexts) {
        const marker = context.isDefault ? "*" : " ";
        const credential = context.hasCredential ? "credential: yes" : "credential: missing";
        console.log(
          `${marker} ${context.id}  ${context.companyName} / ${context.subscriptionName}  ${context.baseUrl}  ${credential}`,
        );
      }
    });

  context
    .command("remove")
    .description("Remove a Connxio context.")
    .argument("<id>", "Context identifier to remove.")
    .option("--keep-credential", "Keep the stored credential for this context.")
    .action(async (id: string, options: RemoveOptions) => {
      const contextId = validateContextId(id);
      await removeContext(contextId);

      if (!options.keepCredential) {
        await deleteApiKey(contextId);
      }

      console.log(`Context removed: ${contextId}`);
    });

  context
    .command("default")
    .description("Show or set the default Connxio context.")
    .argument("[id]", "Context identifier to make default.")
    .action(async (id: string | undefined) => {
      if (!id) {
        const context = await resolveContext();
        console.log(context.id);
        return;
      }

      const contextId = validateContextId(id);
      await setDefaultContext(contextId);
      console.log(`Default context: ${contextId}`);
    });

  mcp
    .command("doctor")
    .description("Check Connxio MCP configuration health.")
    .action(async () => {
      const contexts = await listPublicContexts();
      const oauth = await getOAuthStatus();
      const problems: string[] = [];

      console.log(`Config: ${getConfigPath()}`);
      console.log(`Credential store: ${getCredentialStoreDescription()}`);

      if (!oauth.configured) {
        problems.push("OAuth is not configured. Run `connxio auth configure`.");
      } else if (!oauth.hasClientSecret) {
        problems.push("OAuth client secret is missing. Run `connxio auth configure`.");
      }

      if (contexts.length === 0) {
        problems.push("No contexts configured. Run `connxio context add`.");
      }

      for (const context of contexts) {
        if (!(await hasApiKey(context.id))) {
          problems.push(`Missing credential for context ${context.id}.`);
        }
      }

      if (problems.length === 0) {
        console.log("OK: Connxio MCP configuration looks ready.");
        return;
      }

      for (const problem of problems) {
        console.log(`Problem: ${problem}`);
      }

      process.exitCode = 1;
    });
}

function ensureActiveSubscription(subscription: { active: boolean }): void {
  if (!subscription.active) {
    throw new Error("No active Connxio subscriptions are available for this API key.");
  }
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "connxio";
}

function validateContextId(value: string): string {
  const id = value.trim();

  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new InvalidArgumentError(
      "Context id may only contain letters, numbers, dots, underscores, and dashes.",
    );
  }

  return id;
}

async function promptVisible(label: string): Promise<string> {
  const rl = createInterface({ input, output });

  try {
    return (await rl.question(label)).trim();
  } finally {
    rl.close();
  }
}

async function promptHidden(label: string, nonInteractiveMessage: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error(nonInteractiveMessage);
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";

    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    };

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");

      for (const char of text) {
        if (char === "\r" || char === "\n") {
          stdout.write("\n");
          cleanup();
          resolve(value);
          return;
        }

        if (char === "\u0003") {
          cleanup();
          reject(new Error("Input cancelled."));
          return;
        }

        if (char === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }

        value += char;
      }
    };

    stdout.write(label);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.on("data", onData);
  });
}
