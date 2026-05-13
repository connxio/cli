# Agent Instructions

## Project Summary

This repository will contain the Connxio CLI, distributed as `@connxio/cli` with the executable `connxio`. The first implementation focus is an MCP server under `connxio mcp serve` so AI clients can interact with Connxio management APIs through natural language prompts.

## Current Priority

Implement an MCP-first TypeScript CLI, not a full general-purpose Connxio CLI yet.

Initial commands:

```bash
connxio mcp serve
connxio mcp context add
connxio mcp context list
connxio mcp context remove
connxio mcp context default
connxio mcp doctor
```

## Architecture Principles

- The `connxio` executable is the stable user-facing command.
- MCP functionality belongs under `connxio mcp ...`.
- The MCP server must be client-agnostic and work with Claude Code, Codex, VS Code, Claude Desktop, Cursor, and other MCP clients.
- The MCP server should call the public Connxio API over HTTP.
- Do not couple this project to VS Code APIs or any single MCP client.
- Use a monorepo layout so the core CLI, future VS Code extension, and agent plugin assets remain separate distributables.

## Context And Credentials

Connxio API keys are subscription-scoped. Users can have multiple subscriptions and companies, so the CLI needs named contexts.

Rules:

- A context represents one Connxio API key and subscription scope.
- Read-only tools can use the default context when available.
- Write tools should require `contextId`.
- Destructive tools should require `contextId` and `confirm: true`.
- If context selection is ambiguous, return a clear error asking the user to specify `contextId`.
- Never expose API keys to the model or logs.

## Initial MCP Tools

Prioritize read-only tools first:

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

Add writes only after read-only tools and context handling are stable.

## Relevant Connxio APIs

Use v2 management endpoints:

- `GET /v2/subscriptions`
- `GET /v2/integrations`
- `GET /v2/integrations/{id}`
- `GET /v2/codecomponents`
- `GET /v2/codecomponents/{id}`
- `GET /v2/codecomponents/{id}/versions`
- `GET /v2/environmentvariables`
- `GET /v2/securityconfigs`
- `GET /v2/securityconfigs/{id}`

Authentication header:

```http
Connxio-Api-Key: <api key>
```

## Coding Guidance

- Use TypeScript.
- Use Vite+ as the repository toolchain.
- Keep shared Vite+ configuration in the root `vite.config.ts`.
- Prefer `vp install`, `vp check`, `vp test`, `vp run`, and `vp pack` over direct package-manager or tool-specific commands when working in this repository.
- Configure CLI/package packaging through the Vite+ `pack` block rather than adding a separate `tsdown.config.ts` unless there is a concrete need.
- Prefer small modules with clear responsibilities.
- Use schema validation for tool inputs.
- Keep MCP tool outputs concise enough for model context.
- Return enough structured data for follow-up tool calls.
- Avoid broad generic HTTP passthrough tools unless explicitly requested.
- Do not implement destructive actions without explicit confirmation fields.
- Keep `AGENTS.md` up to date when new information, decisions, constraints, or implementation conventions are discovered during work.

## Repository Layout

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
- `extensions/vscode` is reserved for a future VS Code extension. Keep VS Code-specific APIs and UX out of the core CLI package.
- `plugins/agent` is reserved for cross-agent plugin packaging with skills and MCP config.
- `docs` contains client-specific setup documentation.

## Non-Goals For MVP

- Do not build a complete Connxio CLI yet.
- Do not build a hosted MCP server yet.
- Do not build client-specific plugins before the core MCP server works.
- Do not rely on VS Code-specific credential storage as the primary credential model.
