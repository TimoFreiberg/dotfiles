import contextlib
import importlib.machinery
import importlib.util
import io
import os
import stat
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "bin" / "dotfiles-migrate"
LOADER = importlib.machinery.SourceFileLoader("dotfiles_migrate", str(SCRIPT))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
assert SPEC is not None
MIGRATE = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(MIGRATE)


class ErrorReportingTests(unittest.TestCase):
    def test_broken_configuration_link_reports_path_target_and_action(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "config"
            root.mkdir()
            broken = root / "broken"
            os.symlink("missing-target", broken)

            with self.assertRaises(MIGRATE.SafetyError) as raised:
                MIGRATE.inventory(root, Path(temporary) / "repo")

        message = str(raised.exception)
        self.assertIn("configuration contains a broken symlink", message)
        self.assertIn(f"path: {broken}", message)
        self.assertIn("target: missing-target (resolved:", message)
        self.assertIn("restore the target or remove the dangling symlink", message)

    def test_archive_compare_allows_relative_links_to_leave_the_archive(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "config"
            (source / "polytoken").mkdir(parents=True)
            (root / "agents" / "skills").mkdir(parents=True)
            os.symlink("../../agents/skills", source / "polytoken" / "skills")
            archive = root / "state" / "backup" / "config"
            archive.parent.mkdir(parents=True)
            MIGRATE.copy_tree(source, archive)

            counts = MIGRATE.archive_compare(source, archive, root / "repo")

        self.assertEqual(counts, {category: 0 for category in MIGRATE.CATEGORIES})

    def test_unsupported_configuration_object_reports_path_and_type(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "config"
            root.mkdir()
            fifo = root / "named-pipe"
            os.mkfifo(fifo)
            fifo_mode = stat.filemode(fifo.lstat().st_mode)

            with self.assertRaises(MIGRATE.SafetyError) as raised:
                MIGRATE.inventory(root, Path(temporary) / "repo")

        message = str(raised.exception)
        self.assertIn("unsupported filesystem object", message)
        self.assertIn(f"path: {fifo}", message)
        self.assertIn(fifo_mode, message)
        self.assertIn("remove the socket, device, FIFO", message)

    def test_os_error_detail_includes_errno_and_paths(self) -> None:
        error = OSError(13, "Permission denied", "/private/config")
        error.filename2 = "/private/other"

        detail = MIGRATE.exception_detail(error)

        self.assertIn("[Errno 13] Permission denied", detail)
        self.assertIn("path: /private/config", detail)
        self.assertIn("secondary path: /private/other", detail)

    def test_chained_copy_error_reports_the_command_failure(self) -> None:
        error = MIGRATE.subprocess.CalledProcessError(
            1, ["cp", "source", "destination"], stderr=b"permission denied\\n"
        )

        detail = MIGRATE.exception_detail(error)

        self.assertIn("command exited with status 1", detail)
        self.assertIn("permission denied", detail)


class DiffOutputTests(unittest.TestCase):
    def test_text_diff_reports_regular_text_changes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            before = root / "before"
            after = root / "after"
            before.write_text("same\nold\n", encoding="utf-8")
            after.write_text("same\nnew\n", encoding="utf-8")

            diff = MIGRATE.text_diff(before, after, ".config/example")

        self.assertIsNotNone(diff)
        rendered = "".join(diff or [])
        self.assertIn("--- before .config/example", rendered)
        self.assertIn("-old", rendered)
        self.assertIn("+new", rendered)

    def test_text_diff_refuses_binary_content(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            before = root / "before"
            after = root / "after"
            before.write_bytes(b"before\x00")
            after.write_bytes(b"after\x00")

            diff = MIGRATE.text_diff(before, after, ".config/example")

        self.assertIsNone(diff)

    def test_print_content_diffs_labels_changed_config_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            backup = root / "backup" / "config"
            current = root / "home" / ".config"
            backup.mkdir(parents=True)
            current.mkdir(parents=True)
            (backup / "example").write_text("old\n", encoding="utf-8")
            (current / "example").write_text("new\n", encoding="utf-8")
            entry = {"kind": "file", "size": 4, "digest": "old"}
            actual = {"kind": "file", "size": 4, "digest": "new"}
            output = io.StringIO()

            with contextlib.redirect_stdout(output):
                MIGRATE.print_content_diffs(
                    {"backup": str(root / "backup")},
                    root / "home",
                    {"example": entry},
                    {"example": actual},
                    [],
                )

        rendered = output.getvalue()
        self.assertIn("--- before .config/example", rendered)
        self.assertIn("-old", rendered)
        self.assertIn("+new", rendered)


class PathReplacementTests(unittest.TestCase):
    def test_replaces_directory_symlink_and_preserves_target_contents(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            old_target = root / "legacy"
            old_target.mkdir()
            (old_target / "old").write_text("old", encoding="utf-8")
            replacement = root / "replacement"
            replacement.mkdir()
            (replacement / "new").write_text("new", encoding="utf-8")
            destination = root / ".config"
            os.symlink(old_target, destination, target_is_directory=True)

            MIGRATE.replace_path(replacement, destination)

            self.assertFalse(destination.is_symlink())
            self.assertEqual((destination / "new").read_text(encoding="utf-8"), "new")
            self.assertFalse((destination / "old").exists())

    def test_restores_directory_symlink_when_replacement_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            old_target = root / "legacy"
            old_target.mkdir()
            destination = root / ".config"
            original_target = str(old_target)
            os.symlink(original_target, destination, target_is_directory=True)

            with self.assertRaises(FileNotFoundError):
                MIGRATE.replace_path(root / "missing", destination)

            self.assertTrue(destination.is_symlink())
            self.assertEqual(os.readlink(destination), original_target)


if __name__ == "__main__":
    unittest.main()
