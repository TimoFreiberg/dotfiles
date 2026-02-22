/**
 * Timestamps Extension
 *
 * Shows timestamps as notifications (persist greyed out in chat history):
 * - ">" when the agent finishes / session starts (with LLM response duration)
 * - "<" when the user sends a message
 *
 * While the agent is thinking, a running timer is shown in the "Working"
 * message above the prompt (e.g., "Working (3s)"), updating every second.
 *
 * Format: > 2026-02-03 09:38:20+01 (12s)
 *         < 2026-02-03 09:38:25+01
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function formatTimestamp(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	const hours = String(now.getHours()).padStart(2, "0");
	const minutes = String(now.getMinutes()).padStart(2, "0");
	const seconds = String(now.getSeconds()).padStart(2, "0");

	const offsetMinutes = now.getTimezoneOffset();
	const offsetSign = offsetMinutes <= 0 ? "+" : "-";
	const offsetHours = String(Math.abs(Math.floor(offsetMinutes / 60))).padStart(2, "0");

	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}`;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.round(ms / 1000);
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`;
}

export default function (pi: ExtensionAPI) {
	let lastNotification = "";
	let agentStartTime = 0;
	let timerInterval: ReturnType<typeof setInterval> | undefined;
	let paused = false;
	let pausedCtx: { ui: { setWorkingMessage(text?: string): void } } | undefined;

	function startTimer(ctx: { ui: { setWorkingMessage(text?: string): void } }) {
		stopTimer(ctx);

		pausedCtx = ctx;
		agentStartTime = Date.now();
		updateWorkingMessage(ctx);
		timerInterval = setInterval(() => updateWorkingMessage(ctx), 1000);
	}

	function updateWorkingMessage(ctx: { ui: { setWorkingMessage(text?: string): void } }) {

		if (agentStartTime <= 0 || paused) return;
		const elapsed = Date.now() - agentStartTime;
		ctx.ui.setWorkingMessage(`Working (${formatDuration(elapsed)})`);
	}

	function stopTimer(ctx: { ui: { setWorkingMessage(text?: string): void } }) {

		if (timerInterval !== undefined) {
			clearInterval(timerInterval);
			timerInterval = undefined;
		}
		ctx.ui.setWorkingMessage();
	}

	// Start running timer when the agent begins processing
	pi.on("agent_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		startTimer(ctx);
	});

	// Show "ready" timestamp when session starts (no duration)
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		agentStartTime = 0;
		lastNotification = `> ${formatTimestamp()}`;
		ctx.ui.notify(lastNotification, "info");
	});

	// Stop timer and show "ready" timestamp with duration when agent finishes
	pi.on("agent_end", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		const elapsed = agentStartTime > 0 ? Date.now() - agentStartTime : 0;
		stopTimer(ctx);
		lastNotification = `> ${formatTimestamp()}`;
		if (elapsed > 0) {
			lastNotification += ` (${formatDuration(elapsed)})`;
		}
		agentStartTime = 0;
		ctx.ui.notify(lastNotification, "info");
	});

	// Prepend previous notification and append send timestamp
	pi.on("input", async (_event, ctx) => {
		if (!ctx.hasUI) return { action: "continue" as const };
		ctx.ui.notify(`${lastNotification}\n< ${formatTimestamp()}`, "info");
		return { action: "continue" as const };
	});

	// Clean up timer on shutdown
	pi.on("session_shutdown", async (_event, ctx) => {
		stopTimer(ctx);
	});

	// Pause timer when answer UI is shown (avoid overwriting the working message)
	pi.events.on("answer:open", () => {
		paused = true;
		if (timerInterval !== undefined) {
			clearInterval(timerInterval);
			timerInterval = undefined;
		}
	});

	// Resume timer when answer UI closes
	pi.events.on("answer:close", () => {
		paused = false;
		if (pausedCtx && agentStartTime > 0) {
			updateWorkingMessage(pausedCtx);
			timerInterval = setInterval(() => updateWorkingMessage(pausedCtx!), 1000);
		}
	});

}
