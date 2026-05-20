import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import updateNotifier from "update-notifier";

import pkg from "../../../package.json" with { type: "json" };

import { confirmSchema, withToolErrors } from "./shared.js";

const execFileAsync = promisify(execFile);

export function registerCliTools(server: McpServer): void {
  server.registerTool(
    "check_cli_update",
    {
      description:
        "Check whether a newer version of the Connxio CLI is available on npm. " +
        "Call this proactively to let the user know if an update is available.",
    },
    async () =>
      withToolErrors(async () => {
        const info = await updateNotifier({ pkg, updateCheckInterval: 0 }).fetchInfo();
        const updateAvailable = info.type !== "latest";
        return {
          current: info.current,
          latest: info.latest,
          updateAvailable,
          updateType: updateAvailable ? info.type : null,
          installCommand: updateAvailable ? `npm install -g ${pkg.name}` : null,
        };
      }),
  );

  server.registerTool(
    "install_cli_update",
    {
      description:
        "Install the latest version of the Connxio CLI via npm. " +
        "Only use after check_cli_update confirms an update is available. Requires confirm: true.",
      inputSchema: { confirm: confirmSchema },
    },
    async () =>
      withToolErrors(async () => {
        const { stdout, stderr } = await execFileAsync("npm", [
          "install",
          "-g",
          `${pkg.name}@latest`,
        ]);
        return { stdout: stdout.trim(), stderr: stderr.trim() };
      }),
  );
}
