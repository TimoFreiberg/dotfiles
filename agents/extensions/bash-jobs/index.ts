/**
 * Backgroundable + streaming bash tool for pi.
 *
 * Pi ships a single blocking foreground bash tool with no way to background a
 * long-running command. This extension replaces the `bash` tool with a strict
 * superset and adds a small job-control surface:
 *
 *   bash(command, timeout?, background?)
 *     - background omitted/false: behaves exactly like pi's built-in bash
 *       (streams to the session with a capped tail, writes the FULL output to a
 *       temp file when truncated, applies our env spawn hook + compact render).
 *     - background: true: spawns the command detached, returns IMMEDIATELY with
 *       a job id + the temp file path + a hint to poll. The agent can then
 *       notice -> consider -> poll/abort like a human watching a terminal.
 *
 *   job_poll(jobId)   -> new output since last poll + status (+ exit code)
 *   job_list()        -> all jobs in this session with status
 *   job_abort(jobId)  -> SIGTERM, then SIGKILL after a grace window
 *
 * ── Why this owns `bash` (single-owner rule) ─────────────────────────────────
 * Pi resolves duplicate tool registrations by FIRST-registration-wins
 * (ExtensionRunner.getAllRegisteredTools / getToolDefinition iterate extensions
 * and keep the first match), and the resource loader logs a "Tool 'bash'
 * conflicts with <ext>" diagnostic when two extensions register the same name.
 * So the `bash` registration was MOVED out of compact-output.ts (which keeps
 * read/write/grep/find) into here, making this the sole owner. The env spawn
 * hook and the `bashToolRender` compact rendering are preserved verbatim.
 *
 * ── Foreground delegation ────────────────────────────────────────────────────
 * Foreground bash delegates to pi's own `createBashToolDefinition`, so we
 * inherit its battle-tested streaming, truncation, temp-file handling, and the
 * exact `BashToolDetails` result shape the compact renderer reads. We do not
 * reimplement any of that.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  createBashToolDefinition,
  formatSize,
  type BashSpawnContext,
  type BashSpawnHook,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { relative } from "node:path";
import { bashToolRender } from "../lib/compact-tool-render.ts";
import { JobRegistry, type JobView } from "./jobs.ts";

// ── shared env spawn hook (identical for foreground and background) ──────────
// Moved verbatim from compact-output.ts. Keeps interactive editors/pagers from
// hanging a non-interactive agent shell.
const envSpawnHook: BashSpawnHook = ({
  command,
  cwd,
  env,
}: BashSpawnContext): BashSpawnContext => ({
  command,
  cwd,
  env: {
    ...env,
    CI: "true",
    EDITOR: "false",
    GIT_EDITOR: "false",
    GIT_PAGER: "cat",
    JJ_EDITOR: "false",
    MANPAGER: "cat",
    PAGER: "cat",
  },
});

// Extend the built-in bash schema with an optional `background` flag. The
// built-in schema is { command, timeout? }; we add `background?`.
const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(
    Type.Number({
      description:
        "Timeout in seconds. For background jobs, kills the job after this many seconds.",
    }),
  ),
  background: Type.Optional(
    Type.Boolean({
      description:
        "If true, run the command in the background and return immediately with a job id. " +
        "Use job_poll to read incremental output and job_abort to kill it. " +
        "Use this for long-running commands (servers, builds, watchers) so you are not blocked.",
    }),
  ),
});

const jobIdSchema = Type.Object({
  jobId: Type.String({
    description: "The job id returned by a background bash call.",
  }),
});

function shortenPath(path: string, cwd: string): string {
  try {
    const rel = relative(cwd, path);
    if (rel && !rel.startsWith("..") && rel.length < path.length) return rel;
  } catch {
    /* fall through */
  }
  return path;
}

function statusLine(view: JobView): string {
  const runtime = `${(view.runtimeMs / 1000).toFixed(1)}s`;
  switch (view.status) {
    case "running":
      return `running (${runtime} elapsed)`;
    case "exited":
      return `exited code ${view.exitCode ?? "unknown"} (ran ${runtime})`;
    case "aborted":
      return `aborted (ran ${runtime})`;
    case "failed":
      return `failed: ${view.error ?? "unknown error"} (ran ${runtime})`;
  }
}

export default function (pi: ExtensionAPI) {
  // One registry per extension instance (i.e. per session). Re-created on
  // session_start; live jobs are killed on session_shutdown.
  let registry = new JobRegistry();

  // displayCwd is fine for path shortening in renderers; the tool's execute
  // must use ctx.cwd at runtime (pi-gui's process cwd != workspace cwd).
  const displayCwd = process.cwd();

  // ── bash (override) ────────────────────────────────────────────────────────
  const render = bashToolRender(displayCwd);
  pi.registerTool({
    name: "bash",
    label: "bash",
    description:
      "Execute a bash command in the current working directory. Returns stdout and stderr. " +
      "Output is truncated (last 2000 lines or 50KB, whichever is hit first); when truncated, " +
      "the FULL output is saved to a temp file whose path is included in the result so you can " +
      "`read` it. Set background: true to run long commands without blocking — it returns a job " +
      "id immediately; then use job_poll to watch output and job_abort to stop it. Optionally " +
      "provide a timeout in seconds.",
    promptSnippet:
      "Execute bash commands; set background:true for long-running ones, then job_poll/job_abort",
    promptGuidelines: [
      "Use bash with background:true for commands that run a long time or never exit on their own (dev servers, watchers, long builds/tests) so you are not blocked; then job_poll to read progress and job_abort to stop.",
      "Use job_poll to read new output from a backgrounded bash job and check whether it is still running or has exited.",
      "Use job_abort to terminate a backgrounded bash job you no longer need.",
    ],
    parameters: bashSchema,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const actualCwd =
        (ctx as ExtensionContext | undefined)?.cwd ?? displayCwd;

      if (params.background) {
        // Fire-and-return. The job keeps streaming to its temp file.
        const view = registry.spawn(
          params.command,
          actualCwd,
          envSpawnHook,
          params.timeout,
        );
        const text =
          `Started background job ${view.id}.\n` +
          `Full output streams to: ${view.fullOutputPath}\n` +
          `Use job_poll("${view.id}") to read new output and check status, ` +
          `or job_abort("${view.id}") to stop it.`;
        return {
          content: [{ type: "text", text }],
          details: { job: view },
        };
      }

      // Foreground: delegate to pi's built-in bash with our env spawn hook.
      // This preserves streaming, truncation, temp-file handling, and the exact
      // BashToolDetails result shape the compact renderer depends on.
      const def = createBashToolDefinition(actualCwd, {
        spawnHook: envSpawnHook,
      });
      return def.execute(toolCallId, params, signal, onUpdate);
    },

    // Inherit the compact bash rendering for foreground calls. Background calls
    // produce a short "started job" line which renders fine through it too.
    ...render,
  });

  // ── job_poll ─────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "job_poll",
    label: "job poll",
    description:
      "Read output produced by a background bash job since the last poll, plus its current " +
      "status (running, or exited with an exit code). New output is capped to the last 2000 " +
      "lines / 50KB; the full output always lives in the job's temp file (read it for more).",
    promptSnippet: "Poll a background bash job for new output and status",
    parameters: jobIdSchema,

    async execute(_toolCallId, params) {
      const result = await registry.readSincePoll(params.jobId);
      if (!result) {
        throw new Error(
          `No such job: ${params.jobId}. Use job_list to see known jobs.`,
        );
      }
      const { job, newOutput, newBytes, truncated, skippedBytes } = result;
      const parts: string[] = [`[${job.id}] ${statusLine(job)}`];
      if (newBytes === 0) {
        parts.push("(no new output since last poll)");
      } else {
        if (truncated) {
          parts.push(
            `[showing last ${formatSize(
              newBytes - skippedBytes,
            )} of ${formatSize(
              newBytes,
            )} new output; full output: ${job.fullOutputPath}]`,
          );
        }
        parts.push(newOutput);
      }
      return {
        content: [{ type: "text", text: parts.join("\n") }],
        details: { job, newBytes, truncated },
      };
    },

    renderResult(toolResult, _options, theme) {
      const text = toolResult.content[0];
      return new Text(
        theme.fg("toolOutput", text?.type === "text" ? text.text : ""),
        0,
        0,
      );
    },
  });

  // ── job_list ───────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "job_list",
    label: "job list",
    description:
      "List all background bash jobs started in this session, with their status and exit codes.",
    promptSnippet: "List background bash jobs and their status",
    parameters: Type.Object({}),

    async execute() {
      const jobs = registry.list();
      if (jobs.length === 0) {
        return {
          content: [{ type: "text", text: "No background jobs." }],
          details: { jobs },
        };
      }
      const lines = jobs.map(
        (j) =>
          `[${j.id}] ${statusLine(j)} — ${shortenPath(j.cwd, displayCwd)}$ ${j.command}`,
      );
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { jobs },
      };
    },
  });

  // ── job_abort ────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "job_abort",
    label: "job abort",
    description:
      "Terminate a background bash job. Sends SIGTERM to the whole process group, then SIGKILL " +
      "after a short grace period if it does not exit. No-op if the job already finished.",
    promptSnippet: "Abort (kill) a background bash job",
    parameters: jobIdSchema,

    async execute(_toolCallId, params) {
      const view = registry.abort(params.jobId);
      if (!view) {
        throw new Error(
          `No such job: ${params.jobId}. Use job_list to see known jobs.`,
        );
      }
      const text =
        view.status === "running" || view.status === "aborted"
          ? `Aborting job ${view.id} (SIGTERM sent; SIGKILL follows if needed).`
          : `Job ${view.id} already ${view.status}; nothing to abort.`;
      return { content: [{ type: "text", text }], details: { job: view } };
    },
  });

  // ── lifecycle ──────────────────────────────────────────────────────────────
  // Fresh registry per session; kill live jobs on shutdown (temp files kept on
  // disk so the agent / user can still inspect them after the session ends).
  pi.on("session_start", async () => {
    registry = new JobRegistry();
  });
  pi.on("session_shutdown", async () => {
    registry.abortAll();
  });
}
