# Agent Instructions

## Project Summary

This repository will contain the Connxio CLI, distributed as `@connxio/cli` with the executable `connxio`. The first implementation focus is an MCP server under `connxio mcp serve` so AI clients can interact with Connxio management APIs through natural language prompts.

## Current Priority

Implement an MCP-first TypeScript CLI, not a full general-purpose Connxio CLI yet.

Initial commands:

```bash
connxio mcp serve
connxio auth configure
connxio auth status
connxio auth clear
connxio context add
connxio context list
connxio context remove
connxio context default
connxio mcp doctor
```

## Architecture Principles

- The `connxio` executable is the stable user-facing command.
- MCP functionality belongs under `connxio mcp ...`.
- The MCP server must be client-agnostic and work with Claude Code, Codex, VS Code, Claude Desktop, Cursor, and other MCP clients.
- The MCP server should call the public Connxio API over HTTP.
- Default Connxio API base URL is `https://api.connxio.com`; support `CONNXIO_API_BASE_URL` and `connxio context add --base-url` overrides.
- For local development against self-signed HTTPS endpoints, support `CONNXIO_INSECURE_TLS=true`. Never recommend this for production.
- Do not couple this project to VS Code APIs or any single MCP client.
- Use a monorepo layout so the core CLI, future VS Code extension, and agent plugin assets remain separate distributables.

## Context And Credentials

Connxio API keys are always subscription-scoped. Users can have multiple subscriptions and companies, so the CLI needs named contexts. A local context maps to one Connxio subscription and the API key for that subscription.

Rules:

- A context represents one Connxio subscription plus its API key reference.
- `connxio context add` should call `GET /v2/subscriptions/current` with the provided subscription-scoped API key and store that subscription/company metadata in config so users and tools can refer to subscriptions by name. There is no subscription selection step because each API key is linked to exactly one subscription.
- Read-only tools can use the default context when available.
- Write tools should require `contextId`.
- Destructive tools should require `contextId` and `confirm: true`.
- If context selection is ambiguous, return a clear error asking the user to specify `contextId`.
- Never expose API keys to the model or logs.
- Store non-secret context metadata in `${XDG_CONFIG_HOME:-~/.config}/connxio/config.json` on macOS/Linux and `%APPDATA%\connxio\config.json` on Windows.
- The config file stores credential references only. The initial implementation uses a local credential-store abstraction at the same config root; keep API key handling behind `packages/cli/src/connxio/credentials.ts` so it can move to OS keychain storage later without changing context consumers.
- The remote API requires OAuth client credentials in addition to the subscription API key. OAuth is configured once per developer/operator, not per subscription. Never ship Connxio-owned OAuth client secrets in the npm package or source code.
- OAuth can be configured with `connxio auth configure` or environment variables. `connxio auth configure` prompts for client id, scope, and client secret. Default token URL is `https://api.connxio.com/oauth/token`; default scope is `api://connxio/.default`. Environment overrides are `CONNXIO_OAUTH_CLIENT_ID`, `CONNXIO_OAUTH_CLIENT_SECRET`, optional `CONNXIO_OAUTH_TOKEN_URL`, and optional `CONNXIO_OAUTH_SCOPE`.
- Store OAuth client secret values through `packages/cli/src/connxio/credentials.ts`; store only OAuth metadata and secret references in config.

## Initial MCP Tools

Prioritize read-only tools first:

- `list_contexts`
- `get_current_context`
- `list_subscriptions`
- `get_current_subscription`
- `list_integrations`
- `get_integration`
- `list_code_components`
- `get_code_component`
- `get_code_component_versions`
- `list_environment_variables`
- `list_security_configs`
- `get_security_config`

Support all non-message v2 management operations. Exclude `/messages` tools for now.

Write tools require `contextId`. Destructive tools require `contextId` and `confirm: true`.

## Relevant Connxio APIs

Use v2 management endpoints under `/v2/...`:

- `GET /v2/subscriptions`
- `GET /v2/subscriptions/current`
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

V2 management calls should use `Accept: application/json; x-api-version=2.0` and `Content-Type: application/json; x-api-version=2.0` when sending JSON bodies.

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

## Distribution And Releases

- Publish the CLI as the public npm package `@connxio/cli`.
- The package must support global installation with `npm install -g @connxio/cli`.
- The package must support direct execution with `npx @connxio/cli`.
- Use manual SemVer initially. Stay in `0.x` until the CLI/MCP contracts are stable enough for customer use.
- Prefer npm trusted publishing from GitHub Actions for public releases, with npm provenance enabled.
- If publishing manually, scoped public packages need `npm publish --access public`.
- Require Node.js/npm for MVP distribution.
- Do not add an installer script yet.
- Do not add standalone binary packaging yet.
- Do not add Vite+/tsdown `exe` targets or `@tsdown/exe` yet.
- Use Vite+ `vp pack` for npm package builds only.

## Non-Goals For MVP

- Do not build a complete Connxio CLI yet.
- Do not build a hosted MCP server yet.
- Do not build client-specific plugins before the core MCP server works.
- Do not rely on VS Code-specific credential storage as the primary credential model.
