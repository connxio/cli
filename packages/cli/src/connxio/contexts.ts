import { type ConnxioContextConfig, readConfig, writeConfig } from "./config.js";
import { hasApiKey } from "./credentials.js";

export type PublicContext = {
  baseUrl: string;
  companyId: string;
  companyName: string;
  hasCredential: boolean;
  id: string;
  isDefault: boolean;
  name: string;
  subscriptionId: string;
  subscriptionName: string;
};

export type AddContextInput = {
  baseUrl: string;
  companyId: string;
  companyName: string;
  id: string;
  name: string;
  setDefault?: boolean;
  subscriptionId: string;
  subscriptionName: string;
};

export class ConnxioContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnxioContextError";
  }
}

export async function addContext(input: AddContextInput): Promise<void> {
  const config = await readConfig();
  const context: ConnxioContextConfig = {
    apiKeyRef: input.id,
    baseUrl: input.baseUrl,
    companyId: input.companyId,
    companyName: input.companyName,
    id: input.id,
    name: input.name,
    subscriptionId: input.subscriptionId,
    subscriptionName: input.subscriptionName,
  };
  const existingIndex = config.contexts.findIndex((item) => item.id === input.id);

  if (existingIndex >= 0) {
    config.contexts[existingIndex] = context;
  } else {
    config.contexts.push(context);
  }

  if (input.setDefault || config.contexts.length === 1) {
    config.defaultContext = input.id;
  }

  await writeConfig(config);
}

export async function listPublicContexts(): Promise<PublicContext[]> {
  const config = await readConfig();

  return Promise.all(
    config.contexts.map(async (context) => ({
      baseUrl: context.baseUrl,
      companyId: context.companyId,
      companyName: context.companyName,
      hasCredential: await hasApiKey(context.apiKeyRef),
      id: context.id,
      isDefault: context.id === config.defaultContext,
      name: context.name,
      subscriptionId: context.subscriptionId,
      subscriptionName: context.subscriptionName,
    })),
  );
}

export async function removeContext(id: string): Promise<void> {
  const config = await readConfig();
  const nextContexts = config.contexts.filter((context) => context.id !== id);

  if (nextContexts.length === config.contexts.length) {
    throw new ConnxioContextError(`Context not found: ${id}`);
  }

  const nextConfig = {
    contexts: nextContexts,
    ...(config.defaultContext === id ? {} : { defaultContext: config.defaultContext }),
  };

  await writeConfig(nextConfig);
}

export async function resolveContext(id?: string): Promise<ConnxioContextConfig> {
  const config = await readConfig();

  if (id) {
    const context = config.contexts.find((item) => item.id === id);

    if (!context) {
      throw new ConnxioContextError(`Context not found: ${id}`);
    }

    return context;
  }

  if (config.defaultContext) {
    const context = config.contexts.find((item) => item.id === config.defaultContext);

    if (context) {
      return context;
    }

    throw new ConnxioContextError(`Default context not found: ${config.defaultContext}`);
  }

  if (config.contexts.length === 1) {
    const [context] = config.contexts;

    if (context) {
      return context;
    }
  }

  if (config.contexts.length === 0) {
    throw new ConnxioContextError("No contexts configured. Run `connxio context add`.");
  }

  throw new ConnxioContextError(
    "Multiple contexts exist and no default is configured. Specify contextId.",
  );
}

export async function setDefaultContext(id: string): Promise<void> {
  const config = await readConfig();

  if (!config.contexts.some((context) => context.id === id)) {
    throw new ConnxioContextError(`Context not found: ${id}`);
  }

  await writeConfig({ ...config, defaultContext: id });
}
