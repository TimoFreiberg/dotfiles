/**
 * Todo TUI extension — wraps the `tdo` CLI.
 *
 * Provides `/todo` and `/todo-done` commands with an interactive TUI for
 * browsing, creating, and managing todos. The agent interacts with tdo
 * directly via bash (guided by the tdo skill), so no tool is registered.
 */
import {
	DynamicBorder,
	copyToClipboard,
	getMarkdownTheme,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
} from "@mariozechner/pi-coding-agent";
import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import {
	Container,
	type Focusable,
	Input,
	Key,
	Markdown,
	SelectList,
	Spacer,
	type SelectItem,
	Text,
	TUI,
	fuzzyMatch,
	getEditorKeybindings,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Todo {
	id: string;
	title: string;
	status: string;
	assigned?: string;
	created?: string;
	body: string;
}

type TodoOverlayAction = "back" | "work";

type TodoMenuAction =
	| "work"
	| "refine"
	| "close"
	| "reopen"
	| "release"
	| "delete"
	| "copyPath"
	| "copyText"
	| "view";

// ---------------------------------------------------------------------------
// tdo CLI helpers
// ---------------------------------------------------------------------------

function getTodoDir(): string {
	return path.resolve(process.cwd(), ".todo");
}

function tdo(args: string): string {
	try {
		return execSync(`tdo ${args}`, { encoding: "utf8", timeout: 5000 }).trim();
	} catch (e: any) {
		return e.stderr?.trim() || e.message || "tdo command failed";
	}
}

/** Parse `tdo list` output lines like:
 *  `a3f9  My task`
 *  `a3f9  [done] My task`
 *  `a3f9  My task (assigned: alice)`
 */
function parseListLine(line: string): Todo | null {
	const m = line.match(/^([0-9a-f]{4})\s{2}(.+)$/i);
	if (!m) return null;
	const id = m[1];
	let rest = m[2];

	let status = "open";
	if (rest.startsWith("[done] ")) {
		status = "done";
		rest = rest.slice(7);
	}

	let assigned: string | undefined;
	const assignMatch = rest.match(/\s+\(assigned:\s*(.+?)\)$/);
	if (assignMatch) {
		assigned = assignMatch[1];
		rest = rest.slice(0, assignMatch.index!);
	}

	return { id, title: rest, status, assigned, body: "" };
}

function listTodos(all: boolean): Todo[] {
	const output = tdo(all ? "list --all" : "list");
	if (!output) return [];
	return output.split("\n").map(parseListLine).filter((t): t is Todo => t !== null);
}

/** Read a todo's full content from disk (for detail view / copy). */
function readTodoFile(id: string): Todo | null {
	const dir = getTodoDir();
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return null;
	}
	const file = entries.find((e) => e.startsWith(id) && e.endsWith(".md"));
	if (!file) return null;

	const content = readFileSync(path.join(dir, file), "utf8");
	const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!fmMatch) return { id, title: "", status: "open", body: content };

	const yaml = fmMatch[1];
	const body = (fmMatch[2] ?? "").replace(/^\n+/, "");

	const get = (key: string): string => {
		const m = yaml.match(new RegExp(`^${key}:\\s*'?(.*?)'?\\s*$`, "m"));
		return m ? m[1].replace(/^['"]|['"]$/g, "") : "";
	};

	return {
		id,
		title: get("title"),
		status: get("status") || "open",
		assigned: get("assigned") || undefined,
		created: get("created") || undefined,
		body,
	};
}

// ---------------------------------------------------------------------------
// Sorting & filtering
// ---------------------------------------------------------------------------

function isClosed(status: string): boolean {
	return status === "done" || status === "closed";
}

function splitTodos(todos: Todo[]) {
	const assigned: Todo[] = [];
	const open: Todo[] = [];
	const closed: Todo[] = [];
	for (const t of todos) {
		if (isClosed(t.status)) closed.push(t);
		else if (t.assigned) assigned.push(t);
		else open.push(t);
	}
	return { assigned, open, closed };
}

function filterTodos(todos: Todo[], query: string): Todo[] {
	const trimmed = query.trim();
	if (!trimmed) return todos;
	const tokens = trimmed.split(/\s+/).filter(Boolean);
	if (!tokens.length) return todos;

	const matches: Array<{ todo: Todo; score: number }> = [];
	for (const todo of todos) {
		const text = `${todo.id} ${todo.title} ${todo.status} ${todo.assigned ?? ""}`;
		let totalScore = 0;
		let ok = true;
		for (const token of tokens) {
			const result = fuzzyMatch(token, text);
			if (!result.matches) {
				ok = false;
				break;
			}
			totalScore += result.score;
		}
		if (ok) matches.push({ todo, score: totalScore });
	}

	return matches
		.sort((a, b) => {
			const ac = isClosed(a.todo.status),
				bc = isClosed(b.todo.status);
			if (ac !== bc) return ac ? 1 : -1;
			return a.score - b.score;
		})
		.map((m) => m.todo);
}

// ---------------------------------------------------------------------------
// TUI rendering helpers
// ---------------------------------------------------------------------------

function renderAssignSuffix(theme: Theme, todo: Todo): string {
	if (!todo.assigned) return "";
	return theme.fg("dim", ` (assigned: ${todo.assigned})`);
}

function renderTodoHeading(theme: Theme, todo: Todo): string {
	const closed = isClosed(todo.status);
	const titleColor = closed ? "dim" : "text";
	return (
		theme.fg("accent", todo.id) +
		" " +
		theme.fg(titleColor, todo.title || "(untitled)") +
		renderAssignSuffix(theme, todo)
	);
}

function loadRefineInstructions(): { text: string; error?: string } {
	const home = process.env.HOME || process.env.USERPROFILE || "";
	const skillPath = path.join(home, ".config", "pi", "agent", "skills", "tdo", "SKILL.md");
	try {
		const content = readFileSync(skillPath, "utf8");
		const marker = "## Refine\n";
		const start = content.indexOf(marker);
		if (start < 0) {
			return { text: "", error: `No ## Refine section found in ${skillPath}` };
		}
		const after = content.slice(start + marker.length);
		const nextSection = after.search(/\n## /);
		const section = (nextSection >= 0 ? after.slice(0, nextSection) : after).trim();
		if (!section) {
			return { text: "", error: `## Refine section in ${skillPath} is empty` };
		}
		return { text: section };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { text: "", error: `Failed to load ${skillPath}: ${msg}` };
	}
}

const REFINE_PROMPT_MARKER = "<!-- todo-refine -->";

function buildRefinePrompt(id: string, title: string): string {
	return (
		`let's refine task ${id} "${title}": ` +
		"Ask me for the missing details needed to refine the todo together. Do not rewrite the todo yet and do not make assumptions. " +
		"Ask clear, concrete questions and wait for my answers before drafting any structured description.\n\n" +
		REFINE_PROMPT_MARKER
	);
}

// ---------------------------------------------------------------------------
// TUI components
// ---------------------------------------------------------------------------

class TodoSelectorComponent extends Container implements Focusable {
	private searchInput: Input;
	private listContainer: Container;
	private allTodos: Todo[];
	private filteredTodos: Todo[];
	private selectedIndex = 0;
	private onSelectCallback: (todo: Todo) => void;
	private onCancelCallback: () => void;
	private tui: TUI;
	private theme: Theme;
	private headerText: Text;
	private hintText: Text;
	private onQuickAction?: (todo: Todo, action: "work" | "refine") => void;

	private _focused = false;
	get focused() {
		return this._focused;
	}
	set focused(v: boolean) {
		this._focused = v;
		this.searchInput.focused = v;
	}

	private onCreateCallback?: (title: string) => void;

	constructor(
		tui: TUI,
		theme: Theme,
		todos: Todo[],
		onSelect: (todo: Todo) => void,
		onCancel: () => void,
		initialSearch?: string,
		onQuickAction?: (todo: Todo, action: "work" | "refine") => void,
		onCreate?: (title: string) => void,
	) {
		super();
		this.tui = tui;
		this.theme = theme;
		this.allTodos = todos;
		this.filteredTodos = todos;
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;
		this.onQuickAction = onQuickAction;
		this.onCreateCallback = onCreate;

		this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		this.addChild(new Spacer(1));
		this.headerText = new Text("", 1, 0);
		this.addChild(this.headerText);
		this.addChild(new Spacer(1));

		this.searchInput = new Input();
		if (initialSearch) this.searchInput.setValue(initialSearch);
		this.searchInput.onSubmit = () => {
			if (this.selectedIndex === 0) {
				this.triggerCreate();
			} else {
				const sel = this.filteredTodos[this.selectedIndex - 1];
				if (sel) this.onSelectCallback(sel);
			}
		};
		this.addChild(this.searchInput);
		this.addChild(new Spacer(1));

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));

		this.hintText = new Text("", 1, 0);
		this.addChild(this.hintText);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		this.updateHeader();
		this.updateHints();
		this.applyFilter(this.searchInput.getValue());
		if (this.filteredTodos.length > 0) {
			this.selectedIndex = 1;
			this.updateList();
		}
	}

	setTodos(todos: Todo[]) {
		this.allTodos = todos;
		this.updateHeader();
		this.applyFilter(this.searchInput.getValue());
		this.tui.requestRender();
	}

	private updateHeader() {
		const openCount = this.allTodos.filter((t) => !isClosed(t.status)).length;
		const closedCount = this.allTodos.length - openCount;
		this.headerText.setText(
			this.theme.fg("accent", this.theme.bold(`Todos (${openCount} open, ${closedCount} closed)`)),
		);
	}

	private updateHints() {
		this.hintText.setText(
			this.theme.fg(
				"dim",
				"Type to search • ↑↓ select • Enter actions • Ctrl+N create • Ctrl+Shift+W work • Ctrl+Shift+R refine • Esc close",
			),
		);
	}

	private applyFilter(query: string) {
		this.filteredTodos = filterTodos(this.allTodos, query);
		const totalItems = 1 + this.filteredTodos.length;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, totalItems - 1));
		this.updateList();
	}

	private updateList() {
		this.listContainer.clear();

		const totalItems = 1 + this.filteredTodos.length;
		const maxVisible = 10;
		const startIdx = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(maxVisible / 2), totalItems - maxVisible),
		);
		const endIdx = Math.min(startIdx + maxVisible, totalItems);

		for (let i = startIdx; i < endIdx; i++) {
			if (i === 0) {
				const isSel = this.selectedIndex === 0;
				const prefix = isSel ? this.theme.fg("accent", "→ ") : "  ";
				const searchText = this.searchInput.getValue().trim();
				const label = searchText ? `+ Create "${searchText}"` : "+ Create new todo...";
				const color = isSel ? "accent" : "success";
				this.listContainer.addChild(new Text(prefix + this.theme.fg(color, label), 0, 0));
			} else {
				const todo = this.filteredTodos[i - 1];
				if (!todo) continue;
				const isSel = i === this.selectedIndex;
				const closed = isClosed(todo.status);
				const prefix = isSel ? this.theme.fg("accent", "→ ") : "  ";
				const titleColor = isSel ? "accent" : closed ? "dim" : "text";
				const statusColor = closed ? "dim" : "success";
				const line =
					prefix +
					this.theme.fg("accent", todo.id) +
					" " +
					this.theme.fg(titleColor, todo.title || "(untitled)") +
					renderAssignSuffix(this.theme, todo) +
					" " +
					this.theme.fg(statusColor, `(${todo.status})`);
				this.listContainer.addChild(new Text(line, 0, 0));
			}
		}

		if (startIdx > 0 || endIdx < totalItems) {
			const scrollInfo = this.theme.fg("dim", `  (${this.selectedIndex + 1}/${totalItems})`);
			this.listContainer.addChild(new Text(scrollInfo, 0, 0));
		}
	}

	private triggerCreate() {
		if (this.onCreateCallback) {
			this.onCreateCallback(this.searchInput.getValue().trim());
		}
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();
		const totalItems = 1 + this.filteredTodos.length;
		if (kb.matches(keyData, "selectUp")) {
			if (!totalItems) return;
			this.selectedIndex = this.selectedIndex === 0 ? totalItems - 1 : this.selectedIndex - 1;
			this.updateList();
			return;
		}
		if (kb.matches(keyData, "selectDown")) {
			if (!totalItems) return;
			this.selectedIndex = this.selectedIndex === totalItems - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			return;
		}
		if (kb.matches(keyData, "selectConfirm")) {
			if (this.selectedIndex === 0) {
				this.triggerCreate();
			} else {
				const sel = this.filteredTodos[this.selectedIndex - 1];
				if (sel) this.onSelectCallback(sel);
			}
			return;
		}
		if (kb.matches(keyData, "selectCancel")) {
			this.onCancelCallback();
			return;
		}
		if (matchesKey(keyData, Key.ctrl("n"))) {
			this.triggerCreate();
			return;
		}
		if (matchesKey(keyData, Key.ctrlShift("r"))) {
			if (this.selectedIndex > 0) {
				const sel = this.filteredTodos[this.selectedIndex - 1];
				if (sel && this.onQuickAction) this.onQuickAction(sel, "refine");
			}
			return;
		}
		if (matchesKey(keyData, Key.ctrlShift("w"))) {
			if (this.selectedIndex > 0) {
				const sel = this.filteredTodos[this.selectedIndex - 1];
				if (sel && this.onQuickAction) this.onQuickAction(sel, "work");
			}
			return;
		}
		this.searchInput.handleInput(keyData);
		this.applyFilter(this.searchInput.getValue());
	}

	override invalidate(): void {
		super.invalidate();
		this.updateHeader();
		this.updateHints();
		this.updateList();
	}
}

class TodoActionMenuComponent extends Container {
	private selectList: SelectList;

	constructor(
		theme: Theme,
		todo: Todo,
		onSelect: (action: TodoMenuAction) => void,
		onCancel: () => void,
	) {
		super();

		const closed = isClosed(todo.status);
		const title = todo.title || "(untitled)";
		const options: SelectItem[] = [
			{ value: "view", label: "view", description: "View todo" },
			{ value: "work", label: "work", description: "Work on todo" },
			{ value: "refine", label: "refine", description: "Refine task" },
			...(closed
				? [{ value: "reopen", label: "reopen", description: "Reopen todo" }]
				: [{ value: "close", label: "close", description: "Close todo" }]),
			...(todo.assigned
				? [{ value: "release", label: "unassign", description: "Remove assignment" }]
				: []),
			{ value: "copyPath", label: "copy path", description: "Copy absolute path to clipboard" },
			{ value: "copyText", label: "copy text", description: "Copy title and body to clipboard" },
			{ value: "delete", label: "delete", description: "Delete todo" },
		];

		this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		this.addChild(
			new Text(theme.fg("accent", theme.bold(`Actions for ${todo.id} "${title}"`)), 0, 0),
		);

		this.selectList = new SelectList(options, options.length, {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		this.selectList.onSelect = (item) => onSelect(item.value as TodoMenuAction);
		this.selectList.onCancel = () => onCancel();

		this.addChild(this.selectList);
		this.addChild(new Text(theme.fg("dim", "Enter to confirm • Esc back"), 0, 0));
		this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
	}

	handleInput(keyData: string): void {
		this.selectList.handleInput(keyData);
	}
	override invalidate(): void {
		super.invalidate();
	}
}

class TodoDeleteConfirmComponent extends Container {
	private selectList: SelectList;

	constructor(theme: Theme, message: string, onConfirm: (confirmed: boolean) => void) {
		super();

		const options: SelectItem[] = [
			{ value: "yes", label: "Yes" },
			{ value: "no", label: "No" },
		];

		this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		this.addChild(new Text(theme.fg("accent", message), 0, 0));

		this.selectList = new SelectList(options, options.length, {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		this.selectList.onSelect = (item) => onConfirm(item.value === "yes");
		this.selectList.onCancel = () => onConfirm(false);

		this.addChild(this.selectList);
		this.addChild(new Text(theme.fg("dim", "Enter to confirm • Esc back"), 0, 0));
		this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
	}

	handleInput(keyData: string): void {
		this.selectList.handleInput(keyData);
	}
	override invalidate(): void {
		super.invalidate();
	}
}

class TodoDetailOverlayComponent {
	private todo: Todo;
	private theme: Theme;
	private tui: TUI;
	private markdown: Markdown;
	private scrollOffset = 0;
	private viewHeight = 0;
	private totalLines = 0;
	private onAction: (action: TodoOverlayAction) => void;

	constructor(tui: TUI, theme: Theme, todo: Todo, onAction: (action: TodoOverlayAction) => void) {
		this.tui = tui;
		this.theme = theme;
		this.todo = todo;
		this.onAction = onAction;
		this.markdown = new Markdown(todo.body?.trim() || "_No details yet._", 1, 0, getMarkdownTheme());
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();
		if (kb.matches(keyData, "selectCancel")) {
			this.onAction("back");
			return;
		}
		if (kb.matches(keyData, "selectConfirm")) {
			this.onAction("work");
			return;
		}
		if (kb.matches(keyData, "selectUp")) {
			this.scrollBy(-1);
			return;
		}
		if (kb.matches(keyData, "selectDown")) {
			this.scrollBy(1);
			return;
		}
		if (kb.matches(keyData, "selectPageUp")) {
			this.scrollBy(-this.viewHeight || -1);
			return;
		}
		if (kb.matches(keyData, "selectPageDown")) {
			this.scrollBy(this.viewHeight || 1);
			return;
		}
	}

	render(width: number): string[] {
		const maxHeight = Math.max(10, Math.floor((this.tui.terminal.rows || 24) * 0.8));
		const headerLines = 3,
			footerLines = 3,
			borderLines = 2;
		const innerWidth = Math.max(10, width - 2);
		const contentHeight = Math.max(1, maxHeight - headerLines - footerLines - borderLines);

		const mdLines = this.markdown.render(innerWidth);
		this.totalLines = mdLines.length;
		this.viewHeight = contentHeight;
		const maxScroll = Math.max(0, this.totalLines - contentHeight);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));

		const visibleLines = mdLines.slice(this.scrollOffset, this.scrollOffset + contentHeight);
		const lines: string[] = [];
		lines.push(this.buildTitleLine(innerWidth));
		lines.push(this.buildMetaLine(innerWidth));
		lines.push("");
		for (const l of visibleLines) lines.push(truncateToWidth(l, innerWidth));
		while (lines.length < headerLines + contentHeight) lines.push("");
		lines.push("");
		lines.push(this.buildActionLine(innerWidth));

		const bc = (s: string) => this.theme.fg("borderMuted", s);
		const top = bc(`┌${"─".repeat(innerWidth)}┐`);
		const bottom = bc(`└${"─".repeat(innerWidth)}┘`);
		const framed = lines.map((line) => {
			const t = truncateToWidth(line, innerWidth);
			const pad = Math.max(0, innerWidth - visibleWidth(t));
			return bc("│") + t + " ".repeat(pad) + bc("│");
		});
		return [top, ...framed, bottom].map((l) => truncateToWidth(l, width));
	}

	invalidate(): void {
		this.markdown = new Markdown(
			this.todo.body?.trim() || "_No details yet._",
			1,
			0,
			getMarkdownTheme(),
		);
	}

	private buildTitleLine(width: number): string {
		const titleText = this.todo.title ? ` ${this.todo.title} ` : ` Todo ${this.todo.id} `;
		const tw = visibleWidth(titleText);
		if (tw >= width) return truncateToWidth(this.theme.fg("accent", titleText.trim()), width);
		const left = Math.floor((width - tw) / 2);
		const right = width - tw - left;
		return (
			this.theme.fg("borderMuted", "─".repeat(left)) +
			this.theme.fg("accent", titleText) +
			this.theme.fg("borderMuted", "─".repeat(right))
		);
	}

	private buildMetaLine(width: number): string {
		const status = this.todo.status || "open";
		const statusColor = isClosed(status) ? "dim" : "success";
		const assignText = this.todo.assigned ? `assigned: ${this.todo.assigned}` : "unassigned";
		return truncateToWidth(
			this.theme.fg("accent", this.todo.id) +
				this.theme.fg("muted", " • ") +
				this.theme.fg(statusColor, status) +
				this.theme.fg("muted", " • ") +
				this.theme.fg("muted", assignText),
			width,
		);
	}

	private buildActionLine(width: number): string {
		const work = this.theme.fg("accent", "enter") + this.theme.fg("muted", " work on todo");
		const back = this.theme.fg("dim", "esc back");
		let line = [work, back].join(this.theme.fg("muted", " • "));
		if (this.totalLines > this.viewHeight) {
			const start = Math.min(this.totalLines, this.scrollOffset + 1);
			const end = Math.min(this.totalLines, this.scrollOffset + this.viewHeight);
			line += this.theme.fg("dim", ` ${start}-${end}/${this.totalLines}`);
		}
		return truncateToWidth(line, width);
	}

	private scrollBy(delta: number): void {
		const max = Math.max(0, this.totalLines - this.viewHeight);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset + delta, max));
	}
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function todosExtension(pi: ExtensionAPI) {
	const todosCommandHandler = async (
		args: string | undefined,
		ctx: ExtensionContext,
		showDone: boolean,
	) => {
		const allTodos = listTodos(true);
		const todos = showDone
			? allTodos.filter((t) => isClosed(t.status))
			: allTodos.filter((t) => !isClosed(t.status));
		const searchTerm = (args ?? "").trim();

		if (!ctx.hasUI) {
			console.log(tdo(showDone ? "list --all" : "list"));
			return;
		}

		let nextPrompt: string | null = null;
		let rootTui: TUI | null = null;

		await ctx.ui.custom<void>((tui, theme, _kb, done) => {
			rootTui = tui;
			let selector: TodoSelectorComponent | null = null;
			let actionMenu: TodoActionMenuComponent | null = null;
			let deleteConfirm: TodoDeleteConfirmComponent | null = null;
			let activeComponent: {
				render: (width: number) => string[];
				invalidate: () => void;
				handleInput?: (data: string) => void;
				focused?: boolean;
			} | null = null;
			let wrapperFocused = false;

			const setActive = (comp: typeof activeComponent) => {
				if (activeComponent && "focused" in activeComponent) activeComponent.focused = false;
				activeComponent = comp;
				if (activeComponent && "focused" in activeComponent)
					activeComponent.focused = wrapperFocused;
				tui.requestRender();
			};

			const refreshList = () => {
				const fresh = listTodos(true);
				const filtered = showDone
					? fresh.filter((t) => isClosed(t.status))
					: fresh.filter((t) => !isClosed(t.status));
				selector?.setTodos(filtered);
			};

			const copyPath = (todoId: string) => {
				const dir = getTodoDir();
				let entries: string[];
				try {
					entries = readdirSync(dir);
				} catch {
					ctx.ui.notify("Could not read .todo directory", "error");
					return;
				}
				const file = entries.find((e) => e.startsWith(todoId) && e.endsWith(".md"));
				if (!file) {
					ctx.ui.notify(`Todo file for ${todoId} not found`, "error");
					return;
				}
				try {
					copyToClipboard(path.resolve(dir, file));
					ctx.ui.notify("Copied path to clipboard", "info");
				} catch (e) {
					ctx.ui.notify(e instanceof Error ? e.message : String(e), "error");
				}
			};

			const copyText = (record: Todo) => {
				const title = record.title || "(untitled)";
				const body = record.body?.trim() || "";
				try {
					copyToClipboard(body ? `# ${title}\n\n${body}` : `# ${title}`);
					ctx.ui.notify("Copied todo text to clipboard", "info");
				} catch (e) {
					ctx.ui.notify(e instanceof Error ? e.message : String(e), "error");
				}
			};

			const openOverlay = async (record: Todo): Promise<TodoOverlayAction> => {
				const action = await ctx.ui.custom<TodoOverlayAction>(
					(overlayTui, overlayTheme, _kb, overlayDone) =>
						new TodoDetailOverlayComponent(overlayTui, overlayTheme, record, overlayDone),
					{
						overlay: true,
						overlayOptions: { width: "80%", maxHeight: "80%", anchor: "center" },
					},
				);
				return action ?? "back";
			};

			const applyAction = async (
				todo: Todo,
				action: TodoMenuAction,
			): Promise<"stay" | "exit"> => {
				if (action === "refine") {
					nextPrompt = buildRefinePrompt(todo.id, todo.title || "(untitled)");
					done();
					return "exit";
				}
				if (action === "work") {
					nextPrompt = `work on todo ${todo.id} "${todo.title || "(untitled)"}"`;
					done();
					return "exit";
				}
				if (action === "view") return "stay";
				if (action === "copyPath") {
					copyPath(todo.id);
					return "stay";
				}
				if (action === "copyText") {
					const record = readTodoFile(todo.id);
					if (record) copyText(record);
					else ctx.ui.notify(`Todo ${todo.id} not found`, "error");
					return "stay";
				}
				if (action === "release") {
					tdo(`unassign ${todo.id}`);
					refreshList();
					ctx.ui.notify(`Unassigned todo ${todo.id}`, "info");
					return "stay";
				}
				if (action === "delete") {
					tdo(`delete ${todo.id} --force`);
					refreshList();
					ctx.ui.notify(`Deleted todo ${todo.id}`, "info");
					return "stay";
				}
				// close / reopen
				if (action === "close") {
					tdo(`done ${todo.id}`);
				} else {
					tdo(`reopen ${todo.id}`);
				}
				refreshList();
				ctx.ui.notify(
					`${action === "close" ? "Closed" : "Reopened"} todo ${todo.id}`,
					"info",
				);
				return "stay";
			};

			const handleActionSelection = async (todo: Todo, action: TodoMenuAction) => {
				if (action === "view") {
					const record = readTodoFile(todo.id);
					if (!record) {
						ctx.ui.notify(`Todo ${todo.id} not found`, "error");
						return;
					}
					const overlayAction = await openOverlay(record);
					if (overlayAction === "work") {
						await applyAction(todo, "work");
						return;
					}
					if (actionMenu) setActive(actionMenu);
					return;
				}
				if (action === "delete") {
					const msg = `Delete todo ${todo.id}? This cannot be undone.`;
					deleteConfirm = new TodoDeleteConfirmComponent(theme, msg, (confirmed) => {
						if (!confirmed) {
							setActive(actionMenu);
							return;
						}
						void (async () => {
							await applyAction(todo, "delete");
							setActive(selector);
						})();
					});
					setActive(deleteConfirm);
					return;
				}
				const result = await applyAction(todo, action);
				if (result === "stay") setActive(selector);
			};

			const showActionMenu = (todo: Todo) => {
				// Re-read from disk to get full body for the menu context
				const record = readTodoFile(todo.id) ?? todo;
				actionMenu = new TodoActionMenuComponent(
					theme,
					record,
					(action) => {
						void handleActionSelection(record, action);
					},
					() => {
						setActive(selector);
					},
				);
				setActive(actionMenu);
			};

			selector = new TodoSelectorComponent(
				tui,
				theme,
				todos,
				(todo) => showActionMenu(todo),
				() => done(),
				searchTerm || undefined,
				(todo, action) => {
					const title = todo.title || "(untitled)";
					nextPrompt =
						action === "refine"
							? buildRefinePrompt(todo.id, title)
							: `work on todo ${todo.id} "${title}"`;
					done();
				},
				(title) => {
					if (!title) {
						ctx.ui.notify("Enter a title in the search box first", "warning");
						return;
					}
					const output = tdo(`add ${title}`);
					const idMatch = output.match(/^([0-9a-f]{4})$/im);
					if (idMatch) {
						ctx.ui.notify(`Created ${idMatch[1]} "${title}"`, "info");
					} else {
						ctx.ui.notify(output || "Created todo", "info");
					}
					refreshList();
					done();
				},
			);
			setActive(selector);

			return {
				get focused() {
					return wrapperFocused;
				},
				set focused(v: boolean) {
					wrapperFocused = v;
					if (activeComponent && "focused" in activeComponent)
						activeComponent.focused = v;
				},
				render(width: number) {
					return activeComponent ? activeComponent.render(width) : [];
				},
				invalidate() {
					activeComponent?.invalidate();
				},
				handleInput(data: string) {
					activeComponent?.handleInput?.(data);
				},
			};
		});

		if (nextPrompt) {
			ctx.ui.setEditorText(nextPrompt);
			rootTui?.requestRender();
		}
	};

	const getCompletions = (prefix: string, showDone: boolean) => {
		const allTodos = listTodos(true);
		const todos = showDone
			? allTodos.filter((t) => isClosed(t.status))
			: allTodos.filter((t) => !isClosed(t.status));
		if (!todos.length) return null;
		const matches = filterTodos(todos, prefix);
		if (!matches.length) return null;
		return matches.map((t) => ({
			value: t.title || "(untitled)",
			label: `${t.id} ${t.title || "(untitled)"}`,
			description: `${t.status}${t.assigned ? ` • assigned: ${t.assigned}` : ""}`,
		}));
	};

	pi.registerCommand("todo", {
		description: "List and manage open todos",
		getArgumentCompletions: (prefix: string) => getCompletions(prefix, false),
		handler: async (args, ctx) => todosCommandHandler(args, ctx, false),
	});

	pi.registerCommand("todo-done", {
		description: "List and manage done/closed todos",
		getArgumentCompletions: (prefix: string) => getCompletions(prefix, true),
		handler: async (args, ctx) => todosCommandHandler(args, ctx, true),
	});

	// Append skill refine instructions when a refine prompt is sent
	pi.on("input", async (event, ctx) => {
		if (!event.text.includes(REFINE_PROMPT_MARKER)) return;
		const { text: skillInstructions, error } = loadRefineInstructions();
		if (error) ctx.ui.notify(error, "warning");
		const cleaned = event.text.replace(REFINE_PROMPT_MARKER, "").trimEnd();
		const text = skillInstructions
			? cleaned + "\n\nFollow these refine instructions:\n" + skillInstructions
			: cleaned;
		return { action: "transform" as const, text };
	});
}
