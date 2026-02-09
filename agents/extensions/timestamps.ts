/**
 * Timestamps Extension
 *
 * Shows timestamps in the chat history (greyed out, not sent to LLM):
 * - ">" when the agent finishes / session starts (above next user message)
 * - "<" when the user sends a message (below user message)
 *
 * Also shows a live widget above the prompt for the current timestamps.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

const CUSTOM_TYPE = "timestamp";

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

	// Render timestamp messages as dim text in chat history
	pi.registerMessageRenderer(CUSTOM_TYPE, (message, _options, theme) => {
		return new Text(theme.fg("dim", message.content), 0, 0);
	});

	// Strip timestamp messages from LLM context
	pi.on("context", async (event, _ctx) => {
		return {
			messages: event.messages.filter(
				(m: any) => !(m.role === "custom" && m.customType === CUSTOM_TYPE)
			),
		};
	});

	// When agent finishes or session starts, record ready timestamp and show in chat + widget
	const onReady = async (_event: any, ctx: ExtensionContext) => {
		readyTimestamp = formatTimestamp();
		pi.sendMessage({
			customType: CUSTOM_TYPE,
			content: `> ${readyTimestamp}`,
			display: true,
		});
		if (ctx.hasUI) {
			ctx.ui.setWidget("timestamps", [`> ${readyTimestamp}`]);
		}
	};

	pi.on("agent_end", onReady);
	pi.on("session_start", onReady);

	// When user sends a message, inject "sent" timestamp and update widget
	pi.on("before_agent_start", async (_event, ctx) => {
		const sentTimestamp = formatTimestamp();
		if (ctx.hasUI) {
			ctx.ui.setWidget("timestamps", [`> ${readyTimestamp}`, `< ${sentTimestamp}`]);
		}
		return {
			message: {
				customType: CUSTOM_TYPE,
				content: `< ${sentTimestamp}`,
				display: true,
			},
		};
	});
}
