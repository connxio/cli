# Connxio CLI and MCP Plan

## Direction

Build `Connxio.Cli` as the home of the future `connxio` command-line tool. The first product capability is a Connxio MCP server exposed under `connxio mcp ...`, so we avoid creating a separate `connxio-mcp` command that would need to be migrated later.

## Naming

- Repository: `Connxio.Cli`
- npm package: `@connxio/cli`
- Executable: `connxio`
- MCP server command: `connxio mcp serve`
- MCP server display name: `connxio`

## Initial User Experience

Users configure Connxio once through the CLI:

```bash
connxio mcp context add
connxio mcp context list
connxio mcp context default contoso-prod
connxio mcp doctor
```

MCP clients start the server with:

```bash
connxio mcp serve
```

Example client configurations:

```bash
claude mcp add --transport stdio connxio -- connxio mcp serve
codex mcp add connxio -- connxio mcp serve
```

```json
{
  "servers": {
    "connxio": {
      "type": "stdio",
      "command": "connxio",
      "args": ["mcp", "serve"]
    }
  }
}
```

## Why This Shape

- Works outside VS Code, including Claude Code, Codex, Claude Desktop, Cursor, and other MCP clients.
- Keeps Connxio-specific setup in one place instead of duplicating credentials in every MCP client config.
- Allows a future full CLI to grow naturally as `connxio integrations ...`, `connxio codecomponents ...`, etc.
- Keeps the MCP server as the first feature area, not a separate product line.

## Context Model

Connxio API keys are scoped to a specific subscription. The CLI/MCP must therefore support multiple named contexts, where each context maps to one Connxio API key and subscription scope.

Example conceptual config:

```json
{
  "defaultContext": "contoso-prod",
  "contexts": [
    {
      "id": "contoso-prod",
      "name": "Contoso / Production",
      "baseUrl": "https://api.connxio.com",
      "apiKeyRef": "contoso-prod"
    },
    {
      "id": "contoso-test",
      "name": "Contoso / Test",
      "baseUrl": "https://api.connxio.com",
      "apiKeyRef": "contoso-test"
    }
  ]
}
```

Principles:

- Read tools may use the default context when exactly one/default context is available.
- Write tools should require an explicit `contextId`.
- Destructive tools should require `contextId` and `confirm: true`.
- If multiple contexts exist and no default is configured, tools should return a clear ambiguity error.
- API keys should not be exposed to the model.

## Initial MCP Tool Scope

Start read-heavy and safe.

Initial read-only tools:

- `list_contexts`
- `get_current_context`
- `list_subscriptions`
- `list_integrations`
- `get_integration`
- `list_code_components`
- `get_code_component`
- `get_code_component_versions`
- `list_environment_variables`
- `list_security_configs`
- `get_security_config`

Safe write tools to consider after read-only tools are stable:

- `upsert_environment_variable`
- `rename_code_component`
- `deprecate_code_component`

Destructive tools should come last:

- `delete_integration`
- `delete_environment_variable`
- `delete_security_config`
- `delete_code_component`

## CLI Scope

Initial CLI commands should support MCP setup only:

```bash
connxio mcp serve
connxio mcp context add
connxio mcp context list
connxio mcp context remove
connxio mcp context default
connxio mcp doctor
```

Avoid building a full Connxio CLI in the first version. Full management commands can be added later if there is demand:

```bash
connxio integrations list
connxio integrations get <id>
connxio env list
connxio codecomponents list
```

## Repository Layout

Use a monorepo layout from the start so the core CLI, future VS Code extension, and agent plugin assets have clear ownership boundaries.

Suggested repository structure:

```text
packages/
  cli/
    package.json
    src/
      cli/
        index.ts
        commands/
          mcp.ts
      mcp/
        server.ts
        tools/
          contexts.ts
          integrations.ts
          code-components.ts
          environment-variables.ts
          security-configs.ts
          subscriptions.ts
      connxio/
        client.ts
        config.ts
        contexts.ts
        credentials.ts
extensions/
  vscode/
    package.json
    src/
plugins/
  agent/
    plugin.json
    .mcp.json
    skills/
docs/
  setup-claude-code.md
  setup-codex.md
  setup-vscode.md
```

Ownership:

- `packages/cli` owns the `@connxio/cli` package and `connxio` executable.
- `extensions/vscode` is reserved for a future VS Code Marketplace extension with VS Code-specific onboarding, commands, MCP registration, and optional UI.
- `plugins/agent` is reserved for cross-agent plugin packaging, including Connxio skills and MCP config for Claude Code, Codex, VS Code agent plugins, or similar clients.
- `docs` contains client-specific setup documentation.

Do not put VS Code extension code inside the CLI package. The extension is a different distributable and should remain optional for users of Claude Code, Codex, Claude Desktop, Cursor, and other clients.

## Suggested Technical Shape

Use TypeScript with the official MCP TypeScript SDK.

Use Vite+ as the repository toolchain. This is an intentional early-adopter choice while Vite+ is alpha, selected to keep monorepo tasks, checks, tests, and packaging under one workflow.

Vite+ workflow:

- Keep shared toolchain configuration in the root `vite.config.ts`.
- Use `vp install` for dependency installation.
- Use `vp check` for formatting, linting, and type checking.
- Use `vp test` for tests.
- Use `vp run` for workspace package scripts and monorepo task execution.
- Use `vp pack` for publishable package and CLI packaging, configured through the root `pack` block rather than a separate `tsdown.config.ts`.

Core dependencies to evaluate:

- `@modelcontextprotocol/sdk`
- `zod`
- CLI framework such as `commander` or `clipanion`
- Credential storage library, preferably OS keychain-backed if practical

## Packaging

Primary package:

```bash
npm install -g @connxio/cli
```

MCP client configs should use the stable `connxio mcp serve` command.

Later packaging options:

- Claude Code plugin with skills and MCP config.
- Codex plugin with skills and MCP config.
- VS Code agent plugin with skills and MCP config.
- Hosted HTTP MCP server when Connxio auth supports user/company/subscription selection cleanly.

## Roadmap

1. Scaffold TypeScript CLI package.
2. Implement `connxio mcp serve` with a minimal health/list-contexts tool.
3. Implement local context configuration.
4. Implement credential storage and `connxio mcp context add`.
5. Implement Connxio API client wrapper.
6. Add read-only management MCP tools.
7. Add `connxio mcp doctor` for setup diagnostics.
8. Add safe write MCP tools.
9. Document setup for Claude Code, Codex, VS Code, Claude Desktop, and Cursor.
10. Package agent plugins with Connxio workflow skills.

## Maintaining Project Context

When new project decisions, constraints, architecture context, or implementation conventions are established, update the relevant project context files so future agents have the latest information:

- `plan.md`
- `CLAUDE.md`
- `AGENTS.md`
