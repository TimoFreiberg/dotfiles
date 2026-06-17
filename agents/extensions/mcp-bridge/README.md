# mcp-bridge

Bridges external **stdio** MCP servers into pi as native tools. pi has no
built-in MCP ("It intentionally does not include built-in MCP"); this extension
fills that gap with a small, self-contained adapter.

On `session_start` it reads a config of MCP servers, spawns each over stdio via
the official `@modelcontextprotocol/sdk`, lists each server's tools, and
registers one pi tool per MCP tool named `mcp_<server>_<tool>`. Each call is
forwarded to the server and the MCP content array is mapped back into pi's
result shape. All transports are closed on `session_shutdown` (no leaked child
processes).

## Install deps

This extension ships its own dependency (`@modelcontextprotocol/sdk`). pi runs
`npm install` automatically when a package is installed from npm/git. For a
local checkout, install once:

```bash
cd agents/extensions/mcp-bridge && npm install
```

`node_modules/` is gitignored — it is never committed.

## Config

Live config file (created by you, NOT in this repo):

```
$PI_CODING_AGENT_DIR/mcp-servers.json
```

Default when `PI_CODING_AGENT_DIR` is unset: `~/.config/pi/agent/mcp-servers.json`.
Override the path entirely with `PI_MCP_BRIDGE_CONFIG=/some/file.json` (handy for
testing without touching the live file).

Shape (see `mcp-servers.example.json`):

```json
{
  "servers": {
    "<name>": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": { "API_TOKEN": "..." },
      "cwd": "/optional/working/dir",
      "tools": ["read_text_file", "list_directory"],
      "debug": false
    }
  }
}
```

- `command` (required) + `args`: how to spawn the server.
- `env`: merged over the inherited process env (per-server values win).
- `cwd`: working directory for the spawned server.
- `tools`: optional allowlist of MCP tool names to expose. Omit to expose all.
  Use this to avoid system-prompt bloat from servers with large tool surfaces.
- `debug`: when true, the server's stderr is inherited (visible) for debugging.

A missing config file is the quiet "nothing to bridge" case. A config file that
exists but is malformed fails LOUD (visible error), as does a server that won't
spawn or whose `listTools()` rejects — by design, so a broken bridge is never
silently empty.

## Try it

```bash
PI_MCP_BRIDGE_CONFIG=$PWD/mcp-servers.example.json \
  pi --no-extensions -e ./index.ts -p "list your tools, then call mcp_filesystem_list_directory on /tmp"
```

## v1 limitations / follow-ups

- **STDIO transport only.** HTTP/SSE is a deliberate future add (the SDK has
  `StreamableHTTPClientTransport` / `SSEClientTransport`, but auth + callback
  servers are a much larger surface).
- **No resources/prompts/sampling/elicitation/OAuth.** Tools only. If you need
  the full feature set, the published `pi-mcp-adapter` npm package
  (nicobailon/pi-mcp-adapter, MIT) covers all of it — install it rather than
  growing this.
- **One pi tool per MCP tool.** Legible to the model but can bloat the prompt
  for large servers; mitigate with the `tools` allowlist, or revisit toward a
  single proxy tool if it becomes a problem.

## Security

Each bridged server is an arbitrary executable that runs with your environment
(inherited process env plus any per-server `env`). Only list servers you trust.
Treat `mcp-servers.json` like any file that can launch code on your machine.
