#!/usr/bin/env python3
"""Stop hook: nudge the agent to journal if a turn did real work and never
called the journal skill.

Design:
- Read the transcript from `transcript_path` in the Stop payload.
- Walk backward to find the start of the current turn (last user-role text
  message that isn't one of our own injected nudges or a system-reminder).
- Scan assistant messages since then for (a) non-trivial tool use, (b) any
  invocation of the `journal`/`prowl:journal` skill.
- If (a) happened and (b) didn't, emit
    {"decision": "block", "reason": "<checklist prompt>"}
  so Claude gets one more inference pass with the checklist visible.
- Re-entry prevention: if our previous nudge already appeared in the turn
  (injected as a user-role tool_result-shaped message), don't nudge again.

Tunables near the top so they're easy to adjust.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------

# Tool names considered "real work" — at least one of these in the turn
# makes the turn journal-worthy. Pure Read/Glob/Grep/Agent/ToolSearch
# don't count.
WORK_TOOLS = {
    "Edit",
    "Write",
    "NotebookEdit",
    "Bash",  # Bash is work even if it's just `git status` — over-include
    # rather than under-include; trivial turns are cheap to skip via
    # the journal-itself decision.
}

# Skills that satisfy "journaled" — we cleared the nudge.
JOURNAL_SKILLS = {"journal", "prowl:journal"}

# Substrings that, if they appear in a Bash command's command string, mean
# the turn directly invoked the journal CLI (bypassing the Skill wrapper).
# Both nest and prowl variants are covered because the skill symlink resolves
# to the same script path under either repo layout.
JOURNAL_BASH_MARKERS = ("skills/journal/scripts/journal",)

# Marker text embedded in our block reason. Used to detect "did we already
# nudge this turn?" on re-entry. Must be stable and specific.
NUDGE_MARKER = "JOURNAL_NUDGE_v1"

# The actual prompt Claude sees when we block. Short checklist shape.
NUDGE_REASON = f"""{NUDGE_MARKER}

Before finalizing this turn: did any of these happen?

- A fork where multiple plausible paths existed and you picked one
- A correction or redirect from Timo
- A "worth remembering later" feeling about a generalization

If yes: call the `prowl:journal` skill (or `journal` in nest) now, then
finalize. Capture at the fork, not as wrap-up summary.

If no (routine work, no real judgment formed): just finalize. Not every
turn needs a journal entry.

This nudge is informational — it fires once per turn. Decide and proceed."""


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
    attachment, tool-result, or one of our injected nudges.

    A "real user text message" is:
    - type == "user"
    - message.role == "user"
    - message.content is a string OR a list containing a text block whose
      text is NOT our nudge marker and NOT wrapped in system-reminder tags
      that indicate a synthetic injection.

    We err on the side of calling something genuine — misclassifying an
    injected message as genuine means we might nudge once extra, which is
    cheap. Misclassifying a genuine message as injected would make us
    miss nudges, which is the bigger failure.
    """
    if entry.get("type") != "user":
        return False
    msg = entry.get("message") or {}
    if msg.get("role") != "user":
        return False
    content = msg.get("content")
    if isinstance(content, str):
        # Tool results sometimes arrive as string content; but those are
        # usually wrapped with role != "user" in practice. If a string
        # reaches us, treat as genuine unless it contains our marker.
        return NUDGE_MARKER not in content
    if isinstance(content, list):
        # Tool-result entries are user-role messages with content being
        # a list of tool_result blocks. Those aren't "genuine user text."
        # Genuine user text has at least one text block that's not our
        # injected nudge.
        has_text = False
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                text = block.get("text", "")
                if NUDGE_MARKER in text:
                    return False
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
      - did_work: bool
      - did_journal: bool
      - already_nudged: bool
    """
    did_work = False
    did_journal = False
    already_nudged = False

    for entry in entries[start + 1 :]:
        etype = entry.get("type")
        msg = entry.get("message") or {}
        content = msg.get("content")

        # Our previously-injected nudge shows up as either:
        # (a) a user-role message with text content containing the marker, or
        # (b) some harness-specific shape that still surfaces the marker text.
        # Check both.
        if isinstance(content, str) and NUDGE_MARKER in content:
            already_nudged = True
        elif isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "text" and NUDGE_MARKER in block.get("text", ""):
                    already_nudged = True
                elif btype == "tool_use":
                    name = block.get("name", "")
                    bi = block.get("input", {}) or {}
                    if name == "Skill":
                        skill = bi.get("skill", "")
                        if skill in JOURNAL_SKILLS:
                            did_journal = True
                        # Skills other than journal don't count as "work"
                        # on their own — they could be anything.
                    elif name == "Bash":
                        # Direct Bash invocations of the journal script
                        # clear the nudge too. Otherwise Bash is "work."
                        cmd = bi.get("command", "") or ""
                        if any(m in cmd for m in JOURNAL_BASH_MARKERS):
                            did_journal = True
                        else:
                            did_work = True
                    elif name in WORK_TOOLS:
                        did_work = True
                    # Tool calls that aren't in WORK_TOOLS (Read, Glob,
                    # Grep, Agent, ToolSearch, etc.) are ignored.

    return {
        "did_work": did_work,
        "did_journal": did_journal,
        "already_nudged": already_nudged,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0  # no payload, nothing to do

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

    # Decide whether to nudge.
    if state["already_nudged"]:
        return 0  # re-entry: we already nudged this turn, let it end
    if not state["did_work"]:
        return 0  # trivial turn, no need to nudge
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
