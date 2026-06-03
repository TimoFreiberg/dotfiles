/**
 * Compact Tool Output Extension
 *
 * Makes tool output minimal in the default (collapsed) view:
 * a single line showing the tool name, args, and line count.
 * Ctrl+O still shows the full expanded output.
 *
 * Renders shared via lib/compact-tool-render.ts so container/index.ts
 * can register tools with both compact rendering AND container operations
 * without tool registration conflicts.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  createBashToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  readToolRender,
  writeToolRender,
  bashToolRender,
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
  registerCompactTool(
    pi,
    (cwd) =>
      createBashToolDefinition(cwd, {
        spawnHook: ({ command, cwd, env }) => ({
          command,
          cwd,
          env: {
            ...env,
            CI: "true",
            EDITOR: "false",
            GIT_EDITOR: "false",
            GIT_PAGER: "cat",
            JJ_EDITOR: "false",
            MANPAGER: "cat",
            PAGER: "cat",
          },
        }),
      }),
    bashToolRender(displayCwd),
    displayCwd,
  );
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
