#!/usr/bin/env python3
"""Load private, per-repository agent instructions for global hooks."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys

LOCAL_FILES = ("AGENTS.local.md", "CLAUDE.local.md")


def repo_root(start: Path) -> Path | None:
    """Find the repository root containing the current working directory."""
    for directory in (start.resolve(), *start.resolve().parents):
        if (directory / ".jj" / "repo").exists() or (directory / ".git").exists():
            return directory
    return None


def load_context(root: Path) -> tuple[str, str] | None:
    """Load the canonical local file, falling back to the Claude-compatible name."""
    for name in LOCAL_FILES:
        path = root / name
        try:
            if not path.is_file():
                continue
            content = path.read_text().strip()
        except OSError:
            continue
        if content:
            context = (
                "## Local (uncommitted) project instructions\n\n"
                f"Loaded from `{name}` in the current repository checkout. These are "
                "this developer's private setup instructions; follow them with the "
                "same weight as committed project instructions.\n\n"
                f"{content}"
            )
            return context, name
    return None


def hook_input() -> dict[str, object]:
    try:
        payload = json.load(sys.stdin)
        return payload if isinstance(payload, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def emit(context: str | None) -> None:
    hook_event = os.environ.get("POLYTOKEN_HOOK_EVENT")
    if hook_event:
        result: dict[str, str] = {"outcome": "allow"}
        context_field = {
            "session_start": "additional_context",
            "post_clear": "additional_context",
            "post_compaction": "append_to_output",
        }.get(hook_event)
        if context and context_field:
            result[context_field] = context
    elif context:
        result = {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": context,
            }
        }
    else:
        result = {}
    print(json.dumps(result))


def main() -> int:
    payload = hook_input()
    cwd_value = payload.get("cwd")
    cwd = Path(cwd_value) if isinstance(cwd_value, str) else Path(
        os.environ.get("POLYTOKEN_PROJECT_DIR", os.getcwd())
    )
    root = repo_root(cwd)
    loaded = load_context(root) if root else None
    emit(loaded[0] if loaded else None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
