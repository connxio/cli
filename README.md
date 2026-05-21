# Connxio CLI

Connxio CLI provides the `connxio` command and an MCP server for Connxio management APIs.

The current implementation focuses on MCP usage through:

```bash
connxio mcp serve
```

## Prerequisites

- Node.js 24 or newer
- Connxio OAuth client credentials
- A Connxio subscription-scoped API key for each subscription context you want to use

## Install

Install the CLI globally from npm:

```bash
npm i -g @connxio/cli
```

Verify installation:

```bash
connxio --help
```

## Configure OAuth

```bash
connxio auth configure
```

You will be prompted for:

- OAuth client id
- OAuth scope, defaulting to `api://connxio/.default`
- OAuth client secret

Check status:

```bash
connxio auth status
```

Clear OAuth configuration:

```bash
connxio auth clear
```

You can also configure OAuth with environment variables:

```bash
CONNXIO_OAUTH_CLIENT_ID="<client-id>"
CONNXIO_OAUTH_CLIENT_SECRET="<client-secret>"
CONNXIO_OAUTH_TOKEN_URL="https://api.connxio.com/oauth/token"
CONNXIO_OAUTH_SCOPE="api://connxio/.default"
```

`CONNXIO_OAUTH_TOKEN_URL` and `CONNXIO_OAUTH_SCOPE` are optional overrides.

## Configure Contexts

A context represents one Connxio subscription. Connxio API keys are subscription-scoped, so add one context for each subscription you want to use.

```bash
connxio context add
```

The CLI calls `/v2/subscriptions/current` with the provided API key and stores the subscription/company metadata locally. API keys are stored through the credential abstraction, not in `config.json`.

List contexts:

```bash
connxio context list
```

Set a default context:

```bash
connxio context default <context-id>
```

Remove a context:

```bash
connxio context remove <context-id>
```

## Register With VS Code

VS Code 1.99+ supports MCP servers natively via GitHub Copilot agent mode.

**Option 1 — user settings (all projects)**

Open the command palette (`Ctrl+Shift+P`/`Cmd+Shift+P`) and select `MCP: Add server`.

Select `stdio` transport, `connxio mcp serve` as the command, and set the name to `connxio`. This will create a user-level MCP server registration that is available in all projects.

Alternatively, edit the user level mcp.json config file directly. Open the command palette and select `MCP: Open User Configuration`, then add:

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

**Option 2 — workspace settings (this project only)**

Create `.vscode/mcp.json` in your project root:

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

The Connxio MCP server will now be available when you open this project in VS Code.

If you need to pass environment variables (e.g. for OAuth or a custom API base URL), add an `env` block:

```json
{
  "servers": {
    "connxio": {
      "type": "stdio",
      "command": "connxio",
      "args": ["mcp", "serve"],
      "env": {
        "CONNXIO_OAUTH_CLIENT_ID": "<client-id>",
        "CONNXIO_OAUTH_CLIENT_SECRET": "<client-secret>"
      }
    }
  }
}
```

Do not commit files containing OAuth client secrets to source control.

## Register With Claude Code

Register the installed MCP server:

```bash
claude mcp add --transport stdio connxio -- connxio mcp serve
```

To register the MCP server at user level (available in all projects), add `--scope user`:

```bash
claude mcp add --scope user --transport stdio connxio -- connxio mcp serve
```

Verify registration:

```bash
claude mcp list
```

If you need to replace an existing registration:

```bash
claude mcp remove connxio
claude mcp add --transport stdio connxio -- connxio mcp serve
```

## API Base URL

The default API base URL is:

```text
https://api.connxio.com
```

Override it per context:

```bash
connxio context add --base-url http://localhost:5119/api
```

Or with an environment variable:

```bash
CONNXIO_API_BASE_URL="http://localhost:5119/api"
```

For localhost development with self-signed HTTPS certificates, the CLI automatically allows insecure TLS for localhost URLs. For other local development endpoints, use:

```bash
CONNXIO_INSECURE_TLS=true
```

Do not use insecure TLS settings in production.

## Run Diagnostics

```bash
connxio mcp doctor
```

For HTTP troubleshooting, enable redacted request diagnostics:

```bash
CONNXIO_DEBUG_HTTP=true connxio mcp doctor
```

## MCP Tools

The MCP server exposes non-message Connxio v2 management operations.

Context and subscription tools:

- `list_contexts`
- `get_current_context`
- `list_subscriptions`
- `get_current_subscription`

Integration tools:

- `list_integrations`
- `get_integration`
- `create_integration`
- `create_integration_no_validation`
- `update_integration`
- `delete_integration`

Code component tools:

- `list_code_components`
- `get_code_component`
- `get_code_component_versions`
- `create_code_component`
- `deprecate_code_component`
- `rename_code_component`
- `delete_code_component`

Environment variable tools:

- `list_environment_variables`
- `get_environment_variable`
- `create_environment_variable`
- `delete_environment_variable`

Security configuration tools:

- `list_security_configs`
- `get_security_config`
- `create_security_config`
- `delete_security_config`

Write tools require `contextId`. Destructive tools require `contextId` and `confirm: true`.

`/messages` operations are intentionally not exposed yet.

## Local Config Files

Non-secret config is stored in:

- macOS/Linux: `${XDG_CONFIG_HOME:-~/.config}/connxio/config.json`
- Windows: `%APPDATA%\connxio\config.json`

Secrets are stored through the CLI credential abstraction. The CLI now uses the OS keyring when available and falls back to `${XDG_CONFIG_HOME:-~/.config}/connxio/credentials.json` on macOS/Linux or `%APPDATA%\connxio\credentials.json` on Windows when secure storage is unavailable.

If you already have secrets in `credentials.json`, the CLI migrates them into the OS keyring lazily as they are used and removes the legacy file entries after a successful migration.
