#!/usr/bin/env python3
"""Ensure the plan-task skill is loaded whenever operating in Polytoken's plan facet.

Uses a lightweight per-session marker file in the system temp directory instead of
parsing session logs:
- pre_model_turn: in `plan` facet, reminds the model to load `plan-task` until marked.
- pre_tool_use (skill): synchronously marks `plan-task` loaded when invoked.
- pre_tool_use (write_plan): blocks `write_plan` in `plan` facet if not yet loaded.
- pre_user_prompt: marks `plan-task` loaded if the user explicitly referenced it.
- post_clear / post_compaction: clears the marker so the skill is reloaded.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys
import tempfile

SKILL_NAME = "plan-task"
REMINDER = (
    f"You are in the `plan` facet and have not loaded the `{SKILL_NAME}` skill yet. "
    f"Call `skill(name=\"{SKILL_NAME}\")` immediately before exploring, brainstorming, "
    "answering, or calling any other tool."
)
DENY_REASON = (
    f"Load the `{SKILL_NAME}` skill (`skill(name=\"{SKILL_NAME}\")`) before calling "
    "`write_plan`, and follow its instructions (including running `grill-me` before drafting)."
)
USER_REF_RE = re.compile(
    r"(?:@s(?:kill)?:plan-task\b|<polytoken-ref\b[^>]*\btype=[\"']skill[\"'][^>]*\bname=[\"']plan-task[\"'])"
)


def read_payload() -> dict[str, object]:
    try:
        data = json.load(sys.stdin)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def marker_path() -> Path | None:
    session_id = os.environ.get("POLYTOKEN_SESSION_ID", "").strip()
    if not session_id:
        return None
    safe_id = re.sub(r"[^A-Za-z0-9_.-]", "_", session_id)
    return Path(tempfile.gettempdir()) / f"polytoken-plan-task-loaded-{safe_id}"


def is_loaded(marker: Path | None) -> bool:
    return marker is not None and marker.is_file()


def mark_loaded(marker: Path | None) -> None:
    if marker is None:
        return
    try:
        marker.touch(exist_ok=True)
    except OSError:
        pass


def clear_loaded(marker: Path | None) -> None:
    if marker is None:
        return
    try:
        marker.unlink(missing_ok=True)
    except OSError:
        pass


def skill_name_from_payload(payload: dict[str, object]) -> str | None:
    for key in ("input", "tool_input", "arguments"):
        obj = payload.get(key)
        if isinstance(obj, dict):
            name = obj.get("name")
            if isinstance(name, str):
                return name
    return None


def prompt_text_from_payload(payload: dict[str, object]) -> str:
    for key in ("prompt", "text", "content", "message"):
        val = payload.get(key)
        if isinstance(val, str):
            return val
    return ""


def emit(obj: dict[str, object]) -> int:
    print(json.dumps(obj))
    return 0


def main() -> int:
    event = os.environ.get("POLYTOKEN_HOOK_EVENT", "")
    facet = os.environ.get("POLYTOKEN_FACET_NAME", "")
    marker = marker_path()

    if event == "pre_model_turn":
        if facet == "plan" and not is_loaded(marker):
            return emit({"outcome": "proceed", "additional_context": REMINDER})
        return emit({"outcome": "proceed"})

    if event == "pre_tool_use":
        payload = read_payload()
        tool_name = payload.get("tool_name") or os.environ.get("POLYTOKEN_HOOK_MATCHER_SUBJECT", "")
        if tool_name == "skill":
            if skill_name_from_payload(payload) == SKILL_NAME:
                mark_loaded(marker)
            return emit({"outcome": "allow"})
        if tool_name == "write_plan":
            if facet == "plan" and not is_loaded(marker):
                return emit({"outcome": "deny", "reason": DENY_REASON})
            return emit({"outcome": "allow"})
        return emit({"outcome": "allow"})

    if event == "pre_user_prompt":
        payload = read_payload()
        if USER_REF_RE.search(prompt_text_from_payload(payload)):
            mark_loaded(marker)
        return emit({"outcome": "accept"})

    if event in ("post_clear", "post_compaction"):
        clear_loaded(marker)
        return emit({"outcome": "allow"})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
