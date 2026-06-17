# bash-jobs

A drop-in replacement for pi's built-in `bash` tool that adds two capabilities
the stock tool lacks, unified into a single owner of the `bash` name:

1. **Backgroundable bash** — `bash(..., background: true)` returns immediately
   with a job id instead of blocking the agent. The command keeps running and
   streaming to a temp file; the agent polls/aborts it at will (the way a human
   watches a long-running terminal: notice → consider → poll → abort).
2. **Streaming to session AND file** — both foreground and background output
   stream the FULL stdout+stderr to a per-job temp file while the session sees
   only a capped tail (last 2000 lines / 50KB). No more piping through
   `tail -n60` and losing the ability to tell "slow" from "stuck".

## Tools

| Tool | Params | Returns |
|------|--------|---------|
| `bash` | `command: string`, `timeout?: number` (seconds), `background?: boolean` | Foreground: stdout+stderr (capped tail) + `details.fullOutputPath` when truncated. Background: `Started background job <id>` + temp-file path + poll hint, returned immediately. |
| `job_poll` | `jobId: string` | New output since the last poll (capped tail) + status line (`running` / `exited code N` / `aborted` / `failed`). Advances the per-job poll cursor. |
| `job_list` | _(none)_ | All jobs started this session, each with status, exit code, cwd, command. |
| `job_abort` | `jobId: string` | Sends SIGTERM to the job's process group, then SIGKILL after a 2s grace window if it ignores SIGTERM. No-op if already finished. |

### Job lifecycle contract

- `bash(background:true)` → job is `running`; `details.job` carries the id and
  `fullOutputPath`.
- `job_poll(id)` → returns only output appended **since the previous poll**
  (cursor-based delta), capped with `truncateTail` (keeps the LAST lines). The
  full output is always the temp file at `fullOutputPath` — `read` it for more.
- The job ends as:
  - `exited` (carries the real exit code; code 0 = success),
  - `aborted` (killed via `job_abort` or session shutdown), or
  - `failed` (spawn error, or `timeout` elapsed).
- Temp files live under `os.tmpdir()` as `pi-bash-<jobId>.log` and are **left on
  disk** after the job/session ends, so post-mortem inspection still works.

## Single ownership of `bash` (important)

Pi resolves duplicate tool registrations by **first-registration-wins**
(`ExtensionRunner.getAllRegisteredTools` / `getToolDefinition` iterate
extensions and keep the first match), and the resource loader emits a
`Tool "bash" conflicts with <ext>` diagnostic when two extensions register the
same name. So `bash` must have exactly one owner.

The `bash` registration was therefore **moved out of `compact-output.ts`**
(which still owns the compact renderers for `read`/`write`/`grep`/`find`) and
into this extension. This extension preserves both pieces of the old behavior:

- the **env spawn hook** (`CI=true`, `EDITOR=false`, `GIT_EDITOR=false`,
  `GIT_PAGER=cat`, `JJ_EDITOR=false`, `MANPAGER=cat`, `PAGER=cat`) — applied to
  both foreground and background spawns; and
- the **`bashToolRender` compact rendering** (imported from the shared
  `../lib/compact-tool-render.ts`).

Foreground bash delegates to pi's own `createBashToolDefinition`, so it inherits
the exact streaming/truncation/temp-file machinery and the `BashToolDetails`
result shape the compact renderer reads. Background jobs run through the
`JobRegistry` in `jobs.ts`.

## Why background jobs spawn directly (not via `createLocalBashOperations`)

`createLocalBashOperations().exec()` hides the child pid and only exposes an
AbortSignal that triggers a single SIGTERM-to-the-tree. The SIGTERM→SIGKILL
escalation `job_abort` promises needs the pid, so `jobs.ts` spawns the shell
itself and mirrors pi's foreground behavior (detached process group, signalling
`-pid`), adding the SIGKILL fallback the backend lacks. This is the one place
where reusing the backend can't meet the requirement.

## Files

- `index.ts` — registers `bash` (override), `job_poll`, `job_list`,
  `job_abort`; owns the shared env spawn hook; wires session lifecycle.
- `jobs.ts` — in-memory `JobRegistry`: spawn/poll/abort, per-job temp file,
  process-group kill with SIGKILL escalation.
