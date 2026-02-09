/**
 * Timestamps Extension
 *
 * Shows timestamps:
 * - Above the prompt (widget) when the agent finishes and waits for input
 * - Below the user's prompt (chat message) when a message is sent
 *
 * Format: 2026-02-03 09:38:20+01
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

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

function showReadyTimestamp(ctx: ExtensionContext) {
	if (!ctx.hasUI) return;
	ctx.ui.setWidget("timestamp-ready", (tui, theme) => {
		return new Text(theme.fg("dim", formatTimestamp()), 0, 0);
	});
}

export default function (pi: ExtensionAPI) {
	// Render "sent" timestamps as dim text in the chat history
	pi.registerMessageRenderer("timestamp-sent", (message, _options, theme) => {
		return new Text(theme.fg("dim", message.content), 0, 0);
	});

	// When user sends a message, inject a "sent" timestamp below the prompt
	pi.on("before_agent_start", async (_event, _ctx) => {
		return {
			message: {
				customType: "timestamp-sent",
				content: formatTimestamp(),
				display: true,
			},
		};
	});

	// Show "ready" timestamp widget above the editor when agent finishes
	pi.on("agent_end", async (_event, ctx) => {
		showReadyTimestamp(ctx);
	});

	// Also on session start
	pi.on("session_start", async (_event, ctx) => {
		showReadyTimestamp(ctx);
	});
}
