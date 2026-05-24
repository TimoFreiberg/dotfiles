#!/usr/bin/env python3
"""UserPromptSubmit hook: tag each user prompt with the current timestamp.

The timestamp goes into hookSpecificOutput.additionalContext, so the
model sees it but the user's prompt is not modified in the UI.

Why: the agent has no built-in sense of wall-clock time between turns.
Stamping every prompt lets it notice when a reply lands hours later vs.
seconds later — useful both for adjusting tone after a long gap and for
not over-engineering a quick back-and-forth.

No state kept across invocations: each prompt carries its own absolute
timestamp, and prior prompts in the transcript carry theirs, so deltas
are inferrable on demand without race conditions across concurrent
sessions.
"""

from __future__ import annotations

import datetime
import json
import sys


def format_timestamp() -> str:
    # UTC only on purpose: avoids per-machine TZ variance (host vs.
    # sandbox vs. whichever machine sources this dotfile). The model
    # knows the user's local TZ from context if it ever needs to convert.
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    iso = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"[prompt received {iso}]"


def main() -> int:
    # Drain stdin so the hook host doesn't get SIGPIPE; we don't actually
    # use anything from the payload.
    try:
        sys.stdin.read()
    except Exception:
        pass

    payload = {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": format_timestamp(),
        }
    }
    json.dump(payload, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
