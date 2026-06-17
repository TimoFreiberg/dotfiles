/**
 * Session Search Tool
 *
 * Registers a model-callable `session_search` tool that searches across PAST
 * pi session transcripts on disk. pi stores every session as JSONL under the
 * agent dir's `sessions/` tree but has no search-across-sessions capability —
 * `/resume` only lists, it can't grep. This lets the agent recall prior work
 * ("how did we configure X last week", "the auth fix from before").
 *
 * configRole: NONE — this tool runs no LLM of its own. It streams JSONL off
 * disk, matches a substring/regex, and returns ranked hits as plain text the
 * calling agent reads directly. No model call, no summarization.
 *
 * ## How it works
 *
 * - scope:"cwd" (default) searches only the session dir for the current cwd
 *   (`sessions/--<cwd-encoded>--/`). scope:"all" walks every session dir.
 * - Each *.jsonl is streamed line-by-line (readline over createReadStream) so
 *   we never load a whole transcript into memory.
 * - For each `type:"message"` entry, message.content is flattened to text and
 *   matched. CRITICAL: message.content is SOMETIMES a plain string (the
 *   UserMessage `string | block[]` union) and SOMETIMES a content-block array
 *   (assistant messages, and user messages on this machine's sessions). Both
 *   shapes are handled in `flattenMessageContent` or matches silently miss.
 * - Hits are ranked most-recent-first (by entry timestamp) and capped to
 *   `limit`. Each hit carries: session file path, session display name,
 *   timestamp, role, and a trimmed snippet centered on the match.
 *
 * ## Path encoding (must mirror pi)
 *
 * The cwd -> session-dir encoding (`--<path-with-/-replaced-by-->--`) and the
 * agent-dir resolution (PI_CODING_AGENT_DIR, else ~/.pi/agent) are inlined
 * here, copied from agents/extensions/prompt-editor.ts. They must match pi's
 * own layout (config.ts getAgentDir / getSessionDirForCwd); if pi changes the
 * scheme, scope:"cwd" goes silent (scope:"all" still works — it walks the
 * whole sessions tree regardless of encoding).
 *
 * ## Symlink-safe
 *
 * This file is self-contained: it imports nothing from sibling extension files.
 * pi loads extensions through the `~/.pi/agent/extensions` symlink and resolves
 * relative imports against the symlink path, so cross-tree relative imports can
 * break at runtime. The small helpers adapted from prompt-editor.ts and
 * session-breakdown.ts are inlined rather than imported.
 */

import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { createReadStream, type Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
// scope:"all" can touch hundreds of files; cap age by default so it stays
// responsive. scope:"cwd" has no default age cap (a single dir is cheap).
const DEFAULT_MAX_AGE_DAYS_ALL = 30;
const SNIPPET_RADIUS = 120; // chars of context on each side of the match
const SNIPPET_MAX = 400; // hard cap on snippet length

// ---------------------------------------------------------------------------
// Path helpers — mirror pi's own session-dir layout (see prompt-editor.ts).
// ---------------------------------------------------------------------------

function expandUserPath(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Mirror pi-coding-agent's getAgentDir(): PI_CODING_AGENT_DIR, else ~/.pi/agent. */
function getGlobalAgentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR;
  if (env) return expandUserPath(env);
  return path.join(os.homedir(), ".pi", "agent");
}

function getSessionsRoot(): string {
  return path.join(getGlobalAgentDir(), "sessions");
}

/** Mirror pi's cwd -> `--<encoded>--` session dir name. */
function getSessionDirForCwd(cwd: string): string {
  const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(getSessionsRoot(), safePath);
}

// ---------------------------------------------------------------------------
// Content flattening — handle BOTH string and block-array message.content.
// ---------------------------------------------------------------------------

/**
 * UserMessage.content is `string | (TextContent | ImageContent)[]`;
 * AssistantMessage.content is always a block array (text/thinking/toolCall).
 * Flatten any of these to a single searchable string. Missing this duality
 * means string-content user messages never match.
 */
function flattenMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    // text blocks (user + assistant)
    if (typeof b.text === "string") parts.push(b.text);
    // assistant thinking blocks
    if (typeof b.thinking === "string") parts.push(b.thinking);
    // tool calls: include tool name + stringified args so "we ran the X tool"
    // style recall works.
    if (b.type === "toolCall") {
      if (typeof b.name === "string") parts.push(b.name);
      if (b.arguments && typeof b.arguments === "object") {
        try {
          parts.push(JSON.stringify(b.arguments));
        } catch {
          // ignore unstringifiable args
        }
      }
    }
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

interface Matcher {
  test(haystack: string): number; // returns match index, or -1
  length: number; // length of the matched needle for snippet centering
}

function buildMatcher(query: string, useRegex: boolean): Matcher {
  if (useRegex) {
    let re: RegExp;
    try {
      re = new RegExp(query, "i");
    } catch (err) {
      throw new Error(
        `Invalid regex for session_search query: ${(err as Error).message}`,
      );
    }
    return {
      test(haystack: string): number {
        re.lastIndex = 0;
        const m = re.exec(haystack);
        if (!m) return -1;
        // length tracked via the actual match for snippet centering.
        (this as Matcher).length = m[0].length || 1;
        return m.index;
      },
      length: query.length || 1,
    };
  }

  const needle = query.toLowerCase();
  return {
    test(haystack: string): number {
      return haystack.toLowerCase().indexOf(needle);
    },
    length: needle.length || 1,
  };
}

// ---------------------------------------------------------------------------
// Session walking + parsing
// ---------------------------------------------------------------------------

interface SessionDirEntry {
  filePath: string;
  startedAt: Date | null;
  mtimeMs: number;
}

/** Parse `2026-02-02T21-52-28-774Z_<uuid>.jsonl` into a Date (or null). */
function parseSessionStartFromFilename(name: string): Date | null {
  const m = name.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/,
  );
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Collect *.jsonl files under the given roots, honoring an optional age cutoff.
 * Walks recursively (scope:"all" passes the sessions root; scope:"cwd" passes a
 * single dir, but recursion is harmless and future-proof).
 */
async function collectSessionFiles(
  roots: string[],
  cutoffMs: number | null,
): Promise<SessionDirEntry[]> {
  const out: SessionDirEntry[] = [];
  const stack = [...roots];
  const seen = new Set<string>();

  while (stack.length) {
    const dir = stack.pop()!;
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // missing dir (e.g. cwd never had a session) — not an error
    }

    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!ent.isFile() || !ent.name.endsWith(".jsonl")) continue;
      if (seen.has(p)) continue;
      seen.add(p);

      const startedAt = parseSessionStartFromFilename(ent.name);
      let mtimeMs = startedAt ? startedAt.getTime() : 0;
      if (!startedAt) {
        // Fall back to mtime for non-standard filenames.
        try {
          const st = await fs.stat(p);
          mtimeMs = st.mtimeMs;
        } catch {
          continue;
        }
      }

      if (cutoffMs !== null && mtimeMs < cutoffMs) continue;
      out.push({ filePath: p, startedAt, mtimeMs });
    }
  }

  // Newest-first so the most-recent sessions are searched (and ranked) first.
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

interface Hit {
  filePath: string;
  sessionName: string;
  role: string;
  timestampMs: number;
  timestampIso: string;
  snippet: string;
}

function buildSnippet(
  text: string,
  matchIndex: number,
  matchLen: number,
): string {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(text.length, matchIndex + matchLen + SNIPPET_RADIUS);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  // Collapse whitespace/newlines so a hit is one readable line.
  snippet = snippet.replace(/\s+/g, " ").trim();
  if (snippet.length > SNIPPET_MAX) {
    snippet = snippet.slice(0, SNIPPET_MAX) + "…";
  }
  return snippet;
}

function parseEntryTimestampMs(entry: any, message: any): number {
  // message.timestamp is unix ms; entry.timestamp is ISO. Prefer message.
  if (
    typeof message?.timestamp === "number" &&
    Number.isFinite(message.timestamp)
  ) {
    return message.timestamp;
  }
  if (typeof entry?.timestamp === "string") {
    const d = new Date(entry.timestamp);
    if (Number.isFinite(d.getTime())) return d.getTime();
  }
  return 0;
}

/**
 * Stream one session file, collecting hits. Also resolves the session display
 * name: a `session_info` entry's `name` (set via /name) takes precedence,
 * else the first user message's text (mirrors pi's /resume display logic).
 */
async function searchSessionFile(
  filePath: string,
  matcher: Matcher,
  roleFilter: "user" | "assistant" | undefined,
  signal: AbortSignal | undefined,
): Promise<Hit[]> {
  const hits: Hit[] = [];
  let sessionName: string | null = null;
  let firstUserText: string | null = null;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (signal?.aborted) break;
      if (!line) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry?.type === "session_info" && typeof entry.name === "string") {
        // Latest session_info wins (we keep overwriting as we stream).
        sessionName = entry.name.trim() || sessionName;
        continue;
      }

      if (entry?.type !== "message") continue;
      const message = entry.message;
      if (!message || typeof message.role !== "string") continue;

      const role = message.role;
      const text = flattenMessageContent(message.content);

      if (role === "user" && firstUserText === null && text.trim()) {
        firstUserText = text.trim();
      }

      // Only user/assistant are matchable roles; honor the role filter.
      if (role !== "user" && role !== "assistant") continue;
      if (roleFilter && role !== roleFilter) continue;
      if (!text) continue;

      const idx = matcher.test(text);
      if (idx < 0) continue;

      hits.push({
        filePath,
        sessionName: "", // filled after we know the final name
        role,
        timestampMs: parseEntryTimestampMs(entry, message),
        timestampIso: "",
        snippet: buildSnippet(text, idx, matcher.length),
      });
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  const displayName =
    sessionName ??
    (firstUserText
      ? firstUserText.replace(/\s+/g, " ").slice(0, 80)
      : path.basename(filePath));

  for (const h of hits) {
    h.sessionName = displayName;
    h.timestampIso =
      h.timestampMs > 0 ? new Date(h.timestampMs).toISOString() : "";
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Core search (shared by tool + command)
// ---------------------------------------------------------------------------

interface SearchParams {
  query: string;
  scope: "cwd" | "all";
  role?: "user" | "assistant";
  limit: number;
  maxAgeDays?: number;
  regex: boolean;
  cwd: string;
}

interface SearchOutcome {
  hits: Hit[];
  filesSearched: number;
  truncated: boolean;
  scope: "cwd" | "all";
  cwdDirMissing: boolean;
}

async function runSearch(
  params: SearchParams,
  signal: AbortSignal | undefined,
): Promise<SearchOutcome> {
  const matcher = buildMatcher(params.query, params.regex);

  let roots: string[];
  let cwdDirMissing = false;
  if (params.scope === "all") {
    roots = [getSessionsRoot()];
  } else {
    const dir = getSessionDirForCwd(path.resolve(params.cwd));
    try {
      await fs.access(dir);
    } catch {
      cwdDirMissing = true;
    }
    roots = [dir];
  }

  // Resolve age cutoff. scope:"all" defaults to a cap; scope:"cwd" is unbounded
  // unless explicitly capped.
  let maxAgeDays = params.maxAgeDays;
  if (maxAgeDays === undefined && params.scope === "all") {
    maxAgeDays = DEFAULT_MAX_AGE_DAYS_ALL;
  }
  const cutoffMs =
    maxAgeDays !== undefined && maxAgeDays > 0
      ? Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
      : null;

  const files = await collectSessionFiles(roots, cutoffMs);

  const allHits: Hit[] = [];
  let filesSearched = 0;
  for (const file of files) {
    if (signal?.aborted) break;
    filesSearched += 1;
    const hits = await searchSessionFile(
      file.filePath,
      matcher,
      params.role,
      signal,
    );
    allHits.push(...hits);
  }

  // Rank most-recent-first across all sessions, then cap.
  allHits.sort((a, b) => b.timestampMs - a.timestampMs);
  const truncated = allHits.length > params.limit;
  const capped = allHits.slice(0, params.limit);

  return {
    hits: capped,
    filesSearched,
    truncated,
    scope: params.scope,
    cwdDirMissing,
  };
}

// ---------------------------------------------------------------------------
// Result formatting (plain text the agent reads)
// ---------------------------------------------------------------------------

function homeAbbrev(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

function formatOutcome(outcome: SearchOutcome, query: string): string {
  if (outcome.hits.length === 0) {
    const lines: string[] = [];
    lines.push(
      `No matches for ${JSON.stringify(query)} in scope:${outcome.scope} ` +
        `(${outcome.filesSearched} session file${outcome.filesSearched === 1 ? "" : "s"} searched).`,
    );
    if (outcome.scope === "cwd" && outcome.cwdDirMissing) {
      lines.push(
        'No session directory exists for the current cwd yet. Try scope:"all" to search every project.',
      );
    } else if (outcome.scope === "cwd") {
      lines.push('Try scope:"all" to search across all projects.');
    }
    return lines.join("\n");
  }

  const lines: string[] = [];
  const header =
    `${outcome.hits.length} match${outcome.hits.length === 1 ? "" : "es"} for ` +
    `${JSON.stringify(query)} (scope:${outcome.scope}, ${outcome.filesSearched} files searched)` +
    (outcome.truncated
      ? ` — showing newest ${outcome.hits.length}, more exist`
      : "");
  lines.push(header);
  lines.push("");

  let i = 1;
  for (const h of outcome.hits) {
    const when = h.timestampIso
      ? h.timestampIso.replace("T", " ").replace(/\..*$/, "Z")
      : "unknown time";
    lines.push(`${i}. [${h.role}] ${when} — ${h.sessionName}`);
    lines.push(`   file: ${homeAbbrev(h.filePath)}`);
    lines.push(`   ${h.snippet}`);
    lines.push("");
    i += 1;
  }
  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

interface SessionSearchDetails {
  query: string;
  scope: "cwd" | "all";
  filesSearched: number;
  matchCount: number;
  truncated: boolean;
}

const sessionSearchTool = defineTool({
  name: "session_search",
  label: "Search Sessions",
  description:
    "Search across PAST pi session transcripts on disk for a substring (or regex). " +
    "Use this to recall prior work — what was discussed, decided, or configured in " +
    "earlier sessions. Returns ranked (most-recent-first) hits with the session name, " +
    "timestamp, role, file path, and a snippet of matching text. Read the snippets " +
    "directly; this tool does not call a model.",
  promptSnippet:
    "Search past pi session transcripts for prior discussions, decisions, or config",
  promptGuidelines: [
    'Call session_search when the user references prior work you don\'t have in context — phrases like "like we did before", "the X fix from last week", "how did we set up Y", "didn\'t we already discuss Z". Search rather than guess or say you don\'t recall.',
    'Default scope is "cwd" (this project\'s sessions). Use scope:"all" to search across every project when the work might have happened elsewhere; it auto-caps to recent sessions (~30 days) unless you pass maxAgeDays.',
    "query is a case-insensitive substring by default. Set regex:true only for an actual pattern. Use the most distinctive keyword from what the user described (a filename, a flag, an error string) for the best hit rate.",
    "Each hit names the session and timestamp. If a hit looks relevant, you can read the full session file at the printed path for surrounding context.",
  ],
  parameters: Type.Object({
    query: Type.String({
      description:
        "Text to search for in past session messages. Case-insensitive substring by default; a regex when regex:true.",
    }),
    scope: Type.Optional(
      Type.Union([Type.Literal("cwd"), Type.Literal("all")], {
        description:
          '"cwd" (default) searches only this project\'s sessions. "all" searches every project\'s sessions (auto-capped to recent unless maxAgeDays is set).',
      }),
    ),
    role: Type.Optional(
      Type.Union([Type.Literal("user"), Type.Literal("assistant")], {
        description:
          "Restrict matches to one side of the conversation. Omit to match both user and assistant messages.",
      }),
    ),
    limit: Type.Optional(
      Type.Integer({
        description: `Max hits to return, newest first. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
        minimum: 1,
      }),
    ),
    maxAgeDays: Type.Optional(
      Type.Number({
        description:
          'Skip sessions older than this many days. Defaults to no cap for scope:"cwd" and ~30 days for scope:"all".',
        minimum: 0,
      }),
    ),
    regex: Type.Optional(
      Type.Boolean({
        description:
          "Treat query as a case-insensitive JS regular expression instead of a literal substring. Default false.",
      }),
    ),
  }),

  async execute(
    _toolCallId,
    params,
    signal: AbortSignal | undefined,
    _onUpdate,
    ctx: ExtensionContext,
  ) {
    const query = (params.query ?? "").trim();
    if (!query) {
      const details: SessionSearchDetails = {
        query: "",
        scope: "cwd",
        filesSearched: 0,
        matchCount: 0,
        truncated: false,
      };
      return {
        content: [
          { type: "text" as const, text: "session_search: query was empty." },
        ],
        details,
      };
    }

    const scope = (params.scope ?? "cwd") as "cwd" | "all";
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Math.floor(params.limit ?? DEFAULT_LIMIT)),
    );

    const outcome = await runSearch(
      {
        query,
        scope,
        role: params.role,
        limit,
        maxAgeDays: params.maxAgeDays,
        regex: params.regex ?? false,
        cwd: ctx.cwd,
      },
      signal,
    );

    const text = formatOutcome(outcome, query);
    const details: SessionSearchDetails = {
      query,
      scope: outcome.scope,
      filesSearched: outcome.filesSearched,
      matchCount: outcome.hits.length,
      truncated: outcome.truncated,
    };

    return {
      content: [{ type: "text" as const, text }],
      details,
    };
  },

  renderResult(result, _options, theme) {
    const details = result.details as SessionSearchDetails | undefined;
    const text = result.content[0];
    const body = text?.type === "text" ? text.text : "";
    if (!details) return new Text(body, 0, 0);

    const title = theme.fg(
      "toolTitle",
      theme.bold(
        `session_search: ${details.matchCount} hit${details.matchCount === 1 ? "" : "s"} (scope:${details.scope})`,
      ),
    );
    return new Text(`${title}\n${theme.fg("muted", body)}`, 0, 0);
  },
});

// ---------------------------------------------------------------------------
// Extension entrypoint
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.registerTool(sessionSearchTool);

  // Optional UI command mirroring the same core, so a human can grep their own
  // sessions interactively. `/search-sessions <query>` (scope:cwd) or
  // `/search-sessions --all <query>`.
  pi.registerCommand("search-sessions", {
    description:
      "Search past pi session transcripts for a substring (scope:cwd; pass --all for every project)",
    handler: async (args: string, ctx: ExtensionContext) => {
      const raw = (args ?? "").trim();
      let scope: "cwd" | "all" = "cwd";
      let query = raw;
      if (/^--all\b/.test(raw)) {
        scope = "all";
        query = raw.replace(/^--all\b\s*/, "").trim();
      }

      if (!query) {
        pi.sendMessage(
          {
            customType: "session-search",
            content:
              "Usage: /search-sessions [--all] <query>\nSearches past session transcripts (scope:cwd by default).",
            display: true,
          },
          { triggerTurn: false },
        );
        return;
      }

      const outcome = await runSearch(
        {
          query,
          scope,
          limit: DEFAULT_LIMIT,
          regex: false,
          cwd: ctx.cwd,
        },
        undefined,
      );

      pi.sendMessage(
        {
          customType: "session-search",
          content: formatOutcome(outcome, query),
          display: true,
        },
        { triggerTurn: false },
      );
    },
  });
}
