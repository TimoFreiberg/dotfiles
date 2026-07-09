---
name: review-subagent
description: "Use when reviewing local changes — the working-copy diff, a branch, a commit, or a GitHub PR by number — with fresh reviewer subagents that return structured findings."
---

You orchestrate: parse arguments, run `scope.py` to gather the diff, spawn the
reviewer subagents, and surface their reports verbatim. You do not review code
yourself.

Review is split across two axis groups, each dimension covered exactly once:

- Group 1 — C+S: Correctness & Security, Design & Structure.
- Group 2 — D+T: Documentation & Comments, Test Correctness.

Each group runs as one reviewer subagent. The reviewer reads its own guidance
from disk: the prompt hands it absolute paths to `CONTRACT.md` plus the axis
brief file(s) for that group, and the subagent reads them itself. This avoids
cluttering the main session's context. Findings carry axis prefixes (C1, S2,
D1, T3) and are evidenced with a `file:line` and a quoted snippet.

Reports are surfaced verbatim and unmerged, no dedup or verification stage.
That's the consumer's job.

When `--description` is provided, Group 1 additionally produces a
`## Plan alignment` section (the CONTRACT handles the format).

## Step 1: Parse `$ARGUMENTS`

**Subcommands** (mutually exclusive, optional — default scope is `trunk()..@` for jj or `<merge-base>..HEAD` for git):

- `uncommitted` — uncommitted working-copy changes (git mode misses untracked files; jj snapshots them)
- `commit <revset>` — jj revset, or git ref/range
- `branch <name>` — diff from `<name>` to current
- `file <path>` — uncommitted changes to one file
- `pr <number>` — GitHub PR diff + metadata

**Flags** (any order, all optional):

- `--instructions "..."` — free-form review hints (e.g. "focus on XSS")
- `--description "..."` — task spec; enables the Plan-alignment section on Group 1

If parsing fails (unknown subcommand, missing required arg, or unknown flag),
report the usage and stop.

## Step 2: Gather scope

Run `scope.py` with the subcommand + positional arg (no flags — `--instructions`
and `--description` are not passed to it):

```
uv run $HOME/dotfiles/agents/skills/review-subagent/scope.py [<subcommand> [<arg>]]
```

The script handles VCS detection (jj vs git), runs the right diff commands,
and writes four files to a fresh temp dir whose path it prints on stdout:

- `scope_summary` — one-line description (e.g. `default (trunk()..@, 3 changes)`)
- `header` — commit list + diffstat for the orchestrator's scope header
- `diff` — unified diff for the reviewer prompt
- `pr_context` — PR metadata + comments (only for `pr <number>`; otherwise empty)

If the script exits non-zero, surface its stderr and stop. It already handles
the empty-diff and missing-merge-base cases.

Read `scope_summary` and `header` with the `Read` tool for Step 3. Leave `diff`
on disk — the reviewers Read it directly, keeping the diff out of your context.
Read `pr_context` only if the subcommand was `pr`.

## Step 3: Print a brief scope header

Two lines in your normal response stream (NOT in the subagent's prompt or report):

- `Reviewing: <scope_summary>`
- `<header>` indented as-is (the script already formats commit list + diffstat)

## Step 4: Spawn the reviewer subagents

Spawn two reviewers in parallel:

- Group 1 (C+S) uses subagent type `reviewer-1`.
- Group 2 (D+T) uses subagent type `reviewer-2`.

Do not specify a model by default; let the selected reviewer subagent's own
configuration choose. Only pass a model override when the operator explicitly
asked for one.

Do NOT read `CONTRACT.md` or the axis briefs yourself — hand each subagent the
absolute paths and have it Read them. Build each group's `prompt:` from the
**Reviewer prompt** template below, filling in `$GUIDANCE_FILES` with that
group's ordered path list (one per line) and the `## Task context`
substitutions.

Guidance file lists (all under `$HOME/dotfiles/agents/skills/review-subagent/` —
substitute the concrete absolute path, no `$HOME`; the subagent gets a plain
string):

- **Group 1 (C+S):** `CONTRACT.md`, `CORRECTNESS.md`, `DESIGN.md`
- **Group 2 (D+T):** `CONTRACT.md`, `DOCUMENTATION.md`, `TESTS.md`

Substitutions in the task-context block: `$SCOPE_SUMMARY` (scope_summary),
`$INSTRUCTIONS` / `$DESCRIPTION` (flag values or empty), `$DIFF_PATH` (absolute
path to the `diff` file), `$PR_CONTEXT_PATH` (absolute path to `pr_context` if
the subcommand was `pr`, otherwise empty). Fill `$DESCRIPTION` only for Group 1;
Group 2 gets empty `<description>`.

Each reviewer's final message is its report.

## Step 5: Surface the reports verbatim

Print each group's report verbatim, in order (C+S first, D+T second), under a
label header naming the group, and nothing else between or around them:

    ## Reviewer: C+S

    <that reviewer's report, verbatim>

    ## Reviewer: D+T

    <that reviewer's report, verbatim>

Do not add commentary, summaries, merged findings, or re-sorting.

Per group, treat it as failed if any of:

- the subagent tool returned an error;
- the final message is empty or whitespace-only;
- the final message does not start with `# Code Review`.

On failure, surface that group's message (or the tool error) verbatim under a
`# Review failed (<group>)` heading. A failure in one group does NOT suppress
the other — always surface every group's result.

## Looping

When you use this skill as an adversarial reviewer gate during implementation,
run it in a loop: implement → commit → review → fix → repeat. Commit between
rounds so each reviewer sees the cumulative diff at a definite state. There is
no fixed round cap — keep going until the review passes. If you keep looping on
the same issue without converging, stop and escalate to the operator with the
outstanding findings.

---

## Reviewer prompt

Use this exact text for each group's `prompt:`, with the marked
`$SUBSTITUTIONS` filled in. `$GUIDANCE_FILES` is that group's ordered list of
absolute paths (see Step 4), one per line.

```
Before doing anything else, Read the following files in order and follow them
exactly. They are your authoritative instructions for this review: the first is
the shared output contract, the rest are the axis briefs defining what to look
for and the calibration for each.

$GUIDANCE_FILES

## Task context

<scope_summary>$SCOPE_SUMMARY</scope_summary>

<instructions>$INSTRUCTIONS</instructions>

<description>$DESCRIPTION</description>

<diff_path>$DIFF_PATH</diff_path>

<pr_context_path>$PR_CONTEXT_PATH</pr_context_path>
```

## Examples

- `/review` → default scope; 2 reviewer subagents (`reviewer-1` and `reviewer-2`).
- `/review pr 50` → PR diff + metadata; same 2-group split.
- `/review --description "Add a --verbose flag" branch foo` → scope the branch
  against a task spec; Group 1 (C+S) additionally emits Plan-alignment.
