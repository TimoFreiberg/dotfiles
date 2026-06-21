/**
 * Dev-server starter (preview_serve)
 *
 * The browser half of previewing now lives in playwright-mcp (driven via
 * pi-mcp-adapter — see config/pi/agent/mcp.json). This extension keeps only the
 * one piece no browser MCP will ever do for us: make sure the app's dev server
 * is actually running, and do it WITHOUT the concurrent-session starvation that
 * sank the old `preview` extension.
 *
 * The fix is "Tier 1" reuse:
 *   1. Probe the URL BEFORE spawning. If something already serves it (e.g. a
 *      sibling session's `npm run dev`), ADOPT it — never start a second build.
 *      N concurrent sessions converge on ONE server instead of each kicking off
 *      its own build and thrashing the machine until every readiness poll times
 *      out (the original failure mode).
 *   2. Only ever kill a server WE spawned. An adopted server is left running on
 *      stop/shutdown, so one session can't pull the rug out from under another.
 *   3. No silently-swallowed logs: captured dev-server output is attached to the
 *      error when a spawn fails to come up (loud-failure philosophy).
 *
 * State is module scope = per pi process = per session. Cross-session coordination
 * is done at the OS level (the port probe), which works across processes without
 * any shared in-process registry or daemon.
 *
 * configRole: NONE — nothing here runs an LLM.
 *
 * Once a server is ready, drive/inspect the page with the playwright-mcp browser
 * tools (browser_navigate, browser_take_screenshot, browser_console_messages, …).
 */

import { type ChildProcess, spawn } from "node:child_process";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ── Module-level live state (one tracked server per session) ──────────────────

let devServer: ChildProcess | null = null;
let devServerCommand: string | null = null;
let servingUrl: string | null = null;
// True only when this session spawned `devServer`. Adopted servers leave this
// false so teardown never kills a process another session owns.
let weSpawnedIt = false;

// Ring-buffered dev-server output, surfaced only when a spawn fails to come up.
const MAX_OUTPUT_LINES = 60;
let outputTail: string[] = [];

function pushOutput(chunk: Buffer): void {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (!line) continue;
    outputTail.push(line);
    if (outputTail.length > MAX_OUTPUT_LINES) outputTail.shift();
  }
}

/** Normalize a leading @ that some models prepend, mirroring built-in tools. */
function stripAt(s: string): string {
  return s.startsWith("@") ? s.slice(1) : s;
}

// ── Reachability ──────────────────────────────────────────────────────────────

/** Any HTTP response (any status) means something is listening. */
async function isReachable(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Touch the body to release the socket; content is irrelevant.
    void res.arrayBuffer().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** Poll until `url` responds or we time out. */
async function waitForUrlReady(
  url: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  onUpdate?: (text: string) => void,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted)
      throw new Error("Aborted while waiting for dev server.");
    if (await isReachable(url, 2000)) return;
    attempt++;
    if (attempt % 5 === 0) onUpdate?.(`waiting for ${url}…`);
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `Dev server at ${url} did not become ready within ${timeoutMs}ms.`,
  );
}

// ── Process management ────────────────────────────────────────────────────────

/**
 * Spawn a dev server through a shell so the model can pass a normal command line
 * ("npm run dev", "python3 -m http.server 8000"). We own a process group so the
 * whole tree (dev servers often fork workers) can be killed via negative PID.
 */
function spawnDevServer(command: string, cwd: string): ChildProcess {
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  child.stdout?.on("data", pushOutput);
  child.stderr?.on("data", pushOutput);
  return child;
}

/** Resolve to an immediate spawn error, or null if the spawn looks fine. */
function firstSpawnError(child: ChildProcess): Promise<Error | null> {
  return new Promise((resolve) => {
    const onErr = (e: Error) => resolve(e);
    child.once("error", onErr);
    setTimeout(() => {
      child.removeListener("error", onErr);
      resolve(null);
    }, 200).unref?.();
  });
}

/** SIGTERM the process group, escalating to SIGKILL if it lingers. */
function killProcessGroup(child: ChildProcess): void {
  const groupKill = (sig: NodeJS.Signals) => {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, sig);
        return;
      } catch {
        /* fall through to direct kill */
      }
    }
    child.kill(sig);
  };
  try {
    groupKill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) {
        try {
          groupKill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }, 3000).unref?.();
  } catch {
    /* ignore */
  }
}

/** Kill a server WE spawned and clear its tracking. No-op for adopted servers. */
function killSpawned(): void {
  if (devServer) killProcessGroup(devServer);
  devServer = null;
  devServerCommand = null;
  weSpawnedIt = false;
}

/** Idempotent teardown shared by preview_serve_stop and session_shutdown. */
function teardown(): { killed: boolean; adopted: boolean } {
  const killed = weSpawnedIt && devServer != null;
  const adopted = !weSpawnedIt && servingUrl != null;
  killSpawned();
  servingUrl = null;
  outputTail = [];
  return { killed, adopted };
}

// ── Tools ─────────────────────────────────────────────────────────────────────

const serveTool = defineTool({
  name: "preview_serve",
  label: "Preview Serve",
  description:
    "Ensure a local dev server is running at `url`, reusing an already-running " +
    "one instead of starting a second. Probes `url` first: if something is " +
    "already serving it (e.g. another session's server), ADOPTS it without " +
    "spawning; otherwise runs `command` (e.g. 'npm run dev') in `cwd` and waits " +
    "until `url` responds. Idempotent and safe to call from concurrent sessions " +
    "— at most one server is started per URL. Once ready, open and inspect the " +
    "page with the playwright-mcp browser tools (browser_navigate, " +
    "browser_take_screenshot, …).",
  promptSnippet:
    "Make sure a web app's dev server is up (reusing one if already running)",
  promptGuidelines: [
    "Call preview_serve to ensure a web app's dev server is up before previewing it. It reuses an already-running server, so it is safe to call even if another session started one.",
    "preview_serve only manages the dev server. To open, screenshot, click, or inspect the page, use the playwright-mcp browser tools.",
    "Call preview_serve_stop when done. It tears down only a server THIS session spawned; an adopted server is left running.",
  ],
  parameters: Type.Object({
    url: Type.String({
      description:
        "URL the app should be reachable at, e.g. 'http://localhost:5173'. Probed for reuse and polled for readiness.",
    }),
    command: Type.Optional(
      Type.String({
        description:
          "Shell command to start the dev server if `url` is not already reachable, e.g. 'npm run dev'. Required only when nothing is serving `url`.",
      }),
    ),
    cwd: Type.Optional(
      Type.String({
        description:
          "Working directory for `command`. Defaults to the session cwd.",
      }),
    ),
    timeoutMs: Type.Optional(
      Type.Number({
        description:
          "Max time to wait for the server to become ready, in ms. Default 30000.",
      }),
    ),
  }),

  async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
    const url = stripAt(params.url);
    const timeoutMs = params.timeoutMs ?? 30_000;
    const emit = (text: string) =>
      onUpdate?.({ content: [{ type: "text", text }], details: {} });

    const reply = (text: string, details: Record<string, unknown>) => ({
      content: [{ type: "text" as const, text }],
      details,
    });

    // 1. Already reachable → adopt; never spawn a second server on a live port.
    if (await isReachable(url)) {
      const wasOurs = weSpawnedIt && servingUrl === url;
      if (!wasOurs) {
        // Drop any unrelated server we'd previously spawned, then record the
        // adoption (we do NOT own the live one and must not kill it later).
        if (weSpawnedIt) killSpawned();
        servingUrl = url;
      }
      return reply(
        wasOurs
          ? `Dev server already running at ${url} (started by this session).`
          : `Adopted existing dev server at ${url} — did NOT spawn a new one.`,
        { url, adopted: !wasOurs, spawned: wasOurs },
      );
    }

    // 2. Nothing is serving it → we must spawn, which needs a command.
    if (!params.command) {
      throw new Error(
        `Nothing is serving ${url} and no \`command\` was given to start one.`,
      );
    }

    // One tracked server at a time: replace any we previously spawned.
    if (weSpawnedIt) killSpawned();

    const cwd = params.cwd ? stripAt(params.cwd) : ctx.cwd;
    emit(`spawning dev server: ${params.command}`);
    outputTail = [];
    devServer = spawnDevServer(params.command, cwd);
    devServerCommand = params.command;
    weSpawnedIt = true;
    servingUrl = url;

    // Surface an immediate spawn failure loudly instead of hanging.
    const spawnErr = await firstSpawnError(devServer);
    if (spawnErr) {
      killSpawned();
      servingUrl = null;
      throw new Error(
        `Failed to spawn '${params.command}': ${spawnErr.message}`,
      );
    }

    // Wait for the port to come up; on timeout attach captured output so the
    // failure is diagnosable rather than silently swallowed.
    try {
      await waitForUrlReady(url, timeoutMs, signal, emit);
    } catch (err) {
      const tail = outputTail.slice(-20).join("\n");
      killSpawned();
      servingUrl = null;
      throw new Error(
        (err instanceof Error ? err.message : String(err)) +
          (tail ? `\n\n--- last dev-server output ---\n${tail}` : ""),
      );
    }

    return reply(`Spawned dev server (${params.command}); ready at ${url}.`, {
      url,
      adopted: false,
      spawned: true,
      command: params.command,
    });
  },

  renderResult(result, _options, theme) {
    const d = result.details as
      | { url?: string; adopted?: boolean; spawned?: boolean }
      | undefined;
    const tag = d?.adopted ? "adopted" : d?.spawned ? "spawned" : "serve";
    return new Text(
      theme.fg("toolTitle", theme.bold(`preview_serve ${tag} `)) +
        theme.fg("accent", d?.url ?? ""),
      0,
      0,
    );
  },
});

const stopTool = defineTool({
  name: "preview_serve_stop",
  label: "Preview Serve Stop",
  description:
    "Stop the dev server. Kills the process ONLY if this session spawned it; a " +
    "server adopted from another session is left running. Idempotent.",
  promptSnippet: "Stop a dev server this session started",
  promptGuidelines: [
    "Call preview_serve_stop when finished previewing. It only kills a server this session spawned, so it is safe even if the server was adopted from another session.",
  ],
  parameters: Type.Object({}),

  async execute() {
    const r = teardown();
    const text = r.killed
      ? "Stopped dev server (killed the process this session spawned)."
      : r.adopted
        ? "Released adopted dev server (left it running — another session started it)."
        : "No dev server tracked (nothing to do).";
    return { content: [{ type: "text", text }], details: r };
  },

  renderResult(result, _options, theme) {
    const t = result.content[0];
    return new Text(
      theme.fg("muted", t?.type === "text" ? t.text : "preview_serve stopped"),
      0,
      0,
    );
  },
});

// ── Registration + lifecycle ──────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool(serveTool);
  pi.registerTool(stopTool);

  // Kill only a server WE spawned on session end / reload / switch / fork and on
  // Ctrl+C/SIGTERM (which routes through session_shutdown). Adopted servers are
  // intentionally left running for whichever session owns them.
  pi.on("session_shutdown", async () => {
    teardown();
  });
}
