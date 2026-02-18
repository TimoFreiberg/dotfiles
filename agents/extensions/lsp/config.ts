/**
 * LSP server configuration.
 *
 * Supports:
 * 1. Project-local `.pi/lsp.json`
 * 2. Fallback: Zed's `.zed/settings.json`
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ServerConfig {
  /** Command + args to spawn the server (or lspmux client shim) */
  command: string[];
  /** File extensions this server handles */
  fileExtensions: string[];
  /** LSP initializationOptions sent during handshake */
  initializationOptions?: Record<string, unknown>;
  /** Language ID for textDocument/didOpen (e.g. "rust", "c", "cpp") */
  languageId?: string;
}

export interface LspConfig {
  servers: Record<string, ServerConfig>;
}

/** Map from file extension to language ID */
const EXT_TO_LANG: Record<string, string> = {
  ".rs": "rust",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hh": "cpp",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".zig": "zig",
};

/**
 * Parse a JSONC string (JSON with comments and trailing commas).
 * Strips line comments, block comments, and trailing commas,
 * while respecting string literals. Then feeds the result to JSON.parse.
 */
export function parseJsonc(text: string): unknown {
  let result = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    // String literal — copy verbatim (including escape sequences)
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\") j++; // skip escaped char
        j++;
      }
      result += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // Line comment
    if (ch === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    // Block comment
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2; // skip */
      continue;
    }
    result += ch;
    i++;
  }
  // Strip trailing commas before ] or }
  result = result.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(result);
}

export function languageIdForFile(filePath: string): string {
  const ext = filePath.substring(filePath.lastIndexOf("."));
  return EXT_TO_LANG[ext] ?? "plaintext";
}

/**
 * Find the config file path, preferring `.pi/lsp.json` over `.zed/settings.json`.
 */
export function findConfigPath(projectRoot: string): string | null {
  const piConfig = join(projectRoot, ".pi", "lsp.json");
  if (existsSync(piConfig)) return piConfig;
  const zedConfig = join(projectRoot, ".zed", "settings.json");
  if (existsSync(zedConfig)) return zedConfig;
  return null;
}

/**
 * Load and parse a specific config file. Throws on parse errors.
 */
export function loadConfigFromFile(configPath: string): LspConfig | null {
  const raw = parseJsonc(readFileSync(configPath, "utf-8"));
  if (configPath.endsWith("lsp.json")) {
    return normalizePiConfig(raw);
  } else {
    return parseZedConfig(raw);
  }
}

/**
 * Load config from `.pi/lsp.json`, falling back to `.zed/settings.json`.
 * Throws on parse errors.
 */
export function loadConfig(projectRoot: string): LspConfig | null {
  const configPath = findConfigPath(projectRoot);
  if (!configPath) return null;
  return loadConfigFromFile(configPath);
}

/**
 * Parse .pi/lsp.json format:
 * {
 *   "servers": {
 *     "rust-analyzer": {
 *       "command": ["lspmux", "client", "--server-path", "rust-analyzer"],
 *       "fileExtensions": [".rs"],
 *       "initializationOptions": { ... }
 *     }
 *   }
 * }
 */
function normalizePiConfig(raw: any): LspConfig {
  const servers: Record<string, ServerConfig> = {};
  for (const [name, cfg] of Object.entries(raw.servers ?? {})) {
    const c = cfg as any;
    servers[name] = {
      command: c.command ?? [name],
      fileExtensions: c.fileExtensions ?? [],
      initializationOptions: c.initializationOptions,
      languageId: c.languageId,
    };
  }
  return { servers };
}

/** Known Zed LSP server names → file extensions + language IDs */
const ZED_SERVER_DEFAULTS: Record<string, { fileExtensions: string[]; languageId: string }> = {
  "rust-analyzer": { fileExtensions: [".rs"], languageId: "rust" },
  clangd: { fileExtensions: [".c", ".h", ".cpp", ".hpp", ".cc", ".cxx"], languageId: "c" },
  "typescript-language-server": { fileExtensions: [".ts", ".tsx", ".js", ".jsx"], languageId: "typescript" },
  pylsp: { fileExtensions: [".py"], languageId: "python" },
  gopls: { fileExtensions: [".go"], languageId: "go" },
  zls: { fileExtensions: [".zig"], languageId: "zig" },
};

/**
 * Parse Zed's .zed/settings.json format:
 * {
 *   "lsp": {
 *     "rust-analyzer": {
 *       "binary": { "path": "lspmux", "arguments": ["client", ...] },
 *       "initialization_options": { ... }
 *     }
 *   }
 * }
 */
function parseZedConfig(raw: any): LspConfig | null {
  const lsp = raw.lsp;
  if (!lsp || typeof lsp !== "object") return null;

  const servers: Record<string, ServerConfig> = {};
  for (const [name, cfg] of Object.entries(lsp)) {
    const c = cfg as any;
    const defaults = ZED_SERVER_DEFAULTS[name];
    if (!defaults) continue; // Skip unknown servers

    // Build command from binary config or default to server name
    let command: string[];
    if (c.binary?.path) {
      command = [c.binary.path, ...(c.binary.arguments ?? [])];
    } else {
      command = [name];
    }

    // Zed uses snake_case "initialization_options", LSP uses camelCase
    const initOptions = c.initialization_options ?? c.initializationOptions ?? {};

    servers[name] = {
      command,
      fileExtensions: defaults.fileExtensions,
      initializationOptions: initOptions,
      languageId: defaults.languageId,
    };
  }

  return Object.keys(servers).length > 0 ? { servers } : null;
}

/**
 * Find the server config that handles a given file path.
 */
export function serverForFile(config: LspConfig, filePath: string): [string, ServerConfig] | null {
  const ext = filePath.substring(filePath.lastIndexOf("."));
  for (const [name, cfg] of Object.entries(config.servers)) {
    if (cfg.fileExtensions.includes(ext)) {
      return [name, cfg];
    }
  }
  return null;
}
