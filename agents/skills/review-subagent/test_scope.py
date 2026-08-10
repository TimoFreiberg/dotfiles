from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


MODULE_PATH = pathlib.Path(__file__).with_name("scope.py")
SPEC = importlib.util.spec_from_file_location("review_scope", MODULE_PATH)
assert SPEC and SPEC.loader
scope = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scope)


class SyntheticDiffTests(unittest.TestCase):
    def test_header_text_inside_source_line_is_preserved(self) -> None:
        diff = (
            "diff --git a/note.txt b/note.txt\n"
            "--- a/note.txt\n"
            "+++ b/note.txt\n"
            "@@ -1 +1 @@\n"
            "-old\n"
            "+literal diff --git a/JJ-COMMIT-DESCRIPTION "
            "b/JJ-COMMIT-DESCRIPTION\n"
            "diff --git a/next.txt b/next.txt\n"
            "--- a/next.txt\n"
            "+++ b/next.txt\n"
        )

        self.assertEqual(scope.strip_jj_synthetic_files(diff), diff)


class GatherSinceTests(unittest.TestCase):
    def test_jj_uses_interdiff_against_frozen_commit(self) -> None:
        commands: list[list[str]] = []

        def fake_run(command: list[str], check: bool = True) -> str:
            commands.append(command)
            return "diff --git a/note.txt b/note.txt\n-old\n+new\n"

        with mock.patch.object(scope, "have_jj", return_value=True), mock.patch.object(
            scope, "run", side_effect=fake_run
        ):
            summary, commits, diff, stat = scope.gather_since("abc123")

        self.assertEqual(
            commands,
            [["jj", "interdiff", "--from", "abc123", "--to", "@-", "--git"]],
        )
        self.assertEqual(summary, "patch changes from abc123 to @-")
        self.assertEqual(commits, ["baseline abc123", "final @-"])
        self.assertTrue(diff)
        self.assertEqual(stat, "")

    def test_git_compares_baseline_tree_to_head(self) -> None:
        commands: list[list[str]] = []
        outputs = iter(["diff\n", "stat\n", "deadbeef fix\n"])

        def fake_run(command: list[str], check: bool = True) -> str:
            commands.append(command)
            return next(outputs)

        with mock.patch.object(scope, "have_jj", return_value=False), mock.patch.object(
            scope, "run", side_effect=fake_run
        ):
            summary, commits, diff, stat = scope.gather_since("abc123")

        self.assertEqual(
            commands,
            [
                ["git", "diff", "abc123..HEAD"],
                ["git", "diff", "--stat", "abc123..HEAD"],
                ["git", "log", "--oneline", "abc123..HEAD"],
            ],
        )
        self.assertEqual(summary, "changes from abc123 to HEAD (1 commit)")
        self.assertEqual(commits, ["deadbeef fix"])
        self.assertEqual(diff, "diff\n")
        self.assertEqual(stat, "stat\n")


class JjSinceIntegrationTests(unittest.TestCase):
    def test_since_compares_frozen_patches_without_working_copy_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = pathlib.Path(directory)

            def jj(*args: str) -> str:
                result = subprocess.run(
                    ["jj", *args], cwd=repo, capture_output=True, text=True, check=True
                )
                return result.stdout.strip()

            jj("git", "init")
            (repo / "note.txt").write_text("base\n")
            jj("commit", "-m", "base")

            (repo / "note.txt").write_text("base\nfirst\n")
            jj("commit", "-m", "initial documentation")
            baseline = jj("log", "-r", "@-", "--no-graph", "-T", "commit_id")

            (repo / "note.txt").write_text("base\nsecond\n")
            jj("commit", "-m", "review cleanup")
            final = jj("log", "-r", "@-", "--no-graph", "-T", "commit_id")

            previous_cwd = pathlib.Path.cwd()
            try:
                os.chdir(repo)
                _, _, diff, _ = scope.gather_since(baseline, final)
            finally:
                os.chdir(previous_cwd)

        self.assertIn("-first", diff)
        self.assertIn("+second", diff)
        self.assertNotIn("JJ-COMMIT-DESCRIPTION", diff)
        self.assertNotIn("<<<<<<<", diff)


class EmptySinceTests(unittest.TestCase):
    def test_empty_since_scope_is_successful_short_circuit(self) -> None:
        stderr = io.StringIO()
        with mock.patch.object(
            sys, "argv", ["scope.py", "since", "abc123", "def456"]
        ), mock.patch.object(
            scope, "gather_since", return_value=("changes", [], "", "")
        ) as gather, contextlib.redirect_stderr(stderr):
            result = scope.main()

        self.assertEqual(result, 0)
        gather.assert_called_once_with("abc123", "def456")
        self.assertEqual(stderr.getvalue(), "no changes since baseline: abc123\n")


if __name__ == "__main__":
    unittest.main()
