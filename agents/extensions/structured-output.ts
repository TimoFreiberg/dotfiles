/**
 * Structured Output Tool
 *
 * Registers a model-callable `structured_output` tool that returns
 * SCHEMA-VALIDATED JSON and terminates the agent turn on the call
 * (`terminate: true`). This lets a subagent or skill end cleanly on a
 * machine-readable result instead of trailing prose that a parent process
 * has to regex-parse.
 *
 * How a parent reads the result in `--mode json`:
 *   Each event is one JSON line on stdout. When this tool runs, pi emits a
 *   `tool_execution_end` event whose `result` carries the tool's return
 *   value, including the validated payload under `result.details`. Example:
 *
 *     pi --mode json -e structured-output.ts -p "...emit structured output..." \
 *       | jq -c 'select(.type == "tool_execution_end"
 *                       and .toolName == "structured_output") | .result.details'
 *
 *   The `details` object is `{ status, result }` (see schema below). Because
 *   `terminate: true` fires when every finalized result in the batch is
 *   terminating, a turn that ends on this single tool call skips the extra
 *   follow-up LLM call — no trailing assistant prose to parse.
 *
 * configRole: NONE — this tool runs no LLM of its own; no model/role config.
 *
 * Schema choice: a flexible `{ status, result }` shape rather than the shipped
 * example's fixed headline/summary/actionItems. The point of this extension is
 * to be a foundation for arbitrary subagent/skill outputs, so the payload is an
 * open object (`Type.Any`) the model fills per request, plus a short free-text
 * `status`. Enums are intentionally avoided (the StringEnum/Google-compat
 * caveat in docs/extensions.md) to keep the schema portable and dependency-light.
 *
 * Follow-up (out of scope this round): wire this into the subagent tool in
 * agents/extensions/subagent/index.ts so a parent can request structured output
 * from a child run and read it off `result.details` without prose-parsing.
 */

import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface StructuredOutputDetails {
  status: string;
  result: unknown;
}

const structuredOutputTool = defineTool({
  name: "structured_output",
  label: "Structured Output",
  description:
    "Return a final, machine-readable result as schema-validated JSON and end the turn. " +
    "Use this as your LAST action only when structured / JSON-like / machine-readable " +
    "output is explicitly requested.",
  promptSnippet:
    "Emit a final structured (machine-readable) result as a terminating tool result",
  promptGuidelines: [
    "Call structured_output ONLY when the user (or the calling agent/skill) explicitly asks for structured output, JSON-like output, or a machine-readable result. Do not use it for ordinary prose answers.",
    "When you do call it, make it your FINAL action: put the complete answer in the `result` field and do not emit another assistant response in the same turn.",
    "Put the full machine-readable payload under `result` (any JSON-shaped value) and a short outcome word/phrase under `status` (e.g. 'ok', 'partial', 'no_results').",
  ],
  parameters: Type.Object({
    status: Type.String({
      description:
        "Short outcome indicator, e.g. 'ok', 'partial', 'error', 'no_results'.",
    }),
    result: Type.Any({
      description:
        "The machine-readable payload: any JSON-shaped value (object, array, string, number, etc.) holding the actual structured answer.",
    }),
  }),

  async execute(_toolCallId, params) {
    const details: StructuredOutputDetails = {
      status: params.status,
      result: params.result,
    };
    return {
      // Sent back to the LLM / shown as the tool result content.
      content: [{ type: "text", text: `structured_output (${params.status})` }],
      // Surfaced to parents via `tool_execution_end.result.details` in --mode json.
      details,
      // End the turn here when this is the only finalized result in the batch.
      terminate: true,
    };
  },

  renderResult(result, _options, theme) {
    const details = result.details as StructuredOutputDetails | undefined;
    if (!details) {
      const text = result.content[0];
      return new Text(text?.type === "text" ? text.text : "", 0, 0);
    }

    let body: string;
    try {
      body = JSON.stringify(details.result, null, 2);
    } catch {
      body = String(details.result);
    }

    const lines = [
      theme.fg("toolTitle", theme.bold(`structured_output: ${details.status}`)),
      theme.fg("muted", body),
    ];
    return new Text(lines.join("\n"), 0, 0);
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(structuredOutputTool);
}
