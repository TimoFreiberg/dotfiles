import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "bin/wrap-details"


class WrapDetailsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.clip_file = self.root / "clipboard.txt"
        self.fake_bin = self.root / "bin"
        self.fake_bin.mkdir()

        pbpaste = self.fake_bin / "pbpaste"
        pbpaste.write_text(f'#!/usr/bin/env bash\ncat "{self.clip_file}"\n')
        pbpaste.chmod(0o755)

        pbcopy = self.fake_bin / "pbcopy"
        pbcopy.write_text(f'#!/usr/bin/env bash\ncat > "{self.clip_file}"\n')
        pbcopy.chmod(0o755)

        self.env = dict(os.environ, PATH=f"{self.fake_bin}:{os.environ.get('PATH', '')}")

    def run_script(self, *args, stdin=subprocess.DEVNULL, capture_stdout=True):
        return subprocess.run(
            [str(SCRIPT), *args],
            env=self.env,
            stdin=stdin,
            stdout=subprocess.PIPE if capture_stdout else None,
            stderr=subprocess.PIPE,
            text=True,
        )

    def test_wraps_clipboard_with_default_summary_when_stdin_is_devnull(self):
        self.clip_file.write_text("line 1\nline 2\n")
        res = self.run_script(stdin=subprocess.DEVNULL, capture_stdout=False)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(
            self.clip_file.read_text(),
            "<details>\n<summary>🤖 Details</summary>\n\nline 1\nline 2\n\n</details>\n",
        )

    def test_custom_summary_from_args(self):
        self.clip_file.write_text("hello")
        res = self.run_script("Build", "output", stdin=subprocess.DEVNULL, capture_stdout=False)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(
            self.clip_file.read_text(),
            "<details>\n<summary>Build output</summary>\n\nhello\n\n</details>\n",
        )

    def test_piped_stdin_writes_to_clipboard_by_default(self):
        self.clip_file.write_text("old clipboard")
        res = subprocess.run(
            [str(SCRIPT)],
            env=self.env,
            input="  indented\n```\ncode\n```\n\n",
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(res.stdout, "")
        self.assertEqual(
            self.clip_file.read_text(),
            "<details>\n<summary>🤖 Details</summary>\n\n  indented\n```\ncode\n```\n\n</details>\n",
        )

    def test_stdout_flag_writes_to_stdout(self):
        res = subprocess.run(
            [str(SCRIPT), "--stdout"],
            env=self.env,
            input="hello\n",
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(
            res.stdout,
            "<details>\n<summary>🤖 Details</summary>\n\nhello\n\n</details>\n",
        )

    def test_empty_pipe_falls_back_to_clipboard(self):
        self.clip_file.write_text("from clipboard")
        res = subprocess.run(
            [str(SCRIPT)],
            env=self.env,
            input="",
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(
            self.clip_file.read_text(),
            "<details>\n<summary>🤖 Details</summary>\n\nfrom clipboard\n\n</details>\n",
        )

    def test_does_not_double_wrap(self):
        already = "<details>\n<summary>🤖 Details</summary>\n\nhi\n\n</details>\n"
        self.clip_file.write_text(already)
        res = self.run_script(stdin=subprocess.DEVNULL, capture_stdout=False)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(self.clip_file.read_text(), already)

    def test_empty_clipboard_exits_nonzero_without_clobbering(self):
        self.clip_file.write_text("   \n\t\n")
        res = self.run_script(stdin=subprocess.DEVNULL, capture_stdout=False)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("empty", res.stderr)
        self.assertEqual(self.clip_file.read_text(), "   \n\t\n")


if __name__ == "__main__":
    unittest.main()
