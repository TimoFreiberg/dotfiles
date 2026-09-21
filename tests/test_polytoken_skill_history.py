from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "bin" / "polytoken-skill-history"
LOADER = importlib.machinery.SourceFileLoader("polytoken_skill_history", str(SCRIPT))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
assert SPEC
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[LOADER.name] = MODULE
LOADER.exec_module(MODULE)


class SkillHistoryTests(unittest.TestCase):
    def test_skill_names_only_reads_actual_tool_calls(self) -> None:
        record = {
            "message": {
                "content": "A prompt mentioning {'name': 'not-a-use'}",
                "blocks": [
                    {
                        "type": "text",
                        "text": "Another mention of the skill tool",
                    },
                    {
                        "type": "tool_use",
                        "name": "skill",
                        "input": {"name": "debug"},
                    },
                    {
                        "type": "tool_use",
                        "name": "read_file",
                        "input": {"name": "writing-tests"},
                    },
                ],
            }
        }
        self.assertEqual(list(MODULE.skill_names(record)), ["debug"])

    def test_skill_names_accepts_nested_legacy_payload(self) -> None:
        record = {
            "public_payload": {
                "item": {
                    "body": {
                        "content": [
                            {
                                "type": "tool_use",
                                "name": "Skill",
                                "input": {"value": {"skill": "jj"}},
                            }
                        ]
                    }
                }
            }
        }
        self.assertEqual(list(MODULE.skill_names(record)), ["jj"])

    def test_skill_names_accepts_current_flat_record(self) -> None:
        record = {
            "type": "assistant",
            "blocks": [
                {
                    "type": "tool_use",
                    "name": "skill",
                    "input": {"name": "writing-tests"},
                }
            ],
        }
        self.assertEqual(list(MODULE.skill_names(record)), ["writing-tests"])

    def test_flat_record_timestamp_wins_over_session_creation_date(self) -> None:
        record = {"emitted_at": "2026-09-21T00:01:00Z"}
        metadata = {"created_at": "2026-09-20T23:59:00Z"}
        self.assertEqual(MODULE.record_day(record, metadata), "2026-09-21")

    def test_scan_streams_lines_and_aggregates_days(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "sessions"
            session = root / "session-one"
            session.mkdir(parents=True)
            (session / "session.json").write_text(
                json.dumps({"project_path": str(Path(directory) / "project")})
                + "\n",
                encoding="utf-8",
            )
            records = [
                {
                    "committed_at": "2026-09-20T23:59:00Z",
                    "message": {
                        "blocks": [
                            {
                                "type": "tool_use",
                                "name": "skill",
                                "input": {"name": "debug"},
                            }
                        ]
                    },
                },
                {
                    "committed_at": "2026-09-21T00:01:00Z",
                    "message": {
                        "blocks": [
                            {
                                "type": "tool_use",
                                "name": "skill",
                                "input": {"name": "debug"},
                            },
                            {
                                "type": "tool_use",
                                "name": "skill",
                                "input": {"name": "polytoken:custom"},
                            },
                        ]
                    },
                },
            ]
            (session / "log.jsonl").write_text(
                "\n".join(json.dumps(record) for record in records)
                + "\nnot json\n",
                encoding="utf-8",
            )

            skills, stats = MODULE.scan_sessions(root, MODULE.SkillResolver(Path(directory)))

        self.assertEqual(stats.sessions, 1)
        self.assertEqual(stats.malformed_lines, 1)
        self.assertEqual(skills["debug"].uses, 2)
        self.assertEqual(skills["debug"].dates, {"2026-09-20": 1, "2026-09-21": 1})
        self.assertEqual(skills["polytoken:custom"].dates, {"2026-09-21": 1})

    def test_project_skill_wins_and_namespaced_name_falls_back_to_global(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory) / "home"
            project = Path(directory) / "project"
            (home / ".config/polytoken/skills/global-skill").mkdir(parents=True)
            (project / ".claude/skills/local-skill").mkdir(parents=True)
            (home / ".config/polytoken/skills/global-skill/SKILL.md").write_text("global")
            (project / ".claude/skills/local-skill/SKILL.md").write_text("local")
            resolver = MODULE.SkillResolver(home)

            local = resolver.resolve("local-skill", str(project))
            global_skill = resolver.resolve("polytoken:global-skill", str(project))
            missing = resolver.resolve("missing", str(project))

        self.assertEqual(
            local,
            "project:" + str((project / ".claude/skills/local-skill/SKILL.md").resolve()),
        )
        self.assertEqual(
            global_skill,
            "global:" + str((home / ".config/polytoken/skills/global-skill/SKILL.md").resolve()),
        )
        self.assertEqual(missing, "not found")

    def test_report_includes_summary_and_per_day_history(self) -> None:
        usage = MODULE.SkillUsage()
        usage.add("2026-09-21", "global:$HOME/.config/polytoken/skills/jj/SKILL.md")
        skills = {"jj": usage}
        output = StringIO()
        with redirect_stdout(output):
            MODULE.print_report(Path("/tmp/sessions"), skills, MODULE.ScanStats(sessions=2))

        text = output.getvalue()
        self.assertIn("2 sessions · 1 uses · 1 skills", text)
        self.assertIn("jj", text)
        self.assertIn("2026-09-21 (1)", text)


if __name__ == "__main__":
    unittest.main()
