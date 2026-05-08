/**
 * Prompt History Extension
 *
 * Seeds the editor's up-arrow history with past user prompts from *all*
 * prior sessions in the current cwd, not just the current session.
 *
 * Extracted from mitsuhiko's prompt-editor.ts (agent-stuff), with the
 * modes feature dropped.
 *
 * How it works:
 * - On session_start, reads the current session's user prompts from the
 *   in-memory session branch.
 * - Synchronously installs a CustomEditor seeded with those immediate
 *   prompts so up-arrow works straight away.
 * - Then async-loads user prompts from the last-modified JSONL files in
 *   `~/.pi/agent/sessions/--<cwd-encoded>--/`, dedupes against the current
 *   session, caps at 100 entries, and re-installs the editor with the full
 *   history — unless the editor text has changed in the meantime (user
 *   already typing) or another session_start fired.
 *
 * Caveats:
 * - pi exposes no "add to history" hook; the only way to seed history is
 *   via ctx.ui.setEditorComponent. If another extension also sets a custom
 *   editor component, last-one-wins. None of the currently installed
 *   extensions (answer, btw, context, etc.) do.
 * - The cwd → session-dir encoding (`--<path-with-/-replaced-by-->--`) has
 *   to match pi's own encoding. If pi changes that, history seeding goes
 *   silent (but nothing else breaks).
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const MAX_HISTORY_ENTRIES = 100;
const MAX_RECENT_PROMPTS = 30;

// ---------------------------------------------------------------------------
// Path helpers — mirror pi's own session-dir layout.
// ---------------------------------------------------------------------------

function expandUserPath(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function getGlobalAgentDir(): string {
  // Mirror pi-coding-agent's getAgentDir() behavior.
  // Canonical implementation: pi-mono/packages/coding-agent/src/config.ts
  const env = process.env.PI_CODING_AGENT_DIR;
  if (env) return expandUserPath(env);
  return path.join(os.homedir(), ".pi", "agent");
}

function getSessionDirForCwd(cwd: string): string {
  const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(getGlobalAgentDir(), "sessions", safePath);
}

// ---------------------------------------------------------------------------
// Prompt extraction
// ---------------------------------------------------------------------------

interface PromptEntry {
  text: string;
  timestamp: number;
}

function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text ?? "")
    .join("")
    .trim();
}

function collectUserPromptsFromEntries(entries: Array<any>): PromptEntry[] {
  const prompts: PromptEntry[] = [];

  for (const entry of entries) {
    if (entry?.type !== "message") continue;
    const message = entry?.message;
    if (!message || message.role !== "user" || !Array.isArray(message.content))
      continue;
    const text = extractText(message.content);
    if (!text) continue;
    const timestamp = Number(
      message.timestamp ?? entry.timestamp ?? Date.now(),
    );
    prompts.push({ text, timestamp });
  }

  return prompts;
}

async function readTail(
  filePath: string,
  maxBytes = 256 * 1024,
): Promise<string> {
  let fileHandle: fs.FileHandle | undefined;
  try {
    const stats = await fs.stat(filePath);
    const size = stats.size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    if (length <= 0) return "";

    const buffer = Buffer.alloc(length);
    fileHandle = await fs.open(filePath, "r");
    const { bytesRead } = await fileHandle.read(buffer, 0, length, start);
    if (bytesRead === 0) return "";
    let chunk = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      // Drop the (likely partial) first line after a mid-file seek.
      const firstNewline = chunk.indexOf("\n");
      if (firstNewline !== -1) {
        chunk = chunk.slice(firstNewline + 1);
      }
    }
    return chunk;
  } catch {
    return "";
  } finally {
    await fileHandle?.close();
  }
}

async function loadPromptHistoryForCwd(
  cwd: string,
  excludeSessionFile?: string,
): Promise<PromptEntry[]> {
  const sessionDir = getSessionDirForCwd(path.resolve(cwd));
  const resolvedExclude = excludeSessionFile
    ? path.resolve(excludeSessionFile)
    : undefined;
  const prompts: PromptEntry[] = [];

  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(sessionDir, { withFileTypes: true });
  } catch {
    return prompts;
  }

  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map(async (entry) => {
        const filePath = path.join(sessionDir, entry.name);
        try {
          const stats = await fs.stat(filePath);
          return { filePath, mtimeMs: stats.mtimeMs };
        } catch {
          return undefined;
        }
      }),
  );

  const sortedFiles = files
    .filter((file): file is { filePath: string; mtimeMs: number } =>
      Boolean(file),
    )
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const file of sortedFiles) {
    if (resolvedExclude && path.resolve(file.filePath) === resolvedExclude)
      continue;

    const tail = await readTail(file.filePath);
    if (!tail) continue;
    const lines = tail.split("\n").filter(Boolean);
    for (const line of lines) {
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry?.type !== "message") continue;
      const message = entry?.message;
      if (
        !message ||
        message.role !== "user" ||
        !Array.isArray(message.content)
      )
        continue;
      const text = extractText(message.content);
      if (!text) continue;
      const timestamp = Number(
        message.timestamp ?? entry.timestamp ?? Date.now(),
      );
      prompts.push({ text, timestamp });
      if (prompts.length >= MAX_RECENT_PROMPTS) break;
    }
    if (prompts.length >= MAX_RECENT_PROMPTS) break;
  }

  return prompts;
}

function buildHistoryList(
  currentSession: PromptEntry[],
  previousSessions: PromptEntry[],
): PromptEntry[] {
  const all = [...currentSession, ...previousSessions];
  all.sort((a, b) => a.timestamp - b.timestamp);

  const seen = new Set<string>();
  const deduped: PromptEntry[] = [];
  for (const prompt of all) {
    const key = `${prompt.timestamp}:${prompt.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(prompt);
  }

  return deduped.slice(-MAX_HISTORY_ENTRIES);
}

function historiesMatch(a: PromptEntry[], b: PromptEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.text !== b[i]?.text || a[i]?.timestamp !== b[i]?.timestamp)
      return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Editor wiring
// ---------------------------------------------------------------------------

let loadCounter = 0;

function setEditor(ctx: ExtensionContext, history: PromptEntry[]): void {
  ctx.ui.setEditorComponent((tui, theme, keybindings) => {
    const editor = new CustomEditor(tui, theme, keybindings);
    for (const prompt of history) {
      editor.addToHistory?.(prompt.text);
    }
    return editor;
  });
}

function applyEditor(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  const sessionFile = ctx.sessionManager.getSessionFile();
  const currentEntries = ctx.sessionManager.getBranch();
  const currentPrompts = collectUserPromptsFromEntries(currentEntries);
  const immediateHistory = buildHistoryList(currentPrompts, []);

  const currentLoad = ++loadCounter;
  const initialText = ctx.ui.getEditorText();
  setEditor(ctx, immediateHistory);

  void (async () => {
    const previousPrompts = await loadPromptHistoryForCwd(
      ctx.cwd,
      sessionFile ?? undefined,
    );
    // Bail if a newer session_start fired or the user started typing —
    // replacing the editor under them would be annoying.
    if (currentLoad !== loadCounter) return;
    if (ctx.ui.getEditorText() !== initialText) return;
    const history = buildHistoryList(currentPrompts, previousPrompts);
    if (historiesMatch(history, immediateHistory)) return;
    setEditor(ctx, history);
  })();
}

// ---------------------------------------------------------------------------
// Extension entrypoint
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    applyEditor(ctx);
  });
}
