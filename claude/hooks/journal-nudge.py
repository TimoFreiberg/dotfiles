#!/usr/bin/env python3
"""Stop hook: nudge the agent to journal if a turn did real work and never
called the journal skill.

Design:
- Bail out immediately if `stop_hook_active` is true — Claude Code is
  already continuing as a result of our prior nudge this turn, so firing
  again would loop.
- Read the transcript from `transcript_path` in the Stop payload.
- Walk backward to find the start of the current turn (last user-role text
  message).
- Scan assistant messages since then for (a) "work" tool uses (Edit/Write/
  NotebookEdit/non-recon Bash), (b) any invocation of the `journal`/
  `prowl:journal` skill.
- If (a) happened >= MIN_WORK_COUNT times and (b) didn't, emit
    {"decision": "block", "reason": "<nudge>"}
  so Claude gets one more inference pass with the nudge visible.

Tunables near the top so they're easy to adjust.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------

# Tool names considered "real work" without inspection. Bash is handled
# separately (see BASH_WORK_MARKERS) because most Bash calls today are
# recon (ls, git status, jj log, gh pr view) and over-counting inflates
# the nudge. Pure Read/Glob/Grep/Agent/ToolSearch don't count.
WORK_TOOLS = {
    "Edit",
    "Write",
    "NotebookEdit",
}

# Minimum "work" tool-use count in a turn before the nudge fires. Single
# actions (one commit, one edit) are usually execution of something already
# decided; judgment-formation turns accumulate several actions.
MIN_WORK_COUNT = 3

# Bash commands count as work only if they look side-effect-y. Matched
# against the command string as substrings (quick and good-enough —
# false positives are cheap, false negatives just skip a nudge).
BASH_WORK_MARKERS = (
    "jj commit",
    "jj squash",
    "jj rebase",
    "jj new",
    "jj abandon",
    "jj bookmark",
    "jj describe",
    "jj split",
    "jj duplicate",
    "jj push",
    "git commit",
    "git push",
    "git rebase",
    "git merge",
    "git reset",
    "git checkout",
    "git add",
    "git rm",
    "git mv",
    "gh pr create",
    "gh pr edit",
    "gh pr merge",
    "gh pr comment",
    "gh pr close",
    "gh issue create",
    "gh issue comment",
    "gh issue close",
    " > ",
    " >> ",
    "mv ",
    "rm ",
    "mkdir ",
    "cp ",
    "touch ",
    "chmod ",
    "ln ",
    "sed -i",
    "tee ",
)

# Skills that satisfy "journaled" — we cleared the nudge.
JOURNAL_SKILLS = {"journal", "prowl:journal"}

# Substrings that, if they appear in a Bash command's command string, mean
# the turn directly invoked the journal CLI (bypassing the Skill wrapper).
# Both nest and prowl variants are covered because the skill symlink resolves
# to the same script path under either repo layout.
JOURNAL_BASH_MARKERS = ("skills/journal/scripts/journal",)

# The actual prompt Claude sees when we block. One-liner shape — Claude
# has internalized what counts as a fork, so just the trigger + action.
NUDGE_REASON = (
    "this turn did work and didn't journal. "
    "If a fork or correction formed, call prowl:journal now."
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def load_transcript(path: Path) -> list[dict]:
    """Load a JSONL transcript. Returns a list of parsed entries."""
    entries: list[dict] = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        return []
    return entries


def is_genuine_user_text(entry: dict) -> bool:
    """True if this entry is a real user message (start of a turn), not an
    attachment or tool-result-only message.

    A "real user text message" is:
    - type == "user"
    - message.role == "user"
    - message.content is a string OR a list containing at least one text
      block (tool_result-only entries don't count).
    """
    if entry.get("type") != "user":
        return False
    msg = entry.get("message") or {}
    if msg.get("role") != "user":
        return False
    content = msg.get("content")
    if isinstance(content, str):
        return True
    if isinstance(content, list):
        has_text = False
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                has_text = True
            elif block.get("type") == "tool_result":
                # Pure tool_result turn — not a user text start.
                return False
        return has_text
    return False


def turn_start_index(entries: list[dict]) -> int:
    """Find the index of the most recent genuine user text message.

    Returns -1 if no such message found (shouldn't happen in practice —
    every session starts with one).
    """
    for i in range(len(entries) - 1, -1, -1):
        if is_genuine_user_text(entries[i]):
            return i
    return -1


def scan_turn(entries: list[dict], start: int) -> dict:
    """Scan entries since `start` (exclusive) for signals.

    Returns a dict with:
      - work_count: int — number of "work" tool uses this turn
      - did_journal: bool
    """
    work_count = 0
    did_journal = False

    for entry in entries[start + 1 :]:
        msg = entry.get("message") or {}
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") != "tool_use":
                continue
            name = block.get("name", "")
            bi = block.get("input", {}) or {}
            if name == "Skill":
                skill = bi.get("skill", "")
                if skill in JOURNAL_SKILLS:
                    did_journal = True
                # Skills other than journal don't count as "work"
                # on their own — they could be anything.
            elif name == "Bash":
                cmd = bi.get("command", "") or ""
                if any(m in cmd for m in JOURNAL_BASH_MARKERS):
                    did_journal = True
                elif any(m in cmd for m in BASH_WORK_MARKERS):
                    work_count += 1
                # Recon Bash (ls, git status, jj log, gh pr view, grep,
                # etc.) is ignored — over-counting inflates the nudge.
            elif name in WORK_TOOLS:
                work_count += 1
            # Tool calls that aren't in WORK_TOOLS (Read, Glob,
            # Grep, Agent, ToolSearch, etc.) are ignored.

    return {"work_count": work_count, "did_journal": did_journal}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0  # no payload, nothing to do

    # Re-entry guard: if Claude Code is already continuing because of our
    # prior Stop-hook block this turn, don't fire again.
    if payload.get("stop_hook_active"):
        return 0

    transcript_path = payload.get("transcript_path")
    if not transcript_path:
        return 0

    entries = load_transcript(Path(transcript_path))
    if not entries:
        return 0

    start = turn_start_index(entries)
    if start < 0:
        return 0

    state = scan_turn(entries, start)

    if state["work_count"] < MIN_WORK_COUNT:
        return 0  # light turn, no need to nudge
    if state["did_journal"]:
        return 0  # already journaled, condition cleared

    # Emit the block + reason. Claude gets one more inference pass.
    print(
        json.dumps(
            {
                "decision": "block",
                "reason": NUDGE_REASON,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
