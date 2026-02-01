/**
 * Code Review Extension (based on mitsuhiko's review extension)
 *
 * Provides a `/review` command that prompts the agent to review code changes.
 * Supports multiple review modes:
 * - Review a GitHub pull request (checks out the PR locally)
 * - Review against a base branch (PR style)
 * - Review uncommitted changes
 * - Review a specific commit
 * - Custom review instructions
 *
 * Usage:
 * - `/review` - show interactive selector
 * - `/review pr 123` - review PR #123 (checks out locally)
 * - `/review pr https://github.com/owner/repo/pull/123` - review PR from URL
 * - `/review uncommitted` - review uncommitted changes directly
 * - `/review branch main` - review against main branch
 * - `/review commit abc123` - review specific commit
 * - `/review custom "check for security issues"` - custom instructions
 *
 * Project-specific review guidelines:
 * - Create REVIEW_GUIDELINES.md in the same directory as .pi
 * - Its contents are used as the review prompt
 * - If not found, a minimal default prompt is used
 *
 * Note: PR review requires a clean working tree (no uncommitted changes to tracked files).
 */

import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, BorderedLoader } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import path from "node:path";
import { promises as fs } from "node:fs";

// State to track fresh session review (where we branched from)
let reviewOriginId: string | undefined = undefined;

const REVIEW_STATE_TYPE = "review-session";

type ReviewSessionState = {
	active: boolean;
	originId?: string;
};

function setReviewWidget(ctx: ExtensionContext, active: boolean) {
	if (!ctx.hasUI) return;
	if (!active) {
		ctx.ui.setWidget("review", undefined);
		return;
	}

	ctx.ui.setWidget("review", (_tui, theme) => {
		const text = new Text(theme.fg("warning", "Review session active, return with /end-review"), 0, 0);
		return {
			render(width: number) {
				return text.render(width);
			},
			invalidate() {
				text.invalidate();
			},
		};
	});
}

function getReviewState(ctx: ExtensionContext): ReviewSessionState | undefined {
	let state: ReviewSessionState | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "custom" && entry.customType === REVIEW_STATE_TYPE) {
			state = entry.data as ReviewSessionState | undefined;
		}
	}
	return state;
}

function applyReviewState(ctx: ExtensionContext) {
	const state = getReviewState(ctx);

	if (state?.active && state.originId) {
		reviewOriginId = state.originId;
		setReviewWidget(ctx, true);
		return;
	}

	reviewOriginId = undefined;
	setReviewWidget(ctx, false);
}

// Review target types
type ReviewTarget =
	| { type: "uncommitted" }
	| { type: "baseBranch"; branch: string }
	| { type: "commit"; sha: string; title?: string }
	| { type: "custom"; instructions: string }
	| { type: "pullRequest"; prNumber: number; baseBranch: string; title: string };

// Minimal prompts - project guidelines provide the detail
const UNCOMMITTED_PROMPT =
	"Review the current code changes (staged, unstaged, and untracked files).";

const BASE_BRANCH_PROMPT_WITH_MERGE_BASE =
	"Review the code changes against the base branch '{baseBranch}'. The merge base commit is {mergeBaseSha}. Run `git diff {mergeBaseSha}` to inspect the changes.";

const BASE_BRANCH_PROMPT_FALLBACK =
	"Review the code changes against the base branch '{branch}'. Find the merge base (e.g., `git merge-base HEAD \"{branch}\"`), then run `git diff` against that SHA.";

const COMMIT_PROMPT_WITH_TITLE =
	'Review the code changes in commit {sha} ("{title}").';

const COMMIT_PROMPT = "Review the code changes in commit {sha}.";

const PULL_REQUEST_PROMPT =
	'Review pull request #{prNumber} ("{title}") against base branch \'{baseBranch}\'. Merge base is {mergeBaseSha}. Run `git diff {mergeBaseSha}` to inspect the changes.';

const PULL_REQUEST_PROMPT_FALLBACK =
	'Review pull request #{prNumber} ("{title}") against base branch \'{baseBranch}\'. Find the merge base (`git merge-base HEAD {baseBranch}`), then `git diff` against that SHA.';

// Default review instructions when no REVIEW_GUIDELINES.md exists
const DEFAULT_REVIEW_INSTRUCTIONS = `Review the code changes and provide findings.

Focus on:
- Correctness and logic errors
- Security issues
- Performance concerns
- Error handling

Provide prioritized, actionable findings.`;

async function loadProjectReviewGuidelines(cwd: string): Promise<string | null> {
	let currentDir = path.resolve(cwd);

	while (true) {
		const piDir = path.join(currentDir, ".pi");
		const guidelinesPath = path.join(currentDir, "REVIEW_GUIDELINES.md");

		const piStats = await fs.stat(piDir).catch(() => null);
		if (piStats?.isDirectory()) {
			const guidelineStats = await fs.stat(guidelinesPath).catch(() => null);
			if (guidelineStats?.isFile()) {
				try {
					const content = await fs.readFile(guidelinesPath, "utf8");
					const trimmed = content.trim();
					return trimmed ? trimmed : null;
				} catch {
					return null;
				}
			}
			return null;
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			return null;
		}
		currentDir = parentDir;
	}
}

async function getMergeBase(pi: ExtensionAPI, branch: string): Promise<string | null> {
	try {
		const { stdout: upstream, code: upstreamCode } = await pi.exec("git", [
			"rev-parse",
			"--abbrev-ref",
			`${branch}@{upstream}`,
		]);

		if (upstreamCode === 0 && upstream.trim()) {
			const { stdout: mergeBase, code } = await pi.exec("git", ["merge-base", "HEAD", upstream.trim()]);
			if (code === 0 && mergeBase.trim()) {
				return mergeBase.trim();
			}
		}

		const { stdout: mergeBase, code } = await pi.exec("git", ["merge-base", "HEAD", branch]);
		if (code === 0 && mergeBase.trim()) {
			return mergeBase.trim();
		}

		return null;
	} catch {
		return null;
	}
}

async function getLocalBranches(pi: ExtensionAPI): Promise<string[]> {
	const { stdout, code } = await pi.exec("git", ["branch", "--format=%(refname:short)"]);
	if (code !== 0) return [];
	return stdout
		.trim()
		.split("\n")
		.filter((b) => b.trim());
}

async function getRecentCommits(pi: ExtensionAPI, limit: number = 10): Promise<Array<{ sha: string; title: string }>> {
	const { stdout, code } = await pi.exec("git", ["log", "--oneline", `-n`, `${limit}`]);
	if (code !== 0) return [];

	return stdout
		.trim()
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => {
			const [sha, ...rest] = line.trim().split(" ");
			return { sha, title: rest.join(" ") };
		});
}

async function hasUncommittedChanges(pi: ExtensionAPI): Promise<boolean> {
	const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
	return code === 0 && stdout.trim().length > 0;
}

async function hasPendingChanges(pi: ExtensionAPI): Promise<boolean> {
	const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
	if (code !== 0) return false;

	const lines = stdout.trim().split("\n").filter((line) => line.trim());
	const trackedChanges = lines.filter((line) => !line.startsWith("??"));
	return trackedChanges.length > 0;
}

function parsePrReference(ref: string): number | null {
	const trimmed = ref.trim();

	const num = parseInt(trimmed, 10);
	if (!isNaN(num) && num > 0) {
		return num;
	}

	const urlMatch = trimmed.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
	if (urlMatch) {
		return parseInt(urlMatch[1], 10);
	}

	return null;
}

async function getPrInfo(pi: ExtensionAPI, prNumber: number): Promise<{ baseBranch: string; title: string; headBranch: string } | null> {
	const { stdout, code } = await pi.exec("gh", [
		"pr", "view", String(prNumber),
		"--json", "baseRefName,title,headRefName",
	]);

	if (code !== 0) return null;

	try {
		const data = JSON.parse(stdout);
		return {
			baseBranch: data.baseRefName,
			title: data.title,
			headBranch: data.headRefName,
		};
	} catch {
		return null;
	}
}

async function checkoutPr(pi: ExtensionAPI, prNumber: number): Promise<{ success: boolean; error?: string }> {
	const { stdout, stderr, code } = await pi.exec("gh", ["pr", "checkout", String(prNumber)]);

	if (code !== 0) {
		return { success: false, error: stderr || stdout || "Failed to checkout PR" };
	}

	return { success: true };
}

async function getCurrentBranch(pi: ExtensionAPI): Promise<string | null> {
	const { stdout, code } = await pi.exec("git", ["branch", "--show-current"]);
	if (code === 0 && stdout.trim()) {
		return stdout.trim();
	}
	return null;
}

async function getDefaultBranch(pi: ExtensionAPI): Promise<string> {
	const { stdout, code } = await pi.exec("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"]);
	if (code === 0 && stdout.trim()) {
		return stdout.trim().replace("origin/", "");
	}

	const branches = await getLocalBranches(pi);
	if (branches.includes("main")) return "main";
	if (branches.includes("master")) return "master";

	return "main";
}

async function buildReviewPrompt(pi: ExtensionAPI, target: ReviewTarget): Promise<string> {
	switch (target.type) {
		case "uncommitted":
			return UNCOMMITTED_PROMPT;

		case "baseBranch": {
			const mergeBase = await getMergeBase(pi, target.branch);
			if (mergeBase) {
				return BASE_BRANCH_PROMPT_WITH_MERGE_BASE
					.replace(/{baseBranch}/g, target.branch)
					.replace(/{mergeBaseSha}/g, mergeBase);
			}
			return BASE_BRANCH_PROMPT_FALLBACK.replace(/{branch}/g, target.branch);
		}

		case "commit":
			if (target.title) {
				return COMMIT_PROMPT_WITH_TITLE.replace("{sha}", target.sha).replace("{title}", target.title);
			}
			return COMMIT_PROMPT.replace("{sha}", target.sha);

		case "custom":
			return target.instructions;

		case "pullRequest": {
			const mergeBase = await getMergeBase(pi, target.baseBranch);
			if (mergeBase) {
				return PULL_REQUEST_PROMPT
					.replace(/{prNumber}/g, String(target.prNumber))
					.replace(/{title}/g, target.title)
					.replace(/{baseBranch}/g, target.baseBranch)
					.replace(/{mergeBaseSha}/g, mergeBase);
			}
			return PULL_REQUEST_PROMPT_FALLBACK
				.replace(/{prNumber}/g, String(target.prNumber))
				.replace(/{title}/g, target.title)
				.replace(/{baseBranch}/g, target.baseBranch);
		}
	}
}

function getUserFacingHint(target: ReviewTarget): string {
	switch (target.type) {
		case "uncommitted":
			return "current changes";
		case "baseBranch":
			return `changes against '${target.branch}'`;
		case "commit": {
			const shortSha = target.sha.slice(0, 7);
			return target.title ? `commit ${shortSha}: ${target.title}` : `commit ${shortSha}`;
		}
		case "custom":
			return target.instructions.length > 40 ? target.instructions.slice(0, 37) + "..." : target.instructions;
		case "pullRequest": {
			const shortTitle = target.title.length > 30 ? target.title.slice(0, 27) + "..." : target.title;
			return `PR #${target.prNumber}: ${shortTitle}`;
		}
	}
}

const REVIEW_PRESETS = [
	{ value: "pullRequest", label: "Review a pull request", description: "(GitHub PR)" },
	{ value: "baseBranch", label: "Review against a base branch", description: "(local)" },
	{ value: "uncommitted", label: "Review uncommitted changes", description: "" },
	{ value: "commit", label: "Review a commit", description: "" },
	{ value: "custom", label: "Custom review instructions", description: "" },
] as const;

export default function reviewExtension(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		applyReviewState(ctx);
	});

	pi.on("session_switch", (_event, ctx) => {
		applyReviewState(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		applyReviewState(ctx);
	});

	async function getSmartDefault(): Promise<"uncommitted" | "baseBranch" | "commit"> {
		if (await hasUncommittedChanges(pi)) {
			return "uncommitted";
		}

		const currentBranch = await getCurrentBranch(pi);
		const defaultBranch = await getDefaultBranch(pi);
		if (currentBranch && currentBranch !== defaultBranch) {
			return "baseBranch";
		}

		return "commit";
	}

	async function showReviewSelector(ctx: ExtensionContext): Promise<ReviewTarget | null> {
		const smartDefault = await getSmartDefault();
		const items: SelectItem[] = REVIEW_PRESETS
			.slice()
			.sort((a, b) => {
				if (a.value === smartDefault) return -1;
				if (b.value === smartDefault) return 1;
				return 0;
			})
			.map((preset) => ({
				value: preset.value,
				label: preset.label,
				description: preset.description,
			}));

		while (true) {
			const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
				container.addChild(new Text(theme.fg("accent", theme.bold("Select a review preset"))));

				const selectList = new SelectList(items, Math.min(items.length, 10), {
					selectedPrefix: (text) => theme.fg("accent", text),
					selectedText: (text) => theme.fg("accent", text),
					description: (text) => theme.fg("muted", text),
					scrollInfo: (text) => theme.fg("dim", text),
					noMatch: (text) => theme.fg("warning", text),
				});

				selectList.onSelect = (item) => done(item.value);
				selectList.onCancel = () => done(null);

				container.addChild(selectList);
				container.addChild(new Text(theme.fg("dim", "Press enter to confirm or esc to go back")));
				container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

				return {
					render(width: number) {
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(data: string) {
						selectList.handleInput(data);
						tui.requestRender();
					},
				};
			});

			if (!result) return null;

			switch (result) {
				case "uncommitted":
					return { type: "uncommitted" };

				case "baseBranch": {
					const target = await showBranchSelector(ctx);
					if (target) return target;
					break;
				}

				case "commit": {
					const target = await showCommitSelector(ctx);
					if (target) return target;
					break;
				}

				case "custom": {
					const target = await showCustomInput(ctx);
					if (target) return target;
					break;
				}

				case "pullRequest": {
					const target = await showPrInput(ctx);
					if (target) return target;
					break;
				}

				default:
					return null;
			}
		}
	}

	async function showBranchSelector(ctx: ExtensionContext): Promise<ReviewTarget | null> {
		const branches = await getLocalBranches(pi);
		const defaultBranch = await getDefaultBranch(pi);

		if (branches.length === 0) {
			ctx.ui.notify("No branches found", "error");
			return null;
		}

		const sortedBranches = branches.sort((a, b) => {
			if (a === defaultBranch) return -1;
			if (b === defaultBranch) return 1;
			return a.localeCompare(b);
		});

		const items: SelectItem[] = sortedBranches.map((branch) => ({
			value: branch,
			label: branch,
			description: branch === defaultBranch ? "(default)" : "",
		}));

		const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Select base branch"))));

			const selectList = new SelectList(items, Math.min(items.length, 10), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});

			selectList.searchable = true;
			selectList.onSelect = (item) => done(item.value);
			selectList.onCancel = () => done(null);

			container.addChild(selectList);
			container.addChild(new Text(theme.fg("dim", "Type to filter • enter to select • esc to cancel")));
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		});

		if (!result) return null;
		return { type: "baseBranch", branch: result };
	}

	async function showCommitSelector(ctx: ExtensionContext): Promise<ReviewTarget | null> {
		const commits = await getRecentCommits(pi, 20);

		if (commits.length === 0) {
			ctx.ui.notify("No commits found", "error");
			return null;
		}

		const items: SelectItem[] = commits.map((commit) => ({
			value: commit.sha,
			label: `${commit.sha.slice(0, 7)} ${commit.title}`,
			description: "",
		}));

		const result = await ctx.ui.custom<{ sha: string; title: string } | null>((tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Select commit to review"))));

			const selectList = new SelectList(items, Math.min(items.length, 10), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});

			selectList.searchable = true;
			selectList.onSelect = (item) => {
				const commit = commits.find((c) => c.sha === item.value);
				done(commit ?? null);
			};
			selectList.onCancel = () => done(null);

			container.addChild(selectList);
			container.addChild(new Text(theme.fg("dim", "Type to filter • enter to select • esc to cancel")));
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		});

		if (!result) return null;
		return { type: "commit", sha: result.sha, title: result.title };
	}

	async function showCustomInput(ctx: ExtensionContext): Promise<ReviewTarget | null> {
		const result = await ctx.ui.editor(
			"Enter review instructions:",
			"Review the code for security vulnerabilities and potential bugs...",
		);

		if (!result?.trim()) return null;
		return { type: "custom", instructions: result.trim() };
	}

	async function showPrInput(ctx: ExtensionContext): Promise<ReviewTarget | null> {
		if (await hasPendingChanges(pi)) {
			ctx.ui.notify("Cannot checkout PR: you have uncommitted changes. Please commit or stash them first.", "error");
			return null;
		}

		const prRef = await ctx.ui.editor(
			"Enter PR number or URL (e.g. 123 or https://github.com/owner/repo/pull/123):",
			"",
		);

		if (!prRef?.trim()) return null;

		const prNumber = parsePrReference(prRef);
		if (!prNumber) {
			ctx.ui.notify("Invalid PR reference. Enter a number or GitHub PR URL.", "error");
			return null;
		}

		ctx.ui.notify(`Fetching PR #${prNumber} info...`, "info");
		const prInfo = await getPrInfo(pi, prNumber);

		if (!prInfo) {
			ctx.ui.notify(`Could not find PR #${prNumber}. Make sure gh is authenticated and the PR exists.`, "error");
			return null;
		}

		if (await hasPendingChanges(pi)) {
			ctx.ui.notify("Cannot checkout PR: you have uncommitted changes. Please commit or stash them first.", "error");
			return null;
		}

		ctx.ui.notify(`Checking out PR #${prNumber}...`, "info");
		const checkoutResult = await checkoutPr(pi, prNumber);

		if (!checkoutResult.success) {
			ctx.ui.notify(`Failed to checkout PR: ${checkoutResult.error}`, "error");
			return null;
		}

		ctx.ui.notify(`Checked out PR #${prNumber} (${prInfo.headBranch})`, "info");

		return {
			type: "pullRequest",
			prNumber,
			baseBranch: prInfo.baseBranch,
			title: prInfo.title,
		};
	}

	async function executeReview(ctx: ExtensionCommandContext, target: ReviewTarget, useFreshSession: boolean): Promise<void> {
		if (reviewOriginId) {
			ctx.ui.notify("Already in a review. Use /end-review to finish first.", "warning");
			return;
		}

		if (useFreshSession) {
			const originId = ctx.sessionManager.getLeafId() ?? undefined;
			if (!originId) {
				ctx.ui.notify("Failed to determine review origin. Try again from a session with messages.", "error");
				return;
			}
			reviewOriginId = originId;

			const lockedOriginId = originId;

			const entries = ctx.sessionManager.getEntries();
			const firstUserMessage = entries.find(
				(e) => e.type === "message" && e.message.role === "user",
			);

			if (!firstUserMessage) {
				ctx.ui.notify("No user message found in session", "error");
				reviewOriginId = undefined;
				return;
			}

			try {
				const result = await ctx.navigateTree(firstUserMessage.id, { summarize: false, label: "code-review" });
				if (result.cancelled) {
					reviewOriginId = undefined;
					return;
				}
			} catch (error) {
				reviewOriginId = undefined;
				ctx.ui.notify(`Failed to start review: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}

			reviewOriginId = lockedOriginId;
			ctx.ui.setEditorText("");
			setReviewWidget(ctx, true);
			pi.appendEntry(REVIEW_STATE_TYPE, { active: true, originId: lockedOriginId });
		}

		const prompt = await buildReviewPrompt(pi, target);
		const hint = getUserFacingHint(target);
		const projectGuidelines = await loadProjectReviewGuidelines(ctx.cwd);

		let fullPrompt: string;
		if (projectGuidelines) {
			fullPrompt = `${projectGuidelines}\n\n---\n\n${prompt}`;
		} else {
			fullPrompt = `${DEFAULT_REVIEW_INSTRUCTIONS}\n\n---\n\n${prompt}`;
		}

		const modeHint = useFreshSession ? " (fresh session)" : "";
		ctx.ui.notify(`Starting review: ${hint}${modeHint}`, "info");

		pi.sendUserMessage(fullPrompt);
	}

	function parseArgs(args: string | undefined): ReviewTarget | { type: "pr"; ref: string } | null {
		if (!args?.trim()) return null;

		const parts = args.trim().split(/\s+/);
		const subcommand = parts[0]?.toLowerCase();

		switch (subcommand) {
			case "uncommitted":
				return { type: "uncommitted" };

			case "branch": {
				const branch = parts[1];
				if (!branch) return null;
				return { type: "baseBranch", branch };
			}

			case "commit": {
				const sha = parts[1];
				if (!sha) return null;
				const title = parts.slice(2).join(" ") || undefined;
				return { type: "commit", sha, title };
			}

			case "custom": {
				const instructions = parts.slice(1).join(" ");
				if (!instructions) return null;
				return { type: "custom", instructions };
			}

			case "pr": {
				const ref = parts[1];
				if (!ref) return null;
				return { type: "pr", ref };
			}

			default:
				return null;
		}
	}

	async function handlePrCheckout(ctx: ExtensionContext, ref: string): Promise<ReviewTarget | null> {
		if (await hasPendingChanges(pi)) {
			ctx.ui.notify("Cannot checkout PR: you have uncommitted changes. Please commit or stash them first.", "error");
			return null;
		}

		const prNumber = parsePrReference(ref);
		if (!prNumber) {
			ctx.ui.notify("Invalid PR reference. Enter a number or GitHub PR URL.", "error");
			return null;
		}

		ctx.ui.notify(`Fetching PR #${prNumber} info...`, "info");
		const prInfo = await getPrInfo(pi, prNumber);

		if (!prInfo) {
			ctx.ui.notify(`Could not find PR #${prNumber}. Make sure gh is authenticated and the PR exists.`, "error");
			return null;
		}

		ctx.ui.notify(`Checking out PR #${prNumber}...`, "info");
		const checkoutResult = await checkoutPr(pi, prNumber);

		if (!checkoutResult.success) {
			ctx.ui.notify(`Failed to checkout PR: ${checkoutResult.error}`, "error");
			return null;
		}

		ctx.ui.notify(`Checked out PR #${prNumber} (${prInfo.headBranch})`, "info");

		return {
			type: "pullRequest",
			prNumber,
			baseBranch: prInfo.baseBranch,
			title: prInfo.title,
		};
	}

	pi.registerCommand("review", {
		description: "Review code changes (PR, uncommitted, branch, commit, or custom)",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Review requires interactive mode", "error");
				return;
			}

			if (reviewOriginId) {
				ctx.ui.notify("Already in a review. Use /end-review to finish first.", "warning");
				return;
			}

			const { code } = await pi.exec("git", ["rev-parse", "--git-dir"]);
			if (code !== 0) {
				ctx.ui.notify("Not a git repository", "error");
				return;
			}

			let target: ReviewTarget | null = null;
			let fromSelector = false;
			const parsed = parseArgs(args);

			if (parsed) {
				if (parsed.type === "pr") {
					target = await handlePrCheckout(ctx, parsed.ref);
					if (!target) {
						ctx.ui.notify("PR review failed. Returning to review menu.", "warning");
					}
				} else {
					target = parsed;
				}
			}

			if (!target) {
				fromSelector = true;
			}

			while (true) {
				if (!target && fromSelector) {
					target = await showReviewSelector(ctx);
				}

				if (!target) {
					ctx.ui.notify("Review cancelled", "info");
					return;
				}

				const entries = ctx.sessionManager.getEntries();
				const messageCount = entries.filter((e) => e.type === "message").length;

				let useFreshSession = false;

				if (messageCount > 0) {
					const choice = await ctx.ui.select("Start review in:", ["Empty branch", "Current session"]);

					if (choice === undefined) {
						if (fromSelector) {
							target = null;
							continue;
						}
						ctx.ui.notify("Review cancelled", "info");
						return;
					}

					useFreshSession = choice === "Empty branch";
				}

				await executeReview(ctx, target, useFreshSession);
				return;
			}
		},
	});

	const REVIEW_SUMMARY_PROMPT = `We are switching to a coding session to continue working on the code.
Create a structured summary of this review branch for context when returning later.

Summarize the code review that was performed:

1. What was reviewed (files, changes, scope)
2. Key findings and their priority levels
3. The overall verdict
4. Any action items or recommendations

Append a message with this format at the end:

## Next Steps
1. [What should happen next to act on the review]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Code Review Findings

[Priority] Short Title

File: path/to/file.ext:line_number

\`\`\`
affected code snippet
\`\`\`

Preserve exact file paths, function names, and error messages.
`;

	pi.registerCommand("end-review", {
		description: "Complete review and return to original position",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("End-review requires interactive mode", "error");
				return;
			}

			if (!reviewOriginId) {
				const state = getReviewState(ctx);
				if (state?.active && state.originId) {
					reviewOriginId = state.originId;
				} else if (state?.active) {
					setReviewWidget(ctx, false);
					pi.appendEntry(REVIEW_STATE_TYPE, { active: false });
					ctx.ui.notify("Review state was missing origin info; cleared review status.", "warning");
					return;
				} else {
					ctx.ui.notify("Not in a review branch (use /review first, or review was started in current session mode)", "info");
					return;
				}
			}

			const summaryChoice = await ctx.ui.select("Summarize review branch?", [
				"Summarize",
				"No summary",
			]);

			if (summaryChoice === undefined) {
				ctx.ui.notify("Cancelled. Use /end-review to try again.", "info");
				return;
			}

			const wantsSummary = summaryChoice === "Summarize";
			const originId = reviewOriginId;

			if (wantsSummary) {
				const result = await ctx.ui.custom<{ cancelled: boolean; error?: string } | null>((tui, theme, _kb, done) => {
					const loader = new BorderedLoader(tui, theme, "Summarizing review branch...");
					loader.onAbort = () => done(null);

					ctx.navigateTree(originId!, {
						summarize: true,
						customInstructions: REVIEW_SUMMARY_PROMPT,
						replaceInstructions: true,
					})
						.then(done)
						.catch((err) => done({ cancelled: false, error: err instanceof Error ? err.message : String(err) }));

					return loader;
				});

				if (result === null) {
					ctx.ui.notify("Summarization cancelled. Use /end-review to try again.", "info");
					return;
				}

				if (result.error) {
					ctx.ui.notify(`Summarization failed: ${result.error}`, "error");
					return;
				}

				setReviewWidget(ctx, false);
				reviewOriginId = undefined;
				pi.appendEntry(REVIEW_STATE_TYPE, { active: false });

				if (result.cancelled) {
					ctx.ui.notify("Navigation cancelled", "info");
					return;
				}

				if (!ctx.ui.getEditorText().trim()) {
					ctx.ui.setEditorText("Act on the code review");
				}

				ctx.ui.notify("Review complete! Returned to original position.", "info");
			} else {
				try {
					const result = await ctx.navigateTree(originId!, { summarize: false });

					if (result.cancelled) {
						ctx.ui.notify("Navigation cancelled. Use /end-review to try again.", "info");
						return;
					}

					setReviewWidget(ctx, false);
					reviewOriginId = undefined;
					pi.appendEntry(REVIEW_STATE_TYPE, { active: false });
					ctx.ui.notify("Review complete! Returned to original position.", "info");
				} catch (error) {
					ctx.ui.notify(`Failed to return: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
			}
		},
	});
}
