/**
 * Timestamps Extension
 *
 * Shows timestamps as notifications (persist greyed out in chat history):
 * - ">" when the agent finishes / session starts (with LLM response duration)
 * - "<" when the user sends a message
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

	// Track when the agent starts processing
	pi.on("agent_start", async (_event, _ctx) => {
		agentStartTime = Date.now();
	});

	// Show "ready" timestamp when session starts (no duration)
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		agentStartTime = 0;
		lastNotification = `> ${formatTimestamp()}`;
		ctx.ui.notify(lastNotification, "info");
	});

	// Show "ready" timestamp with LLM response duration when agent finishes
	pi.on("agent_end", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		lastNotification = `> ${formatTimestamp()}`;
		if (agentStartTime > 0) {
			const elapsed = Date.now() - agentStartTime;
			lastNotification += ` (${formatDuration(elapsed)})`;
			agentStartTime = 0;
		}
		ctx.ui.notify(lastNotification, "info");
	});

	// Prepend previous notification and append send timestamp
	pi.on("input", async (_event, ctx) => {
		if (!ctx.hasUI) return { action: "continue" as const };
		ctx.ui.notify(`${lastNotification}\n< ${formatTimestamp()}`, "info");
		return { action: "continue" as const };
	});
}
