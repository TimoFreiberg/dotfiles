# LSP Extension: Auto-discover Zed Language Servers

## Goal

Make the `lsp` tool work **zero-config** by automatically discovering language server binaries that Zed has already downloaded. Config files (`.pi/lsp.json`, `.zed/settings.json`) remain supported for overrides and for lspmux setups.

## Current State

- Extension requires a config file (`.pi/lsp.json` or `.zed/settings.json`) to know which LSP server to launch
- Without config → "No LSP config found" error, user falls back to grep/read
- Config maps server names to commands, file extensions, and init options

## Zed's Language Server Storage

**Location:** `~/Library/Application Support/Zed/languages/` (macOS) or `$XDG_DATA_HOME/zed/languages/` (Linux)

Zed stores downloaded language servers in three patterns:

### Pattern 1: Native binary (date/version-named)
```
languages/rust-analyzer/
  rust-analyzer-2026-02-02          ← the binary
  rust-analyzer-2026-02-02.metadata ← JSON metadata (skip)
```
Resolution: scan dir, skip `.metadata` files, take the last entry as binary.

### Pattern 2: Native binary in versioned subdirectory
```
languages/ruff/
  ruff-0.15.1/ruff-aarch64-apple-darwin/ruff    ← the binary
  ruff-0.15.metadata
```
Resolution: find the versioned dir, then arch subdir, then binary name.

### Pattern 3: Node.js package
```
languages/vtsls/
  node_modules/@vtsls/language-server/bin/vtsls.js
  package.json

languages/basedpyright/
  node_modules/basedpyright/langserver.index.js
  package.json
```
Resolution: Node binary + path to JS entry point + `--stdio`.
Node is at: `~/Library/Application Support/Zed/node/node-v{VERSION}-{os}-{arch}/bin/node`

## Proposed Design

### New: `ZED_SERVER_REGISTRY` — built-in server definitions

A static registry mapping server names to:
- File extensions they handle
- Language ID
- How to find the binary in the Zed languages dir
- Arguments needed (e.g. `--stdio`, `server`)
- Default `initializationOptions` (if any)

```typescript
interface ZedServerDef {
  /** Name of the server (matches Zed's directory name) */
  name: string;
  /** File extensions this server handles */
  fileExtensions: string[];
  /** LSP language ID */
  languageId: string;
  /** How to resolve the binary */
  binary: 
    | { type: "native"; /** binary name without version */ baseName: string }
    | { type: "native-subdir"; /** binary name */ baseName: string }
    | { type: "node"; /** path relative to container dir */ serverPath: string; args?: string[] }
  /** Extra CLI args after the binary (e.g. ["server"] for ruff) */
  extraArgs?: string[];
  /** Default initializationOptions */
  defaultInitOptions?: Record<string, unknown>;
}
```

Initial registry (servers that are useful for coding):

| Server | Type | Extensions | Notes |
|---|---|---|---|
| `rust-analyzer` | native | `.rs` | Primary Rust server |
| `vtsls` | node | `.ts .tsx .js .jsx` | `node_modules/@vtsls/language-server/bin/vtsls.js --stdio` |
| `basedpyright` | node | `.py` | `node_modules/basedpyright/langserver.index.js --stdio` |
| `ruff` | native-subdir | `.py` | Linter only, not useful as primary LSP for code nav |
| `json-language-server` | node | `.json .jsonc` | `node_modules/.bin/vscode-json-language-server --stdio` |
| `gopls` | native | `.go` | Not in Zed languages dir; typically system-installed |
| `clangd` | native | `.c .h .cpp .hpp .cc .cxx` | Typically system-installed |
| `zls` | native | `.zig` | May be in Zed or system-installed |

### New: `discoverServers()` function

```typescript
function discoverServers(projectRoot: string): LspConfig
```

1. Find Zed languages dir (platform-dependent)
2. Find Zed node binary (scan `~/Library/Application Support/Zed/node/` for `node-v*` dirs)
3. For each entry in the registry, check if the binary exists in the Zed languages dir
4. Also check if the binary is available on `$PATH` (system-installed)
5. Return an `LspConfig` with all discovered servers

### Priority / config layering

```
1. .pi/lsp.json           — full override, used as-is (supports lspmux)
2. .zed/settings.json      — Zed project config (current behavior, but enhanced)
3. Auto-discovered servers — zero-config fallback
```

If a config file exists, it takes full precedence (no merging with auto-discovery). This keeps behavior predictable and avoids "where did this server come from?" confusion.

### Changes to `config.ts`

- Add `discoverZedServers(): LspConfig | null` function
- Modify `loadConfig()` / `ensureConfig()` fallback chain:
  1. Try `.pi/lsp.json` → return if found
  2. Try `.zed/settings.json` → return if found  
  3. Try `discoverZedServers()` → return discovered servers
- Remove the hard error "No LSP config found" when discovery finds servers

### Changes to `index.ts`

- Minimal changes — the config layer handles everything
- Update error messages: instead of "Create .pi/lsp.json", say something like "No LSP servers found. Install a language server or create .pi/lsp.json"

### Node binary resolution

For node-based servers, we need to find Zed's bundled Node.js:
```
~/Library/Application Support/Zed/node/node-v{VERSION}-{os}-{arch}/bin/node
```

Strategy: scan the `node/` directory for `node-v*` dirs, pick the latest version, use its `bin/node`. Fall back to system `node` if Zed's isn't available.

## Edge Cases & Concerns

### 1. Multiple servers for the same extension
- `.py` could match both `basedpyright` and `ruff`
- Solution: registry has a priority order; only the first match wins
- Ruff is a linter/formatter, not great for code navigation — `basedpyright` should win for `.py`

### 2. Server not installed in Zed yet
- User hasn't opened that file type in Zed → no server downloaded
- Solution: also check `$PATH` for system-installed servers (rust-analyzer, clangd, gopls)
- If neither found, graceful error as today

### 3. Zed updates a server while pi is running
- Zed replaces the binary on disk (new version-named file)
- Our cached binary path becomes stale
- Solution: re-resolve the binary path each time we start a new server instance (not on every request — only on cold start)

### 4. Platform detection
- macOS: `~/Library/Application Support/Zed/languages/`
- Linux: `$XDG_DATA_HOME/zed/languages/` or `~/.local/share/zed/languages/`
- Need to handle both; Windows not needed for now

### 5. Zed not installed
- No Zed directory exists → discovery returns nothing → fall back to PATH lookup
- Still zero-config if servers are on PATH

### 6. Architecture-specific binaries (ruff pattern)
- `ruff-0.15.1/ruff-aarch64-apple-darwin/ruff`
- Need to detect current arch: `process.arch` → map to Zed's naming
- `arm64` → `aarch64`, `x64` → `x86_64`
- OS: `darwin` → `apple-darwin`, `linux` → `unknown-linux-gnu`

### 7. Node server shebang scripts vs direct invocation
- The `.bin/vtsls` script has `#!/usr/bin/env node` — could invoke wrong node
- Better to use Zed's node binary + the `.js` path directly (like Zed does)
- e.g., `["/path/to/zed/node", "node_modules/@vtsls/language-server/bin/vtsls.js", "--stdio"]`

### 8. initializationOptions
- Auto-discovered servers get sensible defaults (from registry)
- User can still override via `.pi/lsp.json` or `.zed/settings.json`
- For basedpyright, Zed sends: `{ python: { analysis: { autoSearchPaths: true, useLibraryCodeForTypes: true, autoImportCompletions: true } } }`

### 9. System PATH servers
- `rust-analyzer`, `clangd`, `gopls` are often system-installed
- Should we prefer Zed's copy or system copy?
- Proposal: prefer Zed's copy (it's managed/updated), fall back to system

### 10. lspmux compatibility
- lspmux requires explicit config (need to specify the lspmux binary + args)
- Auto-discovery doesn't help here → user must use `.pi/lsp.json`
- This is fine — lspmux is an advanced/optional optimization

### 11. Stale Zed node version
- Zed may update its Node.js — old version dir disappears
- Solution: scan for latest `node-v*` dir each time, don't cache

### 12. Multiple Zed installations (Stable vs Preview)
- Zed Preview uses `~/Library/Application Support/Zed Preview/`
- We could check both, preferring the most recently modified
- Or just check "Zed" (stable) — keep it simple for now

## Decisions (Confirmed)

1. **Scope**: rust-analyzer, vtsls, basedpyright, clangd, gopls, zls. Skip ruff/eslint/tailwindcss/json-language-server.
2. **System PATH**: Yes, auto-use servers found on PATH as fallback.
3. **Config merging**: Merge at the language/server level — if `.pi/lsp.json` configures rust-analyzer (e.g. via lspmux), auto-discovered clangd still works for C files. Don't merge internals of a single server config.
4. **Zed Preview**: Check both stable and preview dirs, prefer whichever has the binary.

## Implementation Plan

1. **Add `discover.ts`** (~150 lines)
   - `ZED_SERVER_REGISTRY` constant
   - `getZedLanguagesDirs(): string[]` — returns both stable + preview paths that exist
   - `getZedNodeBinary(): string | null` — scan both Zed dirs for node
   - `resolveNativeBinary(dir, baseName): string | null`
   - `resolveNodeServer(dir, serverPath, nodeBinary): string[] | null`
   - `discoverServers(): LspConfig`
   - `findSystemServer(name): string | null` (PATH lookup via `which`)

2. **Update `config.ts`** (~20 lines changed)
   - Import `discoverServers` from discover.ts
   - New `loadConfig()` behavior: load file-based config, then merge auto-discovered servers for any file extensions not already covered
   - Keep `findConfigPath` as-is for file config detection

3. **Update `index.ts`** (~5 lines changed)
   - Update error messages (no more "create .pi/lsp.json" as first suggestion)
   - Status shows "LSP: auto" when using discovered servers

4. **Testing**: Manual testing with your actual Zed installation
   - Remove any `.pi/lsp.json` files
   - Verify rust-analyzer auto-starts for `.rs` files
   - Verify vtsls auto-starts for `.ts` files
   - Verify basedpyright auto-starts for `.py` files
   - Verify `.pi/lsp.json` with one server doesn't break auto-discovery of others
