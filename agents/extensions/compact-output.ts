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

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createReadTool,
  createBashTool,
  createWriteTool,
  createGrepTool,
  createFindTool,
} from "@earendil-works/pi-coding-agent";
import {
  readToolRender,
  writeToolRender,
  bashToolRender,
  grepToolRender,
  findToolRender,
} from "./lib/compact-tool-render.ts";

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();

  // Override read, write, bash, grep, and find with compact rendering.
  // ls and edit are left as built-in (compact rendering overhead not worth it).

  const readDef = createReadTool(cwd);
  pi.registerTool({
    ...readDef,
    parameters: { ...(readDef.parameters as any) },
    ...readToolRender(cwd),
  });

  const writeDef = createWriteTool(cwd);
  pi.registerTool({
    ...writeDef,
    parameters: { ...(writeDef.parameters as any) },
    ...writeToolRender(cwd),
  });

  const bashDef = createBashTool(cwd);
  pi.registerTool({
    ...bashDef,
    parameters: { ...(bashDef.parameters as any) },
    ...bashToolRender(cwd),
  });

  const grepDef = createGrepTool(cwd);
  pi.registerTool({
    ...grepDef,
    parameters: { ...(grepDef.parameters as any) },
    ...grepToolRender(cwd),
  });

  const findDef = createFindTool(cwd);
  pi.registerTool({
    ...findDef,
    parameters: { ...(findDef.parameters as any) },
    ...findToolRender(cwd),
  });
}
