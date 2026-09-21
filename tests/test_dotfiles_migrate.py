import importlib.machinery
import importlib.util
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


if __name__ == "__main__":
    unittest.main()
