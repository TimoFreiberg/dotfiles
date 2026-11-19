---
name: swarm
description: "Use when running several subagents whose output feeds other subagents, or that need to coordinate with each other while they run."
---

# Swarm

Subagents hand work to each other through files, not through your context:
you pass paths, they read what they need. `board` in this skill's directory
carries short messages between agents that are still running.

## Setup

Run `<this skill's directory>/board init <session ID> <task-name>`, with
the session ID from your system prompt. It prints the run directory (`DIR`),
inside the session's directory under `swarm/`. You are `lead`. Give each
subagent a short kebab-case name, and use `general-purpose` or
`general-purpose-mini`, since workers need shell, `shell_monitor`, and file
tools.

Agents that edit the same files at the same time need separate workspaces
(@skill:jj-workspaces).

## Brief each subagent with

Its name, the roster (each name with a one-line role), and this protocol with
the placeholders filled in, verbatim:

> **Team protocol.** You are `<name>`. Board: `<absolute path to board>`.
> Run directory: `<DIR>`.
> - Write anything another agent or the lead needs in full to
>   `<DIR>/artifacts/<name>/` with file tools. Your final response is a short
>   status (at most five lines) plus those paths, not their content.
> - To tell someone something, post one line that names the file:
>   `<board> post <DIR> <name> "@other <message> <path>"`. `@lead` reaches
>   the lead, `@all` everyone.
> - When you need input from another agent, post, then wait with
>   `shell_monitor` on `<board> check <DIR> <name>` (`retry_seconds: 10`,
>   `max_wait_seconds: 1800`), then run `<board> read <DIR> <name>`. Also
>   read the board after each major step.
> - Read only the artifacts you need.

## While they run

- Forward paths, not contents. Read an artifact yourself only when you have
  to judge it.
- To hear `@lead` posts while subagents work, run a background
  `shell_monitor` on `board check DIR lead`; its completion wakes you. Start
  a new one after each `board read DIR lead`.
- A finished subagent no longer reads the board. To continue its work, fork
  it with `resume_from` and point it at the posts it missed.
- `board read DIR lead --all` prints the whole history.
