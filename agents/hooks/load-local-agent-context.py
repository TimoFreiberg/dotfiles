#!/usr/bin/env python3
"""Load private, per-repository agent instructions for global hooks."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

LOCAL_FILES = ("AGENTS.local.md", "CLAUDE.local.md")


def main_repo_root(start: Path) -> Path | None:
    """Resolve the main checkout root from a repo, jj workspace, or git worktree."""
    for directory in (start.resolve(), *start.resolve().parents):
        jj_repo = directory / ".jj" / "repo"
        if jj_repo.exists():
            if jj_repo.is_dir():
                return directory
            target = (directory / ".jj" / jj_repo.read_text().strip()).resolve()
            return target.parent.parent

        git_path = directory / ".git"
        if git_path.exists():
            try:
                result = subprocess.run(
                    [
                        "git",
                        "rev-parse",
                        "--path-format=absolute",
                        "--git-common-dir",
                    ],
                    cwd=directory,
                    check=True,
                    capture_output=True,
                    text=True,
                )
                common_dir = Path(result.stdout.strip())
                if common_dir:
                    return common_dir.parent
            except (OSError, subprocess.CalledProcessError):
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
                f"Loaded from `{name}` in the main repository checkout. These are "
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
    if os.environ.get("POLYTOKEN_HOOK_EVENT"):
        result: dict[str, str] = {"outcome": "allow"}
        if context:
            result["additional_context"] = context
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
    root = main_repo_root(cwd)
    loaded = load_context(root) if root else None
    emit(loaded[0] if loaded else None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
