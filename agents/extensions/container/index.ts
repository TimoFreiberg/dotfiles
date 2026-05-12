/**
 * Container Sandbox + Compact Output Extension
 *
 * The single source of truth for tool definitions when loaded alongside
 * compact-output.ts. Registers read/write/edit/bash/grep/find with:
 *   - Compact rendering (via lib/compact-tool-render.ts)
 *   - Container-aware execute (via lib/container-ops.ts)
 *
 * Strategy to avoid tool registration conflicts:
 *   - No tools registered at startup → no conflict with compact-output.ts
 *   - In session_start, register tools with compact rendering + container execute
 *     → replaces compact-output's tools silently
 *
 * Usage:
 *   /container [path]    — Start container mode (defaults to cwd)
 *   /local               — Back to local execution
 *
 * Config (merged, project takes precedence):
 *   ~/.pi/agent/extensions/container/container.json  (global)
 *   .pi/container.json                                (per-project)
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createBashTool,
  createGrepTool,
  createFindTool,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  readToolRender,
  writeToolRender,
  bashToolRender,
  grepToolRender,
  findToolRender,
} from "../lib/compact-tool-render.ts";
import {
  loadConfig,
  ensureImage,
  startContainer,
  stopContainer,
  createContainerBashOps,
  type ContainerState,
  wrapReadTool,
  wrapWriteTool,
  wrapEditTool,
  wrapBashTool,
} from "../lib/container-ops.ts";

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  const extensionDir = join(getAgentDir(), "extensions", "container");
  const cwd = process.cwd();

  let containerState: ContainerState | null = null;
  const getState = () => containerState;

  // -----------------------------------------------------------------------
  // Tool registrations — deferred to session_start to avoid conflict
  // with compact-output.ts's tool registrations during extension loading.
  //
  // session_start fires after all extensions are loaded, so compact-output
  // has already registered its tools. We replace them here with the same
  // compact rendering but container-aware execute.
  // -----------------------------------------------------------------------

  let toolsRegistered = false;

  pi.on("session_start", async () => {
    if (toolsRegistered) return;
    toolsRegistered = true;

    const readBase = createReadTool(cwd);
    pi.registerTool(
      wrapReadTool(cwd, { ...readBase, ...readToolRender(cwd) }, getState),
    );

    const writeBase = createWriteTool(cwd);
    pi.registerTool(
      wrapWriteTool(cwd, { ...writeBase, ...writeToolRender(cwd) }, getState),
    );

    const bashBase = createBashTool(cwd);
    pi.registerTool(
      wrapBashTool(cwd, { ...bashBase, ...bashToolRender(cwd) }, getState),
    );

    const grepBase = createGrepTool(cwd);
    pi.registerTool({
      ...grepBase,
      parameters: { ...(grepBase.parameters as any) },
      ...grepToolRender(cwd),
      async execute(
        id: string,
        params: any,
        signal: any,
        onUpdate: any,
        ctx: any,
      ) {
        // grep is read-only, works through bind mounts — no container ops needed
        return grepBase.execute(id, params, signal, onUpdate, ctx);
      },
    });

    const findBase = createFindTool(cwd);
    pi.registerTool({
      ...findBase,
      parameters: { ...(findBase.parameters as any) },
      ...findToolRender(cwd),
      async execute(
        id: string,
        params: any,
        signal: any,
        onUpdate: any,
        ctx: any,
      ) {
        return findBase.execute(id, params, signal, onUpdate, ctx);
      },
    });

    const editBase = createEditTool(cwd);
    pi.registerTool(wrapEditTool(cwd, editBase, getState));
  });

  // -----------------------------------------------------------------------
  // Handle user ! and !! commands via container ops
  // -----------------------------------------------------------------------

  pi.on("user_bash", () => {
    const s = getState();
    if (!s) return;
    return { operations: createContainerBashOps(s) };
  });

  // -----------------------------------------------------------------------
  // Commands
  // -----------------------------------------------------------------------

  pi.registerCommand("container", {
    description:
      "Start container mode: route tool calls into a Docker container",
    handler: async (args, ctx) => {
      if (containerState) {
        ctx.ui.notify(
          "Already in container mode. Use /local to switch back.",
          "warning",
        );
        return;
      }

      const config = loadConfig(ctx.cwd, extensionDir);
      const runtime = config.runtime || "docker";
      const image = config.image || "pi-container";
      const workspace = (args?.trim() || config.workspace || ctx.cwd) as string;

      if (!existsSync(workspace)) {
        ctx.ui.notify(`Workspace not found: ${workspace}`, "error");
        return;
      }

      ctx.ui.notify("Preparing container image...", "info");

      try {
        await ensureImage(runtime, image, extensionDir, config.dockerfile);
      } catch (err) {
        ctx.ui.notify(
          `Failed to prepare image: ${err instanceof Error ? err.message : err}`,
          "error",
        );
        return;
      }

      ctx.ui.notify("Starting container...", "info");

      try {
        containerState = await startContainer(
          runtime,
          image,
          config,
          workspace,
        );
      } catch (err) {
        ctx.ui.notify(
          `Failed to start container: ${err instanceof Error ? err.message : err}`,
          "error",
        );
        return;
      }

      ctx.ui.setStatus(
        "container",
        ctx.ui.theme.fg("accent", `🐳 ${containerState.name}`),
      );
      ctx.ui.notify(`Container mode: ${workspace}`, "info");
    },
  });

  pi.registerCommand("local", {
    description: "Exit container mode, route tool calls back to the host",
    handler: async (_args, ctx) => {
      if (!containerState) {
        ctx.ui.notify("Already in local mode.", "info");
        return;
      }

      await stopContainer(containerState);
      containerState = null;
      ctx.ui.setStatus("container", "");
      ctx.ui.notify("Local mode restored.", "info");
    },
  });

  // -----------------------------------------------------------------------
  // Cleanup on session end
  // -----------------------------------------------------------------------

  pi.on("session_shutdown", async () => {
    if (!containerState) return;
    await stopContainer(containerState);
    containerState = null;
  });

  // -----------------------------------------------------------------------
  // Tweak system prompt to reflect container context
  // -----------------------------------------------------------------------

  pi.on("before_agent_start", async (event) => {
    const s = getState();
    if (!s) return;

    return {
      systemPrompt:
        event.systemPrompt +
        "\n\nContainer mode is active. Bash commands run inside a Docker container. " +
        "File operations (read, write, edit) run inside the container as well.",
    };
  });
}
