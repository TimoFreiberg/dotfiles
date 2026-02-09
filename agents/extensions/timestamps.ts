/**
 * Timestamps Extension
 *
 * Shows timestamps as notifications (persist greyed out in chat history):
 * - ">" when the agent finishes / session starts
 * - "<" when the user sends a message
 *
 * Format: > 2026-02-03 09:38:20+01
 *         < 2026-02-03 09:38:25+01
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

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

export default function (pi: ExtensionAPI) {
	let readyTimestamp = "";

	// Show "ready" timestamp when agent finishes or session starts
	const onReady = async (_event: any, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		readyTimestamp = formatTimestamp();
		ctx.ui.notify(`> ${readyTimestamp}`, "info");
	};

	pi.on("agent_end", onReady);
	pi.on("session_start", onReady);

	// Replace the "ready" notification with both timestamps
	pi.on("input", async (_event, ctx) => {
		if (!ctx.hasUI) return { action: "continue" as const };
		ctx.ui.notify(`> ${readyTimestamp}\n< ${formatTimestamp()}`, "info");
		return { action: "continue" as const };
	});
}
