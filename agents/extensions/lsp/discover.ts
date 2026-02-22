/**
 * Auto-discover LSP servers from Zed's managed installations and system PATH.
 *
 * Zed downloads language servers to ~/Library/Application Support/Zed/languages/
 * (macOS) or $XDG_DATA_HOME/zed/languages/ (Linux). This module scans those
 * directories and builds ServerConfig entries for any servers it finds.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir, platform } from "node:os";
import { execFileSync } from "node:child_process";
import type { ServerConfig, LspConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Server registry
// ---------------------------------------------------------------------------

interface ServerDef {
  /** Name matching Zed's directory under languages/ */
  name: string;
  /** File extensions this server handles */
  fileExtensions: string[];
  /** LSP languageId */
  languageId: string;
  /** How to locate the binary inside the Zed languages dir */
  binary:
    | { type: "native" }
    | { type: "node"; serverPath: string; args: string[] };
  /** Default initializationOptions */
  defaultInitOptions?: Record<string, unknown>;
  /** Alternative names to search on $PATH */
  pathNames?: string[];
}

/**
 * Registry of servers we auto-discover, in priority order.
 * For file extensions claimed by multiple servers, the first match wins.
 */
const SERVER_REGISTRY: ServerDef[] = [
  {
    name: "rust-analyzer",
    fileExtensions: [".rs"],
    languageId: "rust",
    binary: { type: "native" },
  },
  {
    name: "vtsls",
    fileExtensions: [".ts", ".tsx", ".js", ".jsx"],
    languageId: "typescript",
    binary: {
      type: "node",
      serverPath: "node_modules/@vtsls/language-server/bin/vtsls.js",
      args: ["--stdio"],
    },
  },
  {
    name: "basedpyright",
    fileExtensions: [".py"],
    languageId: "python",
    binary: {
      type: "node",
      serverPath: "node_modules/basedpyright/langserver.index.js",
      args: ["--stdio"],
    },
    pathNames: ["basedpyright-langserver"],
    defaultInitOptions: {
      python: {
        analysis: {
          autoSearchPaths: true,
          useLibraryCodeForTypes: true,
          autoImportCompletions: true,
        },
      },
    },
  },
  {
    name: "gopls",
    fileExtensions: [".go"],
    languageId: "go",
    binary: { type: "native" },
  },
  {
    name: "clangd",
    fileExtensions: [".c", ".h", ".cpp", ".hpp", ".cc", ".cxx"],
    languageId: "c",
    binary: { type: "native" },
  },
  {
    name: "zls",
    fileExtensions: [".zig"],
    languageId: "zig",
    binary: { type: "native" },
  },
];

// ---------------------------------------------------------------------------
// Zed directory discovery
// ---------------------------------------------------------------------------

/**
 * Return candidate Zed application-support directories (stable + preview).
 * Only directories that actually exist are returned.
 */
function getZedBaseDirs(): string[] {
  const home = homedir();
  const candidates: string[] = [];

  if (platform() === "darwin") {
    candidates.push(
      join(home, "Library", "Application Support", "Zed"),
      join(home, "Library", "Application Support", "Zed Preview"),
    );
  } else {
    // Linux
    const dataHome = process.env.XDG_DATA_HOME ?? join(home, ".local", "share");
    candidates.push(join(dataHome, "zed"), join(dataHome, "zed-preview"));
    // Flatpak
    if (process.env.FLATPAK_XDG_DATA_HOME) {
      candidates.push(join(process.env.FLATPAK_XDG_DATA_HOME, "zed"));
    }
  }

  return candidates.filter((d) => existsSync(d));
}

/**
 * Find all Zed languages directories that exist.
 */
function getZedLanguagesDirs(): string[] {
  return getZedBaseDirs()
    .map((d) => join(d, "languages"))
    .filter((d) => existsSync(d));
}

// ---------------------------------------------------------------------------
// Node binary resolution
// ---------------------------------------------------------------------------

/**
 * Find Zed's bundled Node.js binary. Scans for node-v* directories
 * and picks the one with the highest version number.
 * Falls back to system `node` on PATH.
 */
function findNodeBinary(): string | null {
  for (const baseDir of getZedBaseDirs()) {
    const nodeDir = join(baseDir, "node");
    if (!existsSync(nodeDir)) continue;

    let entries: string[];
    try {
      entries = readdirSync(nodeDir).filter((e) => e.startsWith("node-v"));
    } catch {
      continue;
    }

    if (entries.length === 0) continue;

    // Sort by version descending (node-v24.11.0-darwin-arm64 → 24.11.0)
    entries.sort((a, b) => {
      const va = a.match(/node-v([\d.]+)/)?.[1] ?? "0";
      const vb = b.match(/node-v([\d.]+)/)?.[1] ?? "0";
      return compareVersions(vb, va);
    });

    const nodeBin = join(nodeDir, entries[0], "bin", "node");
    if (existsSync(nodeBin)) return nodeBin;
  }

  // Fall back to system node
  return findOnPath("node");
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Native binary resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a native binary in a Zed languages container directory.
 * Pattern: languages/{name}/{name}-{version} (skip .metadata files).
 * Takes the last non-metadata entry (Zed's convention).
 */
function resolveNativeBinary(containerDir: string): string | null {
  if (!existsSync(containerDir)) return null;

  let entries: string[];
  try {
    entries = readdirSync(containerDir);
  } catch {
    return null;
  }

  // Filter out metadata files and directories
  const binaries = entries.filter((e) => {
    if (e.endsWith(".metadata")) return false;
    const fullPath = join(containerDir, e);
    try {
      const stat = statSync(fullPath);
      return stat.isFile();
    } catch {
      return false;
    }
  });

  if (binaries.length === 0) return null;

  // Take the last entry (Zed uses this convention — latest version sorts last)
  const binary = join(containerDir, binaries[binaries.length - 1]);

  // Verify it's executable (best effort)
  try {
    const stat = statSync(binary);
    if (stat.isFile()) return binary;
  } catch {
    // ignore
  }

  return null;
}

// ---------------------------------------------------------------------------
// PATH lookup
// ---------------------------------------------------------------------------

/**
 * Find a binary on the system PATH using `which`.
 */
function findOnPath(name: string): string | null {
  try {
    const result = execFileSync("which", [name], {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main discovery
// ---------------------------------------------------------------------------

/**
 * Discover available LSP servers from Zed installations and system PATH.
 * Returns an LspConfig with all found servers, or null if none found.
 */
export function discoverServers(): LspConfig | null {
  const languagesDirs = getZedLanguagesDirs();
  const nodeBinary = findNodeBinary();
  const servers: Record<string, ServerConfig> = {};

  for (const def of SERVER_REGISTRY) {
    const resolved = resolveServer(def, languagesDirs, nodeBinary);
    if (resolved) {
      servers[def.name] = resolved;
    }
  }

  return Object.keys(servers).length > 0 ? { servers } : null;
}

function resolveServer(
  def: ServerDef,
  languagesDirs: string[],
  nodeBinary: string | null,
): ServerConfig | null {
  // Try Zed-managed installation first
  if (def.binary.type === "native") {
    // Check Zed languages dirs
    for (const langDir of languagesDirs) {
      const containerDir = join(langDir, def.name);
      const binary = resolveNativeBinary(containerDir);
      if (binary) {
        return {
          command: [binary],
          fileExtensions: def.fileExtensions,
          languageId: def.languageId,
          initializationOptions: def.defaultInitOptions,
        };
      }
    }

    // Fall back to PATH
    const pathBinary = findOnPath(def.name);
    if (pathBinary) {
      return {
        command: [pathBinary],
        fileExtensions: def.fileExtensions,
        languageId: def.languageId,
        initializationOptions: def.defaultInitOptions,
      };
    }
  } else if (def.binary.type === "node") {
    if (!nodeBinary) {
      // Try PATH names as last resort (e.g. basedpyright-langserver)
      for (const pathName of def.pathNames ?? []) {
        const pathBinary = findOnPath(pathName);
        if (pathBinary) {
          return {
            command: [pathBinary, ...def.binary.args],
            fileExtensions: def.fileExtensions,
            languageId: def.languageId,
            initializationOptions: def.defaultInitOptions,
          };
        }
      }
      return null;
    }

    // Check Zed languages dirs for the node package
    for (const langDir of languagesDirs) {
      const containerDir = join(langDir, def.name);
      const serverJs = join(containerDir, def.binary.serverPath);
      if (existsSync(serverJs)) {
        return {
          command: [nodeBinary, serverJs, ...def.binary.args],
          fileExtensions: def.fileExtensions,
          languageId: def.languageId,
          initializationOptions: def.defaultInitOptions,
        };
      }
    }

    // Fall back to PATH names (e.g. basedpyright-langserver on PATH)
    for (const pathName of def.pathNames ?? []) {
      const pathBinary = findOnPath(pathName);
      if (pathBinary) {
        return {
          command: [pathBinary, ...def.binary.args],
          fileExtensions: def.fileExtensions,
          languageId: def.languageId,
          initializationOptions: def.defaultInitOptions,
        };
      }
    }
  }

  return null;
}

/**
 * Merge discovered servers into an existing config.
 * Only adds servers for file extensions not already covered by the existing config.
 */
export function mergeWithDiscovered(
  existing: LspConfig,
  discovered: LspConfig,
): LspConfig {
  // Collect all file extensions already handled by existing config
  const coveredExtensions = new Set<string>();
  for (const cfg of Object.values(existing.servers)) {
    for (const ext of cfg.fileExtensions) {
      coveredExtensions.add(ext);
    }
  }

  // Add discovered servers whose extensions aren't already covered
  const merged = { servers: { ...existing.servers } };
  for (const [name, cfg] of Object.entries(discovered.servers)) {
    const hasNewExtension = cfg.fileExtensions.some(
      (ext) => !coveredExtensions.has(ext),
    );
    if (hasNewExtension && !(name in merged.servers)) {
      merged.servers[name] = cfg;
      for (const ext of cfg.fileExtensions) {
        coveredExtensions.add(ext);
      }
    }
  }

  return merged;
}
