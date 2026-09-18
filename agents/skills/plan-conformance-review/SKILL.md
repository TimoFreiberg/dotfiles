---
name: plan-conformance-review
description: "Use when checking whether an implementation matches an approved plan, task specification, acceptance criteria, non-goals, or bounded deferrals — reviews intent conformance separately from code quality."
---

# Plan Conformance Review

Review a diff against its governing intent. This is independent of
`review-subagent`: C/S/T/L asks whether code is sound and lean; this skill asks
whether the change built the requested thing, avoided excluded work, and
respected approved decisions and deferrals.

## Invocation

Accept the same optional scope subcommands as `review-subagent`:

- default — `trunk()..@` for jj or merge-base to `HEAD` for git;
- `uncommitted`;
- `commit <revset>`;
- `since <baseline> [<final>]`;
- `branch <name>`;
- `file <path>`;
- `pr <number>`.

Require exactly one governing-intent source:

- `--plan <path>` — an approved plan or other specification artifact;
- `--description "..."` — an explicit inline task specification.

Also accept optional `--instructions "..."` review hints and
`--difficulty routine|thorough|critical`. Flags may appear in any order and
each valued flag consumes exactly one following value. Strip `--difficulty`
before invoking `scope.py`, and reject duplicate, unknown, malformed, or
missing-value flags before scope work. Difficulty omitted means `thorough`.
Do not infer risk from diff text.

Parse exactly one scope subcommand with its documented arity (`since` accepts
one or two positionals; the others have fixed arity), then reject duplicate
flags, extra positionals, missing values, or both intent flags. Do not infer
intent from commit messages, code, tests, PR discussion, or what seems
desirable. If neither intent source is supplied, report usage and stop. Callers
with an active saved plan must pass its artifact path explicitly; this keeps the
reviewed version visible and reproducible.

## Gather the diff

Run the existing scope helper with only the parsed scope subcommand and
positional arguments:

```text
uv run $HOME/dotfiles/agents/skills/review-subagent/scope.py [<scope>]
```

The helper prints a temp directory containing `scope_summary`, `header`, `diff`,
and `pr_context`. If it fails, surface stderr and stop. An empty `since`
interdiff is a successful short circuit.

Do not read generated scope artifacts into the main session. Preserve their
absolute paths for the reviewer. Resolve `--plan` to an absolute path and verify
that it is a readable file, but do not summarize it; the reviewer reads the
source directly.

## Run the selected conformance assignments

Select the model group from the difficulty: `review_routine` for routine,
`review_thorough` for thorough, and `review_critical` for critical. Routine
launches one `general-purpose` worker with `model_override: "mg:review_routine"`.
Thorough and critical launch three independent workers with identical
conformance inputs using `count: 3` and the corresponding group, labeled P1/P2/P3
by clone ordinal. Each clone starts at a different group candidate, and
provider failover may advance an individual clone. Do not create
model-specific named subagents.

Spawn the selected `general-purpose` subagents. Substitute concrete absolute
paths and values into this prompt:

```text
You are an adversarial implementation-conformance reviewer.

Before doing anything else, Read this authoritative review contract and follow
it exactly:

$HOME/dotfiles/agents/skills/plan-conformance-review/CONTRACT.md

## Task context

<scope_summary>$SCOPE_SUMMARY</scope_summary>
<instructions>$INSTRUCTIONS</instructions>
<intent_path>$PLAN_PATH</intent_path>
<intent_description>$DESCRIPTION</intent_description>
<diff_path>$DIFF_PATH</diff_path>
<pr_context_path>$PR_CONTEXT_PATH</pr_context_path>
```

Replace `$HOME` with the concrete absolute home path. Exactly one of
`<intent_path>` and `<intent_description>` must be non-empty.

## Surface the reports

Announce one compact selection/status notice first with the selected difficulty,
model group, and expected assignments. Then emit each successful report in
clone order under `## Reviewer: <clone-or-worker-id> (<replica>)`, preserving its
body verbatim beginning with `# Plan Conformance Review`. Emit bounded
stable-stage failure notices in the corresponding positions. Do not summarize,
merge, deduplicate, majority-vote, or silently suppress reports.

Validate each report independently: it starts with `# Plan Conformance Review`,
contains each required level-2 heading exactly once and in contract order, uses
only documented ledger statuses and finding tags, and ends with exactly one
allowed verdict. A successful report is complete; any launch/runtime/validation
failure makes the batch `incomplete` and `undetermined`, while retaining valid
output. An incomplete batch cannot pass and requires a fresh explicit outer
round after the operational cause is addressed. Live validation is deferred;
status behavior is an instruction-level contract.

When using this as an implementation gate, fix or explicitly rebut every
finding with evidence and rerun against a committed, definite scope. Any real
`missing`, `partial`, `scope-deviated`, `decision-violated`, or
`deferral-violated` item blocks conformance. `indeterminate` requires clarification
from the intent owner rather than reviewer or implementer invention.

## Examples

- `/plan-conformance-review --plan /tmp/approved-plan.md commit @-`
- `/plan-conformance-review branch feature --description "Add --verbose; preserve default output; do not add configuration files"`
- `/plan-conformance-review --instructions "Pay special attention to the approved persistence deferral" --plan docs/plan.md pr 50`
