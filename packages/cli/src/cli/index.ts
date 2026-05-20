#!/usr/bin/env node
import { Command } from "commander";
import updateNotifier from "update-notifier";

import pkg from "../../package.json" with { type: "json" };

import { registerMcpCommands } from "./commands/mcp.js";
const notifier = updateNotifier({ pkg });
// Skip notification when running as MCP server — stdout is the stdio transport.
if (process.argv.slice(2).join(" ") !== "mcp serve") {
  notifier.notify();
}

export async function main(argv = process.argv): Promise<void> {
  const program = new Command();

  program.name("connxio").description("Connxio command-line tool.").version(pkg.version);

  registerMcpCommands(program);

  await program.parseAsync(argv);
}

main().catch((error: unknown) => {
  const message = formatError(error);
  console.error(message);
  process.exitCode = 1;
});

function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = error.cause instanceof Error ? `\nCause: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}
