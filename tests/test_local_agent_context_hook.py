from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import os
import sys
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "agents" / "hooks" / "load-local-agent-context.py"
LOADER = importlib.machinery.SourceFileLoader("local_agent_context_hook", str(SCRIPT))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
assert SPEC
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[LOADER.name] = MODULE
LOADER.exec_module(MODULE)


class LocalAgentContextHookTests(unittest.TestCase):
    def test_polytoken_events_emit_the_event_specific_context_field(self) -> None:
        expected_fields = {
            "session_start": "additional_context",
            "post_clear": "additional_context",
            "post_compaction": "append_to_output",
        }
        context = "Private repository instructions"

        for event, field in expected_fields.items():
            with self.subTest(event=event):
                output = StringIO()
                with patch.dict(os.environ, {"POLYTOKEN_HOOK_EVENT": event}):
                    with redirect_stdout(output):
                        MODULE.emit(context)
                self.assertEqual(
                    json.loads(output.getvalue()),
                    {"outcome": "allow", field: context},
                )

    def test_post_compaction_without_context_emits_allow_only(self) -> None:
        output = StringIO()
        with patch.dict(os.environ, {"POLYTOKEN_HOOK_EVENT": "post_compaction"}):
            with redirect_stdout(output):
                MODULE.emit(None)
        self.assertEqual(json.loads(output.getvalue()), {"outcome": "allow"})

    def test_non_polytoken_hook_output_remains_compatible(self) -> None:
        context = "Private repository instructions"
        output = StringIO()
        with patch.dict(os.environ, {}, clear=True):
            with redirect_stdout(output):
                MODULE.emit(context)
        self.assertEqual(
            json.loads(output.getvalue()),
            {
                "hookSpecificOutput": {
                    "hookEventName": "SessionStart",
                    "additionalContext": context,
                }
            },
        )


if __name__ == "__main__":
    unittest.main()
