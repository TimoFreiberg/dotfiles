---
name: review-subagent
description: "Use when reviewing local changes — the working-copy diff, a branch, a commit, or a GitHub PR by number — with fresh reviewer subagents that return structured findings."
---

You orchestrate: parse arguments, run `scope.py` to gather the diff, select the
configured reviewer model group, use subagents, and surface their reports
verbatim. You do not review code yourself. Use `review_routine` for routine,
`review_thorough` for thorough, and `review_critical` for critical. Do not
create a manifest, report-file transport, digest, or live mechanical reducer.

Review difficulty drives assignment:

- **routine**: one worker/report using the `review_routine` model group. The
  worker reads `CONTRACT.md`, `CORRECTNESS.md`, `DESIGN.md`, `TESTS.md`, and
  `LEANNESS.md` and covers C, S, T, and L together.
- **thorough**: four parallel workers using the `review_thorough` model group,
  with clone ordinals 1/2/3/4 mapped to Correctness & Security (C), Design &
  Structure (S), Test Correctness & Verification Adequacy (T), and Leanness &
  Simplification (L).
- **critical**: four parallel workers using the `review_critical` model group,
  with the same C/S/T/L clone mapping.

Documentation prose quality is owned by the `editing-documentation` skill and
its dedicated editor, not by code review. Correctness still covers materially
false documentation contracts and dangerous omissions.

Each reviewer reads its guidance from disk: the prompt hands it absolute paths
to `CONTRACT.md` and the axis brief for its dimension, and the subagent reads
them itself. This avoids cluttering the main session's context. Findings carry
axis prefixes (C1, S2, T1, L1) and are evidenced with a `file:line` and a quoted
snippet.

Surface valid reports verbatim and unmerged with worker labels. Keep each
report and finding attributable: do not deduplicate, majority-vote, or silently
discard output. Live validation is instruction-level; fixture helpers do not
wrap subagent output.

## Step 1: Parse `$ARGUMENTS`

**Subcommands** (mutually exclusive, optional — default scope is `trunk()..@` for jj or `<merge-base>..HEAD` for git):

- `uncommitted` — uncommitted working-copy changes (git mode misses untracked files; jj snapshots them)
- `commit <revset>` — jj revset, or git ref/range
- `since <baseline> [<final>]` — patch changes between frozen commits
- `branch <name>` — diff from `<name>` to current
- `file <path>` — uncommitted changes to one file
- `pr <number>` — GitHub PR diff + metadata

**Flags** (any order, all optional):

- `--instructions "..."` — free-form review hints (e.g. "focus on XSS")
- `--difficulty routine|thorough|critical` — reviewer group to use; omitted
  means `thorough`.

Validate duplicates, unknown flags, and missing values before scope work. Strip
`--difficulty` before invoking `scope.py`; never infer difficulty from the text
of the diff. Announce the selected difficulty, model group, and expected
assignment count in one selection/status notice.

If parsing fails (unknown subcommand, missing required arg, or unknown flag),
report the usage and stop.

## Step 2: Gather scope

Run `scope.py` with the subcommand + positional arg (`--instructions` is not
passed to it):

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
the empty-diff and missing-merge-base cases. The `since` scope is the exception:
an empty interdiff exits zero without an artifact path so callers can short
circuit successfully.

Do **not** read any generated scope files. Keep `scope_summary`, `header`, `diff`,
and `pr_context` on disk and pass their absolute paths to the reviewer
subagents. In particular, never load the diff or scope header into your own
context merely to summarize it in the chat transcript. The reviewers read the
artifacts directly.

## Step 3: Record the scope artifact paths

Keep the paths printed or returned by `scope.py` available for the reviewer
prompts. Do not print the contents of `scope_summary` or `header`; the review
reports are the useful output, and loading those files would defeat the
context-isolation purpose of the scope script.

## Step 4: Use subagents for the selected assignments

For `routine`, launch one `general-purpose` subagent with
`model_override: "mg:review_routine"`. The model group supplies ordered
provider failover for that one combined C+S+T+L assignment. For `thorough`,
launch `count: 4` parallel `general-purpose` subagents with
`model_override: "mg:review_thorough"`; for `critical`, do the same with
`model_override: "mg:review_critical"`. Map clone ordinals 1/2/3/4 to C/S/T/L.
Starting candidates rotate through the group, wrapping when needed; provider
failover may advance an individual clone. Do not create one named subagent
definition per model. Use the guidance lists below; routine receives all five
files.

Do NOT read `CONTRACT.md` or the axis briefs yourself — hand each subagent the
absolute paths and have it Read them. Build each dimension's `prompt:` from the
**Reviewer prompt** template below, filling in `$GUIDANCE_FILES` with that
dimension's ordered path list (one per line) and the `## Task context`
substitutions.

Guidance file lists (all under `$HOME/dotfiles/agents/skills/review-subagent/` —
substitute the concrete absolute path, no `$HOME`; the subagent gets a plain
string):

- **Correctness & Security (C):** `CONTRACT.md`, `CORRECTNESS.md`
- **Design & Structure (S):** `CONTRACT.md`, `DESIGN.md`
- **Test Correctness & Verification Adequacy (T):** `CONTRACT.md`, `TESTS.md`
- **Leanness & Simplification (L):** `CONTRACT.md`, `LEANNESS.md`

Substitutions in the task-context block: `$SCOPE_SUMMARY` (scope_summary),
`$INSTRUCTIONS` (flag value or empty), `$DIFF_PATH` (absolute path to the `diff`
file), and `$PR_CONTEXT_PATH` (absolute path to `pr_context` for `pr`, otherwise
empty).

Each reviewer's final message is its report.

## Step 5: Surface reports verbatim

Print one compact selection/status notice first, naming the selected difficulty,
model group, and expected assignment count. Then emit assignments in clone order
under `## Reviewer: <clone-or-worker-id> (<axis-or-combined>)`, followed by the
unchanged report body beginning with `# Code Review`. Emit a bounded,
stable-stage failure notice in a failed assignment's position. Do not add a
merged summary, re-sort findings, deduplicate reports, or vote.

A successful report is complete; any launch/runtime/validation failure is
`incomplete`, retains successful output, and is undetermined. These status and
failure rendering rules are prompt-level in this session, not a mechanically
validated live envelope. Diagnostic excerpts are bounded to 4096 UTF-8 bytes,
remove control characters, redact secret-like assignments/local-config content,
and never include raw provider payloads.

Per assignment, treat it as failed if the subagent errors, returns empty output,
or produces a malformed report. A valid report starts with `# Code Review`,
contains `## Coverage`, `## Findings`, and `## Verdict` exactly once in that
order, includes the expected axis coverage and verdict, uses only documented
finding severities, and has an overall verdict consistent with its critical and
high findings. Validate each report independently, without inserting a worker
label inside its body.

On failure, surface a stable stage/error classification under the assignment's
outer reviewer label. A failure never suppresses successful assignments, but an
incomplete batch must never be presented as a passed review. Require a fresh
outer review round after the operational cause is addressed; this is not an
automatic slot retry.

## Looping

When you use this skill as an adversarial reviewer gate during implementation,
run it in a loop: implement → commit → review → fix → repeat. Commit between
rounds so each reviewer sees the cumulative diff at a definite state. There is
no fixed round cap — keep going until the review passes. If you keep looping on
the same issue without converging, stop and escalate to the operator with the
outstanding findings.

---

## Reviewer prompt

Use this exact text for each dimension's `prompt:`, with the marked
`$SUBSTITUTIONS` filled in. `$GUIDANCE_FILES` is that dimension's ordered list
of absolute paths (see Step 4), one per line.

```
You are an adversarial code reviewer.

Before doing anything else, Read the following files in order and follow them
exactly. They are your authoritative instructions for this review: the first is
the shared output contract, the rest are the axis briefs defining what to look
for and the calibration for each.

$GUIDANCE_FILES

## Task context

<scope_summary>$SCOPE_SUMMARY</scope_summary>

<instructions>$INSTRUCTIONS</instructions>

<diff_path>$DIFF_PATH</diff_path>

<pr_context_path>$PR_CONTEXT_PATH</pr_context_path>
```

## Examples

- `/review` → default scope; C, S, T, and L reviewer subagents.
- `/review pr 50` → PR diff + metadata; same four-dimension split.
- `/review --instructions "Focus on XSS" branch foo` → branch scope with an
  additional explicit check for each reviewer.
