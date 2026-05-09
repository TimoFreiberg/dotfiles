/**
 * Prompt Editor Extension
 *
 * Replaces pi's default editor with a `PromptEditor` subclass that adds
 * two behaviors:
 *
 * 1. **Visual-line cursor movement and kill.** ctrl+a / ctrl+e / ctrl+u /
 *    ctrl+k operate on visual (wrapped) lines instead of logical
 *    (\n-delimited) lines. Progressive stepping: a second press at a
 *    boundary crosses into the previous/next visual line. Between
 *    wrapped segments of one logical line, ctrl+u / ctrl+k just
 *    reposition the cursor (there's no \n to remove at a wrap point).
 *
 *    Ported from Timo's fork of pi-mono (change tkttkqqx): "feat(tui):
 *    cursorLineStart/cursorLineEnd operate on visual lines".
 *
 * 2. **Up-arrow history seeded from prior sessions in the current cwd.**
 *    Not just the live session — pi's default history is in-session only.
 *    Extracted from mitsuhiko's prompt-editor.ts (agent-stuff), with the
 *    modes feature dropped.
 *
 *    How it works: on session_start, reads current-session user prompts
 *    from the in-memory branch and installs the editor seeded with those
 *    immediately. Then async-loads more prompts from the last-modified
 *    JSONL files under `~/.pi/agent/sessions/--<cwd-encoded>--/`,
 *    dedupes against the current session, caps at 100 entries, and
 *    re-installs — unless the user already started typing or another
 *    session_start fired.
 *
 * ## Caveats
 *
 * - Pi-tui's `Editor` treats several fields and methods as `private`
 *   (state, lastWidth, preferredVisualCol, lastAction, historyIndex,
 *   killRing, buildVisualLineMap, findCurrentVisualLine, setCursorCol,
 *   pushUndoSnapshot). The visual-line overrides reach into them via a
 *   structural `EditorInternals` cast. If pi-tui renames any of these,
 *   behaviour breaks silently (wrong movement, not a crash).
 *
 * - Home/End share keybindings with ctrl+a/ctrl+e
 *   (tui.editor.cursorLineStart/End), so Home/End also become visual.
 *   Matches VS Code / most modern editors.
 *
 * - Pi exposes no "add to history" hook; the only way to seed history
 *   is via ctx.ui.setEditorComponent. If another extension also sets a
 *   custom editor component, last-one-wins. None of the currently
 *   installed extensions (answer, btw, context, etc.) do.
 *
 * - The cwd → session-dir encoding (`--<path-with-/-replaced-by-->--`)
 *   has to match pi's own encoding. If pi changes that, history seeding
 *   goes silent (but nothing else breaks).
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
// PromptEditor — CustomEditor subclass with visual-line overrides.
// ---------------------------------------------------------------------------

type VisualLine = {
  logicalLine: number;
  startCol: number;
  length: number;
};

type KillRing = {
  push(text: string, opts: { prepend: boolean; accumulate: boolean }): void;
};

type EditorInternals = {
  state: { lines: string[]; cursorLine: number; cursorCol: number };
  lastWidth: number;
  preferredVisualCol: number | null;
  lastAction: string | null;
  historyIndex: number;
  killRing: KillRing;
  buildVisualLineMap(width: number): VisualLine[];
  findCurrentVisualLine(visualLines: VisualLine[]): number;
  setCursorCol(col: number): void;
  pushUndoSnapshot(): void;
};

type Matcher = { matches(data: string, id: string): boolean };

// Constructor typing: accept whatever CustomEditor accepts without pinning
// TUI / theme / KeybindingsManager (not all public exports).
// biome-ignore lint/suspicious/noExplicitAny: See above.
type AnyArg = any;

class PromptEditor extends CustomEditor {
  private kb: Matcher;

  constructor(tui: AnyArg, theme: AnyArg, keybindings: Matcher & AnyArg) {
    super(tui, theme, keybindings);
    this.kb = keybindings;
  }

  handleInput(data: string): void {
    if (this.kb.matches(data, "tui.editor.cursorLineStart")) {
      this.moveToVisualLineStart();
      this.invalidate();
      return;
    }
    if (this.kb.matches(data, "tui.editor.cursorLineEnd")) {
      this.moveToVisualLineEnd();
      this.invalidate();
      return;
    }
    if (this.kb.matches(data, "tui.editor.deleteToLineStart")) {
      this.deleteToVisualLineStart();
      this.invalidate();
      return;
    }
    if (this.kb.matches(data, "tui.editor.deleteToLineEnd")) {
      this.deleteToVisualLineEnd();
      this.invalidate();
      return;
    }
    super.handleInput(data);
  }

  // -------------------------------------------------------------------------
  // Visual-line cursor movement
  // -------------------------------------------------------------------------

  private moveToVisualLineStart(): void {
    const i = this as unknown as EditorInternals;
    i.lastAction = null;
    const visualLines = i.buildVisualLineMap(i.lastWidth);
    const currentVLIndex = i.findCurrentVisualLine(visualLines);
    const currentVL = visualLines[currentVLIndex];
    if (!currentVL) {
      i.setCursorCol(0);
      return;
    }

    const visualLineStart = currentVL.startCol;
    if (i.state.cursorCol > visualLineStart) {
      // Move to start of current visual line
      i.setCursorCol(visualLineStart);
    } else if (currentVLIndex > 0) {
      // Already at start — step to previous visual line start
      const prevVL = visualLines[currentVLIndex - 1]!;
      i.state.cursorLine = prevVL.logicalLine;
      i.setCursorCol(prevVL.startCol);
    }
    // else: already at very first visual line, stay put
  }

  private moveToVisualLineEnd(): void {
    const i = this as unknown as EditorInternals;
    i.lastAction = null;
    const visualLines = i.buildVisualLineMap(i.lastWidth);
    const currentVLIndex = i.findCurrentVisualLine(visualLines);
    const currentVL = visualLines[currentVLIndex];
    if (!currentVL) {
      const currentLine = i.state.lines[i.state.cursorLine] || "";
      i.setCursorCol(currentLine.length);
      return;
    }

    const visualLineEnd = positioningEnd(visualLines, currentVLIndex);
    if (i.state.cursorCol < visualLineEnd) {
      // Move to end of current visual line
      i.setCursorCol(visualLineEnd);
    } else if (currentVLIndex < visualLines.length - 1) {
      // Already at end — step to next visual line end
      const nextVL = visualLines[currentVLIndex + 1]!;
      const nextEnd = positioningEnd(visualLines, currentVLIndex + 1);
      i.state.cursorLine = nextVL.logicalLine;
      i.setCursorCol(nextEnd);
    }
    // else: already at very last visual line, stay put
  }

  // -------------------------------------------------------------------------
  // Visual-line kill operations
  // -------------------------------------------------------------------------

  private deleteToVisualLineStart(): void {
    const i = this as unknown as EditorInternals;
    i.historyIndex = -1; // Exit history browsing mode

    const visualLines = i.buildVisualLineMap(i.lastWidth);
    const currentVLIndex = i.findCurrentVisualLine(visualLines);
    const currentVL = visualLines[currentVLIndex];
    const currentLine = i.state.lines[i.state.cursorLine] || "";

    if (currentVL && i.state.cursorCol > currentVL.startCol) {
      // Delete from visual line start to cursor
      i.pushUndoSnapshot();
      const deletedText = currentLine.slice(
        currentVL.startCol,
        i.state.cursorCol,
      );
      i.killRing.push(deletedText, {
        prepend: true,
        accumulate: i.lastAction === "kill",
      });
      i.lastAction = "kill";
      i.state.lines[i.state.cursorLine] =
        currentLine.slice(0, currentVL.startCol) +
        currentLine.slice(i.state.cursorCol);
      i.setCursorCol(currentVL.startCol);
    } else if (currentVL && currentVLIndex > 0) {
      const prevVL = visualLines[currentVLIndex - 1]!;

      if (prevVL.logicalLine === i.state.cursorLine) {
        // At visual line start within a wrapped logical line — reposition
        // cursor to end of previous visual line (no deletion: there's no
        // \n between wrapped segments of the same logical line)
        const prevEnd = positioningEnd(visualLines, currentVLIndex - 1);
        i.setCursorCol(prevEnd);
      } else {
        // At start of logical line — delete just the \n, merge with previous
        i.pushUndoSnapshot();
        i.killRing.push("\n", {
          prepend: true,
          accumulate: i.lastAction === "kill",
        });
        i.lastAction = "kill";

        const previousLine = i.state.lines[i.state.cursorLine - 1] || "";
        i.state.lines[i.state.cursorLine - 1] = previousLine + currentLine;
        i.state.lines.splice(i.state.cursorLine, 1);
        i.state.cursorLine--;
        i.setCursorCol(previousLine.length);
      }
    }
    // else: at very first visual line start, nothing to delete

    if (this.onChange) {
      this.onChange(this.getText());
    }
  }

  private deleteToVisualLineEnd(): void {
    const i = this as unknown as EditorInternals;
    i.historyIndex = -1; // Exit history browsing mode

    const visualLines = i.buildVisualLineMap(i.lastWidth);
    const currentVLIndex = i.findCurrentVisualLine(visualLines);
    const currentVL = visualLines[currentVLIndex];
    const currentLine = i.state.lines[i.state.cursorLine] || "";

    // For deletion we always use startCol+length (unlike cursor positioning,
    // which clips to length-1 for non-last segments to avoid visually landing
    // the cursor on the next wrapped row).
    const visualLineEnd = currentVL
      ? currentVL.startCol + currentVL.length
      : currentLine.length;

    if (i.state.cursorCol < visualLineEnd) {
      // Delete from cursor to end of current visual line
      i.pushUndoSnapshot();
      const deletedText = currentLine.slice(i.state.cursorCol, visualLineEnd);
      i.killRing.push(deletedText, {
        prepend: false,
        accumulate: i.lastAction === "kill",
      });
      i.lastAction = "kill";
      i.state.lines[i.state.cursorLine] =
        currentLine.slice(0, i.state.cursorCol) +
        currentLine.slice(visualLineEnd);
    } else if (currentVLIndex < visualLines.length - 1) {
      const nextVL = visualLines[currentVLIndex + 1]!;

      if (nextVL.logicalLine === i.state.cursorLine) {
        // At visual line end within a wrapped logical line — reposition
        // cursor to start of next visual line (no deletion)
        i.setCursorCol(nextVL.startCol);
      } else {
        // At end of logical line — delete just the \n, merge with next line
        i.pushUndoSnapshot();
        i.killRing.push("\n", {
          prepend: false,
          accumulate: i.lastAction === "kill",
        });
        i.lastAction = "kill";

        const nextLine = i.state.lines[i.state.cursorLine + 1] || "";
        i.state.lines[i.state.cursorLine] = currentLine + nextLine;
        i.state.lines.splice(i.state.cursorLine + 1, 1);
      }
    }
    // else: at very last visual line end, nothing to delete

    if (this.onChange) {
      this.onChange(this.getText());
    }
  }
}

/**
 * End column for CURSOR POSITIONING at a visual line. For non-last segments
 * of a wrapped logical line, position at startCol+length would appear on the
 * next visual line, so we clip to length-1.
 */
function positioningEnd(visualLines: VisualLine[], index: number): number {
  const vl = visualLines[index]!;
  const isLastSegment =
    index === visualLines.length - 1 ||
    visualLines[index + 1]?.logicalLine !== vl.logicalLine;
  return isLastSegment
    ? vl.startCol + vl.length
    : vl.startCol + Math.max(0, vl.length - 1);
}

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
    const editor = new PromptEditor(tui, theme, keybindings);
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
