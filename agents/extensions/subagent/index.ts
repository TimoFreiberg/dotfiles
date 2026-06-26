/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Runs each subagent in-process via the pi SDK's `createAgentSession()` instead
 * of spawning a `pi` child process. Each session gets its own isolated context
 * window, the same OAuth/subscription auth as the parent (shared modelRegistry),
 * and a lean ResourceLoader: a custom system prompt + the agent body + the
 * AGENTS.md context chain, but NO extensions and NO skills. Dropping extensions
 * also means subagents can't recursively get a `subagent` tool.
 *
 * One-shot / parallel:
 *   subagent { tasks: [{ agent, task }, ...] }       // create -> 1 turn -> dispose
 *
 * Durable (multi-turn) sessions:
 *   subagent { tasks: [{ agent, task, keepAlive: true }] }  // returns a handle
 *   subagent_followup { handle, task }                      // another turn
 *   subagent_list {}                                        // live handles
 *   subagent_close { handle }                               // dispose ("all" ok)
 *
 * Model selection normally uses the shared roles infra (roles.json +
 * agents/_lib/roles.mjs): an agent's `role:` frontmatter, or a per-task `role`
 * override, resolves to a concrete model. A per-task `model` override accepts a
 * concrete `provider/model[:thinking]` spec and wins over any role; its thinking
 * suffix wins too. With no role or model anywhere, the subagent inherits the
 * parent session's model.
 *
 * Config env vars:
 *   PI_SUBAGENT_SCOPE   - "user" (default), "project", or "both"
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  AgentToolResult,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { Message, Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionAPI,
  getAgentDir,
  getMarkdownTheme,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  type AgentConfig,
  type AgentScope,
  discoverAgents,
  formatAgentList,
} from "./agents.js";
import { SUBAGENT_SYSTEM_PROMPT } from "./system-prompt.js";

type SubSession = Awaited<ReturnType<typeof createAgentSession>>["session"];

/**
 * Shared per-machine role -> model resolver (agents/_lib/roles.mjs).
 *
 * It lives OUTSIDE the extension dir, so a static relative import breaks: pi
 * discovers this extension through the symlink ~/.pi/agent/extensions ->
 * dotfiles/agents/extensions and resolves relative imports against that symlink
 * path, where ../../_lib does not exist. We instead realpath import.meta.url
 * (which crosses the symlink, verified) and dynamic-import the resolver by its
 * absolute on-disk path. Cached so we import it once.
 *
 * pi-runtime-free ESM, also imported by plain-node skills, so skills and
 * subagents agree on ONE roles.json.
 */
interface RolesModule {
  resolveRoleModel: (
    role: string,
    modelRegistry: { find: (provider: string, id: string) => unknown },
    opts?: { override?: string; agentDir?: string; quiet?: boolean },
  ) => {
    model: unknown;
    provider?: string;
    id: string;
    thinking?: string;
    spec: string;
  } | null;
  getAgentDir: () => string;
  readJson: (p: string, fallback?: unknown) => any;
}

let rolesPromise: Promise<RolesModule> | null = null;
function getRoles(): Promise<RolesModule> {
  if (!rolesPromise) {
    const realHere = path.dirname(
      fs.realpathSync(fileURLToPath(import.meta.url)),
    );
    const rolesPath = path.resolve(realHere, "../../_lib/roles.mjs");
    rolesPromise = import(
      pathToFileURL(rolesPath).href
    ) as Promise<RolesModule>;
  }
  return rolesPromise;
}

/** List the role names defined in the active roles.json, for the tool description. */
async function listRoles(): Promise<{ names: string[]; rolesPath: string }> {
  try {
    const roles = await getRoles();
    const rolesPath = path.join(roles.getAgentDir(), "roles.json");
    const cfg = roles.readJson(rolesPath, null);
    const names = cfg?.roles ? Object.keys(cfg.roles) : [];
    return { names, rolesPath };
  } catch {
    return { names: [], rolesPath: "(roles.json not found)" };
  }
}

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;

/**
 * Tools enabled for an agent that does not pin a `tools:` list. Mirrors the full
 * read/write built-in set the old spawned `pi` exposed by default (the SDK's
 * own default is just read/bash/edit/write).
 */
const DEFAULT_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    contextTokens?: number;
    turns?: number;
  },
  model?: string,
): string {
  const parts: string[] = [];
  if (usage.turns)
    parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens && usage.contextTokens > 0) {
    parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  }
  if (model) parts.push(model);
  return parts.join(" ");
}

function formatToolCall(
  toolName: string,
  args: Record<string, unknown>,
  themeFg: (color: any, text: string) => string,
): string {
  const shortenPath = (p: string) => {
    const home = os.homedir();
    return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
  };

  switch (toolName) {
    case "bash": {
      const command = (args.command as string) || "...";
      const preview =
        command.length > 60 ? `${command.slice(0, 60)}...` : command;
      return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
    }
    case "read": {
      const rawPath = (args.file_path || args.path || "...") as string;
      const filePath = shortenPath(rawPath);
      const offset = args.offset as number | undefined;
      const limit = args.limit as number | undefined;
      let text = themeFg("accent", filePath);
      if (offset !== undefined || limit !== undefined) {
        const startLine = offset ?? 1;
        const endLine = limit !== undefined ? startLine + limit - 1 : "";
        text += themeFg(
          "warning",
          `:${startLine}${endLine ? `-${endLine}` : ""}`,
        );
      }
      return themeFg("muted", "read ") + text;
    }
    case "write": {
      const rawPath = (args.file_path || args.path || "...") as string;
      const filePath = shortenPath(rawPath);
      const content = (args.content || "") as string;
      const lines = content.split("\n").length;
      let text = themeFg("muted", "write ") + themeFg("accent", filePath);
      if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
      return text;
    }
    case "edit": {
      const rawPath = (args.file_path || args.path || "...") as string;
      return (
        themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath))
      );
    }
    case "ls": {
      const rawPath = (args.path || ".") as string;
      return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
    }
    case "find": {
      const pattern = (args.pattern || "*") as string;
      const rawPath = (args.path || ".") as string;
      return (
        themeFg("muted", "find ") +
        themeFg("accent", pattern) +
        themeFg("dim", ` in ${shortenPath(rawPath)}`)
      );
    }
    case "grep": {
      const pattern = (args.pattern || "") as string;
      const rawPath = (args.path || ".") as string;
      return (
        themeFg("muted", "grep ") +
        themeFg("accent", `/${pattern}/`) +
        themeFg("dim", ` in ${shortenPath(rawPath)}`)
      );
    }
    default: {
      const argsStr = JSON.stringify(args);
      const preview =
        argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
      return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
    }
  }
}

interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

interface SingleResult {
  agent: string;
  agentSource: "user" | "project" | "unknown";
  task: string;
  /** 0 = ran, 1 = error, -1 = still running (parallel placeholder). */
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  outputFile?: string;
  /** Set when the session is kept alive after this turn. */
  handle?: string;
}

interface SubagentDetails {
  results: SingleResult[];
}

function emptyUsage(): UsageStats {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    turns: 0,
  };
}

function blankResult(
  agent: string,
  task: string,
  agentSource: SingleResult["agentSource"] = "unknown",
): SingleResult {
  return {
    agent,
    agentSource,
    task,
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: emptyUsage(),
  };
}

function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") return part.text;
      }
    }
  }
  return "";
}

type DisplayItem =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") items.push({ type: "text", text: part.text });
        else if (part.type === "toolCall")
          items.push({
            type: "toolCall",
            name: part.name,
            args: part.arguments,
          });
      }
    }
  }
  return items;
}

async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

const SUBAGENT_OUTPUT_DIR = path.join(os.tmpdir(), "pi-subagent-output");

function outputFileHint(results: SingleResult[]): string {
  const files = results.filter((r) => r.outputFile).map((r) => r.outputFile!);
  if (files.length === 0) return "";
  if (files.length === 1) return `\n\nFull output saved to: ${files[0]}`;
  return `\n\nFull outputs saved to:\n${files.map((f) => `  ${f}`).join("\n")}`;
}

function saveOutputFile(agentName: string, result: SingleResult): string {
  fs.mkdirSync(SUBAGENT_OUTPUT_DIR, { recursive: true });
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(
    SUBAGENT_OUTPUT_DIR,
    `${safeName}-${timestamp}.md`,
  );
  const output = getFinalOutput(result.messages);
  const header = [
    `# Subagent output: ${agentName}`,
    ``,
    `- **Task:** ${result.task}`,
    `- **Exit code:** ${result.exitCode}`,
    `- **Model:** ${result.model || "unknown"}`,
    result.handle ? `- **Handle:** ${result.handle}` : null,
    result.stopReason ? `- **Stop reason:** ${result.stopReason}` : null,
    result.errorMessage ? `- **Error:** ${result.errorMessage}` : null,
    ``,
    `## Output`,
    ``,
  ]
    .filter((line) => line !== null)
    .join("\n");
  fs.writeFileSync(filePath, header + output, {
    encoding: "utf-8",
    mode: 0o600,
  });
  return filePath;
}

function getAgentScope(): AgentScope {
  const env = process.env.PI_SUBAGENT_SCOPE;
  if (env === "project" || env === "both") return env;
  return "user";
}

function isErrorResult(r: SingleResult): boolean {
  return (
    r.exitCode > 0 ||
    r.stopReason === "error" ||
    r.stopReason === "aborted" ||
    !!r.errorMessage
  );
}

// ---------------------------------------------------------------------------
// Durable session registry — survives across tool calls for the pi process
// lifetime. Disposed wholesale on session_shutdown.
// ---------------------------------------------------------------------------

interface DurableEntry {
  handle: string;
  agent: string;
  agentSource: SingleResult["agentSource"];
  model?: string;
  session: SubSession;
  cwd: string;
  turns: number;
  createdAt: number;
}

const durable = new Map<string, DurableEntry>();
let handleCounter = 0;

function newHandle(agent: string): string {
  const safe = agent.replace(/[^\w.-]+/g, "_");
  return `${safe}-${++handleCounter}`;
}

function disposeAllDurable(): void {
  for (const entry of durable.values()) {
    try {
      entry.session.dispose();
    } catch {
      /* ignore */
    }
  }
  durable.clear();
}

// ---------------------------------------------------------------------------
// Model resolution (roles) + session construction
// ---------------------------------------------------------------------------

async function resolveModelSelection(
  agent: AgentConfig,
  roleOverride: string | undefined,
  modelOverride: string | undefined,
  modelRegistry: { find: (provider: string, id: string) => unknown },
  parentModel: Model<any> | undefined,
  parentThinking: ThinkingLevel | undefined,
): Promise<{
  model: Model<any> | undefined;
  thinkingLevel: ThinkingLevel | undefined;
  modelLabel: string | undefined;
}> {
  const role = roleOverride ?? agent.role;
  const inheritParent = () => ({
    model: parentModel,
    thinkingLevel:
      (agent.thinking as ThinkingLevel | undefined) ?? parentThinking,
    modelLabel: parentModel
      ? `${parentModel.provider}/${parentModel.id}`
      : undefined,
  });

  if (!role && !modelOverride) return inheritParent();

  const roles = await getRoles();
  // resolveRoleModel fails loud if the provider/model isn't in the registry —
  // we let that throw and surface it as the task's error. When modelOverride is
  // supplied, the role name is only a validation/default anchor for the shared
  // resolver; the concrete provider/model spec wins.
  const resolved = roles.resolveRoleModel(role ?? "default", modelRegistry, {
    override: modelOverride,
  });
  if (!resolved) return inheritParent(); // role mapped to null (caller-fallback)

  const resolvedThinking = resolved.thinking as ThinkingLevel | undefined;
  return {
    model: resolved.model as Model<any>,
    thinkingLevel:
      (modelOverride ? resolvedThinking : undefined) ??
      (agent.thinking as ThinkingLevel | undefined) ??
      resolvedThinking ??
      parentThinking,
    modelLabel: resolved.spec,
  };
}

interface BuildSessionDeps {
  cwd: string;
  modelRegistry: any;
  authStorage: any;
  parentModel: Model<any> | undefined;
  parentThinking: ThinkingLevel | undefined;
}

async function buildSession(
  agent: AgentConfig,
  roleOverride: string | undefined,
  modelOverride: string | undefined,
  deps: BuildSessionDeps,
): Promise<{ session: SubSession; modelLabel: string | undefined }> {
  const { model, thinkingLevel, modelLabel } = await resolveModelSelection(
    agent,
    roleOverride,
    modelOverride,
    deps.modelRegistry,
    deps.parentModel,
    deps.parentThinking,
  );

  const agentDir = getAgentDir();

  // Lean loader: replace pi's default system prompt (which mentions pi and would
  // trip Claude-subscription third-party-harness detection), append the agent
  // body, keep the AGENTS.md context chain, but load NO extensions and NO skills.
  const resourceLoader = new DefaultResourceLoader({
    cwd: deps.cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPromptOverride: () => SUBAGENT_SYSTEM_PROMPT,
    appendSystemPromptOverride: () =>
      agent.systemPrompt.trim() ? [agent.systemPrompt] : [],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: deps.cwd,
    agentDir,
    model,
    thinkingLevel,
    tools: agent.tools && agent.tools.length > 0 ? agent.tools : DEFAULT_TOOLS,
    resourceLoader,
    modelRegistry: deps.modelRegistry,
    authStorage: deps.authStorage,
    sessionManager: SessionManager.inMemory(deps.cwd),
  });

  return { session, modelLabel };
}

/** Recompute messages + usage on a result from the session's current state. */
function syncResult(session: SubSession, result: SingleResult): void {
  const messages = session.messages as unknown as Message[];
  result.messages = messages;
  const usage = emptyUsage();
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    usage.turns++;
    const u = (msg as any).usage;
    if (u) {
      usage.input += u.input || 0;
      usage.output += u.output || 0;
      usage.cacheRead += u.cacheRead || 0;
      usage.cacheWrite += u.cacheWrite || 0;
      usage.cost += u.cost?.total || 0;
      usage.contextTokens = u.totalTokens || 0;
    }
    if ((msg as any).stopReason) result.stopReason = (msg as any).stopReason;
    if ((msg as any).errorMessage)
      result.errorMessage = (msg as any).errorMessage;
  }
  result.usage = usage;
}

/**
 * How long the subagent stream may go idle (no model tokens arriving) before
 * we declare the underlying SSE stream wedged and abort.
 *
 * Why this exists: pi's anthropic-style stream iterator blocks on
 * `reader.read()` and only re-checks the abort signal *between* reads. A
 * socket that stays open but sends zero bytes wedges `reader.read()` forever,
 * so `session.abort()` — which just flips the AbortController — cannot
 * interrupt it. Only the codex provider has an idle timeout of its own. A
 * wedged stream means `session.prompt()` never settles, so the tool's
 * `execute` promise is orphaned: the parent run gets force-ended above us,
 * no tool_result is recorded, and the next turn sees a synthetic "No result
 * provided". The watchdog converts that silent infinite hang into a loud
 * error the parent can react to.
 *
 * Only armed during the streaming phase (waiting for model tokens). A quiet
 * tool execution is legitimately silent — the bash tool's onUpdate fires
 * only on NEW output — so the timer is disarmed for the whole
 * tool-execution phase and this value never competes with a slow command.
 * Chosen long enough to not trip on a real model thinking pause, short
 * enough to recover inside the parent's own stall window. Tunable via
 * $PI_SUBAGENT_IDLE_TIMEOUT_MS.
 */
const IDLE_TIMEOUT_MS =
  Number.parseInt(process.env.PI_SUBAGENT_IDLE_TIMEOUT_MS || "", 10) || 120_000;

/**
 * Grace period after we abort before we assume `session.abort()` could not
 * unblock the stream (it can't, for a truly wedged `reader.read()`) and
 * force-dispose the session so `execute` always settles.
 */
const ABORT_GRACE_MS =
  Number.parseInt(process.env.PI_SUBAGENT_ABORT_GRACE_MS || "", 10) || 5_000;

/** Run a single prompt turn on a session, streaming updates into `result`. */
async function runTurn(
  session: SubSession,
  result: SingleResult,
  task: string,
  signal: AbortSignal | undefined,
  emit: () => void,
): Promise<void> {
  const RESYNC_EVENTS = new Set([
    "message_update",
    "message_end",
    "turn_end",
    "tool_execution_start",
    "tool_execution_update",
    "tool_execution_end",
    "agent_end",
  ]);

  // --- Phase-aware idle watchdog + settlement guarantee ---
  //
  // `session.prompt()` is awaited with no native timeout, and pi's
  // anthropic-style stream iterator blocks on `reader.read()` checking the
  // abort signal only *between* reads. A socket that stays open but sends
  // zero bytes wedges `reader.read()` forever, so `session.abort()` (which
  // just flips the AbortController) cannot interrupt it. The prompt promise
  // never settles, the tool's `execute` promise is orphaned, the parent run
  // is force-ended above us, no tool_result is recorded, and the next turn
  // sees a synthetic "No result provided".
  //
  // The watchdog converts that silent infinite hang into a loud error — but
  // ONLY during the streaming phase (waiting for model tokens). A quiet tool
  // execution (e.g. a multi-minute `npm install` or test run that emits no
  // stdout) is legitimately silent between tool_execution_start and
  // tool_execution_end: the bash tool's onUpdate fires only on NEW output,
  // and its setInterval is a UI invalidate, not a tool event. Timing out
  // there would abort healthy work, so the timer is disarmed for the whole
  // tool-execution phase and re-armed when the next assistant turn streams.
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let armed = false; // armed only during the streaming phase
  let idleReason: string | undefined;
  let disposedForcibly = false;
  let resolveOnForce: (() => void) | undefined;
  const forceSettle = new Promise<void>((resolve) => {
    resolveOnForce = resolve;
  });

  const clearIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };
  const armIdle = () => {
    if (!armed) return;
    clearIdle();
    idleTimer = setTimeout(() => {
      // Only a wedged stream looks like this: we're still streaming but no
      // token has arrived for IDLE_TIMEOUT_MS. Tools are allowed to be quiet
      // (the timer is disarmed during their execution), so a fire here is a
      // confident wedge signal, not a slow command.
      if (!session.isStreaming) return;
      idleReason = `subagent stream went idle (no model tokens for ${IDLE_TIMEOUT_MS}ms); underlying SSE stream likely wedged`;
      void session.abort();
      // `session.abort()` just flips the AbortController; for a wedged
      // `reader.read()` it cannot unblock the stream. Give it a grace window
      // to settle normally, then force-dispose so `execute` always settles.
      if (graceTimer) clearTimeout(graceTimer);
      graceTimer = setTimeout(() => {
        disposedForcibly = true;
        try {
          session.dispose();
        } catch {
          /* disposal must not block settlement */
        }
        resolveOnForce?.();
      }, ABORT_GRACE_MS);
    }, IDLE_TIMEOUT_MS);
  };

  const unsubscribe = session.subscribe((event: { type: string }) => {
    switch (event.type) {
      case "turn_start":
      case "message_start":
        // Entering the streaming phase: arm the watchdog for the model's
        // response (time-to-first-token + inter-token gaps).
        armed = true;
        armIdle();
        break;
      case "message_update":
        // Tokens are flowing — reset the idle window.
        armIdle();
        break;
      case "tool_execution_start":
        // Leaving the streaming phase for tool execution: a quiet tool is
        // healthy, so disarm for the duration of the tool call.
        armed = false;
        clearIdle();
        break;
      case "tool_execution_end":
        // Tool finished; the next assistant turn will stream, so re-arm.
        armed = true;
        armIdle();
        break;
      case "message_end":
      case "turn_end":
      case "agent_end":
        // Streaming phase over. If tools follow, tool_execution_start will
        // disarm; otherwise the turn is ending and `finally` tears down. Drop
        // the timer so we don't carry it across a non-streaming gap.
        armed = false;
        clearIdle();
        break;
    }
    if (RESYNC_EVENTS.has(event.type)) {
      syncResult(session, result);
      emit();
    }
  });

  let onAbort: (() => void) | undefined;
  if (signal) {
    onAbort = () => {
      armed = false;
      clearIdle();
      void session.abort();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    armed = true;
    armIdle();
    await Promise.race([session.prompt(task), forceSettle]);
    if (disposedForcibly) {
      // Surface a loud, specific error so the parent gets a real tool_result
      // and can react (retry / switch model) instead of seeing "No result
      // provided" with no cause.
      throw new Error(idleReason as string);
    }
    syncResult(session, result);
  } finally {
    armed = false;
    clearIdle();
    if (graceTimer) clearTimeout(graceTimer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    unsubscribe();
  }
}

// ---------------------------------------------------------------------------
// Rendering (shared between subagent and subagent_followup)
// ---------------------------------------------------------------------------

function renderResults(
  result: AgentToolResult<any>,
  expanded: boolean,
  theme: any,
): any {
  const details = result.details as SubagentDetails | undefined;
  if (!details || details.results.length === 0) {
    const text = result.content[0];
    return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
  }

  const mdTheme = getMarkdownTheme();

  const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
    const toShow = limit ? items.slice(-limit) : items;
    const skipped = limit && items.length > limit ? items.length - limit : 0;
    let text = "";
    if (skipped > 0)
      text += theme.fg("muted", `... ${skipped} earlier items\n`);
    for (const item of toShow) {
      if (item.type === "text") {
        const preview = expanded
          ? item.text
          : item.text.split("\n").slice(0, 3).join("\n");
        text += `${theme.fg("toolOutput", preview)}\n`;
      } else {
        text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
      }
    }
    return text.trimEnd();
  };

  // Single result
  if (details.results.length === 1) {
    const r = details.results[0];
    const isError = isErrorResult(r);
    const icon = isError
      ? theme.fg("error", "✗")
      : r.exitCode === -1
        ? theme.fg("warning", "⏳")
        : theme.fg("success", "✓");
    const displayItems = getDisplayItems(r.messages);
    const finalOutput = getFinalOutput(r.messages);

    if (expanded) {
      const container = new Container();
      let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
      if (r.handle) header += ` ${theme.fg("accent", `[${r.handle}]`)}`;
      if (isError && r.stopReason)
        header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
      container.addChild(new Text(header, 0, 0));
      if (isError && r.errorMessage)
        container.addChild(
          new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0),
        );
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
      container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
      if (displayItems.length === 0 && !finalOutput) {
        container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
      } else {
        for (const item of displayItems) {
          if (item.type === "toolCall")
            container.addChild(
              new Text(
                theme.fg("muted", "→ ") +
                  formatToolCall(item.name, item.args, theme.fg.bind(theme)),
                0,
                0,
              ),
            );
        }
        if (finalOutput) {
          container.addChild(new Spacer(1));
          container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
        }
      }
      const usageStr = formatUsageStats(r.usage, r.model);
      if (usageStr) {
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
      }
      return container;
    }

    let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
    if (r.handle) text += ` ${theme.fg("accent", `[${r.handle}]`)}`;
    if (isError && r.stopReason)
      text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
    if (isError && r.errorMessage)
      text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
    else if (displayItems.length === 0)
      text += `\n${theme.fg("muted", "(no output)")}`;
    else {
      text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
      if (displayItems.length > COLLAPSED_ITEM_COUNT)
        text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
    }
    const usageStr = formatUsageStats(r.usage, r.model);
    if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
    return new Text(text, 0, 0);
  }

  // Multiple results (parallel)
  const running = details.results.filter((r) => r.exitCode === -1).length;
  const successCount = details.results.filter(
    (r) => r.exitCode === 0 && !isErrorResult(r),
  ).length;
  const failCount = details.results.filter(
    (r) => r.exitCode !== -1 && isErrorResult(r),
  ).length;
  const isRunning = running > 0;
  const icon = isRunning
    ? theme.fg("warning", "⏳")
    : failCount > 0
      ? theme.fg("warning", "◐")
      : theme.fg("success", "✓");
  const status = isRunning
    ? `${successCount + failCount}/${details.results.length} done, ${running} running`
    : `${successCount}/${details.results.length} tasks`;

  const aggregateUsage = () => {
    const total = emptyUsage();
    for (const r of details.results) {
      total.input += r.usage.input;
      total.output += r.usage.output;
      total.cacheRead += r.usage.cacheRead;
      total.cacheWrite += r.usage.cacheWrite;
      total.cost += r.usage.cost;
      total.turns += r.usage.turns;
    }
    return total;
  };

  if (expanded && !isRunning) {
    const container = new Container();
    container.addChild(
      new Text(
        `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
        0,
        0,
      ),
    );

    for (const r of details.results) {
      const rIcon = isErrorResult(r)
        ? theme.fg("error", "✗")
        : theme.fg("success", "✓");
      const displayItems = getDisplayItems(r.messages);
      const finalOutput = getFinalOutput(r.messages);

      container.addChild(new Spacer(1));
      let head = `${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`;
      if (r.handle) head += ` ${theme.fg("accent", `[${r.handle}]`)}`;
      container.addChild(new Text(head, 0, 0));
      container.addChild(
        new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0),
      );

      for (const item of displayItems) {
        if (item.type === "toolCall") {
          container.addChild(
            new Text(
              theme.fg("muted", "→ ") +
                formatToolCall(item.name, item.args, theme.fg.bind(theme)),
              0,
              0,
            ),
          );
        }
      }

      if (finalOutput) {
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
      }

      const taskUsage = formatUsageStats(r.usage, r.model);
      if (taskUsage)
        container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
    }

    const usageStr = formatUsageStats(aggregateUsage());
    if (usageStr) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
    }
    return container;
  }

  // Collapsed view (or still running)
  let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
  for (const r of details.results) {
    const rIcon =
      r.exitCode === -1
        ? theme.fg("warning", "⏳")
        : isErrorResult(r)
          ? theme.fg("error", "✗")
          : theme.fg("success", "✓");
    const displayItems = getDisplayItems(r.messages);
    text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
    if (displayItems.length === 0)
      text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
    else text += `\n${renderDisplayItems(displayItems, 5)}`;
  }
  if (!isRunning) {
    const usageStr = formatUsageStats(aggregateUsage());
    if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
  }
  if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
  return new Text(text, 0, 0);
}

// ---------------------------------------------------------------------------
// Result -> tool output text
// ---------------------------------------------------------------------------

function handleHint(r: SingleResult): string {
  if (!r.handle) return "";
  return `\n\nSession kept alive as handle "${r.handle}". Continue it with subagent_followup({ handle: "${r.handle}", task: "..." }) or release it with subagent_close({ handle: "${r.handle}" }).`;
}

/**
 * Build an error tool result. pi's runtime honors `result.isError`
 * (agent-loop.js: `let isError = executed.isError`) even though the published
 * `AgentToolResult` type omits the field, so we set it through one cast here.
 */
function errorOutput<T>(text: string, details: T): AgentToolResult<T> {
  return {
    content: [{ type: "text", text }],
    details,
    isError: true,
  } as AgentToolResult<T>;
}

function singleResultOutput(r: SingleResult): AgentToolResult<SubagentDetails> {
  const results = [r];
  if (isErrorResult(r)) {
    const errorMsg =
      r.errorMessage || r.stderr || getFinalOutput(r.messages) || "(no output)";
    return errorOutput(
      `Agent ${r.stopReason || "failed"}: ${errorMsg}${handleHint(r)}${outputFileHint(results)}`,
      { results },
    );
  }
  return {
    content: [
      {
        type: "text",
        text:
          (getFinalOutput(r.messages) || "(no output)") +
          handleHint(r) +
          outputFileHint(results),
      },
    ],
    details: { results },
  };
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default async function (pi: ExtensionAPI) {
  const agentScope = getAgentScope();

  // Discover agents + roles at registration time for the tool descriptions.
  const cwd = process.cwd();
  const knownAgents = discoverAgents(cwd, agentScope).agents;
  const { names: roleNames, rolesPath } = await listRoles();

  const agentNames = knownAgents.map((a) => a.name);
  const agentListShort = agentNames.length > 0 ? agentNames.join(", ") : "none";
  const agentListDetailed = knownAgents
    .map((a) => `  - "${a.name}": ${a.description}`)
    .join("\n");
  const roleListShort = roleNames.length > 0 ? roleNames.join(", ") : "none";

  const roleDescription =
    roleNames.length > 0
      ? `Optional role override (default model selection path). Available roles, defined in ${rolesPath}: ${roleListShort}. Omit to use the agent's own role, or to inherit this session's model when the agent has none.`
      : `Optional role override (default model selection path). Roles are defined in ${rolesPath}. Omit to use the agent's own role.`;

  const modelDescription =
    "Optional concrete model override as provider/model[:thinking] (for example anthropic/claude-sonnet-4-5:high). Wins over role and agent frontmatter.";

  const TaskItem = Type.Object({
    agent: Type.String({
      description: `Name of the agent to run. Available agents: ${agentListShort}`,
    }),
    task: Type.String({
      description: "The task description to send to the agent",
    }),
    role: Type.Optional(Type.String({ description: roleDescription })),
    model: Type.Optional(Type.String({ description: modelDescription })),
    keepAlive: Type.Optional(
      Type.Boolean({
        description:
          "Keep the session alive after this turn and return a handle, so you can send more turns with subagent_followup. Default false (one-shot: the session is disposed after the turn).",
      }),
    ),
  });

  const SubagentParams = Type.Object({
    tasks: Type.Array(TaskItem),
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: [
      "Delegate tasks to subagents with isolated context. Each task {agent, task} runs in its own in-process session. Multiple tasks run in parallel.",
      "Set keepAlive:true on a task to keep its session for multi-turn use (returns a handle for subagent_followup); otherwise the session is one-shot.",
      "",
      "Available agents:",
      agentListDetailed || "  (none discovered)",
    ].join("\n"),
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const discovery = discoverAgents(ctx.cwd, agentScope);
      const agents = discovery.agents;

      if (!params.tasks || params.tasks.length === 0) {
        const { text } = formatAgentList(agents, 10);
        return {
          content: [
            {
              type: "text",
              text: `No tasks provided. Available agents: ${text}`,
            },
          ],
          details: { results: [] },
        };
      }

      if (params.tasks.length > MAX_PARALLEL_TASKS) {
        return {
          content: [
            {
              type: "text",
              text: `Too many tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
            },
          ],
          details: { results: [] },
        };
      }

      // Confirm project-local agents if needed
      if ((agentScope === "project" || agentScope === "both") && ctx.hasUI) {
        const requestedAgentNames = new Set(params.tasks.map((t) => t.agent));
        const projectAgentsRequested = Array.from(requestedAgentNames)
          .map((name) => agents.find((a) => a.name === name))
          .filter((a): a is AgentConfig => a?.source === "project");

        if (projectAgentsRequested.length > 0) {
          const names = projectAgentsRequested.map((a) => a.name).join(", ");
          const dir = discovery.projectAgentsDir ?? "(unknown)";
          const ok = await ctx.ui.confirm(
            "Run project-local agents?",
            `Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
          );
          if (!ok) {
            return {
              content: [
                {
                  type: "text",
                  text: "Canceled: project-local agents not approved.",
                },
              ],
              details: { results: [] },
            };
          }
        }
      }

      const deps: BuildSessionDeps = {
        cwd: ctx.cwd,
        modelRegistry: ctx.modelRegistry,
        authStorage: (ctx.modelRegistry as any).authStorage,
        parentModel: ctx.model,
        parentThinking:
          pi.getThinkingLevel() !== "off" ? pi.getThinkingLevel() : undefined,
      };

      const allResults: SingleResult[] = params.tasks.map((t) =>
        blankResult(t.agent, t.task),
      );

      const emitParallelUpdate = () => {
        if (!onUpdate) return;
        const running = allResults.filter((r) => r.exitCode === -1).length;
        const done = allResults.filter((r) => r.exitCode !== -1).length;
        onUpdate({
          content: [
            {
              type: "text",
              text: `${done}/${allResults.length} done, ${running} running...`,
            },
          ],
          details: { results: [...allResults] },
        });
      };

      const results = await mapWithConcurrencyLimit(
        params.tasks,
        MAX_CONCURRENCY,
        async (t, index) => {
          const result = allResults[index];
          const agent = agents.find((a) => a.name === t.agent);
          if (!agent) {
            const available =
              agents.map((a) => `"${a.name}"`).join(", ") || "none";
            result.exitCode = 1;
            result.stopReason = "error";
            result.errorMessage = `Unknown agent: "${t.agent}". Available agents: ${available}.`;
            emitParallelUpdate();
            return result;
          }
          result.agentSource = agent.source;

          let session: SubSession | undefined;
          try {
            const built = await buildSession(agent, t.role, t.model, deps);
            session = built.session;
            result.model = built.modelLabel;
            if (t.keepAlive) {
              const handle = newHandle(agent.name);
              result.handle = handle;
              durable.set(handle, {
                handle,
                agent: agent.name,
                agentSource: agent.source,
                model: built.modelLabel,
                session,
                cwd: ctx.cwd,
                turns: 0,
                createdAt: Date.now(),
              });
            }
            await runTurn(session, result, t.task, signal, emitParallelUpdate);
            result.exitCode = 0;
            if (t.keepAlive) {
              const entry = durable.get(result.handle!);
              if (entry) entry.turns = 1;
            } else {
              session.dispose();
            }
          } catch (err) {
            result.exitCode = 1;
            result.stopReason = result.stopReason || "error";
            result.errorMessage =
              result.errorMessage ||
              (err instanceof Error ? err.message : String(err));
            // One-shot sessions are disposed on failure; a keepAlive session
            // that built but errored mid-turn stays registered for retry.
            if (session && !t.keepAlive) {
              try {
                session.dispose();
              } catch {
                /* ignore */
              }
            }
          }
          result.outputFile = saveOutputFile(t.agent, result);
          emitParallelUpdate();
          return result;
        },
      );

      // Single task: return output directly
      if (results.length === 1) return singleResultOutput(results[0]);

      // Multiple tasks: summarize
      const successCount = results.filter((r) => !isErrorResult(r)).length;
      const failures = results.filter((r) => isErrorResult(r));
      const summaries = results.map((r) => {
        const output = getFinalOutput(r.messages);
        const preview =
          output.slice(0, 100) + (output.length > 100 ? "..." : "");
        const tag = r.handle ? ` (${r.handle})` : "";
        return `[${r.agent}${tag}] ${isErrorResult(r) ? "failed" : "completed"}: ${preview || "(no output)"}`;
      });

      if (failures.length > 0) {
        const errorDetails = failures.map((r) => {
          const errorMsg =
            r.errorMessage ||
            r.stderr ||
            getFinalOutput(r.messages) ||
            "(no output)";
          return `[${r.agent}] ${errorMsg}`;
        });
        return errorOutput(
          `${successCount}/${results.length} succeeded, ${failures.length} failed\n\nErrors:\n${errorDetails.join("\n")}\n\n${summaries.join("\n\n")}${outputFileHint(results)}`,
          { results },
        );
      }

      return {
        content: [
          {
            type: "text",
            text: `${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}${outputFileHint(results)}`,
          },
        ],
        details: { results },
      };
    },

    renderCall(args, theme) {
      const tasks = args.tasks || [];
      if (tasks.length === 0) {
        return new Text(
          theme.fg("toolTitle", theme.bold("subagent ")) +
            theme.fg("muted", "(no tasks)"),
          0,
          0,
        );
      }
      if (tasks.length === 1) {
        const t = tasks[0];
        const preview = t.task
          ? t.task.length > 60
            ? `${t.task.slice(0, 60)}...`
            : t.task
          : "...";
        let text =
          theme.fg("toolTitle", theme.bold("subagent ")) +
          theme.fg("accent", t.agent || "...");
        if (t.keepAlive) text += theme.fg("muted", " (keep-alive)");
        text += `\n  ${theme.fg("dim", preview)}`;
        return new Text(text, 0, 0);
      }
      let text =
        theme.fg("toolTitle", theme.bold("subagent ")) +
        theme.fg("accent", `parallel (${tasks.length} tasks)`);
      for (const t of tasks.slice(0, 3)) {
        const preview =
          t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
        text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
      }
      if (tasks.length > 3)
        text += `\n  ${theme.fg("muted", `... +${tasks.length - 3} more`)}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      return renderResults(result, expanded, theme);
    },
  });

  // -------------------------------------------------------------------------
  // subagent_followup — send another turn to a durable session
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "subagent_followup",
    label: "Subagent Follow-up",
    description:
      "Send another turn to a durable subagent session (one created with keepAlive:true). The session keeps its full prior context. Use subagent_list to see live handles.",
    parameters: Type.Object({
      handle: Type.String({
        description: "Handle of a live subagent session (from subagent_list).",
      }),
      task: Type.String({ description: "The next task for that session." }),
    }),

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const entry = durable.get(params.handle);
      if (!entry) {
        const live = [...durable.keys()].join(", ") || "none";
        return errorOutput(
          `Unknown handle "${params.handle}". Live handles: ${live}.`,
          { results: [] },
        );
      }
      if (entry.session.isStreaming) {
        return errorOutput(
          `Handle "${params.handle}" is busy (still streaming a previous turn).`,
          { results: [] },
        );
      }

      const result = blankResult(entry.agent, params.task, entry.agentSource);
      result.handle = entry.handle;
      result.model = entry.model;

      const emit = () => {
        if (onUpdate)
          onUpdate({
            content: [
              {
                type: "text",
                text: getFinalOutput(result.messages) || "(running...)",
              },
            ],
            details: { results: [result] },
          });
      };

      try {
        await runTurn(entry.session, result, params.task, signal, emit);
        result.exitCode = 0;
        entry.turns++;
      } catch (err) {
        result.exitCode = 1;
        result.stopReason = result.stopReason || "error";
        result.errorMessage =
          result.errorMessage ||
          (err instanceof Error ? err.message : String(err));
      }
      result.outputFile = saveOutputFile(entry.agent, result);
      return singleResultOutput(result);
    },

    renderCall(args, theme) {
      const preview = args.task
        ? args.task.length > 60
          ? `${args.task.slice(0, 60)}...`
          : args.task
        : "...";
      return new Text(
        `${theme.fg("toolTitle", theme.bold("subagent_followup "))}${theme.fg("accent", args.handle || "...")}\n  ${theme.fg("dim", preview)}`,
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme) {
      return renderResults(result, expanded, theme);
    },
  });

  // -------------------------------------------------------------------------
  // subagent_list — show live durable sessions
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "subagent_list",
    label: "Subagent List",
    description: "List live durable subagent sessions and their handles.",
    parameters: Type.Object({}),

    async execute() {
      if (durable.size === 0) {
        return {
          content: [
            { type: "text", text: "No live durable subagent sessions." },
          ],
          details: {},
        };
      }
      const now = Date.now();
      const lines = [...durable.values()].map((e) => {
        const age = Math.round((now - e.createdAt) / 1000);
        const busy = e.session.isStreaming ? " [streaming]" : "";
        return `- ${e.handle}: agent=${e.agent} turns=${e.turns} age=${age}s${e.model ? ` model=${e.model}` : ""}${busy}`;
      });
      return {
        content: [
          {
            type: "text",
            text: `${durable.size} live session(s):\n${lines.join("\n")}`,
          },
        ],
        details: {},
      };
    },

    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("subagent_list")), 0, 0);
    },
  });

  // -------------------------------------------------------------------------
  // subagent_close — dispose durable sessions
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "subagent_close",
    label: "Subagent Close",
    description:
      'Dispose a durable subagent session and free its context. Pass a handle, or "all" to close every live session.',
    parameters: Type.Object({
      handle: Type.String({
        description: 'Handle to close, or "all" for every live session.',
      }),
    }),

    async execute(_toolCallId, params) {
      if (params.handle === "all") {
        const n = durable.size;
        disposeAllDurable();
        return {
          content: [{ type: "text", text: `Closed ${n} durable session(s).` }],
          details: {},
        };
      }
      const entry = durable.get(params.handle);
      if (!entry) {
        const live = [...durable.keys()].join(", ") || "none";
        return errorOutput(
          `Unknown handle "${params.handle}". Live handles: ${live}.`,
          {},
        );
      }
      try {
        entry.session.dispose();
      } catch {
        /* ignore */
      }
      durable.delete(params.handle);
      return {
        content: [{ type: "text", text: `Closed session "${params.handle}".` }],
        details: {},
      };
    },

    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("subagent_close "))}${theme.fg("accent", args.handle || "...")}`,
        0,
        0,
      );
    },
  });

  // Dispose every durable session when this session's runtime is torn down
  // (quit, reload, /new, /resume, /fork).
  pi.on("session_shutdown", async () => {
    disposeAllDurable();
  });
}
