/**
 * Timestamps Extension
 *
 * Shows timestamps as a widget directly above the prompt:
 * - ">" timestamp when the agent finishes and waits for input
 * - "<" timestamp when the user sends a message (appended as second line)
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

	function showWidget(ctx: ExtensionContext, lines: string[]) {
		if (!ctx.hasUI) return;
		ctx.ui.setWidget("timestamps", lines);
	}

	// Show "ready" timestamp when agent finishes or session starts
	const onReady = async (_event: any, ctx: ExtensionContext) => {
		readyTimestamp = formatTimestamp();
		showWidget(ctx, [`> ${readyTimestamp}`]);
	};

	pi.on("agent_end", onReady);
	pi.on("session_start", onReady);

	// Append "sent" timestamp when user sends a message
	pi.on("input", async (_event, ctx) => {
		if (!ctx.hasUI) return { action: "continue" as const };
		showWidget(ctx, [`> ${readyTimestamp}`, `< ${formatTimestamp()}`]);
		return { action: "continue" as const };
	});
}
