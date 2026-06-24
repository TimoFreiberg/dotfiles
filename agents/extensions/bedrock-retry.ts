/**
 * Bedrock workarounds extension
 *
 * Wraps Bedrock's provider streams via `setBedrockProviderModule`
 * to patch two upstream pi-ai bugs that
 * both cause turns to end with the agent obviously unfinished:
 *
 * 1. earendil-works/pi#4210 — Bedrock's Converse stream occasionally
 *    closes cleanly with a `messageStop` that has `stopReason:
 *    "stop"`, zero tokens, and no content blocks — or no `messageStop`
 *    at all, which surfaces the same shape. pi's default provider
 *    treats that as "assistant finished" and ends the turn silently.
 *    We rewrite the empty `done` event to an `error` event whose
 *    message matches pi's agent-session retry regex
 *    (`/provider.?returned.?error/i`), so the turn is retried with
 *    backoff instead of ended.
 *
 * 2. earendil-works/pi#4848 — for Claude models with adaptive thinking
 *    (Opus 4.6+, Sonnet 4.6+, Fable 5) running with reasoning enabled,
 *    `streamSimple` takes a branch that does not set
 *    `options.maxTokens`. `stream` only puts `maxTokens` in
 *    the Converse `inferenceConfig` when defined, so Bedrock falls
 *    back to its per-model default of 4096. Result: the model spends
 *    its whole output budget inside one thinking block and emits no
 *    visible text or tool call. We inject `maxTokens: model.maxTokens`
 *    (e.g. 128_000 for Opus 4.7) when the caller hasn't set one and
 *    the model is on the broken path.
 *
 * Both wraps are temporary — delete the corresponding piece when each
 * upstream issue lands. Combined into one file because
 * `setBedrockProviderModule` is global: two separate extensions would
 * each read the un-wrapped original module, and the second
 * `setBedrockProviderModule` call would clobber the first.
 *
 * The empty-stop wrap is adapted from the sketch in
 * https://github.com/earendil-works/pi/issues/4210 (OP's extension).
 *
 * ## Resolving @earendil-works/pi-ai files
 *
 * pi's extension loader aliases `@earendil-works/pi-ai` to pi-ai's
 * bundled entrypoint as a literal path replacement, so unsupported subpath
 * imports like `@earendil-works/pi-ai/bedrock-provider` come out as
 * `<entrypoint>.js/bedrock-provider` — bogus. pi-ai's package.json also
 * only declares `import` conditional exports, so `require.resolve`
 * can't reach either the submodule or the package.json itself.
 *
 * We resolve pi-ai files by filesystem topology: find pi's installed cli.js
 * via realpath(process.argv[1]), then look for sibling files under
 * `node_modules/@earendil-works/pi-ai/dist/`. Works for
 * npm/homebrew-style installs, which is how pi ships.
 */

import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type AssistantMessage,
  type AssistantMessageEvent,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EMPTY_STOP_ERROR_MESSAGE =
  "provider returned error: empty response (no content, 0 tokens)";

interface AssistantMessageEventStreamLike extends AsyncIterable<AssistantMessageEvent> {
  result(): Promise<AssistantMessage>;
}

type ProviderStreamFunction = (
  model: unknown,
  context: unknown,
  options?: unknown,
) => AssistantMessageEventStreamLike;

interface BedrockProviderModule {
  stream?: ProviderStreamFunction;
  streamSimple?: ProviderStreamFunction;
  streamBedrock?: ProviderStreamFunction;
  streamSimpleBedrock?: ProviderStreamFunction;
}

type SetBedrockProviderModule = (module: BedrockProviderModule) => void;

function isEmptyStop(message: AssistantMessage): boolean {
  if (message.stopReason !== "stop") return false;
  const tokens = message.usage?.totalTokens ?? 0;
  const content = Array.isArray(message.content) ? message.content : [];
  const hasContent = content.some((c) => {
    if (!c || typeof c !== "object") return false;
    if (c.type === "text" && typeof c.text === "string" && c.text.length > 0)
      return true;
    if (
      c.type === "thinking" &&
      typeof c.thinking === "string" &&
      c.thinking.length > 0
    )
      return true;
    if (c.type === "toolCall") return true;
    return false;
  });
  return tokens === 0 && !hasContent;
}

/**
 * Mirror pi-ai's own conditions for the broken adaptive-thinking branch:
 * `isAnthropicClaudeModel(model) && supportsAdaptiveThinking(model.id, model.name)
 * && options.reasoning` (see api/bedrock-converse-stream.js streamSimple).
 * When all three are true and the caller has not set `options.maxTokens`,
 * pi sends no `maxTokens` to Bedrock, so Bedrock applies its 4096 default.
 * We inject `model.maxTokens` precisely on that path; everywhere else this
 * is a no-op.
 */
function shouldInjectMaxTokens(model: unknown, options: unknown): boolean {
  if (model === null || typeof model !== "object") return false;
  if (
    options !== undefined &&
    (options === null || typeof options !== "object")
  )
    return false;
  const m = model as { id?: unknown; name?: unknown; maxTokens?: unknown };
  const o = (options ?? {}) as { maxTokens?: unknown; reasoning?: unknown };
  if (o.maxTokens !== undefined) return false;
  if (typeof m.maxTokens !== "number" || m.maxTokens <= 4096) return false;
  if (typeof m.id !== "string") return false;
  const id = m.id.toLowerCase();
  const name = typeof m.name === "string" ? m.name.toLowerCase() : "";
  const isClaude =
    id.includes("anthropic.claude") ||
    id.includes("anthropic/claude") ||
    name.includes("claude");
  if (!isClaude) return false;
  const candidates = [id, name];
  const isAdaptive = candidates.some(
    (s) =>
      s.includes("opus-4-6") ||
      s.includes("opus-4-7") ||
      s.includes("opus-4-8") ||
      s.includes("sonnet-4-6") ||
      s.includes("fable-5"),
  );
  if (!isAdaptive) return false;
  if (o.reasoning === undefined || o.reasoning === null) return false;
  return true;
}

function injectMaxTokensIfNeeded(model: unknown, options: unknown): unknown {
  if (!shouldInjectMaxTokens(model, options)) return options;
  const modelMax = (model as { maxTokens: number }).maxTokens;
  return { ...((options ?? {}) as object), maxTokens: modelMax };
}

function rewriteEmptyStop(
  source: AssistantMessageEventStreamLike,
): AssistantMessageEventStreamLike {
  const stream = createAssistantMessageEventStream();
  void (async () => {
    for await (const event of source) {
      if (event.type === "done" && isEmptyStop(event.message)) {
        const rewritten: AssistantMessage = {
          ...event.message,
          stopReason: "error",
          errorMessage: EMPTY_STOP_ERROR_MESSAGE,
        };
        console.error(
          `[bedrock-retry] empty stop from ${rewritten.model} — rewriting to retryable error`,
        );
        stream.push({ type: "error", reason: "error", error: rewritten });
        continue;
      }
      stream.push(event);
    }
    stream.end();
  })();
  return stream;
}

/**
 * Locate a pi-ai dist file by filesystem topology. Returns null if the
 * expected layout isn't found — caller should leave the default provider
 * in place rather than breaking pi startup.
 *
 * Tries two anchor sources for pi-coding-agent's dist/ directory:
 * 1. process.argv[1] — works when pi is the process entry (CLI mode).
 * 2. PATH scan for the `pi` binary — works when pi is embedded via the
 *    SDK inside another process (e.g. a bun server), where process.argv[1]
 *    is the host entry, not pi's cli.js.
 */
function findPiAiDistFile(...pathSegments: string[]): string | null {
  try {
    const anchors: string[] = [];
    try {
      anchors.push(realpathSync(process.argv[1]));
    } catch {}
    for (const dir of (process.env.PATH ?? "").split(":")) {
      const candidate = resolve(dir, "pi");
      if (existsSync(candidate)) {
        try {
          anchors.push(realpathSync(candidate));
        } catch {}
      }
    }
    for (const piCliPath of anchors) {
      const distDir = dirname(piCliPath);
      // nested layout: <pi-coding-agent>/node_modules/@earendil-works/pi-ai/...
      const nested = resolve(
        distDir,
        "..",
        "node_modules",
        "@earendil-works",
        "pi-ai",
        "dist",
        ...pathSegments,
      );
      if (existsSync(nested)) return nested;
      // flattened layout: .../node_modules/@earendil-works/{pi-coding-agent,pi-ai}/...
      const flat = resolve(
        distDir,
        "..",
        "..",
        "pi-ai",
        "dist",
        ...pathSegments,
      );
      if (existsSync(flat)) return flat;
    }
    return null;
  } catch {
    return null;
  }
}

function getProviderStream(
  module: BedrockProviderModule,
  preferredName: "stream" | "streamSimple",
  legacyName: "streamBedrock" | "streamSimpleBedrock",
): ProviderStreamFunction {
  const stream = module[preferredName] ?? module[legacyName];
  if (typeof stream !== "function") {
    throw new Error(
      `[bedrock-retry] bedrock provider module missing ${preferredName}/${legacyName}; found keys: ${Object.keys(
        module,
      ).join(", ")}`,
    );
  }
  return stream;
}

export default async function (_pi: ExtensionAPI): Promise<void> {
  const providerFile = findPiAiDistFile("bedrock-provider.js");
  if (!providerFile) {
    console.error(
      "[bedrock-retry] could not locate @earendil-works/pi-ai/dist/bedrock-provider.js — default provider left in place",
    );
    return;
  }
  const setterFile = findPiAiDistFile("api", "bedrock-converse-stream.lazy.js");
  if (!setterFile) {
    console.error(
      "[bedrock-retry] could not locate @earendil-works/pi-ai/dist/api/bedrock-converse-stream.lazy.js — default provider left in place",
    );
    return;
  }
  const mod = (await import(pathToFileURL(providerFile).href)) as {
    bedrockProviderModule: BedrockProviderModule;
  };
  const { setBedrockProviderModule } = (await import(
    pathToFileURL(setterFile).href
  )) as { setBedrockProviderModule: SetBedrockProviderModule };
  const inner = mod.bedrockProviderModule;
  const streamBedrock = getProviderStream(inner, "stream", "streamBedrock");
  const streamSimpleBedrock = getProviderStream(
    inner,
    "streamSimple",
    "streamSimpleBedrock",
  );
  const wrappedStream: ProviderStreamFunction = (model, context, options) =>
    rewriteEmptyStop(
      streamBedrock(model, context, injectMaxTokensIfNeeded(model, options)),
    );
  const wrappedStreamSimple: ProviderStreamFunction = (
    model,
    context,
    options,
  ) =>
    rewriteEmptyStop(
      streamSimpleBedrock(
        model,
        context,
        injectMaxTokensIfNeeded(model, options),
      ),
    );

  setBedrockProviderModule({
    stream: wrappedStream,
    streamSimple: wrappedStreamSimple,
    streamBedrock: wrappedStream,
    streamSimpleBedrock: wrappedStreamSimple,
  });
}
