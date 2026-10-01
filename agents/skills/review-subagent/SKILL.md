---
name: review-subagent
description: "Use when reviewing local changes — the working-copy diff, a branch, a commit, or a GitHub PR by number — with fresh reviewer subagents that return structured findings. Optionally checks the change against an approved plan or task specification."
---

You orchestrate: parse arguments, run `scope.py` to gather the diff, launch
reviewer subagents against the configured model group, and surface their reports
verbatim. You do not review code yourself.

## Dimensions

Three axes, one brief each:

| Axis | Question | Brief |
|---|---|---|
| **C** — Correctness & Intent | Does this do the right thing, and what demonstrates that? | `CORRECTNESS.md` |
| **S** — Style & Design | Is this well-shaped code for this codebase? | `STYLE.md` |
| **L** — Leanness & Simplification | Can we deliver the same value with less machinery? | `LEANNESS.md` |

C owns test *validity* — whether a test proves the right behavior, and what
would fail if the behavior were reverted. S owns test *shape*. L owns test
*machinery*. There is no separate test axis.

C also owns plan conformance when `--plan` or `--description` is supplied. It
reports a conformance verdict separately from severity, so a small-but-clear
requirement violation still blocks. S and L do not receive the intent source.

Documentation prose quality belongs to `editing-documentation`. C still covers
materially false documentation claims and dangerous omissions.

## Step 1: Parse `$ARGUMENTS`

**Scope subcommands** (mutually exclusive, optional — default is `trunk()..@` for jj or `<merge-base>..HEAD` for git):

- `uncommitted` — uncommitted working-copy changes (git mode misses untracked files; jj snapshots them)
- `commit <revset>` — jj revset, or git ref/range
- `since <baseline> [<final>]` — patch changes between frozen commits
- `branch <name>` — diff from `<name>` to current
- `file <path>` — uncommitted changes to one file
- `pr <number>` — GitHub PR diff + metadata

**Flags** (any order, all optional):

- `--difficulty routine|thorough|critical` — see **Choosing the level** below
  (`critical` only on explicit operator request)
- `--instructions "..."` — free-form review hints (e.g. "focus on XSS")
- `--plan <path>` — approved plan or specification artifact for the C reviewer
- `--description "..."` — inline task specification, as an alternative to `--plan`
- `--prior-findings <path>` — findings ledger from earlier rounds; switches
  reviewers to verification mode (see **Verification rounds**)

Each valued flag consumes exactly one following value. Reject duplicate flags,
unknown flags, missing values, extra positionals, and `--plan` together with
`--description`. On a parse failure, report the usage and stop.

Never infer intent from commit messages, code, or PR discussion. A caller with
an active plan must pass its path explicitly, so the reviewed version stays
visible and reproducible. Resolve `--plan` and `--prior-findings` to absolute
paths and confirm they are readable, but do not read them — the reviewer reads
them directly.

### Choosing the level

A level recorded in an approved plan wins; pass it through. Otherwise the
caller chooses before invoking, and when `--difficulty` is omitted you choose
after Step 2 using the `header` artifact (commit list and diffstat) plus what
the operator said about the change. Choose only between two levels, judging
by **risk, not size**:

- **routine** — local, low-risk changes whose correctness is easy to see:
  docs, comments, config values, renames and other mechanical edits (even
  large ones), a contained bug fix with a direct test, test-only changes. No
  change to a public interface, persisted or wire format, concurrency,
  security, or error-handling policy.
- **thorough** — everything else, including security, concurrency, FFI,
  memory safety, persisted-data migrations, and distributed-systems changes.

**critical** is operator-only. Use it only when the operator explicitly asks
for it in the current request (`--difficulty critical`, or naming
`review_critical`). Never select, propose, recommend, or record it in a plan
yourself, however risky the change looks.

Do not raise the level for size or caution alone. Print the chosen level with
a one-line reason in the selection notice so the operator can overrule it.

## Step 2: Gather scope

Strip the flags, then run:

```
uv run $HOME/dotfiles/agents/skills/review-subagent/scope.py [<subcommand> [<arg>]]
```

The script detects jj vs git, runs the right diff commands, and writes four
files to a fresh temp dir whose path it prints on stdout:

- `scope_summary` — one-line description (e.g. `default (trunk()..@, 3 changes)`)
- `header` — commit list + diffstat
- `diff` — unified diff for the reviewer prompt
- `pr_context` — PR metadata + comments (only for `pr <number>`; otherwise empty)

If it exits non-zero, surface its stderr and stop. It already handles the
empty-diff and missing-merge-base cases. An empty `since` interdiff exits zero
with no artifact path, so callers can short circuit successfully.

Keep the four artifacts on disk and pass their absolute paths to the reviewers.
Do **not** read `diff` or `pr_context` — loading them into your own context
defeats the purpose of the script. You may read `header` (commit list and
diffstat) when you must choose the level yourself.

## Step 3: Launch the reviewers

Select the model group from the difficulty: `review_routine`, `review_thorough`,
or `review_critical`. Launch `general-purpose` subagents with
`model_override: "mg:<group>"`. Never create one subagent definition per model.

- **routine** — **one** worker covering C, S and L together. One launch,
  `count: 1`, all three briefs.
- **thorough** — **one worker per dimension**, so three total. Three separate
  launches, each `count: 1`, each with one brief. Every dimension therefore
  starts at the group's first candidate and advances only on provider failure.
- **critical** (operator-only) — **C on every candidate; S and L once each**, for `N + 2`
  workers, where `N` is the number of candidates in the group (three in the
  configured review groups, giving five workers). Launch C with `count: N`, and
  launch S and L separately with `count: 1` each. Within C's counted batch,
  clone *i* starts at candidate *i*, so correctness is reviewed once per model;
  S and L start at the group's first candidate and advance only on provider
  failure, as in thorough mode.

Provider failover may advance an individual worker past its starting candidate;
that is expected and does not invalidate a report.

Do NOT read `CONTRACT.md` or the briefs yourself — hand each subagent absolute
paths and have it Read them. Build each prompt from the **Reviewer prompt**
template below, with `$GUIDANCE_FILES` set to that assignment's ordered path
list, one per line, under
`$HOME/dotfiles/agents/skills/review-subagent/` (substitute the concrete
absolute path; the subagent gets a plain string):

- **C:** `CONTRACT.md`, `CORRECTNESS.md`
- **S:** `CONTRACT.md`, `STYLE.md`
- **L:** `CONTRACT.md`, `LEANNESS.md`
- **routine:** `CONTRACT.md`, `CORRECTNESS.md`, `STYLE.md`, `LEANNESS.md`

Name the assigned axis explicitly in each prompt: set `$AXIS_NAME` and
`$AXIS_PREFIX` to that assignment's name and letter from the table above, or to
`Correctness & Intent, Style & Design and Leanness & Simplification` and
`C, S and L` for routine. Do not mention another axis's name in a shared
wrapper: reviewers adopt the name they are given and will report under the wrong
axis if it contradicts their brief.

Fill `$PLAN_PATH` and `$DESCRIPTION` only for C and routine; leave both empty
for S and L. At most one of them is ever non-empty. Fill `$PRIOR_FINDINGS_PATH`
for every reviewer when `--prior-findings` was given.

Each reviewer's final message is its report.

## Step 4: Surface reports verbatim

Print one compact notice naming the selected difficulty (with its one-line
reason when you chose it), model group, and expected worker count. Then emit
each assignment under
`## Reviewer: <worker-id> (<axis>)`, followed by the unchanged report body
beginning with `# Code Review`.

Keep every report and finding attributable: do not merge, re-sort, deduplicate,
majority-vote, or silently discard output. At critical, C returns several
independent reports; present all of them side by side rather than reconciling
them. S and L each return one report.

Validate each report independently, without inserting a worker label inside its
body. A valid report starts with `# Code Review`, contains `## Coverage`,
`## Findings` and `## Verdict` exactly once in that order, covers the expected
axis, uses only documented severities, and has an overall verdict consistent
with its critical and high findings. When an intent source was supplied, a C
report must also carry an intent checklist and a conformance verdict.

Treat an assignment as failed if the subagent errors, returns empty output, or
produces a malformed report. Emit a failure notice in that assignment's
position, naming the stage and error class. Bound the excerpt, strip control
characters, redact secret-like content, and never paste raw provider payloads.

A failure never suppresses successful reports, but an incomplete batch must
never be presented as a passed review. After fixing the operational cause,
start a fresh review round; this is not an automatic per-worker retry.

## Looping

As an adversarial gate during implementation: implement → commit → review →
fix → commit → verify. Commit between rounds so each reviewer sees a definite
state.

### Verification rounds

After the first round, review only the repair delta and pass the findings
ledger with `--prior-findings`. Reviewers then confirm each fix, check the
repair and its blast radius for regressions, and leave dispositioned findings
closed unless they cite new evidence. Without the ledger, every round is a
fresh full review that finds new nitpicks and never converges.

Cap rounds at 2 for `routine` and 4 for `thorough` or `critical`, counting the
first round. When the cap is reached with critical or high findings open, stop
and report them as unresolved with their evidence and recommendations, so a
follow-up session can pick them up. Stop early the same way when a finding
reverses an earlier accepted fix or the same material is re-litigated without
new evidence. Never downgrade a finding to make a round pass.

A conformance verdict is not severity-gated: any real `not conformant` item
blocks, however small. `clarification required` goes to the intent owner, never
to the reviewer's or implementer's own interpretation.

---

## Reviewer prompt

Use this text for each assignment's `prompt:`, with the marked
`$SUBSTITUTIONS` filled in.

```
You are an adversarial code reviewer. Your assigned axes are $AXIS_NAME ($AXIS_PREFIX).

Before doing anything else, Read the following files in order and follow them
exactly. They are your authoritative instructions for this review: the first is
the shared output contract, the rest are the axis briefs defining what to look
for and the calibration for each.

$GUIDANCE_FILES

## Task context

<scope_summary>$SCOPE_SUMMARY</scope_summary>

<instructions>$INSTRUCTIONS</instructions>

<plan_path>$PLAN_PATH</plan_path>

<intent_description>$DESCRIPTION</intent_description>

<diff_path>$DIFF_PATH</diff_path>

<pr_context_path>$PR_CONTEXT_PATH</pr_context_path>

<prior_findings_path>$PRIOR_FINDINGS_PATH</prior_findings_path>
```

## Examples

- `/review` → default scope; the level is chosen from the diffstat and
  announced with a reason.
- `/review --difficulty critical pr 50` → PR diff + metadata; C is reviewed once
  per model in `review_critical`, while S and L each have one reviewer.
- `/review --difficulty routine uncommitted` → one worker covering all three axes.
- `/review --plan docs/plan.md commit @-` → C also checks the change against the
  approved plan and returns a separate conformance verdict.
- `/review --instructions "Focus on XSS" branch foo` → branch scope with an
  additional explicit check for each reviewer.
