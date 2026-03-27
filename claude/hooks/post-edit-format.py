#!/usr/bin/env python3
"""Post-edit hook that runs configured formatters after Write/Edit.

Defaults: rustfmt for *.rs, uv format for *.py.

Per-project overrides: create .claude/format.json in the project root.
Maps glob patterns to commands. {file} is replaced with the edited path.

    {
      "*.c": "buck2 run //tools:clang-format -- -i {file}",
      "*.h": "buck2 run //tools:clang-format -- -i {file}",
      "*.py": null
    }

Project config merges with defaults. Set a pattern to null to disable it.
Formatter failures are reported but never block edits.
"""

import fnmatch
import json
import os
import subprocess
import sys

DEFAULTS = {
    "*.rs": "rustfmt {file}",
    "*.py": "uv format -q {file}",
    "*.ts": "npx prettier --write {file}",
    "*.tsx": "npx prettier --write {file}",
    "*.js": "npx prettier --write {file}",
    "*.jsx": "npx prettier --write {file}",
}


def find_config(start_path):
    """Walk up from start_path looking for .claude/format.json."""
    current = os.path.dirname(os.path.abspath(start_path))
    for _ in range(20):
        candidate = os.path.join(current, ".claude", "format.json")
        if os.path.isfile(candidate):
            with open(candidate, "r") as f:
                return json.load(f)
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return None


def find_formatter(file_path, config):
    """Return the formatter command for a file, or None."""
    basename = os.path.basename(file_path)
    # Project config overrides defaults; explicit null disables a default
    merged = dict(DEFAULTS)
    if config is not None:
        for pattern, command in config.items():
            if command is None:
                merged.pop(pattern, None)
            else:
                merged[pattern] = command
    for pattern, command in merged.items():
        if fnmatch.fnmatch(basename, pattern):
            return command
    return None


def main():
    try:
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, Exception):
        sys.exit(0)

    if input_data.get("tool_name") not in ("Write", "Edit"):
        sys.exit(0)

    file_path = input_data.get("tool_input", {}).get("file_path", "")
    if not file_path or not os.path.isfile(file_path):
        sys.exit(0)

    config = find_config(file_path)
    command = find_formatter(file_path, config)
    if not command:
        sys.exit(0)

    cmd = command.replace("{file}", file_path)
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            stderr = result.stderr.strip()
            if stderr:
                lines = stderr.split("\n")
                preview = "\n".join(lines[:5])
                if len(lines) > 5:
                    preview += f"\n... ({len(lines) - 5} more lines)"
                print(f"Formatter failed on {os.path.basename(file_path)}:\n{preview}")
    except subprocess.TimeoutExpired:
        print(f"Formatter timed out on {os.path.basename(file_path)}")
    except FileNotFoundError:
        print(f"Formatter not found: {cmd.split()[0]}")

    sys.exit(0)


if __name__ == "__main__":
    main()
