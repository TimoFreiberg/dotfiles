from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

HERE = pathlib.Path(__file__).parent

def load(name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

pool = load("review_pool", HERE / "review_pool.py")

REFS = {
    "zai/glm-5.3-flash(high)",
    "codex/gpt-5.6-luna(xhigh)",
    "deepseek/deepseek-v4-flash(high)",
    "codex/gpt-5.6-sol(medium)",
}


def catalog_for(*references: str) -> dict:
    references = set(references or REFS)
    entries = []
    for reference in sorted(references):
        base, effort = pool.parse_model_reference(reference)
        provider, name = base.split("/", 1)
        entries.append({
            "name": base,
            "provider": provider,
            "reasoning": {"levels": [effort] if effort else []},
            "selectable": [base, reference] if effort else [base],
        })
    return {"default_model": "codex/gpt-5.6-luna", "default_small_model": "deepseek/deepseek-v4-flash", "models": entries}


class PoolTests(unittest.TestCase):
    def test_example_pool_matches_personal_order(self):
        config = pool.load_pool(HERE / "review-pool.example.yaml")
        self.assertEqual(config["workers"]["glm_flash"]["model"], "zai/glm-5.3-flash(high)")
        self.assertEqual(config["workers"]["codex_luna"]["model"], "codex/gpt-5.6-luna(xhigh)")
        self.assertEqual(config["workers"]["deepseek"]["model"], "deepseek/deepseek-v4-flash(high)")
        self.assertEqual(config["workers"]["codex_sol"]["model"], "codex/gpt-5.6-sol(medium)")
        self.assertEqual(config["levels"]["routine"]["workers"], ["glm_flash", "codex_luna", "deepseek"])
        self.assertEqual(config["levels"]["thorough"]["workers"], ["glm_flash", "codex_luna", "deepseek"])
        self.assertEqual(config["levels"]["critical"]["workers"], ["glm_flash", "codex_sol", "deepseek"])

    def test_local_file_is_complete_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "review-pool.local.yaml"
            path.write_text("""version: 1\nworkers:\n  local_one:\n    model: custom/workhorse(high)\n  local_two:\n    model: custom/second(high)\n  local_three:\n    model: custom/third(high)\nlevels:\n  routine:\n    strategy: ordered-fallback\n    workers: [local_one]\n  thorough:\n    strategy: parallel\n    workers: [local_one, local_two, local_three]\n  critical:\n    strategy: parallel\n    workers: [local_one, local_two, local_three]\n""")
            config = pool.load_pool(path)
            catalog = catalog_for("custom/workhorse(high)", "custom/second(high)", "custom/third(high)")
            result = pool.resolve_selection("thorough", "explicit", False, config_path=path, catalog=catalog)
            self.assertEqual(result["config_source"]["kind"], "local")
            self.assertEqual(result["workers"]["local_one"], "custom/workhorse(high)")
            self.assertNotIn("glm_flash", config["workers"])
            self.assertEqual([item["worker_id"] for item in result["assignments"]["code"]["assignments"]], ["local_one", "local_two", "local_three"])

    def test_duplicate_yaml_keys_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "pool.yaml"
            path.write_text("version: 1\nversion: 1\n")
            with self.assertRaises(pool.PoolError):
                pool.load_pool(path)

    def test_unhashable_yaml_key_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "pool.yaml"
            path.write_text("? [unhashable]\n: value\n")
            with self.assertRaises(pool.PoolError):
                pool.load_pool(path)

    def test_mixed_type_root_keys_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "pool.yaml"
            path.write_text("version: 1\nworkers: {}\nlevels: {}\n7: unexpected\n")
            with self.assertRaises(pool.PoolError):
                pool.load_pool(path)

    def test_malformed_local_file_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "review-pool.local.yaml"
            path.write_text("version: [not valid")
            with self.assertRaises(pool.PoolError):
                pool.load_pool(path)

    def test_rejects_unknown_keys_duplicate_workers_and_bad_model_refs(self):
        base = """version: 1\nworkers:\n  a:\n    model: provider/model(high)\nlevels:\n  routine:\n    strategy: ordered-fallback\n    workers: [a]\n  thorough:\n    strategy: parallel\n    workers: [a, b, c]\n  critical:\n    strategy: parallel\n    workers: [a, b, c]\n"""
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "pool.yaml"
            path.write_text(base.replace("workers:\n  a:", "unexpected: true\nworkers:\n  a:"))
            with self.assertRaises(pool.PoolError):
                pool.load_pool(path)
            path.write_text(base.replace("model(high)", "provider/model:secret"))
            with self.assertRaises(pool.PoolError):
                pool.load_pool(path)
            path.write_text(base.replace("workers: [a, b, c]", "workers: [a, a, c]", 1))
            with self.assertRaises(pool.PoolError):
                pool.load_pool(path)

    def test_catalog_duplicate_identity_fails_closed(self):
        document = catalog_for("provider/model(high)")
        document["models"].append(dict(document["models"][0]))
        with self.assertRaises(pool.PoolError):
            pool.normalize_catalog(document)

    def test_empty_cli_argument_fails_closed(self):
        with self.assertRaises(pool.PoolError):
            pool.parse_cli([""])

    def test_catalog_resolution_checks_reasoning_variant(self):
        document = catalog_for("provider/model(high)")
        catalog = pool.normalize_catalog(document)
        self.assertEqual(pool.reference_resolvable("provider/model(high)", catalog), (True, "resolved"))
        self.assertEqual(pool.reference_resolvable("provider/model(low)", catalog)[0], False)
        document["models"][0]["reasoning"]["levels"] = []
        catalog = pool.normalize_catalog(document)
        self.assertEqual(pool.reference_resolvable("provider/model(high)", catalog)[0], False)

    def test_explicit_level_fails_when_parallel_slot_unresolvable(self):
        self.assertRaises(pool.PoolError, pool.resolve_selection, "thorough", "explicit", False, catalog=catalog_for("zai/glm-5.3-flash(high)"))

    def test_allow_downgrade_selects_lower_complete_level(self):
        result = pool.resolve_selection("critical", "explicit", True, catalog=catalog_for("zai/glm-5.3-flash(high)"))
        self.assertEqual(result["effective_difficulty"], "routine")
        self.assertEqual(result["assignments"]["code"]["expected_slots"], 1)
        self.assertTrue(any(event.get("event") == "downgrade" for event in result["events"]))

    def test_selection_result_has_no_secret_or_full_config_content(self):
        result = pool.resolve_selection("routine", "explicit", False, catalog=catalog_for(*REFS))
        encoded = json.dumps(result)
        self.assertNotIn("password", encoded.lower())
        self.assertNotIn("api_key", encoded.lower())
        self.assertNotIn("models", result["config_source"]["path"])
        self.assertNotIn("workers:", encoded)
        self.assertEqual(result["config_source"]["path"], "agents/skills/review-subagent/review-pool.example.yaml")

    def test_unavailable_uv_or_catalog_fails_closed(self):
        with mock.patch.object(pool.shutil, "which", side_effect=lambda command: None if command in {"uv", "polytoken"} else None):
            with self.assertRaises(pool.PoolError):
                pool.load_catalog()
        with mock.patch.object(pool.shutil, "which", return_value="/usr/bin/tool"), mock.patch.object(pool.subprocess, "run", side_effect=FileNotFoundError):
            with self.assertRaises(pool.PoolError):
                pool.load_catalog()

    def test_raw_default_and_malformed_difficulty_flags_fail_closed(self):
        self.assertEqual(pool.parse_cli([]), ("thorough", "raw-default", False))
        self.assertEqual(pool.parse_cli(["--difficulty", "routine"]), ("routine", "explicit", False))
        for args in (["--difficulty"], ["--difficulty", "routine", "--difficulty", "critical"], ["--bogus"], ["--difficulty", "unsafe"]):
            with self.assertRaises(pool.PoolError):
                pool.parse_cli(args)

    def test_only_same_base_reasoning_correction_is_allowed(self):
        self.assertEqual(pool.model_override("codex/gpt-5.6-luna(xhigh)"), "codex/gpt-5.6-luna:xhigh")
        base, level = pool.parse_model_reference("codex/gpt-5.6-luna(xhigh)")
        self.assertEqual(base, "codex/gpt-5.6-luna")
        self.assertEqual(level, "xhigh")
        with self.assertRaises(pool.PoolError):
            pool.parse_model_reference("other-provider/other-model(high)") if False else pool.parse_model_reference("provider/model/high")

    def test_actual_model_override_payload_syntax(self):
        self.assertEqual(pool.model_override("zai/glm-5.3-flash(high)"), "zai/glm-5.3-flash:high")
        self.assertEqual(pool.model_override("codex/gpt-5.6-sol(medium)"), "codex/gpt-5.6-sol:medium")

    def test_resolver_cli_emits_one_json_result_and_bounded_failure(self):
        with mock.patch.object(pool, "resolve_selection", return_value={"schema_version": 1}), mock.patch("builtins.print") as output:
            self.assertEqual(pool.main(["--difficulty", "routine"]), 0)
            output.assert_called_once()
            json.loads(output.call_args.args[0])
        with mock.patch.object(pool, "resolve_selection", side_effect=pool.PoolError("x" * 10000)), mock.patch("builtins.print") as printed:
            with mock.patch.object(pool.sys, "stderr") as stderr:
                self.assertEqual(pool.main([]), 2)
            self.assertEqual(printed.call_count, 1)
            self.assertIs(printed.call_args.kwargs["file"], stderr)
            self.assertLessEqual(len(printed.call_args.args[0]), 4096 + 40)

    def test_symlink_views_and_root_ignore_rule(self):
        canonical = (HERE / "SKILL.md").resolve()
        self.assertEqual((pathlib.Path("claude/skills/review-subagent/SKILL.md")).resolve(), canonical)
        self.assertEqual((pathlib.Path("config/polytoken/skills/review-subagent/SKILL.md")).resolve(), canonical)
        self.assertEqual((pathlib.Path("config/pi/agent/skills/review-subagent/SKILL.md")).resolve(), canonical)
        result = subprocess.run(["git", "check-ignore", "-q", "agents/skills/review-subagent/review-pool.local.yaml"])
        self.assertEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
