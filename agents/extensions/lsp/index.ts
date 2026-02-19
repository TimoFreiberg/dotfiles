/**
 * LSP extension for pi.
 *
 * Provides a single `lsp` tool with actions: hover, definition, references,
 * symbols, workspace_symbols. Connects lazily to language servers via lspmux
 * or directly. Reads config from .pi/lsp.json or .zed/settings.json.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  truncateHead,
  formatSize,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";

import { LspClient } from "./client.js";
import {
  findConfigPath,
  loadConfig,
  serverForFile,
  languageIdForFile,
  type LspConfig,
  type ServerConfig,
} from "./config.js";

export default function (pi: ExtensionAPI) {
  // One LspClient per server name (e.g. "rust-analyzer", "clangd")
  const clients = new Map<string, LspClient>();
  // Tracks in-flight server starts to avoid duplicate spawns from concurrent calls
  const starting = new Map<string, Promise<LspClient>>();
  let config: LspConfig | null = null;
  let configPath: string | null = null;
  let configMtime: number = 0;
  let configLoadedOnce = false;
  let configWarning: string | null = null;

  // --- Config loading ---

  function ensureConfig(projectRoot: string): LspConfig | null {
    configWarning = null;
    const currentPath = findConfigPath(projectRoot);

    // Determine if we need to reload
    let needsReload = !configLoadedOnce;
    if (!needsReload) {
      if (currentPath !== configPath) {
        // Config file appeared, disappeared, or switched
        needsReload = true;
      } else if (currentPath) {
        try {
          const mtime = statSync(currentPath).mtimeMs;
          if (mtime !== configMtime) needsReload = true;
        } catch {
          needsReload = true;
        }
      }
    }

    if (!needsReload) return config;

    // Reload
    configLoadedOnce = true;
    configPath = currentPath;

    if (!currentPath) {
      config = null;
      configMtime = 0;
      return null;
    }

    try {
      configMtime = statSync(currentPath).mtimeMs;
    } catch {
      configMtime = 0;
    }

    try {
      const newConfig = loadConfig(projectRoot);
      const oldJson = JSON.stringify(config);
      const newJson = JSON.stringify(newConfig);

      if (clients.size > 0 && config !== null && newJson !== oldJson) {
        configWarning = `LSP config has changed (${currentPath}). Running servers use the old config — use /reload to pick up changes.`;
      }

      config = newConfig;
      return config;
    } catch (e: any) {
      // Parse error: keep last good config, surface error
      configWarning = `LSP config file is broken (${currentPath}): ${e.message}. Using last good config.`;
      return config;
    }
  }

  /**
   * Prepend configWarning (if set) to a tool result.
   */
  function maybeWarnResult(result: ReturnType<typeof okResult>) {
    if (configWarning && result.content.length > 0) {
      const first = result.content[0];
      if (first.type === "text") {
        first.text = `⚠️ ${configWarning}\n\n${first.text}`;
      }
    }
    return result;
  }

  // --- Client management ---

  async function getClient(
    serverName: string,
    serverConfig: ServerConfig,
    projectRoot: string,
  ): Promise<LspClient> {
    const existing = clients.get(serverName);
    if (existing?.isRunning()) return existing;

    const inflight = starting.get(serverName);
    if (inflight) return inflight;

    const promise = (async () => {
      const client = new LspClient();

      client.on("log", (msg: string) => {
        // Could pipe to a debug log; suppress for now
      });

      client.on("exit", (code: number) => {
        clients.delete(serverName);
      });

      await client.start({
        command: serverConfig.command,
        rootUri: projectRoot,
        initializationOptions: serverConfig.initializationOptions,
      });

      clients.set(serverName, client);
      return client;
    })();

    starting.set(serverName, promise);
    try {
      return await promise;
    } finally {
      starting.delete(serverName);
    }
  }

  async function getClientForFile(
    filePath: string,
    projectRoot: string,
  ): Promise<{ client: LspClient; serverName: string } | string> {
    const cfg = ensureConfig(projectRoot);
    if (!cfg) {
      return "No LSP config found. Create .pi/lsp.json or .zed/settings.json with LSP server configuration. Use grep/read to navigate code instead.";
    }

    const match = serverForFile(cfg, filePath);
    if (!match) {
      return `No LSP server configured for ${extname(filePath)} files. Use grep/read to navigate code instead.`;
    }

    const [serverName, serverConfig] = match;
    try {
      const client = await getClient(serverName, serverConfig, projectRoot);
      return { client, serverName };
    } catch (e: any) {
      return `Failed to start LSP server '${serverName}': ${e.message}. Use grep/read to navigate code instead.`;
    }
  }

  /**
   * Ensure file is open in the LSP server before querying.
   */
  async function ensureFileOpen(
    client: LspClient,
    filePath: string,
  ): Promise<string | null> {
    if (!existsSync(filePath)) return `File not found: ${filePath}`;
    try {
      const content = readFileSync(filePath, "utf-8");
      const langId = languageIdForFile(filePath);
      client.ensureOpen(filePath, content, langId);
      return null;
    } catch (e: any) {
      return `Failed to read file ${filePath}: ${e.message}`;
    }
  }

  // --- Symbol resolution ---

  /**
   * Resolve a symbol name to a file + position using workspace/symbol.
   * Returns the best match or an error string.
   */
  async function resolveSymbol(
    client: LspClient,
    symbol: string,
    signal?: AbortSignal,
  ): Promise<{ file: string; line: number; col: number } | string> {
    const results = await client.workspaceSymbol(symbol, signal);
    if (!results || results.length === 0) {
      return `Symbol '${symbol}' not found via workspace/symbol. Try a different name or use grep.`;
    }

    // Prefer exact name match, then prefix match
    const exact = results.find((r: any) => r.name === symbol);
    const match = exact ?? results[0];

    const loc = match.location;
    if (!loc?.uri) {
      return `Symbol '${symbol}' found but has no location. Try grep instead.`;
    }

    const file = loc.uri.replace("file://", "");
    const line = loc.range?.start?.line ?? 0;
    const col = loc.range?.start?.character ?? 0;
    return { file, line, col };
  }

  // --- Context extraction ---

  /**
   * Read lines around a position: 5 above, 15 below.
   */
  function extractContext(filePath: string, line: number): string {
    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const start = Math.max(0, line - 5);
      const end = Math.min(lines.length, line + 16);
      const numbered = lines
        .slice(start, end)
        .map((l, i) => {
          const lineNum = start + i + 1;
          const marker = lineNum === line + 1 ? ">" : " ";
          return `${marker}${String(lineNum).padStart(5)} | ${l}`;
        })
        .join("\n");
      return numbered;
    } catch {
      return `(could not read ${filePath})`;
    }
  }

  // --- Result formatting ---

  function formatLocation(uri: string, range: any): string {
    const file = uri.replace("file://", "");
    const line = (range?.start?.line ?? 0) + 1;
    const col = (range?.start?.character ?? 0) + 1;
    return `${file}:${line}:${col}`;
  }

  function formatHover(result: any): string {
    if (!result?.contents) return "No hover information available.";
    const contents = result.contents;
    if (typeof contents === "string") return contents;
    if (contents.value) return contents.value;
    if (Array.isArray(contents)) {
      return contents
        .map((c: any) => (typeof c === "string" ? c : (c.value ?? "")))
        .join("\n\n");
    }
    return JSON.stringify(contents);
  }

  function formatSymbolKind(kind: number): string {
    const kinds: Record<number, string> = {
      1: "File",
      2: "Module",
      3: "Namespace",
      4: "Package",
      5: "Class",
      6: "Method",
      7: "Property",
      8: "Field",
      9: "Constructor",
      10: "Enum",
      11: "Interface",
      12: "Function",
      13: "Variable",
      14: "Constant",
      15: "String",
      16: "Number",
      17: "Boolean",
      18: "Array",
      19: "Object",
      20: "Key",
      21: "Null",
      22: "EnumMember",
      23: "Struct",
      24: "Event",
      25: "Operator",
      26: "TypeParameter",
    };
    return kinds[kind] ?? `Kind(${kind})`;
  }

  function formatDocumentSymbols(symbols: any[], indent = 0): string {
    if (!symbols?.length) return "No symbols found.";
    const prefix = "  ".repeat(indent);
    return symbols
      .map((s: any) => {
        const kind = formatSymbolKind(s.kind);
        const line =
          (s.range?.start?.line ?? s.location?.range?.start?.line ?? 0) + 1;
        let result = `${prefix}${kind} ${s.name} (line ${line})`;
        if (s.children?.length) {
          result += "\n" + formatDocumentSymbols(s.children, indent + 1);
        }
        return result;
      })
      .join("\n");
  }

  function formatWorkspaceSymbols(symbols: any[]): string {
    if (!symbols?.length) return "No symbols found.";
    return symbols
      .slice(0, 50) // Cap results
      .map((s: any) => {
        const kind = formatSymbolKind(s.kind);
        const loc = formatLocation(s.location.uri, s.location.range);
        const container = s.containerName ? ` (in ${s.containerName})` : "";
        return `${kind} ${s.name}${container} — ${loc}`;
      })
      .join("\n");
  }

  function formatReferences(refs: any[]): string {
    if (!refs?.length) return "No references found.";
    const formatted = refs
      .slice(0, 100)
      .map((r: any) => formatLocation(r.uri, r.range));
    let result = formatted.join("\n");
    if (refs.length > 100) {
      result += `\n... and ${refs.length - 100} more references`;
    }
    return result;
  }

  // --- Resolve position from params ---

  interface ResolvedPosition {
    file: string;
    line: number; // 0-indexed
    col: number; // 0-indexed
  }

  async function resolvePosition(
    params: any,
    projectRoot: string,
    signal?: AbortSignal,
  ): Promise<{ pos: ResolvedPosition; client: LspClient } | { error: string }> {
    // If file+line+col given, use directly
    if (params.file && params.line != null && params.col != null) {
      const filePath = resolve(projectRoot, params.file.replace(/^@/, ""));
      const result = await getClientForFile(filePath, projectRoot);
      if (typeof result === "string") return { error: result };
      const openErr = await ensureFileOpen(result.client, filePath);
      if (openErr) return { error: openErr };
      return {
        pos: { file: filePath, line: params.line - 1, col: params.col - 1 },
        client: result.client,
      };
    }

    // If symbol given, resolve via workspace/symbol
    if (params.symbol) {
      // We need a client, but we don't know the file yet.
      // Try each configured server until we find the symbol.
      const cfg = ensureConfig(projectRoot);
      if (!cfg) {
        return {
          error:
            "No LSP config found. Create .pi/lsp.json or .zed/settings.json. Use grep/read instead.",
        };
      }

      for (const [name, serverCfg] of Object.entries(cfg.servers)) {
        try {
          const client = await getClient(name, serverCfg, projectRoot);
          const resolved = await resolveSymbol(client, params.symbol, signal);
          if (typeof resolved !== "string") {
            const openErr = await ensureFileOpen(client, resolved.file);
            if (openErr) return { error: openErr };
            return { pos: resolved, client };
          }
        } catch {
          // Try next server
        }
      }
      return {
        error: `Symbol '${params.symbol}' not found in any configured LSP server. Try grep instead.`,
      };
    }

    return {
      error: "Provide either file+line+col or symbol to identify a location.",
    };
  }

  // --- Tool registration ---

  pi.registerTool({
    name: "lsp",
    label: "LSP",
    description: `Query language servers for code intelligence. Prefer for code navigation. Provide file+line+col or symbol name. Positions are 1-indexed.`,

    parameters: Type.Object({
      action: StringEnum(["hover", "definition", "references", "symbols", "workspace_symbols"] as const),
      file: Type.Optional(Type.String()),
      line: Type.Optional(Type.Number({ description: "1-indexed" })),
      col: Type.Optional(Type.Number({ description: "1-indexed" })),
      symbol: Type.Optional(Type.String({ description: "Alternative to file+line+col" })),
      query: Type.Optional(Type.String({ description: "For workspace_symbols" })),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const projectRoot = ctx.cwd;
      const updateStatusAfter = () => updateStatus(ctx);

      try {
        let result: ReturnType<typeof okResult>;
        switch (params.action) {
          case "hover": {
            const resolved = await resolvePosition(params, projectRoot, signal);
            if ("error" in resolved)
              return maybeWarnResult(errorResult(resolved.error));
            const hoverResult = await resolved.client.hover(
              resolved.pos.file,
              resolved.pos.line,
              resolved.pos.col,
              signal,
            );
            const text = formatHover(hoverResult);
            result = okResult(
              `Hover at ${resolved.pos.file}:${resolved.pos.line + 1}:${resolved.pos.col + 1}:\n\n${text}`,
            );
            break;
          }

          case "definition": {
            const resolved = await resolvePosition(params, projectRoot, signal);
            if ("error" in resolved)
              return maybeWarnResult(errorResult(resolved.error));
            const defResult = await resolved.client.definition(
              resolved.pos.file,
              resolved.pos.line,
              resolved.pos.col,
              signal,
            );

            if (!defResult) {
              result = okResult("No definition found.");
              break;
            }

            // definition can return a single Location or Location[]
            const locations = Array.isArray(defResult)
              ? defResult
              : [defResult];
            if (locations.length === 0) {
              result = okResult("No definition found.");
              break;
            }

            const parts = locations.map((loc: any) => {
              const file = loc.uri.replace("file://", "");
              const line = loc.range?.start?.line ?? 0;
              const header = formatLocation(loc.uri, loc.range);
              const context = extractContext(file, line);
              return `${header}\n${context}`;
            });
            result = okResult(parts.join("\n\n---\n\n"));
            break;
          }

          case "references": {
            const resolved = await resolvePosition(params, projectRoot, signal);
            if ("error" in resolved)
              return maybeWarnResult(errorResult(resolved.error));
            const refsResult = await resolved.client.references(
              resolved.pos.file,
              resolved.pos.line,
              resolved.pos.col,
              true,
              signal,
            );
            result = okResult(formatReferences(refsResult));
            break;
          }

          case "symbols": {
            if (!params.file)
              return errorResult("'symbols' action requires a file path.");
            const filePath = resolve(
              projectRoot,
              params.file.replace(/^@/, ""),
            );
            const clientResult = await getClientForFile(filePath, projectRoot);
            if (typeof clientResult === "string")
              return maybeWarnResult(errorResult(clientResult));
            const openErr = await ensureFileOpen(clientResult.client, filePath);
            if (openErr) return maybeWarnResult(errorResult(openErr));
            const symResult = await clientResult.client.documentSymbol(
              filePath,
              signal,
            );
            result = okResult(
              `Symbols in ${params.file}:\n\n${formatDocumentSymbols(symResult)}`,
            );
            break;
          }

          case "workspace_symbols": {
            const query = params.query ?? params.symbol ?? "";
            if (!query)
              return errorResult(
                "'workspace_symbols' action requires a query or symbol.",
              );
            const cfg = ensureConfig(projectRoot);
            if (!cfg)
              return maybeWarnResult(
                errorResult("No LSP config found. Use grep instead."),
              );

            // Query all servers and merge results
            const allResults: any[] = [];
            for (const [name, serverCfg] of Object.entries(cfg.servers)) {
              try {
                const client = await getClient(name, serverCfg, projectRoot);
                const results = await client.workspaceSymbol(query, signal);
                if (results) allResults.push(...results);
              } catch {
                // Skip failed servers
              }
            }
            result = okResult(formatWorkspaceSymbols(allResults));
            break;
          }

          default:
            return errorResult(`Unknown action: ${params.action}`);
        }
        return maybeWarnResult(result);
      } catch (e: any) {
        return maybeWarnResult(
          errorResult(
            `LSP error: ${e.message}. Use grep/read to navigate code instead.`,
          ),
        );
      } finally {
        updateStatusAfter();
      }
    },
  });

  // --- File change tracking ---

  /**
   * After write/edit tools modify a file, refresh it in any LSP server
   * that has it open. Uses didClose + didOpen (simpler than incremental didChange).
   */
  pi.on("tool_result", async (event, ctx) => {
    if (clients.size === 0) return; // No servers running, nothing to refresh

    let filePath: string | undefined;
    if (event.toolName === "write" || event.toolName === "edit") {
      filePath = (event.input as any)?.path;
    }
    if (!filePath) return;

    const absPath = resolve(ctx.cwd, filePath.replace(/^@/, ""));
    if (!existsSync(absPath)) return;

    try {
      const content = readFileSync(absPath, "utf-8");
      const langId = languageIdForFile(absPath);
      for (const client of clients.values()) {
        client.refreshDocument(absPath, content, langId);
      }
    } catch {
      // Best effort — don't break the tool chain
    }
  });

  // --- Status updates ---

  function updateStatus(ctx: {
    ui: { setStatus(key: string, msg: string | undefined): void };
  }) {
    if (clients.size === 0) {
      ctx.ui.setStatus(
        "lsp",
        configLoadedOnce && !config ? "LSP: no config" : "LSP: idle",
      );
    } else {
      const names = [...clients.keys()].join(", ");
      ctx.ui.setStatus("lsp", `LSP: ${names}`);
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx);
  });

  // --- Cleanup ---

  pi.on("session_shutdown", async () => {
    for (const [, client] of clients) {
      await client.stop().catch(() => {});
    }
    clients.clear();
  });
}

// --- Helpers ---

function okResult(text: string) {
  const result = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  let output = result.content;
  if (result.truncated) {
    output += `\n\n[Output truncated: ${formatSize(result.totalBytes)} / ${result.totalLines} lines → ${formatSize(result.outputBytes)} / ${result.outputLines} lines, hit ${result.truncatedBy} limit]`;
  }
  return {
    content: [{ type: "text" as const, text: output }],
    details: {},
  };
}

function errorResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
    isError: true,
  };
}
