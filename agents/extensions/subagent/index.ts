/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Single task: { tasks: [{ agent: "name", task: "..." }] }
 * Parallel:    { tasks: [{ agent: "a", task: "..." }, { agent: "b", task: "..." }] }
 *
 * Config env vars:
 *   PI_SUBAGENT_SCOPE   - "user" (default), "project", or "both"
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import {
  type ExtensionAPI,
  getMarkdownTheme,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
  type AgentConfig,
  type AgentScope,
  discoverAgents,
  formatAgentList,
} from "./agents.js";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;

/**
 * Map generic model names to Amazon Bedrock model IDs.
 */
const BEDROCK_MODEL_MAP: Record<string, string> = {
  "claude-opus-4-6": "global.anthropic.claude-opus-4-6-v1",
  "claude-opus-4-5": "global.anthropic.claude-opus-4-5-20251101-v1:0",
  "claude-sonnet-4-5": "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "claude-sonnet-4": "global.anthropic.claude-sonnet-4-20250514-v1:0",
  "claude-haiku-4-5": "global.anthropic.claude-haiku-4-5-20251001-v1:0",
};

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
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  outputFile?: string;
}

interface SubagentDetails {
  results: SingleResult[];
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

function writePromptToTempFile(
  agentName: string,
  prompt: string,
): { dir: string; filePath: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  fs.writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
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

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

function getAgentScope(): AgentScope {
  const env = process.env.PI_SUBAGENT_SCOPE;
  if (env === "project" || env === "both") return env;
  return "user";
}

async function runSingleAgent(
  cwd: string,
  agents: AgentConfig[],
  agentName: string,
  task: string,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdateCallback | undefined,
  parentProvider?: string,
  parentThinking?: string,
): Promise<SingleResult> {
  const agent = agents.find((a) => a.name === agentName);

  if (!agent) {
    const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
    return {
      agent: agentName,
      agentSource: "unknown",
      task,
      exitCode: 1,
      messages: [],
      stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        contextTokens: 0,
        turns: 0,
      },
    };
  }

  const args: string[] = ["--mode", "json", "-p", "--no-session"];

  const provider = agent.provider ?? parentProvider;
  if (provider) args.push("--provider", provider);

  if (agent.model) {
    const resolvedModel =
      provider === "amazon-bedrock"
        ? (BEDROCK_MODEL_MAP[agent.model] ?? agent.model)
        : agent.model;
    args.push("--model", resolvedModel);
  }

  const thinking = agent.thinking ?? parentThinking;
  if (thinking) args.push("--thinking", thinking);

  if (agent.tools && agent.tools.length > 0)
    args.push("--tools", agent.tools.join(","));

  let tmpPromptDir: string | null = null;
  let tmpPromptPath: string | null = null;

  const currentResult: SingleResult = {
    agent: agentName,
    agentSource: agent.source,
    task,
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
    model: agent.model,
  };

  const emitUpdate = () => {
    if (onUpdate) {
      onUpdate({
        content: [
          {
            type: "text",
            text: getFinalOutput(currentResult.messages) || "(running...)",
          },
        ],
        details: { results: [currentResult] },
      });
    }
  };

  try {
    if (agent.systemPrompt.trim()) {
      const tmp = writePromptToTempFile(agent.name, agent.systemPrompt);
      tmpPromptDir = tmp.dir;
      tmpPromptPath = tmp.filePath;
      args.push("--append-system-prompt", tmpPromptPath);
    }

    args.push(`Task: ${task}`);
    let wasAborted = false;

    const exitCode = await new Promise<number>((resolve) => {
      const proc = spawn("pi", args, {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let buffer = "";

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }

        if (event.type === "message_end" && event.message) {
          const msg = event.message as Message;
          currentResult.messages.push(msg);

          if (msg.role === "assistant") {
            currentResult.usage.turns++;
            const usage = msg.usage;
            if (usage) {
              currentResult.usage.input += usage.input || 0;
              currentResult.usage.output += usage.output || 0;
              currentResult.usage.cacheRead += usage.cacheRead || 0;
              currentResult.usage.cacheWrite += usage.cacheWrite || 0;
              currentResult.usage.cost += usage.cost?.total || 0;
              currentResult.usage.contextTokens = usage.totalTokens || 0;
            }
            if (!currentResult.model && msg.model)
              currentResult.model = msg.model;
            if (msg.stopReason) currentResult.stopReason = msg.stopReason;
            if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
          }
          emitUpdate();
        }

        if (event.type === "tool_result_end" && event.message) {
          currentResult.messages.push(event.message as Message);
          emitUpdate();
        }
      };

      proc.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });

      proc.stderr.on("data", (data) => {
        currentResult.stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (buffer.trim()) processLine(buffer);
        resolve(code ?? 0);
      });

      proc.on("error", () => {
        resolve(1);
      });

      if (signal) {
        const killProc = () => {
          wasAborted = true;
          proc.kill("SIGTERM");
          setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL");
          }, 5000);
        };
        if (signal.aborted) killProc();
        else signal.addEventListener("abort", killProc, { once: true });
      }
    });

    currentResult.exitCode = exitCode;
    if (wasAborted) throw new Error("Subagent was aborted");
    return currentResult;
  } finally {
    if (tmpPromptPath)
      try {
        fs.unlinkSync(tmpPromptPath);
      } catch {
        /* ignore */
      }
    if (tmpPromptDir)
      try {
        fs.rmdirSync(tmpPromptDir);
      } catch {
        /* ignore */
      }
  }
}

const TaskItem = Type.Object({
  agent: Type.String(),
  task: Type.String(),
});

const SubagentParams = Type.Object({
  tasks: Type.Array(TaskItem),
});

export default function (pi: ExtensionAPI) {
  const agentScope = getAgentScope();

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate tasks to subagents with isolated context. Each task {agent, task} runs as a separate pi process. Multiple tasks run in parallel.",
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

      const parentProvider = ctx.model?.provider;
      const parentThinking = pi.getThinkingLevel();

      // Track all results for streaming updates
      const allResults: SingleResult[] = new Array(params.tasks.length);

      for (let i = 0; i < params.tasks.length; i++) {
        allResults[i] = {
          agent: params.tasks[i].agent,
          agentSource: "unknown",
          task: params.tasks[i].task,
          exitCode: -1,
          messages: [],
          stderr: "",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0,
            contextTokens: 0,
            turns: 0,
          },
        };
      }

      const emitParallelUpdate = () => {
        if (onUpdate) {
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
        }
      };

      const results = await mapWithConcurrencyLimit(
        params.tasks,
        MAX_CONCURRENCY,
        async (t, index) => {
          const result = await runSingleAgent(
            ctx.cwd,
            agents,
            t.agent,
            t.task,
            signal,
            (partial) => {
              if (partial.details?.results[0]) {
                allResults[index] = partial.details.results[0];
                emitParallelUpdate();
              }
            },
            parentProvider,
            parentThinking !== "off" ? parentThinking : undefined,
          );
          allResults[index] = result;
          emitParallelUpdate();
          result.outputFile = saveOutputFile(t.agent, result);
          return result;
        },
      );

      const successCount = results.filter((r) => r.exitCode === 0).length;
      const failures = results.filter(
        (r) =>
          r.exitCode !== 0 ||
          r.stopReason === "error" ||
          r.stopReason === "aborted",
      );

      // Single task: return output directly
      if (results.length === 1) {
        const r = results[0];
        const isError =
          r.exitCode !== 0 ||
          r.stopReason === "error" ||
          r.stopReason === "aborted";
        if (isError) {
          const errorMsg =
            r.errorMessage ||
            r.stderr ||
            getFinalOutput(r.messages) ||
            "(no output)";
          return {
            content: [
              {
                type: "text",
                text: `Agent ${r.stopReason || "failed"}: ${errorMsg}${outputFileHint(results)}`,
              },
            ],
            details: { results },
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text",
              text:
                (getFinalOutput(r.messages) || "(no output)") +
                outputFileHint(results),
            },
          ],
          details: { results },
        };
      }

      // Multiple tasks: summarize
      const summaries = results.map((r) => {
        const output = getFinalOutput(r.messages);
        const preview =
          output.slice(0, 100) + (output.length > 100 ? "..." : "");
        return `[${r.agent}] ${r.exitCode === 0 ? "completed" : "failed"}: ${preview || "(no output)"}`;
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
        return {
          content: [
            {
              type: "text",
              text: `${successCount}/${results.length} succeeded, ${failures.length} failed\n\nErrors:\n${errorDetails.join("\n")}\n\n${summaries.join("\n\n")}${outputFileHint(results)}`,
            },
          ],
          details: { results },
          isError: true,
        };
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
      const details = result.details as SubagentDetails | undefined;
      if (!details || details.results.length === 0) {
        const text = result.content[0];
        return new Text(
          text?.type === "text" ? text.text : "(no output)",
          0,
          0,
        );
      }

      const mdTheme = getMarkdownTheme();

      const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
        const toShow = limit ? items.slice(-limit) : items;
        const skipped =
          limit && items.length > limit ? items.length - limit : 0;
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
        const isError =
          r.exitCode !== 0 ||
          r.stopReason === "error" ||
          r.stopReason === "aborted";
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
          container.addChild(
            new Text(theme.fg("muted", "─── Output ───"), 0, 0),
          );
          if (displayItems.length === 0 && !finalOutput) {
            container.addChild(
              new Text(theme.fg("muted", "(no output)"), 0, 0),
            );
          } else {
            for (const item of displayItems) {
              if (item.type === "toolCall")
                container.addChild(
                  new Text(
                    theme.fg("muted", "→ ") +
                      formatToolCall(
                        item.name,
                        item.args,
                        theme.fg.bind(theme),
                      ),
                    0,
                    0,
                  ),
                );
            }
            if (finalOutput) {
              container.addChild(new Spacer(1));
              container.addChild(
                new Markdown(finalOutput.trim(), 0, 0, mdTheme),
              );
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
        (r) => r.exitCode === 0,
      ).length;
      const failCount = details.results.filter((r) => r.exitCode > 0).length;
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
        const total = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          turns: 0,
        };
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
          const rIcon =
            r.exitCode === 0
              ? theme.fg("success", "✓")
              : theme.fg("error", "✗");
          const displayItems = getDisplayItems(r.messages);
          const finalOutput = getFinalOutput(r.messages);

          container.addChild(new Spacer(1));
          container.addChild(
            new Text(
              `${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`,
              0,
              0,
            ),
          );
          container.addChild(
            new Text(
              theme.fg("muted", "Task: ") + theme.fg("dim", r.task),
              0,
              0,
            ),
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
          container.addChild(
            new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0),
          );
        }
        return container;
      }

      // Collapsed view (or still running)
      let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
      for (const r of details.results) {
        const rIcon =
          r.exitCode === -1
            ? theme.fg("warning", "⏳")
            : r.exitCode === 0
              ? theme.fg("success", "✓")
              : theme.fg("error", "✗");
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
    },
  });
}
