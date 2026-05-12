/**
 * Shared container operations.
 *
 * Extracted from container/index.ts so both compact-output.ts and
 * container/index.ts can use the same container lifecycle and operations
 * without duplicating code.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import crypto from "node:crypto";
import type {
  BashOperations,
  ReadOperations,
  WriteOperations,
  EditOperations,
} from "@earendil-works/pi-coding-agent";
import {
  createBashTool,
  createReadTool,
  createWriteTool,
  createEditTool,
} from "@earendil-works/pi-coding-agent";
import type { AgentTool } from "@earendil-works/pi-agent-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContainerConfig {
  /** Docker image name (default: "pi-container") */
  image?: string;
  /** Path to a Dockerfile to build the image (default: bundled Dockerfile) */
  dockerfile?: string;
  /** Container runtime command (default: "docker") */
  runtime?: string;
  /** Enable network access in the container (default: true) */
  network?: boolean;
  /** Path to dotfiles directory to mount read-only (default: ~/dotfiles, false to skip) */
  dotfiles?: string | false;
  /** Extra bind mounts: host paths to mount into the container */
  extraMounts?: Array<{ source: string; target: string; readonly?: boolean }>;
  /** Extra environment variables to pass to the container */
  env?: Record<string, string>;
  /** Container workspace root path (default: process.cwd()) */
  workspace?: string;
}

export interface ContainerState {
  name: string;
  runtime: string;
}

// ---------------------------------------------------------------------------
// Shell-safe quoting
// ---------------------------------------------------------------------------

export function squote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// Docker helpers
// ---------------------------------------------------------------------------

function dockerExecBuffer(runtime: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => errChunks.push(d));
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(
          new Error(
            `${runtime} failed (${code}): ${Buffer.concat(errChunks).toString().trim()}`,
          ),
        );
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
  });
}

export async function dockerExec(
  runtime: string,
  args: string[],
): Promise<string> {
  const buf = await dockerExecBuffer(runtime, args);
  return buf.toString();
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

export function loadConfig(cwd: string, extensionDir: string): ContainerConfig {
  const globalPath = join(extensionDir, "container.json");
  const projectPath = join(cwd, ".pi", "container.json");

  const global: ContainerConfig = {};
  const project: ContainerConfig = {};

  if (existsSync(globalPath)) {
    try {
      Object.assign(global, JSON.parse(readFileSync(globalPath, "utf-8")));
    } catch {
      // ignore malformed global config
    }
  }
  if (existsSync(projectPath)) {
    try {
      Object.assign(project, JSON.parse(readFileSync(projectPath, "utf-8")));
    } catch {
      // ignore malformed project config
    }
  }
  return { ...global, ...project };
}

// ---------------------------------------------------------------------------
// Image management
// ---------------------------------------------------------------------------

export async function ensureImage(
  runtime: string,
  image: string,
  extensionDir: string,
  dockerfile?: string,
): Promise<void> {
  try {
    await dockerExec(runtime, ["image", "inspect", image]);
    return;
  } catch {
    // doesn't exist, build it
  }

  const dfPath = dockerfile || join(extensionDir, "Dockerfile");
  if (!existsSync(dfPath)) {
    throw new Error(
      `Dockerfile not found at ${dfPath}. ` +
        `Set "dockerfile" in container.json or place a Dockerfile at that path.`,
    );
  }

  await dockerExec(runtime, [
    "build",
    "-t",
    image,
    "-f",
    dfPath,
    resolve(dfPath, ".."),
  ]);
}

// ---------------------------------------------------------------------------
// Container lifecycle
// ---------------------------------------------------------------------------

export async function startContainer(
  runtime: string,
  image: string,
  config: ContainerConfig,
  workspace: string,
): Promise<ContainerState> {
  const name = `pi-container-${crypto.randomBytes(4).toString("hex")}`;

  const dfSrc =
    config.dotfiles !== false
      ? resolve(config.dotfiles || join(homedir(), "dotfiles"))
      : null;

  const args: string[] = [
    "run",
    "-d",
    "--name",
    name,
    "-v",
    `${resolve(workspace)}:${resolve(workspace)}:rw`,
  ];

  if (dfSrc && existsSync(dfSrc)) {
    args.push("-v", `${dfSrc}:${dfSrc}:ro`);
  }

  for (const m of config.extraMounts || []) {
    const flags = m.readonly === false ? "rw" : "ro";
    args.push("-v", `${resolve(m.source)}:${m.target}:${flags}`);
  }

  if (config.network === false) {
    args.push("--network", "none");
  }

  for (const [k, v] of Object.entries(config.env || {})) {
    args.push("-e", `${k}=${v}`);
  }

  args.push(image, "sleep", "infinity");

  await dockerExec(runtime, args);
  return { name, runtime };
}

export async function stopContainer(state: ContainerState): Promise<void> {
  try {
    await dockerExec(state.runtime, ["kill", state.name]);
  } catch {
    // may already be stopped
  }
  try {
    await dockerExec(state.runtime, ["rm", "-f", state.name]);
  } catch {
    // may already be removed
  }
}

// ---------------------------------------------------------------------------
// Container file operations for tool delegation
// ---------------------------------------------------------------------------

export function createContainerReadOps(state: ContainerState): ReadOperations {
  const { runtime, name } = state;
  return {
    readFile: async (p) => dockerExecBuffer(runtime, ["exec", name, "cat", p]),
    access: async (p) => {
      await dockerExec(runtime, ["exec", name, "test", "-r", p]);
    },
    detectImageMimeType: async (p) => {
      try {
        const out = await dockerExec(runtime, [
          "exec",
          name,
          "file",
          "--mime-type",
          "-b",
          p,
        ]);
        const m = out.trim();
        return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(
          m,
        )
          ? m
          : null;
      } catch {
        return null;
      }
    },
  };
}

export function createContainerWriteOps(
  state: ContainerState,
): WriteOperations {
  const { runtime, name } = state;
  return {
    writeFile: async (p, content) => {
      const b64 = Buffer.from(content).toString("base64");
      await dockerExec(runtime, [
        "exec",
        name,
        "bash",
        "-c",
        `mkdir -p $(dirname ${JSON.stringify(p)}) && echo ${JSON.stringify(b64)} | base64 -d > ${JSON.stringify(p)}`,
      ]);
    },
    mkdir: async (dir) => {
      await dockerExec(runtime, ["exec", name, "mkdir", "-p", dir]);
    },
  };
}

export function createContainerEditOps(state: ContainerState): EditOperations {
  const r = createContainerReadOps(state);
  const w = createContainerWriteOps(state);
  return { readFile: r.readFile, access: r.access, writeFile: w.writeFile };
}

export function createContainerBashOps(state: ContainerState): BashOperations {
  const { runtime, name } = state;
  return {
    exec: (command, cwd, { onData, signal, timeout }) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          runtime,
          ["exec", "-w", cwd, name, "bash", "-c", command],
          { stdio: ["ignore", "pipe", "pipe"] },
        );

        let timedOut = false;
        const timer = timeout
          ? setTimeout(() => {
              timedOut = true;
              child.kill();
            }, timeout * 1000)
          : undefined;

        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("error", (e: Error) => {
          if (timer) clearTimeout(timer);
          reject(e);
        });

        const onAbort = () => child.kill();
        signal?.addEventListener("abort", onAbort, { once: true });

        child.on("close", (code: number | null) => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          if (signal?.aborted) reject(new Error("aborted"));
          else if (timedOut) reject(new Error(`timeout:${timeout}`));
          else resolve({ exitCode: code });
        });
      }),
  };
}

// ---------------------------------------------------------------------------
// Tool factory wrappers: create a tool that checks container state at runtime
// ---------------------------------------------------------------------------

/**
 * Wraps a read tool definition so its execute method delegates to a
 * container-read tool when `getState()` returns a non-null ContainerState.
 */
export function wrapReadTool(
  cwd: string,
  baseTool: AgentTool<any>,
  getState: () => ContainerState | null,
): AgentTool<any> {
  return {
    ...baseTool,
    async execute(
      id: string,
      params: any,
      signal: any,
      onUpdate: any,
      ctx: any,
    ) {
      const s = getState();
      if (!s) return baseTool.execute(id, params, signal, onUpdate, ctx);
      const tool = createReadTool(cwd, {
        operations: createContainerReadOps(s),
      });
      return tool.execute(id, params, signal, onUpdate, ctx);
    },
  };
}

/**
 * Same as wrapReadTool but for write.
 */
export function wrapWriteTool(
  cwd: string,
  baseTool: AgentTool<any>,
  getState: () => ContainerState | null,
): AgentTool<any> {
  return {
    ...baseTool,
    async execute(
      id: string,
      params: any,
      signal: any,
      onUpdate: any,
      ctx: any,
    ) {
      const s = getState();
      if (!s) return baseTool.execute(id, params, signal, onUpdate, ctx);
      const tool = createWriteTool(cwd, {
        operations: createContainerWriteOps(s),
      });
      return tool.execute(id, params, signal, onUpdate, ctx);
    },
  };
}

/**
 * Same as wrapReadTool but for edit.
 */
export function wrapEditTool(
  cwd: string,
  baseTool: AgentTool<any>,
  getState: () => ContainerState | null,
): AgentTool<any> {
  return {
    ...baseTool,
    async execute(
      id: string,
      params: any,
      signal: any,
      onUpdate: any,
      ctx: any,
    ) {
      const s = getState();
      if (!s) return baseTool.execute(id, params, signal, onUpdate, ctx);
      const tool = createEditTool(cwd, {
        operations: createContainerEditOps(s),
      });
      return tool.execute(id, params, signal, onUpdate, ctx);
    },
  };
}

/**
 * Same as wrapReadTool but for bash.
 */
export function wrapBashTool(
  cwd: string,
  baseTool: AgentTool<any>,
  getState: () => ContainerState | null,
): AgentTool<any> {
  return {
    ...baseTool,
    async execute(
      id: string,
      params: any,
      signal: any,
      onUpdate: any,
      ctx: any,
    ) {
      const s = getState();
      if (!s) return baseTool.execute(id, params, signal, onUpdate, ctx);
      const tool = createBashTool(cwd, {
        operations: createContainerBashOps(s),
      });
      return tool.execute(id, params, signal, onUpdate, ctx);
    },
  };
}
