---
name: review
description: Code review with scope selection. Use when the user wants to review code changes - uncommitted work, a specific commit, or a GitHub PR.
argument-hint: "[uncommitted | commit <hash> | pr <number> | branch <name> | file <path>]"
disable-model-invocation: true
allowed-tools:
  - Bash(git diff *)
  - Bash(git log *)
  - Bash(git show *)
  - Bash(git merge-base *)
  - Bash(git status *)
  - Bash(git branch *)
  - Bash(git rev-parse *)
  - Bash(gh pr diff *)
  - Bash(gh pr view *)
  - Bash(jj *)
  - Agent
  - Read
  - Glob
  - Grep
---

## Repo state

- VCS: !`test -d .jj && echo "jj" || echo "git"`
- Uncommitted changes: !`test -d .jj && jj diff --stat 2>/dev/null || git diff --stat HEAD 2>/dev/null`
- Current branch: !`test -d .jj && jj log -r @ --no-graph -T 'bookmarks' 2>/dev/null || git branch --show-current 2>/dev/null`
- Recent commits: !`test -d .jj && jj log --no-graph -r 'ancestors(@, 5)' -T 'change_id.shortest() ++ " " ++ description.first_line() ++ "\n"' 2>/dev/null || git log --oneline -5 2>/dev/null`

## Step 1: Determine review scope

| Argument | Example | Action |
|---|---|---|
| *(empty)* | `/review` | Use AskUserQuestion; use repo state above to tailor options |
| `uncommitted` | `/review uncommitted` | Review uncommitted changes |
| `commit <hash>` | `/review commit abc123` | Review that commit |
| `pr <number-or-url>` | `/review pr 42` | Review that GitHub PR |
| `branch <name>` | `/review branch main` | Review changes against that base branch |
| `file <path>` | `/review file src/foo.ts` | Review only that file's uncommitted changes |
| anything else | `/review check for XSS` | Use as custom review instructions |

When `$ARGUMENTS` is empty, use AskUserQuestion. Use the repo state above to make smart choices: hide "uncommitted" if working tree is clean, show the current branch name in the "branch" option description, etc.

When the user picks "commit", show recent commits and ask which. For "PR", ask for the number. For "branch", show branches and ask which.

## Step 2: Gather the diff

Use jj commands if VCS is "jj", git commands otherwise.

| Scope | git | jj |
|---|---|---|
| uncommitted | `git diff HEAD` + `git status` for untracked | `jj diff --git` |
| commit | `git show <hash>` | `jj diff --git -r <change-id>` |
| pr | `gh pr diff <n>` + `gh pr view <n>` + `gh pr view <n> --comments` | same (PRs are git-hosted) |
| branch | `git merge-base HEAD <branch>`, then `git diff <base>` | `jj diff --git -r 'latest(trunk())..@'` (adjust base as needed) |
| file | `git diff HEAD -- <path>` | `jj diff --git <path>` |

For PR reviews, also fetch `gh pr view <n> --comments` for reviewer discussion context.

## Step 3: Launch parallel review agents

Launch **four** Agent subagents in parallel (all in a single message so they run concurrently). Each agent receives:
- The full diff from Step 2
- Any PR context (title, description, comments) if this is a PR review
- Any custom instructions from `$ARGUMENTS`
- Its axis-specific guidelines (below)
- The shared review guidelines (below)

Each agent should use Read, Glob, and Grep to examine source files for context beyond the diff.

**Model:** pass `model: "opus"` to every Agent call in this skill (reviewers and verifiers). Reviews are serious business — don't let subagents silently downgrade to a smaller model.

### Shared review guidelines

Include the following in every subagent prompt.

<!-- "adversarially" appears to highly increase review thoroughness. -->
Conduct this review adversarially.

**What to flag** — issues that: (a) meaningfully impact correctness, performance, security, or maintainability; (b) are discrete and actionable; (c) don't demand rigor inconsistent with the rest of the codebase; (d) the author would likely fix if aware; (e) have provable impact on other parts of the code.

Note whether each finding is in newly added or pre-existing code. Non-critical findings in pre-existing code are informational.

**Priorities** — tag each finding: [P0] blocking, [P1] urgent, [P2] normal, [P3] low.

**Format** — number findings with the axis prefix (C1, D1, S1, T1, …). For each: priority tag, file path with line number, one-paragraph explanation, code snippets under 3 lines. Matter-of-fact tone. Don't stop at the first finding — list every qualifying issue. Ignore trivial style issues unless they obscure meaning.

### Agent 1: Correctness & Security (prefix: C)

Focus exclusively on correctness and security:
- Logic bugs, off-by-one errors, incorrect control flow
- Vulnerability classes (flag even if surrounding code has the same issues): memory safety (use-after-free, double-free, uninitialized reads, buffer overflows, unsound `unsafe`, lifetime issues); integer issues (overflow/truncation on cast, unchecked arithmetic, off-by-one); untrusted input (unvalidated input → shell commands, file paths, format strings, serialization boundaries — prefer escaping over sanitization); concurrency (data races, missing synchronization, lock ordering, TOCTOU); resource leaks (unclosed handles, missing cleanup on error paths, unbounded allocations)
- Error handling: unchecked errors, wrong error codes, logging-and-continue
- Fail-fast violations, silent degradation
- Incorrect assumptions about inputs, state, or ordering
- Behavioral regressions: changes to observable behavior that callers or consumers don't expect (changed return values, dropped side effects, altered invariants)
- Boundary/edge-case handling: nil/null, empty collections, zero-length strings, integer limits, Unicode edge cases

Ignore documentation, naming, and structural concerns — other agents cover those.

Number findings C1, C2, C3, …

### Agent 2: Documentation & Comments (prefix: D)

Focus exclusively on documentation and comments:
- Comments that restate what the code visibly does
- Comments that are inaccurate, outdated, or misleading relative to the code
- Doc comments / module-level docs that make claims not supported by the code — cross-reference every factual claim against actual code paths
- Missing documentation where the *why* is non-obvious
- TODO/FIXME/HACK comments: new ones that defer work that should be done in this diff, or existing ones in touched code that reference resolved issues or deleted code
- Dead references in comments: links to functions, files, tickets, or URLs that no longer exist
- Commit message / PR description accuracy relative to what the diff actually does

Read the full source files (not just the diff) to verify doc claims. Ignore correctness and structural concerns — other agents cover those.

Number findings D1, D2, D3, …

### Agent 3: Design & Structure (prefix: S)

Focus exclusively on design and structure:
- New dependencies: are they justified?
- Unnecessary abstractions, wrappers, or indirection
- API design: are interfaces clear, minimal, hard to misuse?
- Code organization: does the change belong where it's placed?
- Naming: do names accurately reflect behavior?
- Consistency with surrounding code patterns
- Layering / dependency direction: lower-level modules importing higher-level ones, circular dependencies, utilities reaching into application-specific code
- Visibility / exposure: internal helpers, types, or constants that are unnecessarily public, leaking implementation details
- In languages with expressive type systems (Rust, TypeScript, etc.): prefer types that enforce invariants over runtime checks — parse, don't validate
- Line-level readability: overly clever expressions (nested ternaries, long chains, dense comprehensions), functions too long or doing too many things, AI-generated verbosity where idiomatic code would be shorter
- Architectural legibility: can a reader follow the flow and predict what comes next? Surprising behavior should be surfaced through comments and eye-catching names, not hidden in generic abstractions

Ignore correctness bugs and documentation — other agents cover those.

Number findings S1, S2, S3, …

### Agent 4: Test Correctness (prefix: T)

Only review test code added or modified in the diff. Focus exclusively on test correctness:
- Tautological assertions: tests that pass regardless of the code under test (e.g., asserting a mock returns what it was told to return)
- Wrong expected values: assertions that encode incorrect expectations
- Tests that pass for the wrong reason: e.g., testing an error path that never triggers, or a condition that's always true
- Insufficient assertions: test sets up a scenario but doesn't verify the interesting part
- Flaky patterns: time-dependent checks, order-dependent assertions on unordered data, missing cleanup
- Not exercising production code: test helpers or fixtures that reimplement the logic under test, so the test passes without the real code path ever running
- Wrong test layer: unit tests with heavy mocking that only test implementation details — prefer fast, readable integration tests when they cover the same behavior without brittleness
- Overly specific assertions: testing exact error messages, snapshot-matching large objects when only a few fields matter, asserting internal state instead of observable behavior — correct today but brittle

If the diff contains no test code, return "No test code in this diff — no findings."

Ignore production code correctness and all other concerns — other agents cover those.

Number findings T1, T2, T3, …

## Step 4: Verify findings

Reviewer subagents produce false positives — claims about behavior that don't hold once you read the surrounding code, or concerns that are already handled elsewhere. Catch them before presenting.

Once all four reviewers return, collate their findings into a single numbered list (preserve the C/D/S/T axis prefixes) and spawn **one** verifier Agent with the whole list. Verification is a uniform task ("does this claim hold?"), so it doesn't suffer the attention-dilution problem that motivated splitting reviewers by axis — and a single verifier can also spot cross-axis duplicates.

The verifier receives:
- Every finding (verbatim: priority, file:line, explanation, snippet)
- The full diff from Step 2
- The verification prompt below

**Verifier prompt template:**

> You are verifying a batch of code review findings. Other subagents produced them; your job is to adversarially check each one.
>
> **Findings:**
> {all findings, numbered by axis prefix}
>
> **Diff under review:**
> {diff}
>
> For each finding, read the relevant source files (Read/Glob/Grep) to check the claim. Specifically:
> - Does the referenced code actually behave as the finding describes?
> - Is the concern already handled elsewhere (caller validates, type system enforces, framework guarantees)?
> - Is the finding based on a misreading of the diff or a misunderstanding of an API?
> - For correctness/security claims: can you construct a concrete input or sequence that triggers the bug? If not, the finding may be hypothetical.
>
> Also note cross-axis duplicates: two findings (e.g. C3 and S1) that describe the same issue from different angles.
>
> Default to keeping findings unless you're confident they're wrong — we'd rather show the user a weak finding than silently drop a real one.
>
> For each finding, reply with one of:
> - `<id>: HOLDS`
> - `<id>: HOLDS WITH CORRECTION — <short correction>`
> - `<id>: REJECTED — <one-paragraph reason>`
> - `<id>: DUPLICATE OF <other-id> — <one-sentence note>`
>
> Keep each verdict under 100 words.

## Step 5: Collate and present findings

Apply the verifier's verdicts:

1. `HOLDS` → keep as-is.
2. `HOLDS WITH CORRECTION` → keep, incorporate the correction into the explanation or priority.
3. `REJECTED` → move to a "Rejected during verification" section at the end with the verifier's reason.
4. `DUPLICATE` → merge into the referenced finding, keep the higher priority, note both perspectives.
5. Sort surviving findings by priority (P0 first, then P1, P2, P3), keeping the axis prefix.
6. Present the combined review in a single response. Include the "Rejected during verification" section at the end so the user can spot verifier mistakes.
7. End with per-axis verdicts and an overall verdict. For each axis, state "correct" or "needs attention" based on whether it has surviving P0/P1 findings. The overall verdict is "needs attention" if any axis is, "correct" otherwise.

