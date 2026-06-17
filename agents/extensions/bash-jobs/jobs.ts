/**
 * In-memory background-job registry for the bash-jobs extension.
 *
 * Each job runs a bash command in its own detached process group, streaming the
 * FULL stdout+stderr to a per-job temp file while keeping the temp file as the
 * single source of truth for incremental polling.
 *
 * Why we spawn directly instead of reusing `createLocalBashOperations()`:
 *   pi's foreground bash backend hides the child pid behind `exec()`, exposing
 *   only an AbortSignal that triggers a single SIGTERM-to-the-tree. The task
 *   requires a real SIGTERM-then-SIGKILL escalation, which needs the pid. So we
 *   spawn the shell ourselves and mirror exactly what pi's backend does
 *   (detached process group via `setsid`, `kill(-pid, ...)` on the group),
 *   adding the SIGKILL fallback the backend lacks. This is the one place where
 *   reusing the backend can't meet the requirement honestly.
 *
 * Other design notes (fail-loud philosophy):
 * - The temp file holds the complete output and is the only buffer we keep, so
 *   a long-running noisy job can't grow memory without bound. The session-facing
 *   poll view reads a bounded tail from the file on demand.
 * - Output is appended to the temp file as it arrives. Readers (job_poll, the
 *   agent's `read` tool) can peek at the file at any time, even mid-run.
 * - A spawn hook (the same one foreground bash uses) injects env so backgrounded
 *   commands behave identically (CI=true, PAGER=cat, ...).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  truncateTail,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  getShellConfig,
  type BashSpawnContext,
  type BashSpawnHook,
} from "@earendil-works/pi-coding-agent";

export type JobStatus = "running" | "exited" | "aborted" | "failed";

export interface JobState {
  id: string;
  command: string;
  cwd: string;
  /** Absolute path to the temp file holding the FULL output. */
  fullOutputPath: string;
  status: JobStatus;
  /** Exit code once finished (null if killed by signal, undefined while running). */
  exitCode: number | null | undefined;
  /** Error message if the job failed to spawn or was killed. */
  error?: string;
  startedAt: number;
  endedAt?: number;
  /** Byte offset into the temp file already returned by a previous poll. */
  polledBytes: number;
}

/** Public, serializable view of a job (no internal stream/process handles). */
export interface JobView {
  id: string;
  command: string;
  cwd: string;
  fullOutputPath: string;
  status: JobStatus;
  exitCode: number | null | undefined;
  error?: string;
  startedAt: number;
  endedAt?: number;
  runtimeMs: number;
}

interface InternalJob extends JobState {
  child: ChildProcess;
  stream: WriteStream;
  /** Total bytes written to the temp file so far. */
  writtenBytes: number;
  /** Resolves when the process has fully exited and the file is flushed. */
  done: Promise<void>;
  /** Pending SIGKILL escalation timer, set while an abort is in progress. */
  killTimer?: NodeJS.Timeout;
}

function newJobId(): string {
  // Short, readable, collision-resistant enough for an in-memory registry.
  return `job_${randomBytes(4).toString("hex")}`;
}

function tempFilePath(id: string): string {
  return join(tmpdir(), `pi-bash-${id}.log`);
}

/** How long to wait after SIGTERM before escalating to SIGKILL. */
const SIGKILL_GRACE_MS = 2000;

export class JobRegistry {
  private jobs = new Map<string, InternalJob>();

  /**
   * Spawn a backgrounded bash command. Returns immediately with the job view;
   * the process keeps running and streaming to the temp file in the background.
   *
   * @param spawnHook same hook applied to foreground bash, so backgrounded
   *   commands get identical env (CI=true, PAGER=cat, ...).
   */
  spawn(
    command: string,
    cwd: string,
    spawnHook: BashSpawnHook,
    timeout?: number,
  ): JobView {
    const id = newJobId();
    const fullOutputPath = tempFilePath(id);
    const stream = createWriteStream(fullOutputPath);

    // Apply the same spawn hook foreground bash uses (env injection, etc.).
    const base: BashSpawnContext = { command, cwd, env: { ...process.env } };
    const resolved = spawnHook(base);

    // Use pi's own shell resolver so backgrounded commands run in the EXACT
    // same shell as foreground bash (/bin/bash, NOT $SHELL — pi is deliberate
    // about this). Diverging would let bashisms behave differently in the
    // background path.
    const { shell, args } = getShellConfig();
    // detached: true puts the child in its own process group so we can signal
    // the whole tree with kill(-pid, ...) — matching pi's foreground behavior.
    const child = spawn(shell, [...args, resolved.command], {
      cwd: resolved.cwd,
      detached: process.platform !== "win32",
      env: resolved.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const job: InternalJob = {
      id,
      command,
      cwd,
      fullOutputPath,
      status: "running",
      exitCode: undefined,
      startedAt: Date.now(),
      polledBytes: 0,
      child,
      stream,
      writtenBytes: 0,
      done: Promise.resolve(),
    };

    const onData = (data: Buffer) => {
      job.writtenBytes += data.length;
      stream.write(data);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    let timeoutHandle: NodeJS.Timeout | undefined;
    if (timeout !== undefined && timeout > 0) {
      timeoutHandle = setTimeout(() => {
        job.error = `timed out after ${timeout}s`;
        job.status = "failed";
        this.killTree(job, "SIGTERM");
      }, timeout * 1000);
    }

    job.done = new Promise<void>((resolve) => {
      const settle = async (exitCode: number | null) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (job.killTimer) {
          clearTimeout(job.killTimer);
          job.killTimer = undefined;
        }
        job.exitCode = exitCode;
        // If we already classified this job (aborted / timed-out failure),
        // keep that classification; otherwise it exited on its own.
        if (job.status === "running") job.status = "exited";
        job.endedAt = Date.now();
        await new Promise<void>((r) => stream.end(r));
        resolve();
      };

      child.on("error", (err) => {
        // Spawn-level failure (e.g. shell not found): fail loud, don't swallow.
        job.status = "failed";
        job.error = err.message;
        void settle(null);
      });
      child.on("close", (code) => {
        void settle(code);
      });
    });

    this.jobs.set(id, job);
    return toView(job);
  }

  get(id: string): JobView | undefined {
    const job = this.jobs.get(id);
    return job ? toView(job) : undefined;
  }

  list(): JobView[] {
    return [...this.jobs.values()].map(toView);
  }

  /**
   * Read output appended to the temp file since the previous poll, capped to a
   * bounded tail for the session view. Advances the per-job poll cursor.
   *
   * Reads the delta range straight from the temp file (rather than an in-memory
   * ring buffer) so the poll view and the agent's `read` of the full file can
   * never disagree about what the output is.
   */
  async readSincePoll(id: string): Promise<
    | {
        job: JobView;
        newOutput: string;
        newBytes: number;
        truncated: boolean;
        skippedBytes: number;
      }
    | undefined
  > {
    const job = this.jobs.get(id);
    if (!job) return undefined;

    const from = job.polledBytes;
    const to = job.writtenBytes;
    let newOutput = "";
    let truncated = false;
    let skippedBytes = 0;
    let consumed = 0;

    if (to > from) {
      const length = to - from;
      const buf = Buffer.alloc(length);
      const handle = await open(job.fullOutputPath, "r");
      let bytesRead = 0;
      try {
        ({ bytesRead } = await handle.read(buf, 0, length, from));
      } finally {
        await handle.close();
      }
      // `writtenBytes` is bumped synchronously in the data handler, but the
      // WriteStream flushes to disk asynchronously — so the file can hold fewer
      // bytes than `to` at this instant. Trust what we actually read, never the
      // requested length: decoding the unflushed tail would yield NUL padding,
      // and advancing the cursor past it would drop that output for good. The
      // not-yet-flushed bytes are simply picked up by the next poll.
      consumed = bytesRead;
      const raw = buf.subarray(0, bytesRead).toString("utf-8");
      const trunc = truncateTail(raw, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });
      newOutput = trunc.content;
      truncated = trunc.truncated;
      skippedBytes = trunc.totalBytes - trunc.outputBytes;
    }

    const newBytes = consumed;
    job.polledBytes = from + consumed;
    return { job: toView(job), newOutput, newBytes, truncated, skippedBytes };
  }

  /**
   * Kill a job: SIGTERM the process group, then escalate to SIGKILL after a
   * grace window if the process is still alive. Idempotent — aborting a job that
   * already finished is a no-op.
   */
  abort(id: string): JobView | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    if (job.status !== "running") return toView(job);

    job.status = "aborted";
    job.error = "aborted by job_abort";
    this.killTree(job, "SIGTERM");

    // If SIGTERM doesn't take, escalate to SIGKILL. The `done` promise (close
    // event) clears this timer if the process exits first.
    job.killTimer = setTimeout(() => {
      job.killTimer = undefined;
      if (this.jobs.get(id)?.endedAt === undefined) {
        this.killTree(job, "SIGKILL");
      }
    }, SIGKILL_GRACE_MS);

    return toView(job);
  }

  /** Kill every live job (used on session shutdown). Temp files are left on disk. */
  abortAll(): void {
    for (const job of this.jobs.values()) {
      if (job.status === "running") {
        job.status = "aborted";
        this.killTree(job, "SIGTERM");
      }
    }
  }

  /**
   * Signal the child's whole process group. On POSIX a detached child leads its
   * own group, so negating the pid signals every descendant. Falls back to
   * signaling just the child if the group send fails.
   */
  private killTree(job: InternalJob, signal: NodeJS.Signals): void {
    const pid = job.child.pid;
    if (pid === undefined) return;
    try {
      if (process.platform === "win32") {
        job.child.kill(signal);
      } else {
        process.kill(-pid, signal);
      }
    } catch {
      // Process group already gone, or we lost the race with natural exit.
      try {
        job.child.kill(signal);
      } catch {
        // Truly gone; nothing to signal.
      }
    }
  }
}

function toView(job: JobState): JobView {
  const end = job.endedAt ?? Date.now();
  return {
    id: job.id,
    command: job.command,
    cwd: job.cwd,
    fullOutputPath: job.fullOutputPath,
    status: job.status,
    exitCode: job.exitCode,
    error: job.error,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    runtimeMs: end - job.startedAt,
  };
}
