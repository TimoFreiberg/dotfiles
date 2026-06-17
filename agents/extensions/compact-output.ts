/**
 * Compact Tool Output Extension
 *
 * Makes tool output minimal in the default (collapsed) view:
 * a single line showing the tool name, args, and line count.
 * Ctrl+O still shows the full expanded output.
 *
 * Renders are shared via lib/compact-tool-render.ts so other extensions can
 * reuse the same compact rendering without tool-registration conflicts.
 *
 * Owns the compact renderers for: read, write, grep, find. The `bash` tool is
 * owned by the bash-jobs extension (which reuses bashToolRender from the shared
 * lib) — see the note at its registration site below.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  createReadToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  readToolRender,
  writeToolRender,
  grepToolRender,
  findToolRender,
} from "./lib/compact-tool-render.ts";

type ToolFactory = (cwd: string) => ToolDefinition;

function registerCompactTool(
  pi: ExtensionAPI,
  factory: ToolFactory,
  render: Record<string, unknown>,
  displayCwd: string,
): void {
  const def = factory(displayCwd);
  pi.registerTool({
    name: def.name,
    label: def.label,
    description: def.description,
    parameters: def.parameters as any,
    promptSnippet: def.promptSnippet,
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      // Use the session's actual cwd at execution time, not process.cwd()
      const actualCwd =
        (ctx as ExtensionContext | undefined)?.cwd ?? displayCwd;
      const actual = factory(actualCwd);
      return actual.execute(toolCallId, params, signal, onUpdate);
    },
    ...render,
  });
}

export default function (pi: ExtensionAPI) {
  // process.cwd() is fine for display (path shortening), but the tool's
  // execute function must use ctx.cwd (the session workspace path) at
  // runtime — especially in pi-gui where the Electron process CWD differs
  // from the workspace.
  const displayCwd = process.cwd();

  registerCompactTool(
    pi,
    createReadToolDefinition,
    readToolRender(displayCwd),
    displayCwd,
  );
  registerCompactTool(
    pi,
    createWriteToolDefinition,
    writeToolRender(displayCwd),
    displayCwd,
  );
  // NOTE: the `bash` tool is intentionally NOT registered here. It is owned by
  // the bash-jobs extension (agents/extensions/bash-jobs/), which registers a
  // superset bash (foreground + backgroundable) while preserving this env spawn
  // hook and the bashToolRender compact rendering. Pi resolves duplicate tool
  // names by first-registration-wins and logs a conflict diagnostic, so `bash`
  // must have exactly one owner — see bash-jobs/index.ts for the rationale.
  registerCompactTool(
    pi,
    createGrepToolDefinition,
    grepToolRender(displayCwd),
    displayCwd,
  );
  registerCompactTool(
    pi,
    createFindToolDefinition,
    findToolRender(displayCwd),
    displayCwd,
  );
}
