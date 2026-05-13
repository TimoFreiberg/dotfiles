/**
 * Tasklist Extension — In-session task tracking for the agent
 *
 * Provides tools for the agent to maintain a focused task list during a
 * session, with periodic reminders every N turns of non-use.  State is stored
 * in a file outside the session tree so it survives compaction and /resume.
 *
 * Design informed by experience with Swival's todo feature:
 * - File-based storage survives compaction
 * - Tool-calling forces explicit commit/completion signals
 * - Nudge re-injects after 3 turns of non-use
 * - Fuzzy matching cascade for done/delete (exact → prefix → substring →
 *   disambiguation)
 * - Hard caps (50 items, 500 chars each) force the model to summarize
 *
 * Tasks are scoped to a session file path — switching sessions (/new,
 * /resume) starts with the tasks that belong to that session.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskItem {
  id: string;
  description: string;
  createdAt: number;
}

interface SessionTaskState {
  tasks: TaskItem[];
  /** How many user prompts have passed since the last tasklist tool call. */
  turnsSinceTasklistUse: number;
}

interface TaskListFile {
  version: 2;
  sessions: Record<string, SessionTaskState>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Reminder fires after this many user prompts with no tasklist tool use. */
const REMINDER_INTERVAL = 3;

/** Hard cap: max number of tasks.  Forces the model to summarize/consolidate. */
const MAX_TASKS = 50;

/** Hard cap: max characters per task description. */
const MAX_DESC_LENGTH = 500;

const DATA_FILE = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "extensions",
  "tasklist-state.json",
);

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

let tasks: TaskItem[] = [];
let sessionKey: string | null = null;
let turnsSinceTasklistUse = 0;

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function readFile(): TaskListFile {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(raw) as TaskListFile;
  } catch {
    return { version: 2, sessions: {} };
  }
}

function writeFile(): void {
  if (!sessionKey) return;
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

  // Read-merge-write to avoid clobbering other sessions' data
  const data = readFile();
  data.sessions[sessionKey] = { tasks, turnsSinceTasklistUse };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Find a task by user-supplied input using a cascade:
 * 1. Exact match on ID
 * 2. Prefix match on ID  ("a3" → "a3f9")
 * 3. Case-insensitive substring match on description
 * 4. Multiple matches → error listing candidates
 * 5. Nothing found → error
 */
function findTask(
  input: string,
): { task: TaskItem } | { error: string; candidates: TaskItem[] } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { error: "Empty task identifier.", candidates: [] };
  }

  // 1. Exact match on ID
  const exact = tasks.find((t) => t.id === trimmed);
  if (exact) return { task: exact };

  // 2. Prefix match on ID
  const prefixHits = tasks.filter((t) => t.id.startsWith(trimmed));
  if (prefixHits.length === 1) return { task: prefixHits[0] };

  // 3. Case-insensitive substring on description
  const lower = trimmed.toLowerCase();
  const substrHits = tasks.filter((t) =>
    t.description.toLowerCase().includes(lower),
  );
  if (substrHits.length === 1) return { task: substrHits[0] };

  // 4. Disambiguate: show candidates if prefix/substring hit multiple
  const candidates = prefixHits.length > 1 ? prefixHits : substrHits;
  if (candidates.length > 1) {
    const ids = candidates.map((c) => `#${c.id}`).join(", ");
    return {
      error: `"${trimmed}" matches ${candidates.length} tasks: ${ids}. Use one of those IDs.`,
      candidates,
    };
  }

  // 5. Nothing found
  return {
    error: `No task found matching "${trimmed}".`,
    candidates: [],
  };
}

function formatTaskList(items: TaskItem[]): string {
  if (items.length === 0) return "No tasks.";
  return items.map((t) => `[ ] #${t.id}: ${t.description}`).join("\n");
}

// ---------------------------------------------------------------------------
// Persistent widget (above editor, shown while tasks are nonempty)
// ---------------------------------------------------------------------------

function updateWidget(ui: ExtensionContext["ui"]): void {
  if (tasks.length === 0) {
    ui.setWidget("tasklist", undefined);
    return;
  }
  const lines: string[] = [
    `Open Tasks (${tasks.length}):`,
    ...tasks.map((t) => `  \u25cb #${t.id}: ${t.description}`),
  ];
  ui.setWidget("tasklist", lines);
}

/**
 * One-line summary for pre-flight injection.
 * Always injected on non-use turns so the model knows tasks are pending
 * without the full-list token cost every time.
 */
function summaryLine(items: TaskItem[]): string {
  if (items.length === 0) return "";
  const ids = items.map((t) => `#${t.id}`).join(", ");
  return `⚡ ${items.length} open task(s): ${ids}`;
}

/**
 * Full reminder block injected on the exact trigger turn.
 */
function formatReminder(items: TaskItem[]): string {
  if (items.length === 0) return "";
  const lines = [
    `Open Tasks (${items.length} remaining) — use tasklist_done/delete when addressed:`,
    ...items.map((t) => `  • #${t.id}: ${t.description}`),
  ];
  return lines.join("\n");
}

/** Reset the non-use counter when any tasklist tool is called. */
function markToolUsed(): void {
  turnsSinceTasklistUse = 0;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function tasklistExtension(pi: ExtensionAPI) {
  const getSessionKey = (ctx: ExtensionContext): string | null => {
    const file = ctx.sessionManager.getSessionFile();
    if (file) return file;
    // Ephemeral / --no-session: fall back to cwd-based key so the list at
    // least lives for the duration of the process.
    return `__ephemeral__:${ctx.cwd}`;
  };

  const isEphemeral = (): boolean =>
    sessionKey !== null && sessionKey.startsWith("__ephemeral__");

  // -----------------------------------------------------------------------
  // Session lifecycle
  // -----------------------------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    sessionKey = getSessionKey(ctx);
    tasks = [];
    turnsSinceTasklistUse = 0;

    if (!sessionKey || isEphemeral()) return;

    const saved = readFile().sessions[sessionKey];
    if (saved) {
      tasks = saved.tasks;
      turnsSinceTasklistUse = saved.turnsSinceTasklistUse ?? 0;
    }

    updateWidget(ctx.ui);
  });

  pi.on("session_shutdown", async () => {
    if (sessionKey && !isEphemeral()) writeFile();
  });

  // -----------------------------------------------------------------------
  // Reminder: inject after REMINDER_INTERVAL turns of non-use
  // -----------------------------------------------------------------------

  pi.on("before_agent_start", async (event) => {
    if (tasks.length === 0) return;

    turnsSinceTasklistUse++;
    if (turnsSinceTasklistUse < REMINDER_INTERVAL) return;

    const reminder = formatReminder(tasks);
    if (!reminder) return;

    return {
      systemPrompt: event.systemPrompt + "\n\n" + reminder,
    };
  });

  // -----------------------------------------------------------------------
  // Tools
  // -----------------------------------------------------------------------

  pi.registerTool({
    name: "tasklist_add",
    label: "Add Tasks",
    description:
      "Add one or more tasks to the in-session task list (max 50 items, 500 chars each)",
    promptSnippet: "Add tasks to track what needs to be done this session",
    promptGuidelines: [
      "Use tasklist_add to track work for the current session. Max 50 items, 500 chars per description. Pass a list of descriptions to batch-add tasks.",
    ],
    parameters: Type.Object({
      descriptions: Type.Array(
        Type.String({ description: "A task description (max 500 chars)" }),
        {
          description: "One or more task descriptions to add",
          minItems: 1,
        },
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Truncate descriptions first so we count accurately
      const normalized = params.descriptions.map((d) =>
        d.length > MAX_DESC_LENGTH ? d.slice(0, MAX_DESC_LENGTH) : d,
      );

      const remaining = MAX_TASKS - tasks.length;
      const toAdd = normalized.slice(0, remaining);
      const skipped = normalized.length - toAdd.length;

      const added: TaskItem[] = [];
      for (const desc of toAdd) {
        const task: TaskItem = {
          id: generateId(),
          description: desc,
          createdAt: Date.now(),
        };
        tasks.push(task);
        added.push(task);
      }
      markToolUsed();
      writeFile();
      updateWidget(ctx.ui);

      const lines: string[] = [];
      if (added.length > 0) {
        const ids = added.map((t) => `#${t.id}`).join(", ");
        lines.push(`Added ${added.length} task(s): ${ids}`);
      }
      if (skipped > 0) {
        lines.push(
          `List is full (${MAX_TASKS} max). ${skipped} task(s) not added. Use tasklist_done or tasklist_delete to make room.`,
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          action: "add",
          added: added.map((t) => ({
            taskId: t.id,
            description: t.description,
          })),
          skipped,
        },
      };
    },
  });

  pi.registerTool({
    name: "tasklist_done",
    label: "Complete Task",
    description:
      "Mark a task as completed and remove it from the list. Supports fuzzy matching: exact ID, prefix ID, or description substring.",
    promptSnippet:
      "Mark a task as done by its task ID (fuzzy matching supported; completed tasks are removed from the list)",
    promptGuidelines: [
      "Use tasklist_done when you complete a task. Supports fuzzy matching — pass an ID, a partial ID, or a description fragment. Completed tasks are removed from the list.",
    ],
    parameters: Type.Object({
      taskId: Type.String({
        description:
          "Task ID or identifier (exact ID, partial ID prefix, or description fragment)",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = findTask(params.taskId);
      if ("error" in result) {
        return {
          content: [{ type: "text", text: result.error }],
          isError: true,
          details: {
            action: "done",
            error: "not_found",
            taskId: params.taskId,
          },
        };
      }
      const idx = tasks.indexOf(result.task);
      const done = tasks.splice(idx, 1)[0];
      markToolUsed();
      writeFile();
      updateWidget(ctx.ui);
      return {
        content: [
          {
            type: "text",
            text: `Task #${done.id} "${done.description}" completed.`,
          },
        ],
        details: {
          action: "done",
          taskId: done.id,
          description: done.description,
        },
      };
    },
  });

  pi.registerTool({
    name: "tasklist_delete",
    label: "Delete Task",
    description:
      "Remove a task from the list entirely (without completing it). Supports fuzzy matching.",
    promptSnippet:
      "Delete a task by its task ID (fuzzy matching supported; use when a task is no longer needed)",
    parameters: Type.Object({
      taskId: Type.String({
        description:
          "Task ID or identifier (exact ID, partial ID prefix, or description fragment)",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = findTask(params.taskId);
      if ("error" in result) {
        return {
          content: [{ type: "text", text: result.error }],
          isError: true,
          details: {
            action: "delete",
            error: "not_found",
            taskId: params.taskId,
          },
        };
      }
      const idx = tasks.indexOf(result.task);
      const removed = tasks.splice(idx, 1)[0];
      markToolUsed();
      writeFile();
      updateWidget(ctx.ui);
      return {
        content: [
          {
            type: "text",
            text: `Deleted task #${removed.id}: ${removed.description}`,
          },
        ],
        details: { action: "delete", taskId: removed.id },
      };
    },
  });

  pi.registerTool({
    name: "tasklist_list",
    label: "List Tasks",
    description: "List all current tasks",
    promptSnippet: "Show the current task list",
    promptGuidelines: [
      "Use tasklist_list when the user asks what's left to do.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const text = formatTaskList(tasks);
      return {
        content: [{ type: "text", text }],
        details: {
          action: "list",
          count: tasks.length,
          tasks: tasks.map((t) => ({
            taskId: t.id,
            description: t.description,
          })),
        },
      };
    },
  });

  // -----------------------------------------------------------------------
  // User command: /tasks
  // -----------------------------------------------------------------------

  pi.registerCommand("tasks", {
    description: "Show the in-session task list",
    handler: async (_args, ctx) => {
      if (tasks.length === 0) {
        ctx.ui.notify("No tasks. Ask the agent to add some!", "info");
        return;
      }
      const lines: string[] = [`Tasks (${tasks.length} open)`];
      for (const t of tasks) {
        lines.push(`  ○ #${t.id}: ${t.description}`);
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
