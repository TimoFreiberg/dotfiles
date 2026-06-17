/**
 * Q&A extension - two paths into one interactive Q&A widget.
 *
 * 1. LLM-callable `answer` TOOL: the agent passes `questions[]` DIRECTLY,
 *    each optionally carrying `options` (a selectable choice list) and a
 *    `multiSelect` flag. No extraction model on this path.
 * 2. `/answer` command (or Ctrl+.): grabs the last assistant message, EXTRACTS
 *    free-text questions from it via the `structured-extraction` role (deepseek),
 *    then opens the same widget. The command path produces free-text questions
 *    only (no options).
 *
 * The widget (QnAComponent) renders, per question, either:
 *   - a free-text editor (no `options`), or
 *   - a selectable choice list — checkboxes when `multiSelect`, single-select
 *     otherwise — plus a "Type something" free-text escape.
 *
 * The full Q&A (question + options + chosen/typed answers) is persisted to the
 * transcript: the tool returns it as text `content`, the command path sends it
 * via `pi.sendUserMessage(...)`. Questions used to die inside the transient
 * widget; recording them in the transcript is the core fix.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  complete,
  type Model,
  type Api,
  type UserMessage,
} from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type ModelRegistry,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Editor,
  type EditorTheme,
  type Focusable,
  Key,
  matchesKey,
  truncateToWidth,
  type TUI,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

// --- Types ---

/** A selectable option offered by the LLM for a choice question. */
interface QuestionOption {
  label: string;
  description?: string;
}

/**
 * A question shown in the widget. `options` is the discriminator between the
 * two render modes:
 *   - absent → free-text editor (the command/extraction path always uses this)
 *   - present → selectable choice list (single-select, or checkboxes when
 *     `multiSelect`). The tool path supplies these directly.
 */
export interface ExtractedQuestion {
  question: string;
  context?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

interface ExtractionResult {
  questions: ExtractedQuestion[];
}

/**
 * The per-question answer captured by the widget. Kept structured (rather than
 * a pre-formatted string) so the transcript formatter can record the question,
 * its options, and exactly which were picked vs. freely typed.
 */
export interface QnAAnswer {
  /** Indices into `question.options` the user selected (choice questions). */
  selectedOptionIndices: number[];
  /**
   * Free text the user typed: the whole answer for free-text questions, or the
   * "Type something" escape value for choice questions. Empty when unused.
   */
  customText: string;
}

export function emptyAnswer(): QnAAnswer {
  return { selectedOptionIndices: [], customText: "" };
}

// --- Transcript formatting (pure, unit-tested) ---

/**
 * Format a Q&A session into the transcript text shared by both entry paths.
 * Pure and deterministic so it can be unit-tested without a TUI.
 *
 * Output shape per question:
 *   Q: <question>
 *   > <context>                (only if present)
 *   Options:                   (only for choice questions)
 *     [x] <picked label>
 *     [ ] <unpicked label>
 *   A: <answer>
 *
 * The `A:` line records the human-readable answer: the picked option label(s)
 * for choice questions, the typed text for free-text / "Type something", or
 * "(no answer)" when nothing was provided.
 */
export function formatQnA(
  questions: ExtractedQuestion[],
  answers: QnAAnswer[],
): string {
  const parts: string[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const a = answers[i] ?? emptyAnswer();

    parts.push(`Q: ${q.question}`);
    if (q.context) {
      parts.push(`> ${q.context}`);
    }

    const hasOptions = Array.isArray(q.options) && q.options.length > 0;
    if (hasOptions) {
      const picked = new Set(a.selectedOptionIndices);
      parts.push("Options:");
      for (let j = 0; j < q.options!.length; j++) {
        const mark = picked.has(j) ? "[x]" : "[ ]";
        parts.push(`  ${mark} ${q.options![j].label}`);
      }
    }

    // Build the human-readable answer line.
    const chosenLabels = hasOptions
      ? a.selectedOptionIndices
          .filter((idx) => idx >= 0 && idx < q.options!.length)
          .map((idx) => q.options![idx].label)
      : [];
    const custom = a.customText.trim();
    const answerSegments: string[] = [...chosenLabels];
    if (custom) {
      // Mark free text distinctly when it accompanies a choice question.
      answerSegments.push(hasOptions ? `(typed) ${custom}` : custom);
    }
    const answerText =
      answerSegments.length > 0 ? answerSegments.join(", ") : "(no answer)";
    parts.push(`A: ${answerText}`);
    parts.push("");
  }

  return parts.join("\n").trim();
}

// --- Prompts ---

const SYSTEM_PROMPT = `You are a question extractor. Given text from a conversation, extract any questions that need answering.

Output a JSON object with this structure:
{
  "questions": [
    {
      "question": "The question text",
      "context": "Optional context that helps answer the question"
    }
  ]
}

Rules:
- Extract all questions that require user input
- Keep questions in the order they appeared
- Be concise with question text
- Include context only when it provides essential information for answering
- If no questions are found, return {"questions": []}

Example output:
{
  "questions": [
    {
      "question": "What is your preferred database?",
      "context": "We can only configure MySQL and PostgreSQL because of what is implemented."
    },
    {
      "question": "Should we use TypeScript or JavaScript?"
    }
  ]
}`;

// --- Role -> model resolver (shared, per-machine) ---

/**
 * Shared per-machine role -> model resolver (agents/_lib/roles.mjs).
 *
 * It lives OUTSIDE the extension dir, so a static relative import breaks: pi
 * discovers this extension through the symlink ~/.pi/agent/extensions ->
 * dotfiles/agents/extensions and resolves relative imports against that symlink
 * path, where ../../_lib does not exist. We instead realpath import.meta.url
 * (which crosses the symlink, verified for the subagent extension) and
 * dynamic-import the resolver by its absolute on-disk path. Cached so we import
 * it once.
 *
 * This mirrors the pattern in extensions/subagent/index.ts. We import the
 * extension-facing `resolveRoleModel` face, which takes the caller's
 * modelRegistry and returns a concrete pi Model (or null when the role has no
 * spec; THROWS when the registry can't find the configured model).
 */
type ResolveRoleModelFn = (
  role: string,
  modelRegistry: {
    find: (provider: string, id: string) => Model<Api> | undefined;
  },
  opts?: { override?: string; agentDir?: string; quiet?: boolean },
) => {
  model: Model<Api>;
  provider?: string;
  id: string;
  thinking?: string;
  spec: string;
} | null;

let resolveRoleModelPromise: Promise<ResolveRoleModelFn> | null = null;
function getResolveRoleModel(): Promise<ResolveRoleModelFn> {
  if (!resolveRoleModelPromise) {
    const realHere = path.dirname(
      fs.realpathSync(fileURLToPath(import.meta.url)),
    );
    const rolesPath = path.resolve(realHere, "../_lib/roles.mjs");
    resolveRoleModelPromise = import(pathToFileURL(rolesPath).href).then(
      (mod) => mod.resolveRoleModel as ResolveRoleModelFn,
    );
  }
  return resolveRoleModelPromise;
}

// --- Model selection ---

// Model patterns for extraction, in priority order. Sonnet 4.6 first
// (haiku makes too many mistakes on this task); we fall through to any
// available Sonnet, then the session model itself.
//
// Only models from the same provider as the session model are considered,
// so we reuse the same auth config that's already working.
//
// NOTE (Bedrock): prefer `global.` prefixed model IDs — those are the
// cross-region inference profiles that work for the current setup.
// Update this if the Bedrock config changes.
const EXTRACTION_MODEL_PATTERNS: (string | RegExp)[] = [
  /global\.anthropic\.claude-sonnet-4-6/, // Bedrock Sonnet 4.6 (global)
  /sonnet-4-6/, // Sonnet 4.6 (other providers)
  /global\.anthropic\.claude-sonnet/, // Bedrock Sonnet (any, fallback)
  /sonnet/, // Sonnet (other providers, fallback)
];

interface ModelCandidate {
  model: Model<Api>;
  apiKey?: string;
  headers?: Record<string, string>;
}

/**
 * Build candidate models for extraction. Strategy (first hit wins; all are
 * appended as ordered fallbacks so doExtract can retry the next on failure):
 * 1. The `structured-extraction` role from the shared per-machine resolver.
 *    This is the new primary path — it honors roles.json across machines.
 * 2. Cheaper models from the SAME provider as the session (reuses session auth)
 * 3. Always fall back to the session's own model (known to work)
 *
 * The role path degrades gracefully: if the resolver returns null (no spec) or
 * throws (e.g. roles.json names a model not available on this machine), we log
 * a one-line note and fall through to the existing pattern scan + ctx.model.
 * answer.ts must NEVER hard-fail just because a role didn't resolve.
 */
async function getCandidateModels(
  currentModel: Model<Api>,
  modelRegistry: ModelRegistry,
  notify: (message: string) => void,
): Promise<ModelCandidate[]> {
  const candidates: ModelCandidate[] = [];
  const seen = new Set<string>();
  const available = modelRegistry.getAvailable();

  const pushCandidate = async (model: Model<Api>): Promise<void> => {
    const key = `${model.provider}/${model.id}`;
    if (seen.has(key)) return;
    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (auth.ok === false) return;
    candidates.push({ model, apiKey: auth.apiKey, headers: auth.headers });
    seen.add(key);
  };

  // 1. Role-resolved model (shared per-machine resolver). Fail loud (a note),
  //    degrade gracefully: any failure falls through to the legacy paths below.
  try {
    const resolveRoleModel = await getResolveRoleModel();
    const resolved = resolveRoleModel("structured-extraction", modelRegistry);
    if (resolved) {
      await pushCandidate(resolved.model);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notify(`answer: role 'structured-extraction' unavailable (${message})`);
  }

  // 2. Look for preferred models from the same provider
  for (const pattern of EXTRACTION_MODEL_PATTERNS) {
    const match = available.find(
      (m) =>
        m.provider === currentModel.provider &&
        (pattern instanceof RegExp
          ? pattern.test(m.id.toLowerCase())
          : m.id.toLowerCase().includes(pattern)),
    );
    if (match) {
      await pushCandidate(match);
    }
  }

  // 3. Always include the session model as the final (most reliable) fallback
  await pushCandidate(currentModel);

  return candidates;
}

// --- JSON parsing ---

function parseExtractionResult(text: string): ExtractionResult {
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    const jsonError = e instanceof Error ? e.message : String(e);
    const preview =
      jsonStr.length > 200 ? jsonStr.slice(0, 200) + "..." : jsonStr;
    throw new Error(`Invalid JSON: ${jsonError}\nResponse preview: ${preview}`);
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as Record<string, unknown>).questions)
  ) {
    const preview =
      jsonStr.length > 200 ? jsonStr.slice(0, 200) + "..." : jsonStr;
    throw new Error(
      `Response JSON missing "questions" array.\nParsed value: ${preview}`,
    );
  }

  return parsed as ExtractionResult;
}

// --- Theme helpers ---

function buildEditorTheme(theme: Theme): EditorTheme {
  return {
    borderColor: (s: string) => theme.fg("border", s),
    selectList: {
      selectedPrefix: (s: string) => theme.fg("accent", s),
      selectedText: (s: string) => theme.fg("accent", s),
      description: (s: string) => theme.fg("muted", s),
      scrollInfo: (s: string) => theme.fg("dim", s),
      noMatch: (s: string) => theme.fg("warning", s),
    },
  };
}

// --- Q&A Component ---

/**
 * Interactive Q&A widget. Per question it switches between two modes based on
 * whether the question carries `options`:
 *
 *   - free-text mode: a single Editor; the typed text is the answer.
 *   - choice mode: a vertical option list. `multiSelect` questions use
 *     checkboxes (Space toggles, Enter confirms the question); single-select
 *     questions confirm immediately on Enter. Both offer a trailing
 *     "Type something" escape that drops into the editor for a free-text answer.
 *
 * Navigation across questions is Tab / Shift+Tab. In choice mode, Up/Down move
 * the option cursor; in free-text mode, Up/Down navigate questions only when
 * the editor is empty (so arrows still work for cursor movement otherwise).
 */
class QnAComponent implements Component, Focusable {
  private questions: ExtractedQuestion[];
  private answers: QnAAnswer[];
  private currentIndex: number = 0;
  /** Cursor within the current choice question's option list. */
  private optionCursor: number = 0;
  /** True while the "Type something" editor is active on a choice question. */
  private choiceEditMode: boolean = false;
  private editor: Editor;
  private theme: Theme;
  private onDone: (result: string | null) => void;
  private requestRender: () => void;
  private showingConfirmation: boolean = false;
  private showingCancelConfirmation: boolean = false;
  private modelId?: string;
  private keybindings?: KeybindingsManager;
  private onToggleExpand?: () => void;

  // Render cache
  private cachedWidth?: number;
  private cachedLines?: string[];

  // Focusable: propagate to Editor child for IME cursor positioning
  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.editor.focused = value;
  }

  constructor(
    questions: ExtractedQuestion[],
    tui: TUI,
    theme: Theme,
    onDone: (result: string | null) => void,
    requestRender: () => void,
    options?: {
      modelId?: string;
      keybindings?: KeybindingsManager;
      onToggleExpand?: () => void;
    },
  ) {
    this.questions = questions;
    this.answers = questions.map(() => emptyAnswer());
    this.theme = theme;
    this.onDone = onDone;
    this.requestRender = requestRender;
    this.modelId = options?.modelId;
    this.keybindings = options?.keybindings;
    this.onToggleExpand = options?.onToggleExpand;

    this.editor = new Editor(tui, buildEditorTheme(theme));
    this.editor.disableSubmit = true;
    this.editor.onChange = () => {
      this.invalidate();
      this.requestRender();
    };

    // Restore editor text for the first question if it is free-text.
    this.syncEditorToCurrent();
  }

  // --- Mode helpers ---

  private currentQuestion(): ExtractedQuestion {
    return this.questions[this.currentIndex];
  }

  /** Whether the current question is a choice question (has options). */
  private isChoice(index: number = this.currentIndex): boolean {
    const opts = this.questions[index]?.options;
    return Array.isArray(opts) && opts.length > 0;
  }

  /**
   * Option rows for the current choice question: the LLM-supplied options plus
   * a trailing "Type something" escape (index === options.length).
   */
  private choiceRowCount(): number {
    const q = this.currentQuestion();
    return (q.options?.length ?? 0) + 1; // +1 for the "Type something" row
  }

  private isOtherRow(rowIndex: number): boolean {
    return rowIndex === (this.currentQuestion().options?.length ?? 0);
  }

  /** Whether any answer (selection or typed text) has been recorded yet. */
  private isAnswered(index: number): boolean {
    const a = this.answers[index];
    if (!a) return false;
    return a.selectedOptionIndices.length > 0 || a.customText.trim().length > 0;
  }

  private hasAnyAnswers(): boolean {
    this.saveCurrentAnswer();
    return this.answers.some((_, i) => this.isAnswered(i));
  }

  /** Persist transient editor text into the current answer (free-text path). */
  private saveCurrentAnswer(): void {
    if (this.isChoice()) {
      // Choice selections are saved eagerly on toggle/select; only the
      // "Type something" escape uses the editor, and that is captured when the
      // user leaves edit mode. Nothing to flush here unless mid-edit.
      if (this.choiceEditMode) {
        this.answers[this.currentIndex].customText = this.editor.getText();
      }
      return;
    }
    this.answers[this.currentIndex].customText = this.editor.getText();
  }

  /** Load the current question's stored free-text into the editor, if any. */
  private syncEditorToCurrent(): void {
    if (this.isChoice() && !this.choiceEditMode) {
      this.editor.setText("");
      return;
    }
    this.editor.setText(this.answers[this.currentIndex]?.customText || "");
  }

  private navigateTo(index: number): void {
    if (index < 0 || index >= this.questions.length) return;
    this.saveCurrentAnswer();
    this.currentIndex = index;
    this.optionCursor = 0;
    this.choiceEditMode = false;
    this.syncEditorToCurrent();
    this.invalidate();
  }

  // --- Choice-mode actions ---

  /** Toggle (multiSelect) or set (single-select) the option under the cursor. */
  private chooseCurrentOption(): void {
    const q = this.currentQuestion();
    const a = this.answers[this.currentIndex];

    if (this.isOtherRow(this.optionCursor)) {
      // Enter the free-text escape editor.
      this.choiceEditMode = true;
      this.editor.setText(a.customText || "");
      this.invalidate();
      this.requestRender();
      return;
    }

    const idx = this.optionCursor;
    if (q.multiSelect) {
      const pos = a.selectedOptionIndices.indexOf(idx);
      if (pos >= 0) {
        a.selectedOptionIndices.splice(pos, 1);
      } else {
        a.selectedOptionIndices.push(idx);
        a.selectedOptionIndices.sort((x, y) => x - y);
      }
      // Selecting an option clears any prior free-text escape for clarity.
      this.invalidate();
      this.requestRender();
      return;
    }

    // Single-select: replace selection, drop any free text, advance/confirm.
    a.selectedOptionIndices = [idx];
    a.customText = "";
    this.advanceOrConfirm();
  }

  /** Advance to the next question, or show the submit confirmation on last. */
  private advanceOrConfirm(): void {
    if (this.currentIndex < this.questions.length - 1) {
      this.navigateTo(this.currentIndex + 1);
    } else {
      this.showingConfirmation = true;
      this.invalidate();
    }
    this.requestRender();
  }

  private submit(): void {
    this.saveCurrentAnswer();
    this.onDone(formatQnA(this.questions, this.answers));
  }

  private cancel(): void {
    this.onDone(null);
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  handleInput(data: string): void {
    // Expand/collapse tool output (Ctrl+O by default)
    if (
      this.keybindings?.matches(data, "app.tools.expand") &&
      this.onToggleExpand
    ) {
      this.onToggleExpand();
      return;
    }

    // Submit confirmation dialog
    if (this.showingConfirmation) {
      if (matchesKey(data, Key.enter) || data.toLowerCase() === "y") {
        this.submit();
        return;
      }
      if (
        matchesKey(data, Key.escape) ||
        matchesKey(data, Key.ctrl("c")) ||
        data.toLowerCase() === "n"
      ) {
        this.showingConfirmation = false;
        this.invalidate();
        this.requestRender();
        return;
      }
      return;
    }

    // Cancel confirmation dialog
    if (this.showingCancelConfirmation) {
      if (matchesKey(data, Key.enter) || data.toLowerCase() === "y") {
        this.cancel();
        return;
      }
      if (
        matchesKey(data, Key.escape) ||
        matchesKey(data, Key.ctrl("c")) ||
        data.toLowerCase() === "n"
      ) {
        this.showingCancelConfirmation = false;
        this.invalidate();
        this.requestRender();
        return;
      }
      return;
    }

    // --- Choice question, free-text escape ("Type something") active ---
    if (this.isChoice() && this.choiceEditMode) {
      // Esc leaves the escape editor and returns to the option list.
      if (matchesKey(data, Key.escape)) {
        this.answers[this.currentIndex].customText = this.editor.getText();
        this.choiceEditMode = false;
        this.invalidate();
        this.requestRender();
        return;
      }
      // Plain Enter commits the typed text and advances/confirms.
      if (
        matchesKey(data, Key.enter) &&
        !matchesKey(data, Key.shift("enter"))
      ) {
        const text = this.editor.getText().trim();
        const a = this.answers[this.currentIndex];
        a.customText = text;
        // A free-text escape answer overrides any checkbox selections.
        a.selectedOptionIndices = [];
        this.choiceEditMode = false;
        this.advanceOrConfirm();
        return;
      }
      this.editor.handleInput(data);
      this.invalidate();
      this.requestRender();
      return;
    }

    // Cancel — confirm first if any answers have been provided
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      if (this.hasAnyAnswers()) {
        this.showingCancelConfirmation = true;
        this.invalidate();
        this.requestRender();
      } else {
        this.cancel();
      }
      return;
    }

    // Tab / Shift+Tab for question navigation (both modes)
    if (matchesKey(data, Key.tab)) {
      if (this.currentIndex < this.questions.length - 1) {
        this.navigateTo(this.currentIndex + 1);
        this.requestRender();
      }
      return;
    }
    if (matchesKey(data, Key.shift("tab"))) {
      if (this.currentIndex > 0) {
        this.navigateTo(this.currentIndex - 1);
        this.requestRender();
      }
      return;
    }

    // --- Choice question (option list) ---
    if (this.isChoice()) {
      if (matchesKey(data, Key.up)) {
        this.optionCursor = Math.max(0, this.optionCursor - 1);
        this.invalidate();
        this.requestRender();
        return;
      }
      if (matchesKey(data, Key.down)) {
        this.optionCursor = Math.min(
          this.choiceRowCount() - 1,
          this.optionCursor + 1,
        );
        this.invalidate();
        this.requestRender();
        return;
      }
      // Space toggles in multiSelect (no-op on the "Type something" row).
      if (
        matchesKey(data, Key.space) &&
        this.currentQuestion().multiSelect &&
        !this.isOtherRow(this.optionCursor)
      ) {
        this.chooseCurrentOption();
        return;
      }
      // Enter: in multiSelect, advance/confirm (unless on the escape row, which
      // opens the editor); in single-select, choose immediately.
      if (matchesKey(data, Key.enter)) {
        const q = this.currentQuestion();
        if (q.multiSelect && !this.isOtherRow(this.optionCursor)) {
          this.advanceOrConfirm();
          return;
        }
        this.chooseCurrentOption();
        return;
      }
      return;
    }

    // --- Free-text question (editor) ---

    // Arrow up/down for question navigation when editor is empty
    if (matchesKey(data, Key.up) && this.editor.getText() === "") {
      if (this.currentIndex > 0) {
        this.navigateTo(this.currentIndex - 1);
        this.requestRender();
        return;
      }
    }
    if (matchesKey(data, Key.down) && this.editor.getText() === "") {
      if (this.currentIndex < this.questions.length - 1) {
        this.navigateTo(this.currentIndex + 1);
        this.requestRender();
        return;
      }
    }

    // Plain Enter: advance to next question or confirm on last
    // Shift+Enter: newline (handled by editor below)
    if (matchesKey(data, Key.enter) && !matchesKey(data, Key.shift("enter"))) {
      this.saveCurrentAnswer();
      if (this.currentIndex < this.questions.length - 1) {
        this.navigateTo(this.currentIndex + 1);
      } else {
        this.showingConfirmation = true;
      }
      this.invalidate();
      this.requestRender();
      return;
    }

    // Everything else goes to the editor
    this.editor.handleInput(data);
    this.invalidate();
    this.requestRender();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const t = this.theme;
    const lines: string[] = [];
    const boxWidth = Math.min(width - 4, 120);
    const contentWidth = boxWidth - 4; // 2 padding each side

    const hLine = (n: number) => "─".repeat(n);

    // Render a line inside the box with left padding and right fill
    const boxLine = (content: string, leftPad: number = 2): string => {
      const padded = " ".repeat(leftPad) + content;
      const cLen = visibleWidth(padded);
      const rightPad = Math.max(0, boxWidth - cLen - 2);
      return (
        t.fg("border", "│") +
        padded +
        " ".repeat(rightPad) +
        t.fg("border", "│")
      );
    };

    const emptyBoxLine = (): string => {
      return (
        t.fg("border", "│") + " ".repeat(boxWidth - 2) + t.fg("border", "│")
      );
    };

    // Ensure every output line is exactly `width` visible characters
    const padLine = (line: string): string => {
      return truncateToWidth(
        line + " ".repeat(Math.max(0, width - visibleWidth(line))),
        width,
        "",
      );
    };

    // Top border
    lines.push(padLine(t.fg("border", "╭" + hLine(boxWidth - 2) + "╮")));

    // Title
    const title = `${t.bold(t.fg("accent", "Questions"))} ${t.fg("dim", `(${this.currentIndex + 1}/${this.questions.length})`)}`;
    lines.push(padLine(boxLine(title)));

    // Separator
    lines.push(padLine(t.fg("border", "├" + hLine(boxWidth - 2) + "┤")));

    // Progress dots
    const dots: string[] = [];
    for (let i = 0; i < this.questions.length; i++) {
      const answered = this.isAnswered(i);
      const current = i === this.currentIndex;
      if (current) {
        dots.push(t.fg("accent", "●"));
      } else if (answered) {
        dots.push(t.fg("success", "●"));
      } else {
        dots.push(t.fg("dim", "○"));
      }
    }
    lines.push(padLine(boxLine(dots.join(" "))));
    lines.push(padLine(emptyBoxLine()));

    // Current question
    const q = this.questions[this.currentIndex];
    const questionText = `${t.bold("Q:")} ${q.question}`;
    for (const wl of wrapTextWithAnsi(questionText, contentWidth)) {
      lines.push(padLine(boxLine(wl)));
    }

    // Context
    if (q.context) {
      lines.push(padLine(emptyBoxLine()));
      const contextText = t.fg("muted", `> ${q.context}`);
      for (const wl of wrapTextWithAnsi(contextText, contentWidth - 2)) {
        lines.push(padLine(boxLine(wl)));
      }
    }

    lines.push(padLine(emptyBoxLine()));

    // Answer area — choice list or free-text editor depending on the question.
    const answerPrefix = t.bold("A: ");
    const answerPrefixWidth = visibleWidth(answerPrefix);

    if (this.isChoice() && !this.choiceEditMode) {
      // Option list (single-select or checkbox). The trailing row is the
      // "Type something" free-text escape.
      const a = this.answers[this.currentIndex];
      const selected = new Set(a.selectedOptionIndices);
      const opts = q.options ?? [];
      const multi = q.multiSelect === true;

      for (let i = 0; i < opts.length; i++) {
        const onCursor = i === this.optionCursor;
        const cursor = onCursor ? t.fg("accent", "> ") : "  ";
        const checked = selected.has(i);
        // Checkboxes for multiSelect, radio-style bullet for single-select.
        const marker = multi
          ? checked
            ? t.fg("success", "[x] ")
            : t.fg("dim", "[ ] ")
          : checked
            ? t.fg("success", "(•) ")
            : t.fg("dim", "( ) ");
        const labelColor = onCursor ? "accent" : "text";
        const label = t.fg(labelColor, `${i + 1}. ${opts[i].label}`);
        for (const wl of wrapTextWithAnsi(
          cursor + marker + label,
          contentWidth,
        )) {
          lines.push(padLine(boxLine(wl)));
        }
        if (opts[i].description) {
          const desc = t.fg("muted", opts[i].description!);
          for (const wl of wrapTextWithAnsi(desc, contentWidth - 5)) {
            lines.push(padLine(boxLine("     " + wl)));
          }
        }
      }

      // "Type something" escape row.
      const otherIdx = opts.length;
      const onOther = this.optionCursor === otherIdx;
      const otherCursor = onOther ? t.fg("accent", "> ") : "  ";
      const typed = a.customText.trim();
      const otherLabel = t.fg(
        onOther ? "accent" : "text",
        `${otherIdx + 1}. Type something`,
      );
      const otherSuffix = typed ? t.fg("muted", `  (${typed})`) : "";
      lines.push(
        padLine(
          boxLine(
            truncateToWidth(
              otherCursor + otherLabel + otherSuffix,
              contentWidth,
            ),
          ),
        ),
      );
    } else {
      // Free-text editor (free-text question, or the "Type something" escape).
      const editorWidth = contentWidth - 4 - answerPrefixWidth;
      const editorLines = this.editor.render(editorWidth);
      // Skip first and last lines (editor border lines)
      for (let i = 1; i < editorLines.length - 1; i++) {
        if (i === 1) {
          lines.push(padLine(boxLine(answerPrefix + editorLines[i])));
        } else {
          lines.push(
            padLine(boxLine(" ".repeat(answerPrefixWidth) + editorLines[i])),
          );
        }
      }
    }

    lines.push(padLine(emptyBoxLine()));

    // Footer separator
    lines.push(padLine(t.fg("border", "├" + hLine(boxWidth - 2) + "┤")));

    // Confirmation or controls
    if (this.showingConfirmation) {
      const msg = `${t.fg("warning", "Submit all answers?")} ${t.fg("dim", "(Enter/y to confirm, Esc/n to cancel)")}`;
      lines.push(padLine(boxLine(truncateToWidth(msg, contentWidth))));
    } else if (this.showingCancelConfirmation) {
      const msg = `${t.fg("warning", "Discard all answers?")} ${t.fg("dim", "(Enter/y to discard, Esc/n to go back)")}`;
      lines.push(padLine(boxLine(truncateToWidth(msg, contentWidth))));
    } else {
      // Controls vary by mode so the hints match the keys that actually work.
      let controls: string;
      if (this.isChoice() && this.choiceEditMode) {
        controls = `${t.fg("dim", "Enter")} confirm · ${t.fg("dim", "Esc")} back to options`;
      } else if (this.isChoice() && this.currentQuestion().multiSelect) {
        controls = `${t.fg("dim", "↑↓")} move · ${t.fg("dim", "Space")} toggle · ${t.fg("dim", "Enter")} next · ${t.fg("dim", "Tab")} jump · ${t.fg("dim", "Esc")} cancel`;
      } else if (this.isChoice()) {
        controls = `${t.fg("dim", "↑↓")} move · ${t.fg("dim", "Enter")} select · ${t.fg("dim", "Tab")} jump · ${t.fg("dim", "Esc")} cancel`;
      } else {
        controls = `${t.fg("dim", "Tab/Enter")} next · ${t.fg("dim", "Shift+Tab")} prev · ${t.fg("dim", "Shift+Enter")} newline · ${t.fg("dim", "Esc")} cancel`;
      }
      lines.push(padLine(boxLine(truncateToWidth(controls, contentWidth))));
    }

    // Model info (only when extraction was used)
    if (this.modelId) {
      const modelInfo = t.fg("dim", `model: ${this.modelId}`);
      lines.push(padLine(boxLine(truncateToWidth(modelInfo, contentWidth))));
    }

    // Bottom border
    lines.push(padLine(t.fg("border", "╰" + hLine(boxWidth - 2) + "╯")));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}

// --- Shared widget runner ---

/**
 * Open the interactive Q&A widget for `questions` and resolve to the formatted
 * transcript text (question + options + answers), or `null` if the user
 * cancelled. Shared by the tool path and the `/answer` command path so both
 * record the full Q&A identically.
 *
 * Emits `answer:open` / `answer:close` around the widget (other extensions use
 * these to pause/resume their own UI, e.g. the working message).
 */
async function runQnAWidget(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  questions: ExtractedQuestion[],
  options?: { modelId?: string },
): Promise<string | null> {
  pi.events.emit("answer:open", undefined);
  const result = await ctx.ui.custom<string | null>((tui, theme, kb, done) => {
    const component = new QnAComponent(
      questions,
      tui,
      theme,
      done,
      () => tui.requestRender(),
      {
        modelId: options?.modelId,
        keybindings: kb,
        onToggleExpand: () => {
          ctx.ui.setToolsExpanded(!ctx.ui.getToolsExpanded());
        },
      },
    );

    return {
      render: (w: number) => component.render(w),
      invalidate: () => component.invalidate(),
      handleInput: (data: string) => component.handleInput(data),
      // Focusable: propagate to component
      get focused() {
        return component.focused;
      },
      set focused(value: boolean) {
        component.focused = value;
      },
    };
  });
  pi.events.emit("answer:close", undefined);
  return result;
}

// --- Tool: LLM-callable `answer` ---

/**
 * Schema for the `answer` tool. The LLM supplies questions DIRECTLY (no
 * extraction model). Each question is free-text by default; supplying `options`
 * turns it into a choice list, and `multiSelect` turns that into checkboxes.
 */
const AnswerOptionSchema = Type.Object({
  label: Type.String({ description: "Display label for the option" }),
  description: Type.Optional(
    Type.String({
      description: "Optional one-line clarification of the option",
    }),
  ),
});

const AnswerQuestionSchema = Type.Object({
  question: Type.String({ description: "The question to ask the user" }),
  context: Type.Optional(
    Type.String({
      description: "Optional context that helps the user answer the question",
    }),
  ),
  options: Type.Optional(
    Type.Array(AnswerOptionSchema, {
      description:
        "Optional selectable choices. When present, the question is shown as a choice list instead of a free-text field. Omit for an open-ended question.",
    }),
  ),
  multiSelect: Type.Optional(
    Type.Boolean({
      description:
        "When true (and options are present), the user may select multiple options (checkboxes). Ignored without options.",
    }),
  ),
});

const AnswerParams = Type.Object({
  questions: Type.Array(AnswerQuestionSchema, {
    description: "One or more questions to ask the user in a single Q&A form.",
  }),
});

/**
 * Build the LLM-callable `answer` tool. A factory (rather than a module-level
 * const) because `execute` needs the `pi` handle to open the widget via the
 * shared `runQnAWidget` runner.
 */
function createAnswerTool(pi: ExtensionAPI) {
  return defineTool({
    name: "answer",
    label: "Answer",
    description:
      "Ask the user one or more questions interactively in a single Q&A form. " +
      "Each question is free-text by default; supply `options` to offer selectable " +
      "choices (set `multiSelect: true` for checkboxes). Use this instead of asking " +
      "inline when you have one or more questions whose answers you need to proceed.",
    promptSnippet:
      "Ask the user one or more questions (free-text or multiple-choice) in one form",
    promptGuidelines: [
      "Use the answer tool when you need the user to answer one or more questions before continuing; prefer it over inline questions when you have a batch or want multiple-choice answers.",
      "For the answer tool, supply `options` only when you can enumerate the meaningful choices; otherwise leave it free-text. Set `multiSelect: true` only when more than one option can legitimately be picked.",
    ],
    parameters: AnswerParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (ctx.mode !== "tui") {
        throw new Error("answer tool requires interactive mode");
      }
      if (params.questions.length === 0) {
        throw new Error("answer tool requires at least one question");
      }

      const questions: ExtractedQuestion[] = params.questions.map((q) => ({
        question: q.question,
        context: q.context,
        // Drop empty option arrays so they render free-text, not an empty list.
        options:
          Array.isArray(q.options) && q.options.length > 0
            ? q.options
            : undefined,
        multiSelect: q.multiSelect,
      }));

      const result = await runQnAWidget(pi, ctx, questions);

      if (result === null) {
        return {
          content: [
            {
              type: "text",
              text: "User cancelled — did not answer the questions.",
            },
          ],
          details: { cancelled: true },
        };
      }

      // Persist the full Q&A (questions + options + answers) for the LLM.
      return {
        content: [{ type: "text", text: result }],
        details: { cancelled: false },
      };
    },
  });
}

// --- Extension entry point ---

export default function (pi: ExtensionAPI) {
  pi.registerTool(createAnswerTool(pi));

  const answerHandler = async (ctx: ExtensionContext) => {
    if (!ctx.hasUI) {
      ctx.ui.notify("answer requires interactive mode", "error");
      return;
    }

    if (!ctx.model) {
      ctx.ui.notify("No model selected", "error");
      return;
    }

    // Find the last assistant message on the current branch
    const branch = ctx.sessionManager.getBranch();
    let lastAssistantText: string | undefined;

    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry.type === "message") {
        const msg = entry.message;
        if ("role" in msg && msg.role === "assistant") {
          if (msg.stopReason !== "stop") {
            ctx.ui.notify(
              `Last assistant message incomplete (${msg.stopReason})`,
              "error",
            );
            return;
          }
          const textParts = msg.content
            .filter(
              (c): c is { type: "text"; text: string } => c.type === "text",
            )
            .map((c) => c.text);
          if (textParts.length > 0) {
            lastAssistantText = textParts.join("\n");
            break;
          }
        }
      }
    }

    if (!lastAssistantText) {
      ctx.ui.notify("No assistant messages found", "error");
      return;
    }

    // Build candidate model list for extraction. The role-resolver note goes to
    // stderr (like the subagent extension) so it surfaces without popping a
    // modal over the extraction spinner.
    const candidates = await getCandidateModels(
      ctx.model,
      ctx.modelRegistry,
      (message) => process.stderr.write(`${message}\n`),
    );

    if (candidates.length === 0) {
      ctx.ui.notify("No models available for extraction", "error");
      return;
    }

    // Extract questions with a loading spinner, trying candidates in order
    const extractionResult = await ctx.ui.custom<{
      result: ExtractionResult;
      modelId: string;
    } | null>((tui, theme, _kb, done) => {
      const loader = new BorderedLoader(tui, theme, `Extracting questions...`);
      loader.onAbort = () => done(null);

      const tryExtract = async (
        candidate: ModelCandidate,
      ): Promise<ExtractionResult> => {
        const userMessage: UserMessage = {
          role: "user",
          content: [{ type: "text", text: lastAssistantText! }],
          timestamp: Date.now(),
        };

        const response = await complete(
          candidate.model,
          { systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
          {
            apiKey: candidate.apiKey,
            headers: candidate.headers,
            signal: loader.signal,
          },
        );

        if (response.stopReason === "aborted") {
          throw new Error("aborted");
        }

        const responseText = response.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");

        if (!responseText) {
          const contentTypes =
            response.content.map((c) => c.type).join(", ") || "(empty)";
          throw new Error(
            `No text content (stop: ${response.stopReason}, types: ${contentTypes})`,
          );
        }

        return parseExtractionResult(responseText);
      };

      const doExtract = async (): Promise<{
        result: ExtractionResult;
        modelId: string;
      } | null> => {
        const errors: string[] = [];

        for (const candidate of candidates) {
          // Update spinner to show which model is being tried
          (loader as any).loader?.setMessage?.(
            `Extracting questions via ${candidate.model.id}...`,
          );
          tui.requestRender();
          try {
            const result = await tryExtract(candidate);
            return { result, modelId: candidate.model.id };
          } catch (err) {
            if (err instanceof Error && err.message === "aborted") return null;
            const message = err instanceof Error ? err.message : String(err);
            errors.push(
              `${candidate.model.provider}/${candidate.model.id}: ${message}`,
            );
          }
        }

        throw new Error(
          `All ${candidates.length} model(s) failed:\n${errors.join("\n")}`,
        );
      };

      doExtract()
        .then(done)
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          // Schedule notification after the custom UI closes
          setTimeout(
            () => ctx.ui.notify(`Extraction failed: ${message}`, "error"),
            0,
          );
          done(null);
        });

      return loader;
    });

    if (extractionResult === null) {
      return;
    }

    if (extractionResult.result.questions.length === 0) {
      ctx.ui.notify("No questions found in the last message", "info");
      return;
    }

    // Show the interactive Q&A form (extraction path: free-text questions only,
    // so no options are passed — the widget renders them as free-text editors).
    const answersResult = await runQnAWidget(
      pi,
      ctx,
      extractionResult.result.questions,
      { modelId: extractionResult.modelId },
    );

    if (answersResult === null) {
      ctx.ui.notify("Cancelled", "info");
      return;
    }

    const message =
      "I answered your questions in the following way:\n\n" + answersResult;
    if (ctx.isIdle()) {
      pi.sendUserMessage(message);
    } else {
      pi.sendUserMessage(message, { deliverAs: "followUp" });
    }
  };

  pi.registerCommand("answer", {
    description:
      "Extract questions from last assistant message into interactive Q&A",
    handler: (_args, ctx) => answerHandler(ctx),
  });

  pi.registerShortcut("ctrl+.", {
    description: "Extract and answer questions",
    handler: answerHandler,
  });
}
