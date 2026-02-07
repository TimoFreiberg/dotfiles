---
name: dev-review-loop
description: "Orchestrates a dev→review→fix loop using child pi agents in tmux. Spawns a dev agent to build something, then iterates strict code review and fixes until the code passes or findings are rejected. Use when asked to run a review loop, multi-agent development, or iterative code improvement."
---

# Dev Review Loop Skill

Orchestrate child `pi` agent sessions in tmux to run a development → review → fix cycle. You (the parent agent) act as the **orchestrator**: you spawn child agents, monitor their progress, and report filtered summaries to the user.

## Overview

1. **Dev agent** — builds the requested feature/project
2. **Review agent** — performs a strict, adversarial code review
3. **Fix agent** — addresses reasonable review findings
4. Steps 2–3 repeat until the review passes or all findings are rejected

## Setup

### 1. Create tmux session

```bash
SKILL_DIR="<absolute path to this skill directory>"
AGENT_TMUX_SOCKET_DIR="${TMPDIR:-/tmp}/agent-tmux-sockets"
mkdir -p "$AGENT_TMUX_SOCKET_DIR"
SOCKET="$AGENT_TMUX_SOCKET_DIR/agent.sock"
SESSION="dev-review-loop"
LOOP_DIR="${TMPDIR:-/tmp}/dev-review-loop-$$"
mkdir -p "$LOOP_DIR"

tmux -S "$SOCKET" new -d -s "$SESSION" -n shell
```

Immediately tell the user:
```
To monitor the child agent session:
  tmux -S <socket> attach -t dev-review-loop
```

### 2. Determine the work directory

Use the current working directory or whatever directory the user specifies as `WORKDIR`.

## Prompts

Store these as shell variables for use in the agent invocations below.

### Review system prompt

```
REVIEW_SYSTEM="You are a ruthless, nitpicky code reviewer. Your job is to find EVERY issue:
- Security vulnerabilities, injection, path traversal, SSRF
- Missing or wrong input validation, boundary conditions
- Error handling gaps: transient failures, partial writes, race conditions
- Invalid/missing config handling, env var fallbacks
- Resource leaks, unclosed handles
- Logic errors, off-by-ones, nil/null dereferences
- API misuse, incorrect assumptions about library behavior
- Missing edge cases in tests

Be pessimistic. Assume inputs are adversarial. Assume the network is flaky.
Assume config is missing or garbage. Do NOT praise the code.

Output format:
- Start with VERDICT: PASS if there are genuinely no nontrivial issues, or VERDICT: FAIL if there are.
- Then list findings as [SEVERITY] description where severity is CRITICAL, HIGH, MEDIUM, or LOW.
- Be specific: reference file paths, line numbers, and concrete attack/failure scenarios.
- Do NOT invent issues that do not actually exist in the code. Every finding must be real and actionable."
```

### Fix append prompt

```
FIX_APPEND="You are a senior developer addressing code review feedback. For each finding:
1. Decide: is it REASONABLE (a real bug/risk) or FRIVOLOUS (stylistic nitpick, hypothetical with no real impact, or factually wrong)?
2. Fix all REASONABLE findings. Ignore FRIVOLOUS ones.
3. After making changes, output a summary:
   - ADDRESSED: list of findings you fixed and what you did.
   - REJECTED: findings you consider frivolous with a one-line reason each.
   - End with STATUS: ALL_FRIVOLOUS if you rejected ALL findings, or STATUS: FIXES_APPLIED if you fixed any."
```

## Running the Loop

### Round 0: Initial Development

Run the dev agent with the user's task prompt:

```bash
"$SKILL_DIR/scripts/run-child-agent.sh" "$SOCKET" "$SESSION" "$LOOP_DIR/dev-0.txt" "$WORKDIR" \
    --append-system-prompt "After completing the task, output a brief summary of what you built and where the key files are." \
    "$TASK_PROMPT"
```

Wait for it to finish:

```bash
"$SKILL_DIR/scripts/wait-for-done.sh" "$LOOP_DIR/dev-0.txt" 600
```

Then read `$LOOP_DIR/dev-0.txt` to get the dev output. **Report a brief summary to the user** (what was built, key files — don't dump the whole output).

### Round N: Review

Build the review prompt that tells the reviewer what to look at:

```
REVIEW_PROMPT="Review the code changes that were just made in the repository at $WORKDIR.
Here is context about what was built/changed:
<last 150 lines of previous dev output>

Examine the actual source files. Read every file that was created or modified. Provide your verdict and findings."
```

Run the review agent:

```bash
"$SKILL_DIR/scripts/run-child-agent.sh" "$SOCKET" "$SESSION" "$LOOP_DIR/review-N.txt" "$WORKDIR" \
    --system-prompt "$REVIEW_SYSTEM" \
    "$REVIEW_PROMPT"
```

Wait, then read the output. **Report the verdict and findings summary to the user.**

#### Exit condition: PASS

If the output contains `VERDICT: PASS`, the loop is done. Tell the user the review passed and summarize the total rounds.

#### Continue: FAIL

If `VERDICT: FAIL`, build the fix prompt:

```
FIX_PROMPT="The following code review findings were reported. Address them according to your instructions.
--- REVIEW FINDINGS ---
<review output>
--- END FINDINGS ---
Read the relevant files, apply fixes for reasonable findings, and output your summary."
```

Run the fix agent:

```bash
"$SKILL_DIR/scripts/run-child-agent.sh" "$SOCKET" "$SESSION" "$LOOP_DIR/fix-N.txt" "$WORKDIR" \
    --append-system-prompt "$FIX_APPEND" \
    "$FIX_PROMPT"
```

Wait, then read the output. **Report what was fixed and what was rejected to the user.**

#### Exit condition: ALL_FRIVOLOUS

If the fix output contains `STATUS: ALL_FRIVOLOUS`, the loop is done. Tell the user the dev agent rejected all remaining findings.

#### Continue: FIXES_APPLIED

Copy/rename the fix output as `dev-N.txt` for the next review round's context, and go back to the review step.

### Max Rounds

Default to **5 review rounds** (not counting the initial dev). If you hit this limit, tell the user the loop didn't converge and summarize the state.

## Reporting to the User

After EVERY child agent completes, give the user a **concise progress report**:

- `🔨 Round 0 — Dev`: "Built X. Key files: ..." (2-3 lines)
- `🔍 Round N — Review`: "VERDICT: FAIL — 3 findings: 1 CRITICAL (SQL injection in auth.py:42), 1 HIGH (...), 1 MEDIUM (...)"
- `🔧 Round N — Fix`: "Fixed 2 findings (SQL injection, missing validation). Rejected 1 as frivolous (naming style)."
- `✅ Loop complete`: "Passed review in round N" or "Dev rejected all findings in round N"

Do NOT dump full child agent output to the user. Read it yourself and summarize.

## Cleanup

When the loop finishes (or on error), kill the tmux session:

```bash
tmux -S "$SOCKET" kill-session -t "$SESSION"
```

Remind the user where the full logs are:
```
Full logs at: $LOOP_DIR/
  dev-0.txt, review-1.txt, fix-1.txt, ...
```

## Important Notes

- Always use `--no-session` for child pi invocations (they're ephemeral)
- The review agent gets `--system-prompt` (replaces default) so it only reviews, it doesn't code
- The fix agent gets `--append-system-prompt` (keeps coding tools + instructions)
- If a child agent times out (10 min default), report the failure and ask the user how to proceed
- The `$LOOP_DIR` uses `$$` (parent PID) to avoid collisions between runs
- You may adjust the model for review vs dev via `--model` if the user requests it
