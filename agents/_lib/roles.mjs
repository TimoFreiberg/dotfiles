/**
 * Role -> model resolver for pi skills and extensions.
 *
 * One source of truth (roles.json) maps a task-ROLE (e.g. "text-summary") to a
 * concrete pi model spec ("provider/model:thinking"). Skills (plain node, no pi
 * runtime) and extensions (pi runtime) both import this module so the mapping
 * changes per machine while their code stays constant.
 *
 * The map carries NO secrets — only "provider/model:thinking" strings. API keys
 * stay in the gitignored auth.json / env that pi resolves itself.
 *
 * Resolution order (first hit wins):
 *   1. override        - call-site flag (--model/--provider, extension arg)
 *   2. PI_ROLE_<ROLE>  - env per-role (UPPER_SNAKE; "web-search" -> PI_ROLE_WEB_SEARCH)
 *   3. roles.json      - roles[<role>] in $PI_CODING_AGENT_DIR
 *   4. roles.default   - roles[<roles.json's "default">]
 *   5. DEFAULTS[<role>]- built-in fallback table below
 * A null result (no spec anywhere, no default) is returned for callers that have
 * their own fallback (e.g. web-search's auth-probe).
 *
 * This module is pi-runtime-free: it loads in a bare `node script.mjs` AND inside
 * pi's extension sandbox. The optional resolveRoleModel() face takes a
 * modelRegistry the CALLER supplies, so nothing here imports pi.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Loud-but-usable fallback when roles.json is missing or a role is absent.
 * These are deliberately conservative, broadly-available ids. They are NOT a
 * per-machine map — that's roles.json's job. `null` means "no built-in default;
 * let the caller fall back to its own probe".
 */
const DEFAULTS = {
  "straightforward-impl": "anthropic/claude-haiku-4-5:medium",
  "high-effort-impl": "anthropic/claude-opus-4-8:high",
  "general-review": "anthropic/claude-sonnet-4-5:high",
  "high-effort-review": "anthropic/claude-opus-4-8:xhigh",
  "web-search": null, // caller (web-search skill) uses its own auth-probe
  "text-summary": "anthropic/claude-haiku-4-5:low",
  "fast-utility": "anthropic/claude-haiku-4-5:off",
  vision: "anthropic/claude-sonnet-4-5",
  recon: "anthropic/claude-sonnet-4-5:medium",
  "structured-extraction": "anthropic/claude-haiku-4-5:low",
  default: "anthropic/claude-haiku-4-5:medium",
};

/** Resolve the pi agent dir, honoring PI_CODING_AGENT_DIR and ~ expansion. */
export function getAgentDir() {
  const configured = process.env.PI_CODING_AGENT_DIR;
  if (!configured) return join(homedir(), ".config", "pi", "agent");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/")) return join(homedir(), configured.slice(2));
  return configured;
}

/** Read JSON from a path, returning `fallback` on missing/unparseable. */
export function readJson(path, fallback = {}) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

const ROLE_ENV_PREFIX = "PI_ROLE_";

function roleEnvVar(role) {
  return ROLE_ENV_PREFIX + String(role).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/**
 * Parse a "provider/model:thinking" spec into parts.
 *
 * HARDENING: reject any spec containing "!" or "$" so the PUBLIC roles.json can
 * never smuggle pi's command (`!cmd`) or env (`$VAR`) value resolution — and thus
 * a secret — into the map. Those sigils belong in the gitignored auth.json only.
 *
 * Returns null for an empty/absent spec. The `:thinking` suffix is detected only
 * when the last colon sits after the provider's slash, so "provider/id" with no
 * thinking parses cleanly, and a model id that itself contains a colon (rare)
 * still needs an explicit slash to disambiguate provider.
 */
function parseSpec(spec) {
  if (spec == null || spec === "") return null;
  if (typeof spec !== "string") {
    throw new Error(`roles: model spec must be a string, got ${typeof spec}`);
  }
  if (spec.includes("!") || spec.includes("$")) {
    throw new Error(
      `roles: refusing model spec containing '!' or '$' (${JSON.stringify(spec)}). ` +
        "Specs are plain 'provider/model:thinking' strings; command/env resolution " +
        "is not allowed in the role map.",
    );
  }

  let body = spec;
  let thinking;
  const colon = spec.lastIndexOf(":");
  const slash = spec.indexOf("/");
  if (colon > slash) {
    thinking = spec.slice(colon + 1);
    body = spec.slice(0, colon);
  }

  const s = body.indexOf("/");
  const provider = s === -1 ? undefined : body.slice(0, s);
  const model = s === -1 ? body : body.slice(s + 1);

  return {
    provider,
    model,
    thinking,
    spec: body + (thinking ? `:${thinking}` : ""),
  };
}

let warned = new Set();
function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  process.stderr.write(`${message}\n`);
}

/**
 * Resolve a role to a model spec.
 *
 * @param {string} role
 * @param {{override?: string, agentDir?: string, quiet?: boolean}} [opts]
 * @returns {{provider?: string, model: string, thinking?: string, spec: string} | null}
 *   null when nothing resolves AND there is no default (caller-fallback signal).
 */
export function resolveRole(role, { override, agentDir, quiet } = {}) {
  if (!role || typeof role !== "string") {
    throw new Error(`roles: role must be a non-empty string, got ${JSON.stringify(role)}`);
  }

  // 1. call-site override
  if (override) return parseSpec(override);

  // 2. env per-role
  const envSpec = process.env[roleEnvVar(role)];
  if (envSpec) return parseSpec(envSpec);

  // 3-5. roles.json -> roles.default -> built-in DEFAULTS
  const dir = agentDir || getAgentDir();
  const cfg = readJson(join(dir, "roles.json"), null);
  const note = (msg) => {
    if (!quiet) warnOnce(`roles.json: ${msg}`);
  };

  if (cfg === null) {
    const fb = DEFAULTS[role];
    note(`not found in ${dir}, role '${role}' using built-in default ${JSON.stringify(fb)}`);
    return parseSpec(fb);
  }

  const map = cfg.roles || {};
  if (map[role]) return parseSpec(map[role]);

  // role absent: try the file's "default" role, then built-in DEFAULTS.
  if (cfg.default && map[cfg.default]) {
    note(`role '${role}' absent, using file default '${cfg.default}' (${map[cfg.default]})`);
    return parseSpec(map[cfg.default]);
  }

  const fb = DEFAULTS[role];
  note(`role '${role}' absent and no file default, using built-in ${JSON.stringify(fb)}`);
  return parseSpec(fb);
}

/**
 * Extension face: resolve a role straight to a pi Model object.
 *
 * The CALLER passes its modelRegistry (ctx.modelRegistry) so this module never
 * imports the pi runtime. Returns null when the role resolves to null (no spec).
 * Throws a clear error when the spec lacks a provider or the registry can't find
 * the model — fail loud, per Timo's philosophy, rather than silently degrading.
 *
 * @param {string} role
 * @param {{find: (provider: string, id: string) => unknown}} modelRegistry
 * @param {{override?: string, agentDir?: string, quiet?: boolean}} [opts]
 * @returns {{model: unknown, provider?: string, id: string, thinking?: string, spec: string} | null}
 */
export function resolveRoleModel(role, modelRegistry, opts = {}) {
  const resolved = resolveRole(role, opts);
  if (!resolved) return null;
  if (!modelRegistry || typeof modelRegistry.find !== "function") {
    throw new Error("roles: resolveRoleModel requires a modelRegistry with a find(provider, id) method");
  }
  if (!resolved.provider) {
    throw new Error(
      `roles: role '${role}' resolved to spec '${resolved.spec}' without a provider; ` +
        "resolveRoleModel needs 'provider/model'.",
    );
  }
  const model = modelRegistry.find(resolved.provider, resolved.model);
  if (!model) {
    throw new Error(
      `roles: modelRegistry.find('${resolved.provider}', '${resolved.model}') returned nothing ` +
        `for role '${role}'. Check that the provider/model in roles.json is available.`,
    );
  }
  return {
    model,
    provider: resolved.provider,
    id: resolved.model,
    thinking: resolved.thinking,
    spec: resolved.spec,
  };
}

export default resolveRole;
