/**
 * Browser Preview Tools
 *
 * Gives pi a headless-browser capability modeled on Claude Code's preview tools:
 * launch (or point at) a running web app, render it in headless Chromium,
 * SCREENSHOT it, and return the screenshot IMAGE back into the model's context
 * so the model can visually reason over the rendered page. Plus read the console
 * and network log, click, fill, and eval against the live page.
 *
 * Why an extension (not a skill): the value is the model calling these mid-loop
 * and getting an IMAGE result back, while a single live Page is held across
 * several tool calls. A skill driving a one-shot CLI cannot hold a live page.
 *
 * configRole: NONE — none of these tools run an LLM. There is deliberately no
 * model/role logic here.
 *
 * ── Image content shape (grounded, not guessed) ──────────────────────────────
 * Tool result `content` is typed `(TextContent | ImageContent)[]` in pi's
 * ToolResultEventBase / AgentToolResult. The canonical ImageContent (pi-ai
 * `types.ts`, mirrored in docs/session-format.md) is the FLAT shape:
 *
 *     { type: "image", data: <base64>, mimeType: "image/png" }
 *
 * NOTE: docs/extensions.md shows a DIFFERENT shape —
 *     { type: "image", source: { type: "base64", mediaType, data } }
 * — but that nested `source` form is the one `pi.sendUserMessage()` accepts for
 * INPUT images, which goes through a separate conversion path. For TOOL RESULT
 * content the runtime type is the flat `{ type, data, mimeType }`. We use the
 * flat form here. (Surfaced because the two docs disagree and the task asked to
 * ground in the real API rather than copy the first example seen.)
 *
 * ── Lifecycle / cleanup ──────────────────────────────────────────────────────
 * A Browser, a Page, and an optional spawned dev-server child process are held
 * at module scope. `session_shutdown` (fires on quit / reload / new / resume /
 * fork, and on Ctrl+C/SIGTERM via ctx.shutdown) calls the SAME idempotent
 * teardown as preview_stop, so a browser or dev server never leaks across
 * sessions. Per docs/extensions.md "Long-lived resources and shutdown": we do
 * NOT start anything from the factory; resources spin up only when a tool runs.
 *
 * ── Portability ──────────────────────────────────────────────────────────────
 * Playwright's bundled Chromium behaves identically on macOS and Linux. No paths
 * are hardcoded; everything uses the cwd passed in or $HOME via os/Playwright.
 */

import { type ChildProcess, spawn } from "node:child_process";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
// Playwright is a runtime dependency of THIS extension (see package.json).
// It is imported lazily inside ensureBrowser() so that merely loading the
// extension (e.g. `pi --list-tools`) does not require node_modules to exist.
import type {
  Browser,
  ConsoleMessage,
  Page,
  Request as PWRequest,
  Response as PWResponse,
} from "playwright";

// ── Module-level live state ──────────────────────────────────────────────────

let browser: Browser | null = null;
let page: Page | null = null;
let devServer: ChildProcess | null = null;
let devServerCommand: string | null = null;
let currentUrl: string | null = null;

interface ConsoleEntry {
  type: string;
  text: string;
  ts: number;
}

interface NetworkEntry {
  method: string;
  url: string;
  status?: number;
  resourceType?: string;
  ts: number;
}

// Ring-buffered so a chatty page cannot grow these without bound.
const MAX_CONSOLE = 500;
const MAX_NETWORK = 500;
let consoleBuffer: ConsoleEntry[] = [];
let networkBuffer: NetworkEntry[] = [];

// ── Error / helper utilities ─────────────────────────────────────────────────

/**
 * Detect the "browser binary not installed" failure and turn it into a loud,
 * actionable error rather than a silent degrade (Timo's failure philosophy).
 */
function isMissingBrowserError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /Executable doesn't exist/i.test(msg) ||
    /playwright install/i.test(msg) ||
    /Looks like Playwright.*was just installed/i.test(msg)
  );
}

function missingBrowserError(original: unknown): Error {
  const detail =
    original instanceof Error ? original.message : String(original);
  return new Error(
    "Headless Chromium is not installed for Playwright. Run:\n" +
      "    npx playwright install chromium\n" +
      "(from agents/extensions/preview/, or anywhere — it installs into the shared Playwright cache).\n\n" +
      `Underlying error: ${detail}`,
  );
}

function requirePage(): Page {
  if (!page) {
    throw new Error(
      "No live preview page. Call preview_start({ url }) (or { command, cwd }) first.",
    );
  }
  return page;
}

/** Normalize a leading @ that some models prepend, mirroring built-in tools. */
function stripAt(s: string): string {
  return s.startsWith("@") ? s.slice(1) : s;
}

// ── Browser bring-up ─────────────────────────────────────────────────────────

async function ensureBrowser(
  onUpdate?: (text: string) => void,
): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  onUpdate?.("launching headless chromium…");
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    throw new Error(
      "Failed to import 'playwright'. Run `npm install` in agents/extensions/preview/.\n" +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    if (isMissingBrowserError(err)) throw missingBrowserError(err);
    throw err;
  }
  return browser;
}

/** Create a fresh Page and wire console/network capture onto it. */
async function newPage(b: Browser): Promise<Page> {
  const p = await b.newPage();
  consoleBuffer = [];
  networkBuffer = [];

  p.on("console", (msg: ConsoleMessage) => {
    consoleBuffer.push({ type: msg.type(), text: msg.text(), ts: Date.now() });
    if (consoleBuffer.length > MAX_CONSOLE) consoleBuffer.shift();
  });
  p.on("pageerror", (err: Error) => {
    consoleBuffer.push({
      type: "pageerror",
      text: err.message,
      ts: Date.now(),
    });
    if (consoleBuffer.length > MAX_CONSOLE) consoleBuffer.shift();
  });
  p.on("request", (req: PWRequest) => {
    networkBuffer.push({
      method: req.method(),
      url: req.url(),
      resourceType: req.resourceType(),
      ts: Date.now(),
    });
    if (networkBuffer.length > MAX_NETWORK) networkBuffer.shift();
  });
  p.on("response", (res: PWResponse) => {
    // Annotate the matching request entry with its status if we can find it.
    const url = res.url();
    for (let i = networkBuffer.length - 1; i >= 0; i--) {
      if (
        networkBuffer[i].url === url &&
        networkBuffer[i].status === undefined
      ) {
        networkBuffer[i].status = res.status();
        break;
      }
    }
  });

  return p;
}

// ── Dev-server spawning ──────────────────────────────────────────────────────

/**
 * Spawn a dev server (`command`) in `cwd`, modeled on the subagent extension's
 * node:child_process usage. We run it through a shell so the model can pass a
 * normal command line ("npm run dev", "python3 -m http.server 8000"). stdout/
 * stderr are captured for diagnostics but not streamed to the model.
 */
function spawnDevServer(command: string, cwd: string): ChildProcess {
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    // Own a process group so we can kill the whole tree (a dev server often
    // forks workers). Negative-PID kill below relies on this.
    detached: process.platform !== "win32",
  });
  child.stdout?.on("data", () => {});
  child.stderr?.on("data", () => {});
  return child;
}

/** Poll until `url` responds (any HTTP status) or we time out. */
async function waitForUrlReady(
  url: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  onUpdate?: (text: string) => void,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  let attempt = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Aborted while waiting for server.");
    attempt++;
    try {
      // A reachable server is enough; any status code means it's listening.
      const res = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      // Touch the body to release the socket; ignore content.
      void res.arrayBuffer().catch(() => {});
      return;
    } catch (err) {
      lastErr = err;
      if (attempt % 5 === 0) onUpdate?.(`waiting for ${url}…`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(
    `Server at ${url} did not become ready within ${timeoutMs}ms. ` +
      `Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

// ── Teardown (shared by preview_stop and session_shutdown) ───────────────────

/** Idempotent teardown: close page+browser, kill the dev server. */
async function teardown(): Promise<{
  closedPage: boolean;
  closedBrowser: boolean;
  killedServer: boolean;
}> {
  let closedPage = false;
  let closedBrowser = false;
  let killedServer = false;

  if (page) {
    try {
      await page.close();
    } catch {
      /* ignore */
    }
    page = null;
    closedPage = true;
  }

  if (browser) {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    browser = null;
    closedBrowser = true;
  }

  if (devServer) {
    killedServer = true;
    const child = devServer;
    devServer = null;
    devServerCommand = null;
    try {
      if (process.platform !== "win32" && child.pid) {
        // Kill the whole process group (negative pid) since we spawned detached.
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      } else {
        child.kill("SIGTERM");
      }
      // Escalate to SIGKILL if it lingers.
      setTimeout(() => {
        if (!child.killed) {
          try {
            if (process.platform !== "win32" && child.pid) {
              process.kill(-child.pid, "SIGKILL");
            } else {
              child.kill("SIGKILL");
            }
          } catch {
            /* ignore */
          }
        }
      }, 3000).unref?.();
    } catch {
      /* ignore */
    }
  }

  currentUrl = null;
  consoleBuffer = [];
  networkBuffer = [];

  return { closedPage, closedBrowser, killedServer };
}

// ── Tool definitions ─────────────────────────────────────────────────────────

const startTool = defineTool({
  name: "preview_start",
  label: "Preview Start",
  description:
    "Launch a headless Chromium preview of a web app and navigate to it. " +
    "Provide `url` to point at an already-running server, OR provide `command` " +
    "(+ optional `cwd`) to spawn a dev server first (e.g. 'npm run dev', " +
    "'python3 -m http.server 8000') and then navigate to `url` (or `waitFor`). " +
    "Holds ONE live page; calling again navigates the existing page (and replaces " +
    "any prior dev server). After this, use preview_screenshot to SEE the page.",
  promptSnippet:
    "Launch/point a headless browser at a web app so it can be screenshotted and inspected",
  promptGuidelines: [
    "Use preview_start to open a web app in a headless browser before calling preview_screenshot. Pass `url` for an already-running server, or `command` (+`cwd`) to spawn a dev server first.",
    "When you start a dev server with preview_start, you MUST call preview_stop when finished so the server and browser do not leak.",
  ],
  parameters: Type.Object({
    url: Type.Optional(
      Type.String({
        description:
          "URL to navigate to (http(s)://, file://, or data:). Required unless you only spawn a server reachable via `waitFor`.",
      }),
    ),
    command: Type.Optional(
      Type.String({
        description:
          "Optional shell command to spawn a dev server before navigating, e.g. 'npm run dev' or 'python3 -m http.server 8000'.",
      }),
    ),
    cwd: Type.Optional(
      Type.String({
        description:
          "Working directory for `command`. Defaults to the session cwd.",
      }),
    ),
    waitFor: Type.Optional(
      Type.String({
        description:
          "URL to poll until the spawned server is reachable. Defaults to `url` when `command` is given.",
      }),
    ),
    timeoutMs: Type.Optional(
      Type.Number({
        description:
          "Max time to wait for the server to become ready and for navigation, in ms. Default 30000.",
      }),
    ),
  }),

  async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
    const timeoutMs = params.timeoutMs ?? 30_000;
    const emit = (text: string) =>
      onUpdate?.({ content: [{ type: "text", text }] });

    const navTarget = params.url ? stripAt(params.url) : undefined;
    const waitTarget = params.waitFor ?? navTarget;

    if (!navTarget && !params.command) {
      throw new Error("preview_start requires `url` and/or `command`.");
    }

    // 1. Optionally spawn a dev server and wait for it to be reachable.
    if (params.command) {
      if (devServer) {
        // Replace any prior server so we never hold two.
        emit("stopping previous dev server…");
        await teardown();
      }
      const serverCwd = params.cwd ? stripAt(params.cwd) : ctx.cwd;
      emit(`spawning dev server: ${params.command}`);
      devServer = spawnDevServer(params.command, serverCwd);
      devServerCommand = params.command;

      // Surface an immediate spawn failure loudly instead of hanging.
      const spawnErr = await new Promise<Error | null>((resolve) => {
        const onErr = (e: Error) => resolve(e);
        devServer?.once("error", onErr);
        // If it hasn't errored within a tick, assume the spawn itself worked.
        setTimeout(() => {
          devServer?.removeListener("error", onErr);
          resolve(null);
        }, 200);
      });
      if (spawnErr) {
        await teardown();
        throw new Error(
          `Failed to spawn dev server '${params.command}': ${spawnErr.message}`,
        );
      }

      if (waitTarget) {
        await waitForUrlReady(waitTarget, timeoutMs, signal, emit);
      }
    }

    if (!navTarget) {
      // Server spawned and ready, but caller gave nothing to navigate to.
      return {
        content: [
          {
            type: "text",
            text:
              `Dev server started (${params.command}); ` +
              `${waitTarget ? `reachable at ${waitTarget}` : "no readiness URL was given"}. ` +
              "Pass a `url` to navigate and then call preview_screenshot.",
          },
        ],
        details: { devServer: params.command, ready: waitTarget ?? null },
      };
    }

    // 2. Launch the browser and (re)use a single page.
    const b = await ensureBrowser(emit);
    if (!page) {
      page = await newPage(b);
    }
    emit(`navigating to ${navTarget}…`);
    let response: PWResponse | null = null;
    try {
      response = await page.goto(navTarget, {
        waitUntil: "load",
        timeout: timeoutMs,
      });
    } catch (err) {
      if (isMissingBrowserError(err)) throw missingBrowserError(err);
      throw err;
    }
    currentUrl = page.url();
    const title = await page.title().catch(() => "");
    const status = response?.status();

    return {
      content: [
        {
          type: "text",
          text:
            `Preview ready at ${currentUrl}` +
            (status ? ` (HTTP ${status})` : "") +
            (title ? `\nTitle: ${title}` : "") +
            (devServerCommand ? `\nDev server: ${devServerCommand}` : "") +
            "\nCall preview_screenshot to see the rendered page.",
        },
      ],
      details: {
        url: currentUrl,
        title,
        status: status ?? null,
        devServer: devServerCommand,
      },
    };
  },

  renderResult(result, _options, theme) {
    const d = result.details as
      | {
          url?: string;
          title?: string;
          status?: number | null;
          devServer?: string | null;
        }
      | undefined;
    if (!d?.url) {
      const t = result.content[0];
      return new Text(t?.type === "text" ? t.text : "", 0, 0);
    }
    const lines = [theme.fg("toolTitle", theme.bold(`preview: ${d.url}`))];
    if (d.title) lines.push(theme.fg("muted", d.title));
    if (d.devServer) lines.push(theme.fg("dim", `server: ${d.devServer}`));
    return new Text(lines.join("\n"), 0, 0);
  },
});

const screenshotTool = defineTool({
  name: "preview_screenshot",
  label: "Preview Screenshot",
  description:
    "Capture a PNG screenshot of the current preview page and return it as an " +
    "IMAGE so you can visually inspect the rendered app. Optionally screenshot " +
    "the full scrollable page (`fullPage`) or a single element (`selector`).",
  promptSnippet:
    "Screenshot the live preview page and return the image to look at",
  promptGuidelines: [
    "Use preview_screenshot to visually verify a web app after preview_start. The image comes back into context; describe what you see and compare it to the intended design.",
  ],
  parameters: Type.Object({
    fullPage: Type.Optional(
      Type.Boolean({
        description:
          "Capture the full scrollable page instead of just the viewport.",
      }),
    ),
    selector: Type.Optional(
      Type.String({
        description:
          "Optional CSS selector; screenshot only the first matching element.",
      }),
    ),
  }),

  async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
    const p = requirePage();
    onUpdate?.({ content: [{ type: "text", text: "capturing screenshot…" }] });

    let pngBuffer: Buffer;
    try {
      if (params.selector) {
        const sel = stripAt(params.selector);
        const el = p.locator(sel).first();
        await el.waitFor({ state: "visible", timeout: 5000 });
        pngBuffer = await el.screenshot({ type: "png" });
      } else {
        pngBuffer = await p.screenshot({
          type: "png",
          fullPage: params.fullPage ?? false,
        });
      }
    } catch (err) {
      if (isMissingBrowserError(err)) throw missingBrowserError(err);
      throw err;
    }

    const base64 = pngBuffer.toString("base64");
    const url = p.url();
    const kib = Math.round(pngBuffer.length / 102.4) / 10;

    return {
      // The IMAGE content goes back into the model's context. Flat ImageContent
      // shape: { type: "image", data, mimeType } — see header note.
      content: [
        {
          type: "text",
          text:
            `Screenshot of ${url}` +
            (params.selector ? ` (selector: ${params.selector})` : "") +
            (params.fullPage ? " (full page)" : "") +
            ` — ${kib} KiB PNG.`,
        },
        { type: "image", data: base64, mimeType: "image/png" },
      ],
      details: {
        url,
        bytes: pngBuffer.length,
        fullPage: params.fullPage ?? false,
        selector: params.selector ?? null,
      },
    };
  },

  renderResult(result, _options, theme) {
    const d = result.details as { url?: string; bytes?: number } | undefined;
    const kib = d?.bytes ? `${Math.round(d.bytes / 102.4) / 10} KiB` : "";
    return new Text(
      theme.fg("toolTitle", theme.bold("preview_screenshot ")) +
        theme.fg("accent", d?.url ?? "") +
        (kib ? theme.fg("dim", ` (${kib} png)`) : ""),
      0,
      0,
    );
  },
});

const stopTool = defineTool({
  name: "preview_stop",
  label: "Preview Stop",
  description:
    "Tear down the preview: close the page and browser and kill any dev server " +
    "spawned by preview_start. Idempotent — safe to call even if nothing is running.",
  promptSnippet: "Close the headless browser and kill any spawned dev server",
  promptGuidelines: [
    "Call preview_stop when you are done previewing, especially if preview_start spawned a dev server, so the browser and server do not leak.",
  ],
  parameters: Type.Object({}),

  async execute() {
    const r = await teardown();
    const parts: string[] = [];
    if (r.closedBrowser) parts.push("closed browser");
    if (r.killedServer) parts.push("killed dev server");
    const text =
      parts.length > 0
        ? `Preview stopped (${parts.join(", ")}).`
        : "Preview already stopped (nothing to do).";
    return { content: [{ type: "text", text }], details: r };
  },

  renderResult(result, _options, theme) {
    const t = result.content[0];
    return new Text(
      theme.fg("muted", t?.type === "text" ? t.text : "preview stopped"),
      0,
      0,
    );
  },
});

// ── Interaction & inspection tools ───────────────────────────────────────────

const clickTool = defineTool({
  name: "preview_click",
  label: "Preview Click",
  description:
    "Click the first element matching a CSS selector on the current preview page.",
  promptSnippet: "Click an element on the preview page by CSS selector",
  parameters: Type.Object({
    selector: Type.String({
      description: "CSS selector of the element to click.",
    }),
    timeoutMs: Type.Optional(
      Type.Number({
        description: "Max time to wait for the element, ms. Default 5000.",
      }),
    ),
  }),
  async execute(_toolCallId, params) {
    const p = requirePage();
    const sel = stripAt(params.selector);
    await p
      .locator(sel)
      .first()
      .click({ timeout: params.timeoutMs ?? 5000 });
    return {
      content: [{ type: "text", text: `Clicked ${sel}. Now at ${p.url()}.` }],
      details: { selector: sel, url: p.url() },
    };
  },
});

const fillTool = defineTool({
  name: "preview_fill",
  label: "Preview Fill",
  description:
    "Fill an input/textarea (or any editable element) matching a CSS selector with a value.",
  promptSnippet: "Fill a form field on the preview page",
  parameters: Type.Object({
    selector: Type.String({
      description: "CSS selector of the field to fill.",
    }),
    value: Type.String({ description: "Value to set." }),
    timeoutMs: Type.Optional(
      Type.Number({
        description: "Max time to wait for the element, ms. Default 5000.",
      }),
    ),
  }),
  async execute(_toolCallId, params) {
    const p = requirePage();
    const sel = stripAt(params.selector);
    await p
      .locator(sel)
      .first()
      .fill(params.value, { timeout: params.timeoutMs ?? 5000 });
    return {
      content: [{ type: "text", text: `Filled ${sel}.` }],
      details: { selector: sel },
    };
  },
});

const consoleLogsTool = defineTool({
  name: "preview_console_logs",
  label: "Preview Console Logs",
  description:
    "Return console messages and page errors captured from the preview page since it loaded. " +
    "Optionally clear the buffer after reading.",
  promptSnippet: "Read the browser console log from the preview page",
  parameters: Type.Object({
    clear: Type.Optional(
      Type.Boolean({
        description: "Clear the console buffer after returning it.",
      }),
    ),
  }),
  async execute(_toolCallId, params) {
    const entries = [...consoleBuffer];
    if (params.clear) consoleBuffer = [];
    const text =
      entries.length === 0
        ? "(no console output captured)"
        : entries.map((e) => `[${e.type}] ${e.text}`).join("\n");
    return { content: [{ type: "text", text }], details: { entries } };
  },
});

const networkTool = defineTool({
  name: "preview_network",
  label: "Preview Network",
  description:
    "Return network requests (method, url, status, resource type) captured from the preview page. " +
    "Optionally clear the buffer after reading.",
  promptSnippet: "Read the network request log from the preview page",
  parameters: Type.Object({
    clear: Type.Optional(
      Type.Boolean({
        description: "Clear the network buffer after returning it.",
      }),
    ),
  }),
  async execute(_toolCallId, params) {
    const entries = [...networkBuffer];
    if (params.clear) networkBuffer = [];
    const text =
      entries.length === 0
        ? "(no network activity captured)"
        : entries
            .map(
              (e) =>
                `${e.method} ${e.status ?? "—"} ${e.url}${e.resourceType ? ` (${e.resourceType})` : ""}`,
            )
            .join("\n");
    return { content: [{ type: "text", text }], details: { entries } };
  },
});

const evalTool = defineTool({
  name: "preview_eval",
  label: "Preview Eval",
  description:
    "Evaluate a JavaScript expression in the preview page and return the JSON-serializable result. " +
    "The expression runs in the page context (has access to `document`, `window`, etc.).",
  promptSnippet: "Run a JS expression in the preview page and get the result",
  promptGuidelines: [
    "Use preview_eval to read DOM/page state from the preview page (e.g. document.title, element text). The expression runs in the page; only JSON-serializable results come back.",
  ],
  parameters: Type.Object({
    expression: Type.String({
      description:
        "A JS expression or function body to evaluate in the page, e.g. 'document.title' or 'document.querySelectorAll(\"li\").length'.",
    }),
  }),
  async execute(_toolCallId, params) {
    const p = requirePage();
    let value: unknown;
    try {
      // Wrap so a bare expression is returned, like the devtools console.
      value = await p.evaluate(
        (expr: string) =>
          // eslint-disable-next-line no-new-func
          (0, eval)(expr),
        params.expression,
      );
    } catch (err) {
      throw new Error(
        `preview_eval failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    let text: string;
    try {
      text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
    return {
      content: [{ type: "text", text: text ?? "undefined" }],
      details: { result: value ?? null },
    };
  },
});

// ── Registration + lifecycle ─────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool(startTool);
  pi.registerTool(screenshotTool);
  pi.registerTool(stopTool);
  pi.registerTool(clickTool);
  pi.registerTool(fillTool);
  pi.registerTool(consoleLogsTool);
  pi.registerTool(networkTool);
  pi.registerTool(evalTool);

  // Idempotent teardown on session end / reload / switch / fork, and on
  // Ctrl+C/SIGTERM (which routes through session_shutdown). Prevents a browser
  // or dev server from leaking across sessions.
  pi.on("session_shutdown", async () => {
    await teardown();
  });
}
