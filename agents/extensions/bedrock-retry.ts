/**
 * Bedrock empty-stop retry extension
 *
 * Bedrock's Converse stream occasionally closes cleanly with a
 * `messageStop` that has `stopReason: "stop"`, zero tokens, and no
 * content blocks — or no `messageStop` at all, which surfaces the same
 * shape. pi's default provider treats that as "assistant finished"
 * and ends the turn silently. See earendil-works/pi#4210.
 *
 * This extension wraps `streamBedrock` / `streamSimpleBedrock` via
 * `setBedrockProviderModule`. When the wrapped stream emits a `done`
 * event whose message looks empty, we rewrite it to an `error` event
 * with a message matching pi's agent-session retry regex
 * (`/provider.?returned.?error/i`), so the turn is retried with
 * backoff instead of ended.
 *
 * Adapted from the sketch in
 * https://github.com/earendil-works/pi/issues/4210 (OP's extension).
 *
 * ## Resolving @earendil-works/pi-ai/bedrock-provider
 *
 * pi's extension loader aliases `@earendil-works/pi-ai` to pi-ai's
 * `dist/index.js` as a literal path replacement, so subpath imports
 * like `@earendil-works/pi-ai/bedrock-provider` come out as
 * `dist/index.js/bedrock-provider` — bogus. pi-ai's package.json also
 * only declares `import` conditional exports, so `require.resolve`
 * can't reach either the submodule or the package.json itself.
 *
 * We resolve it by filesystem topology: find pi's installed cli.js
 * via realpath(process.argv[1]), then look for a sibling
 * `node_modules/@earendil-works/pi-ai/dist/bedrock-provider.js`. Works
 * for npm/homebrew-style installs, which is how pi ships.
 */

import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type AssistantMessage,
  type AssistantMessageEvent,
  setBedrockProviderModule,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EMPTY_STOP_ERROR_MESSAGE =
  "provider returned error: empty response (no content, 0 tokens)";

interface BedrockProviderModule {
  streamBedrock: (
    model: unknown,
    context: unknown,
    options?: unknown,
  ) => AsyncIterable<AssistantMessageEvent>;
  streamSimpleBedrock: (
    model: unknown,
    context: unknown,
    options?: unknown,
  ) => AsyncIterable<AssistantMessageEvent>;
}

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

async function* rewriteEmptyStop(
  source: AsyncIterable<AssistantMessageEvent>,
): AsyncIterable<AssistantMessageEvent> {
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
      yield { type: "error", reason: "error", error: rewritten };
      continue;
    }
    yield event;
  }
}

/**
 * Locate pi-ai's bedrock-provider.js by filesystem topology. Returns
 * null if the expected layout isn't found — caller should leave the
 * default provider in place rather than breaking pi startup.
 */
function findBedrockProviderFile(): string | null {
  try {
    const piCliPath = realpathSync(process.argv[1]);
    // nested layout: <pi-coding-agent>/node_modules/@earendil-works/pi-ai/...
    const nested = resolve(
      dirname(piCliPath),
      "..",
      "node_modules",
      "@earendil-works",
      "pi-ai",
      "dist",
      "bedrock-provider.js",
    );
    if (existsSync(nested)) return nested;
    // flattened layout: .../node_modules/@earendil-works/{pi-coding-agent,pi-ai}/...
    const flat = resolve(
      dirname(piCliPath),
      "..",
      "..",
      "pi-ai",
      "dist",
      "bedrock-provider.js",
    );
    if (existsSync(flat)) return flat;
    return null;
  } catch {
    return null;
  }
}

export default async function (_pi: ExtensionAPI): Promise<void> {
  const providerFile = findBedrockProviderFile();
  if (!providerFile) {
    console.error(
      "[bedrock-retry] could not locate @earendil-works/pi-ai/bedrock-provider.js — default provider left in place",
    );
    return;
  }
  const mod = (await import(pathToFileURL(providerFile).href)) as {
    bedrockProviderModule: BedrockProviderModule;
  };
  const inner = mod.bedrockProviderModule;
  setBedrockProviderModule({
    streamBedrock: ((model, context, options) =>
      rewriteEmptyStop(
        inner.streamBedrock(model, context, options),
      )) as typeof inner.streamBedrock,
    streamSimpleBedrock: ((model, context, options) =>
      rewriteEmptyStop(
        inner.streamSimpleBedrock(model, context, options),
      )) as typeof inner.streamSimpleBedrock,
  });
}
