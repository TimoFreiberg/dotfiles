/**
 * Timestamps Extension
 *
 * Shows timestamps:
 * - Before the prompt (when agent finishes and waits for input)
 * - After sending a message (when user submits input)
 *
 * Format: 2026-02-03 09:38:20+01
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

	// Get timezone offset in +HH or -HH format
	const offsetMinutes = now.getTimezoneOffset();
	const offsetSign = offsetMinutes <= 0 ? "+" : "-";
	const offsetHours = String(Math.abs(Math.floor(offsetMinutes / 60))).padStart(2, "0");

	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}`;
}

export default function (pi: ExtensionAPI) {
	// Show timestamp when user sends a message
	pi.on("input", async (event, ctx) => {
		if (!ctx.hasUI) return { action: "continue" };
		ctx.ui.notify(`[${formatTimestamp()}] Message sent`, "info");
		return { action: "continue" };
	});

	// Show timestamp when agent finishes and prompt is ready
	pi.on("agent_end", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.notify(`[${formatTimestamp()}] Ready for input`, "info");
	});

	// Also show timestamp on session start (initial prompt)
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.notify(`[${formatTimestamp()}] Ready for input`, "info");
	});
}
