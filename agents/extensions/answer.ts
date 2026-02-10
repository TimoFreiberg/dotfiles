/**
 * Q&A extraction extension - extracts questions from assistant responses
 *
 * Custom interactive TUI for answering questions.
 *
 * 1. /answer command (or Ctrl+Shift+A) gets the last assistant message
 * 2. Shows a spinner while extracting questions as structured JSON
 * 3. Presents an interactive TUI to navigate and answer questions
 * 4. Submits the compiled answers when done
 */

import { complete, type Model, type Api, type UserMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";
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
} from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";

// --- Types ---

interface ExtractedQuestion {
	question: string;
	context?: string;
}

interface ExtractionResult {
	questions: ExtractedQuestion[];
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

// --- Model selection ---

// Preferred model patterns, in priority order (cheapest/fastest first)
const EXTRACTION_MODEL_PREFERENCES: (string | RegExp)[] = [
	"eu.anthropic.claude-haiku-4-5-20251001-v1:0", // Bedrock EU Haiku
	"claude-haiku-4-5",                             // Anthropic API Haiku
	"codex-mini",  // OpenAI codex mini
	"flash",       // Gemini Flash
];

interface ModelCandidate {
	model: Model<Api>;
	apiKey: string;
}

async function getCandidateModels(
	currentModel: Model<Api>,
	modelRegistry: {
		getAvailable: () => Model<Api>[];
		getApiKey: (model: Model<Api>) => Promise<string | undefined>;
	},
): Promise<ModelCandidate[]> {
	const candidates: ModelCandidate[] = [];
	const seen = new Set<string>();
	const available = modelRegistry.getAvailable();

	for (const pattern of EXTRACTION_MODEL_PREFERENCES) {
		const match = available.find(m =>
			pattern instanceof RegExp
				? pattern.test(m.id.toLowerCase())
				: m.id.toLowerCase().includes(pattern),
		);
		if (match) {
			const key = `${match.provider}/${match.id}`;
			if (seen.has(key)) continue;
			const apiKey = await modelRegistry.getApiKey(match);
			if (apiKey) {
				candidates.push({ model: match, apiKey });
				seen.add(key);
			}
		}
	}

	// Always include current model as final fallback
	const currentKey = `${currentModel.provider}/${currentModel.id}`;
	if (!seen.has(currentKey)) {
		const apiKey = await modelRegistry.getApiKey(currentModel);
		if (apiKey) {
			candidates.push({ model: currentModel, apiKey });
		}
	}

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
		const preview = jsonStr.length > 200 ? jsonStr.slice(0, 200) + "..." : jsonStr;
		throw new Error(`Invalid JSON: ${jsonError}\nResponse preview: ${preview}`);
	}

	if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>).questions)) {
		const preview = jsonStr.length > 200 ? jsonStr.slice(0, 200) + "..." : jsonStr;
		throw new Error(`Response JSON missing "questions" array.\nParsed value: ${preview}`);
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

class QnAComponent implements Component, Focusable {
	private questions: ExtractedQuestion[];
	private answers: string[];
	private currentIndex: number = 0;
	private editor: Editor;
	private theme: Theme;
	private onDone: (result: string | null) => void;
	private requestRender: () => void;
	private showingConfirmation: boolean = false;
	private modelId?: string;

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
		modelId?: string,
	) {
		this.questions = questions;
		this.answers = questions.map(() => "");
		this.theme = theme;
		this.onDone = onDone;
		this.requestRender = requestRender;
		this.modelId = modelId;

		this.editor = new Editor(tui, buildEditorTheme(theme));
		this.editor.disableSubmit = true;
		this.editor.onChange = () => {
			this.invalidate();
			this.requestRender();
		};
	}

	private saveCurrentAnswer(): void {
		this.answers[this.currentIndex] = this.editor.getText();
	}

	private navigateTo(index: number): void {
		if (index < 0 || index >= this.questions.length) return;
		this.saveCurrentAnswer();
		this.currentIndex = index;
		this.editor.setText(this.answers[index] || "");
		this.invalidate();
	}

	private submit(): void {
		this.saveCurrentAnswer();

		const parts: string[] = [];
		for (let i = 0; i < this.questions.length; i++) {
			const q = this.questions[i];
			const a = this.answers[i]?.trim() || "(no answer)";
			parts.push(`Q: ${q.question}`);
			if (q.context) {
				parts.push(`> ${q.context}`);
			}
			parts.push(`A: ${a}`);
			parts.push("");
		}

		this.onDone(parts.join("\n").trim());
	}

	private cancel(): void {
		this.onDone(null);
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	handleInput(data: string): void {
		// Confirmation dialog
		if (this.showingConfirmation) {
			if (matchesKey(data, Key.enter) || data.toLowerCase() === "y") {
				this.submit();
				return;
			}
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data.toLowerCase() === "n") {
				this.showingConfirmation = false;
				this.invalidate();
				this.requestRender();
				return;
			}
			return;
		}

		// Cancel
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.cancel();
			return;
		}

		// Tab / Shift+Tab for question navigation
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
			return t.fg("border", "│") + padded + " ".repeat(rightPad) + t.fg("border", "│");
		};

		const emptyBoxLine = (): string => {
			return t.fg("border", "│") + " ".repeat(boxWidth - 2) + t.fg("border", "│");
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
			const answered = (this.answers[i]?.trim() || "").length > 0;
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

		// Editor (answer area)
		const answerPrefix = t.bold("A: ");
		const answerPrefixWidth = visibleWidth(answerPrefix);
		const editorWidth = contentWidth - 4 - answerPrefixWidth;
		const editorLines = this.editor.render(editorWidth);
		// Skip first and last lines (editor border lines)
		for (let i = 1; i < editorLines.length - 1; i++) {
			if (i === 1) {
				lines.push(padLine(boxLine(answerPrefix + editorLines[i])));
			} else {
				lines.push(padLine(boxLine(" ".repeat(answerPrefixWidth) + editorLines[i])));
			}
		}

		lines.push(padLine(emptyBoxLine()));

		// Footer separator
		lines.push(padLine(t.fg("border", "├" + hLine(boxWidth - 2) + "┤")));

		// Confirmation or controls
		if (this.showingConfirmation) {
			const msg = `${t.fg("warning", "Submit all answers?")} ${t.fg("dim", "(Enter/y to confirm, Esc/n to cancel)")}`;
			lines.push(padLine(boxLine(truncateToWidth(msg, contentWidth))));
		} else {
			const controls = `${t.fg("dim", "Tab/Enter")} next · ${t.fg("dim", "Shift+Tab")} prev · ${t.fg("dim", "Shift+Enter")} newline · ${t.fg("dim", "Esc")} cancel`;
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

// --- Extension entry point ---

export default function (pi: ExtensionAPI) {
	// --- Tool: let the LLM ask the user multiple questions at once ---

	pi.registerTool({
		name: "answer",
		label: "Answer",
		description:
			"Ask the user one or more questions interactively. The user can answer all questions in a single Q&A form. " +
			"Use this when you have multiple questions for the user instead of asking them inline.",
		parameters: Type.Object({
			questions: Type.Array(
				Type.Object({
					question: Type.String({ description: "The question text" }),
					context: Type.Optional(Type.String({ description: "Optional context to help the user answer" })),
				}),
				{ description: "List of questions to ask the user" },
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Error: answer tool requires interactive mode" }],
					isError: true,
				};
			}

			if (params.questions.length === 0) {
				return {
					content: [{ type: "text", text: "Error: no questions provided" }],
					isError: true,
				};
			}

			const answersResult = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const component = new QnAComponent(
					params.questions,
					tui,
					theme,
					done,
					() => tui.requestRender(),
				);

				return {
					render: (w: number) => component.render(w),
					invalidate: () => component.invalidate(),
					handleInput: (data: string) => component.handleInput(data),
					get focused() {
						return component.focused;
					},
					set focused(value: boolean) {
						component.focused = value;
					},
				};
			});

			if (answersResult === null) {
				return {
					content: [{ type: "text", text: "User cancelled — did not answer the questions." }],
				};
			}

			return {
				content: [{ type: "text", text: answersResult }],
			};
		},
	});
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
						ctx.ui.notify(`Last assistant message incomplete (${msg.stopReason})`, "error");
						return;
					}
					const textParts = msg.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
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

		// Build candidate model list for extraction
		const candidates = await getCandidateModels(ctx.model, ctx.modelRegistry);

		if (candidates.length === 0) {
			ctx.ui.notify("No models available for extraction", "error");
			return;
		}

		// Extract questions with a loading spinner, trying candidates in order
		const extractionResult = await ctx.ui.custom<{ result: ExtractionResult; modelId: string } | null>((tui, theme, _kb, done) => {
			const loader = new BorderedLoader(tui, theme, `Extracting questions...`);
			loader.onAbort = () => done(null);

			const tryExtract = async (candidate: ModelCandidate): Promise<ExtractionResult> => {
				const userMessage: UserMessage = {
					role: "user",
					content: [{ type: "text", text: lastAssistantText! }],
					timestamp: Date.now(),
				};

				const response = await complete(
					candidate.model,
					{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
					{ apiKey: candidate.apiKey, signal: loader.signal },
				);

				if (response.stopReason === "aborted") {
					throw new Error("aborted");
				}

				const responseText = response.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n");

				if (!responseText) {
					const contentTypes = response.content.map((c) => c.type).join(", ") || "(empty)";
					throw new Error(
						`No text content (stop: ${response.stopReason}, types: ${contentTypes})`,
					);
				}

				return parseExtractionResult(responseText);
			};

			const doExtract = async (): Promise<{ result: ExtractionResult; modelId: string } | null> => {
				const errors: string[] = [];

				for (const candidate of candidates) {
					// Update spinner to show which model is being tried
					(loader as any).loader?.setMessage?.(`Extracting questions via ${candidate.model.id}...`);
					tui.requestRender();
					try {
						const result = await tryExtract(candidate);
						return { result, modelId: candidate.model.id };
					} catch (err) {
						if (err instanceof Error && err.message === "aborted") return null;
						const message = err instanceof Error ? err.message : String(err);
						errors.push(`${candidate.model.provider}/${candidate.model.id}: ${message}`);
					}
				}

				throw new Error(`All ${candidates.length} model(s) failed:\n${errors.join("\n")}`);
			};

			doExtract()
				.then(done)
				.catch((err) => {
					const message = err instanceof Error ? err.message : String(err);
					// Schedule notification after the custom UI closes
					setTimeout(() => ctx.ui.notify(`Extraction failed: ${message}`, "error"), 0);
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

		// Show the interactive Q&A form
		const answersResult = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
			const component = new QnAComponent(
				extractionResult.result.questions,
				tui,
				theme,
				done,
				() => tui.requestRender(),
				extractionResult.modelId,
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

		if (answersResult === null) {
			ctx.ui.notify("Cancelled", "info");
			return;
		}

		pi.sendMessage(
			{
				customType: "answers",
				content: "I answered your questions in the following way:\n\n" + answersResult,
				display: true,
			},
			{ triggerTurn: true },
		);
	};

	pi.registerCommand("answer", {
		description: "Extract questions from last assistant message into interactive Q&A",
		handler: (_args, ctx) => answerHandler(ctx),
	});

	pi.registerShortcut("ctrl+shift+a", {
		description: "Extract and answer questions",
		handler: answerHandler,
	});
}
