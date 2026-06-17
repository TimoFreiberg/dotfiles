/**
 * MCP Bridge Extension
 *
 * pi has no built-in MCP support ("It intentionally does not include built-in
 * MCP"). This extension bridges external MCP servers into pi: it reads a config
 * of stdio MCP servers, spawns each over stdio via the official
 * @modelcontextprotocol/sdk, lists each server's tools, and registers one pi
 * tool per MCP tool (named `mcp_<server>_<tool>`) whose `execute` forwards the
 * call to the server and maps the MCP content array back to pi's result shape.
 *
 * Design notes / v1 scope (see README in this dir):
 *  - STDIO transport ONLY. HTTP/SSE is a deliberate future follow-up — the SDK
 *    supports it (StreamableHTTPClientTransport / SSEClientTransport) but auth,
 *    callback servers, and lifecycle make it a much bigger surface.
 *  - One pi tool per MCP tool (not a single proxy tool). This keeps the call
 *    sites legible to the model; the cost is system-prompt bloat if a server
 *    exposes hundreds of tools. Mitigation: per-server `tools` allowlist in
 *    config. nicobailon/pi-mcp-adapter takes the opposite tradeoff (one unified
 *    `mcp` proxy tool) — worth revisiting if tool-count explosion bites.
 *  - Fail LOUD: a server that won't spawn or whose listTools() rejects surfaces
 *    a visible error notification rather than silently registering nothing.
 *  - Clean lifecycle: every transport is closed on `session_shutdown` so we
 *    never leak child processes across session reloads/quit.
 *
 * Security: a bridged server is an arbitrary executable that runs with the
 * environment this extension passes it (process env minus nothing, plus any
 * per-server `env`). Only list servers you trust. See README.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface ServerConfig {
  /** Executable to spawn (e.g. "npx"). Required. */
  command: string;
  /** Arguments passed to the command. */
  args?: string[];
  /** Extra environment variables merged over the inherited process env. */
  env?: Record<string, string>;
  /** Working directory for the spawned server. */
  cwd?: string;
  /**
   * Optional allowlist of MCP tool names to expose. When set, only these tools
   * are bridged (avoids tool-count explosion from servers with large surfaces).
   * Matches against the MCP tool's own name, before the `mcp_<server>_` prefix.
   */
  tools?: string[];
  /** When true, the server's stderr is inherited (visible) instead of ignored. */
  debug?: boolean;
}

interface BridgeConfig {
  servers: Record<string, ServerConfig>;
}

/** Resolve the pi agent dir, honoring PI_CODING_AGENT_DIR (with ~ expansion). */
function getAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return join(homedir(), ".config", "pi", "agent");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/"))
    return resolve(homedir(), configured.slice(2));
  return resolve(configured);
}

function getConfigPath(): string {
  // Explicit override wins so it can be tested without touching the live file.
  const override = process.env.PI_MCP_BRIDGE_CONFIG?.trim();
  if (override) return resolve(override);
  return join(getAgentDir(), "mcp-servers.json");
}

/**
 * Read and validate the bridge config. Returns null when the file is absent
 * (a normal, quiet "nothing to bridge" state). Throws — loudly — on a file
 * that exists but is malformed, so a broken config is never silently ignored.
 */
function loadConfig(path: string): BridgeConfig | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      `mcp-bridge: cannot read config at ${path}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `mcp-bridge: ${path} is not valid JSON: ${(err as Error).message}`,
    );
  }

  const servers = (parsed as BridgeConfig | undefined)?.servers;
  if (!servers || typeof servers !== "object") {
    throw new Error(
      `mcp-bridge: ${path} must have a top-level "servers" object`,
    );
  }
  for (const [name, cfg] of Object.entries(servers)) {
    if (!cfg || typeof cfg.command !== "string" || !cfg.command.trim()) {
      throw new Error(
        `mcp-bridge: server "${name}" must have a non-empty "command"`,
      );
    }
  }
  return { servers };
}

// ---------------------------------------------------------------------------
// MCP <-> pi mapping
// ---------------------------------------------------------------------------

/** A minimal shape for an MCP content block (the SDK's union is wider). */
interface McpContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: { uri?: string; text?: string; mimeType?: string };
  uri?: string;
  name?: string;
}

/** Map MCP tool-result content into pi's content-block array. */
function mapContent(
  content: McpContentBlock[] | undefined,
): Array<Record<string, unknown>> {
  if (!Array.isArray(content) || content.length === 0) {
    return [{ type: "text", text: "(no content)" }];
  }
  return content.map((c) => {
    if (c.type === "text") return { type: "text", text: c.text ?? "" };
    if (c.type === "image") {
      return {
        type: "image",
        data: c.data ?? "",
        mimeType: c.mimeType ?? "image/png",
      };
    }
    if (c.type === "resource") {
      const uri = c.resource?.uri ?? "(no uri)";
      const body = c.resource?.text ?? JSON.stringify(c.resource ?? {});
      return { type: "text", text: `[resource ${uri}]\n${body}` };
    }
    if (c.type === "resource_link") {
      return {
        type: "text",
        text: `[resource_link ${c.name ?? c.uri ?? "?"}] ${c.uri ?? ""}`,
      };
    }
    if (c.type === "audio") {
      return { type: "text", text: `[audio ${c.mimeType ?? "audio/*"}]` };
    }
    // Unknown block type: stringify so nothing is silently dropped.
    return { type: "text", text: JSON.stringify(c) };
  });
}

/**
 * MCP inputSchema is JSON Schema; pi params are typebox (which is JSON Schema
 * under the hood). Wrap the raw schema in Type.Unsafe so pi forwards it to the
 * model verbatim. Fall back to a permissive empty object when a server omits
 * its schema.
 */
function schemaToParams(inputSchema: unknown): ReturnType<typeof Type.Unsafe> {
  if (inputSchema && typeof inputSchema === "object") {
    return Type.Unsafe<Record<string, unknown>>(
      inputSchema as Record<string, unknown>,
    );
  }
  return Type.Unsafe<Record<string, unknown>>({
    type: "object",
    properties: {},
  });
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

interface LiveServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
}

export default function mcpBridgeExtension(pi: ExtensionAPI) {
  const live: LiveServer[] = [];

  pi.on("session_start", async (event, ctx) => {
    // Only spin up on a real session start, not on every reload churn beyond
    // what the framework already scopes. `live` is per extension instance.
    const configPath = getConfigPath();

    let config: BridgeConfig | null;
    try {
      config = loadConfig(configPath);
    } catch (err) {
      // Malformed config is a loud, actionable failure.
      ctx.ui.notify(`mcp-bridge: ${(err as Error).message}`, "error");
      return;
    }

    if (!config) {
      // No config file is the normal "I have nothing to bridge" case. Stay quiet.
      return;
    }

    const serverNames = Object.keys(config.servers);
    if (serverNames.length === 0) return;

    let registeredCount = 0;

    for (const name of serverNames) {
      const cfg = config.servers[name];
      let client: Client;
      let transport: StdioClientTransport;

      try {
        transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args ?? [],
          // Merge over inherited env so PATH etc. is present; per-server env wins.
          env: {
            ...(process.env as Record<string, string>),
            ...(cfg.env ?? {}),
          },
          cwd: cfg.cwd ? resolve(cfg.cwd) : undefined,
          stderr: cfg.debug ? "inherit" : "ignore",
        });
        client = new Client(
          { name: `pi-mcp-bridge-${name}`, version: "0.1.0" },
          { capabilities: {} },
        );
        await client.connect(transport);
      } catch (err) {
        // Fail loud per server, but keep bridging the others.
        ctx.ui.notify(
          `mcp-bridge: server "${name}" failed to start: ${(err as Error).message}`,
          "error",
        );
        continue;
      }

      let toolList: Awaited<ReturnType<Client["listTools"]>>;
      try {
        toolList = await client.listTools();
      } catch (err) {
        ctx.ui.notify(
          `mcp-bridge: listTools() failed for "${name}": ${(err as Error).message}`,
          "error",
        );
        await client.close().catch(() => {});
        continue;
      }

      live.push({ name, client, transport });

      const allow = cfg.tools ? new Set(cfg.tools) : null;
      for (const tool of toolList.tools) {
        if (allow && !allow.has(tool.name)) continue;

        const piToolName = `mcp_${name}_${tool.name}`;
        const description = tool.description
          ? `[MCP ${name}] ${tool.description}`
          : `[MCP ${name}] ${tool.name}`;

        pi.registerTool({
          name: piToolName,
          label: `MCP ${name}: ${tool.name}`,
          description,
          promptSnippet: `Call the ${tool.name} tool on MCP server ${name}`,
          parameters: schemaToParams(tool.inputSchema),
          async execute(_toolCallId, params, _signal, _onUpdate, _execCtx) {
            try {
              const result = await client.callTool({
                name: tool.name,
                arguments: (params ?? {}) as Record<string, unknown>,
              });
              const content = mapContent(
                result.content as McpContentBlock[] | undefined,
              );
              return {
                content,
                details: {
                  server: name,
                  tool: tool.name,
                  isError: result.isError ?? false,
                },
                // Surface MCP-reported tool errors to the model as an error result.
                isError: result.isError ?? false,
              };
            } catch (err) {
              return {
                content: [
                  {
                    type: "text",
                    text: `mcp-bridge: call to ${name}/${tool.name} failed: ${(err as Error).message}`,
                  },
                ],
                details: { server: name, tool: tool.name },
                isError: true,
              };
            }
          },
        });
        registeredCount++;
      }
    }

    if (registeredCount > 0) {
      ctx.ui.notify(
        `mcp-bridge: registered ${registeredCount} tool(s) from ${live.length} server(s)`,
        "info",
      );
    }
  });

  const shutdown = async (_event: unknown, _ctx: ExtensionContext) => {
    // Close every transport so we never leak spawned child processes.
    const closing = live.splice(0, live.length);
    await Promise.all(
      closing.map((s) =>
        s.client.close().catch(() => {
          // Best effort: closing the client also kills the stdio child.
        }),
      ),
    );
  };

  pi.on("session_shutdown", shutdown);
}
