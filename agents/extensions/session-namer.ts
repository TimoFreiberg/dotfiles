/**
 * Session namer.
 *
 * On the first user prompt of an as-yet-unnamed session, asks the `text-summary`
 * role (resolved per-machine via _lib/roles.mjs) for a short, distinguishing
 * name and sets it with pi.setSessionName(). Names show up in the session
 * selector instead of the raw first message.
 *
 * Fire-and-forget: the agent starts replying with zero added latency; the name
 * lands a moment later once the (cheap) model returns.
 *
 * Only fires when ALL of these hold:
 *  - the session has no explicit name yet  -> never overrides a manual name
 *  - the input is a real idle prompt        -> not a mid-stream steer / followup
 *  - source is interactive or rpc           -> not an extension-injected message
 *  - we're in a UI mode (hasUI)             -> skips one-shot `-p` / json runs
 * An in-flight guard stops a quick second prompt from launching a parallel name.
 *
 * Degrades gracefully, per Timo's "fail loud but don't corrupt downstream"
 * philosophy: any failure (role unresolved, no auth, model/network error, empty
 * result) emits a quiet warning and leaves the session unnamed. Naming a session
 * is a convenience — it must never block or crash the turn.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  complete,
  type Api,
  type Model,
  type UserMessage,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/**
 * Shared per-machine role -> model resolver (agents/_lib/roles.mjs).
 *
 * It lives OUTSIDE the extension dir, so a static relative import breaks: pi
 * discovers this extension through the symlink ~/.pi/agent/extensions ->
 * dotfiles/agents/extensions and resolves relative imports against that symlink
 * path, where ../_lib does not exist. We realpath import.meta.url (which crosses
 * the symlink) and dynamic-import the resolver by its absolute on-disk path.
 * Cached so we import it once. Mirrors extensions/answer.ts.
 */
type ResolveRoleModelFn = (
  role: string,
  modelRegistry: {
    find: (provider: string, id: string) => Model<Api> | undefined;
  },
  opts?: { override?: string; agentDir?: string; quiet?: boolean },
) => {
  model: Model<Api>;
  provider?: string;
  id: string;
  thinking?: string;
  spec: string;
} | null;

let resolveRoleModelPromise: Promise<ResolveRoleModelFn> | null = null;
function getResolveRoleModel(): Promise<ResolveRoleModelFn> {
  if (!resolveRoleModelPromise) {
    const realHere = path.dirname(
      fs.realpathSync(fileURLToPath(import.meta.url)),
    );
    const rolesPath = path.resolve(realHere, "../_lib/roles.mjs");
    resolveRoleModelPromise = import(pathToFileURL(rolesPath).href).then(
      (mod) => mod.resolveRoleModel as ResolveRoleModelFn,
    );
  }
  return resolveRoleModelPromise;
}

// The role tuned for this in roles.json. Keeping it a role (not a hardcoded
// model) is the point: the model behind it changes per machine / over time
// while this extension stays constant.
const ROLE = "text-summary";

// Hard cap. ~25 is the readable sweet spot; the prompt asks the model to aim
// there, and sanitizeName() enforces the ceiling regardless of what comes back.
const MAX_LEN = 40;

const SYSTEM_PROMPT = [
  "You generate a short title for a coding session, from the user's first message.",
  "Rules:",
  "- Output ONLY the title. No quotes, no trailing punctuation, no preamble.",
  "- Capture the specific task or topic so the session is easy to tell apart from",
  "  others in a list. Use concrete words from the request; avoid generic filler",
  '  like "help", "task", or "session".',
  "- Under 40 characters; aim for about 25. A short phrase, not a sentence.",
  "Examples: Fix auth redirect loop / Add dark-mode toggle / Debug flaky CI test",
].join("\n");

const errText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Clean up whatever the model returns into a tidy <=MAX_LEN label: first line
 * only, strip wrapping quotes and any "Title:"-style prefix, collapse
 * whitespace, then truncate on a word boundary when one is close to the cap.
 */
function sanitizeName(raw: string): string {
  let name = (raw.split("\n")[0] ?? "").trim();
  name = name.replace(/^["'`]+|["'`]+$/g, "").trim();
  name = name
    .replace(/^(session\s*name|title|name|session)\s*[:\-]\s*/i, "")
    .trim();
  name = name.replace(/\s+/g, " ");

  if (name.length > MAX_LEN) {
    name = name.slice(0, MAX_LEN);
    const lastSpace = name.lastIndexOf(" ");
    if (lastSpace >= MAX_LEN - 12) name = name.slice(0, lastSpace);
    name = name.replace(/[\s\-–—:;,.]+$/, "").trim();
  }
  return name;
}

/**
 * Resolve the role, authenticate, ask for a name, set it. Every failure path
 * returns quietly (warning notify only) without throwing — callers run this
 * fire-and-forget.
 */
async function nameSession(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  prompt: string,
): Promise<void> {
  const note = (msg: string) => {
    if (ctx.hasUI) ctx.ui.notify(msg, "warning");
  };

  let resolved: ReturnType<ResolveRoleModelFn>;
  try {
    const resolveRoleModel = await getResolveRoleModel();
    resolved = resolveRoleModel(ROLE, ctx.modelRegistry);
  } catch (err) {
    note(`session-namer: role '${ROLE}' unavailable (${errText(err)})`);
    return;
  }
  if (!resolved) {
    note(`session-namer: role '${ROLE}' resolved to no model`);
    return;
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(resolved.model);
  if (!auth.ok) {
    note(`session-namer: no auth for ${resolved.spec} (${auth.error})`);
    return;
  }

  const userMessage: UserMessage = {
    role: "user",
    content: [{ type: "text", text: prompt }],
    timestamp: Date.now(),
  };

  let response: Awaited<ReturnType<typeof complete>>;
  try {
    response = await complete(
      resolved.model,
      { systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
      { apiKey: auth.apiKey, headers: auth.headers },
    );
  } catch (err) {
    note(`session-namer: naming call failed (${errText(err)})`);
    return;
  }

  if (response.stopReason === "aborted" || response.stopReason === "error") {
    return;
  }

  const text = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join(" ");

  const name = sanitizeName(text);
  if (!name) {
    note("session-namer: model returned an empty name");
    return;
  }

  // A manual name (or another extension) may have landed while we were out on
  // the model call — don't clobber it.
  if (pi.getSessionName()) return;

  pi.setSessionName(name);
  if (ctx.hasUI) ctx.ui.notify(`Session named: ${name}`, "info");
}

export default function (pi: ExtensionAPI) {
  // Guards a single naming attempt at a time. If the attempt fails the session
  // stays unnamed, so the next prompt retries; once it succeeds, the
  // getSessionName() check below short-circuits all future prompts.
  let inFlight = false;

  pi.on("input", async (event, ctx) => {
    if (
      inFlight ||
      event.source === "extension" || // injected by another extension
      event.streamingBehavior !== undefined || // mid-stream steer / queued followup
      !ctx.hasUI || // one-shot -p / json run: no selector to benefit
      pi.getSessionName() // already named (manual or a prior auto-name)
    ) {
      return { action: "continue" };
    }

    const prompt = event.text.trim();
    if (!prompt) return { action: "continue" };

    inFlight = true;
    // Fire-and-forget: returning immediately keeps the agent's first token
    // un-delayed by the naming round-trip.
    void nameSession(pi, ctx, prompt).finally(() => {
      inFlight = false;
    });

    return { action: "continue" };
  });
}
