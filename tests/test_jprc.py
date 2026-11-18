import os
from pathlib import Path
import subprocess
import tempfile
import unittest


FUNCTION = Path(__file__).resolve().parents[1] / "config/fish/functions/jprc.fish"


class JprcTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.capture = self.repo / "gh-args"
        self.env = dict(os.environ, JJ_USER="Test User", JJ_EMAIL="test@example.com", CAPTURE=str(self.capture))
        self.jj("git", "init")

    def jj(self, *args):
        return subprocess.run(["jj", *args], cwd=self.repo, env=self.env, check=True, capture_output=True, text=True)

    def setup_stack(self, messages, template=None):
        if template is not None:
            path = self.repo / ".github/PULL_REQUEST_TEMPLATE.md"
            path.parent.mkdir()
            path.write_text(template)
        self.jj("describe", "-m", "Base")
        self.jj("bookmark", "create", "base", "-r", "@")
        for message in messages:
            self.jj("new")
            self.jj("describe", "-m", message)

    def run_pr(self, body_file="", jj_override="", existing=False):
        script = '''
source $FUNCTION_PATH
function gh
    if test "$argv[1] $argv[2]" = 'pr list'
        if test "$EXISTING" = 1
            echo https://example.invalid/pr/1
        end
    else
        printf '%s\\0' $argv > $CAPTURE
    end
end
''' + jj_override + '''
__jprc_open_or_create_pr branch base @ "$BODY_FILE"
'''
        env = dict(self.env, FUNCTION_PATH=str(FUNCTION), BODY_FILE=str(body_file), EXISTING="1" if existing else "0")
        return subprocess.run(["fish", "--no-config", "-c", script], cwd=self.repo, env=env, capture_output=True, text=True)

    def gh_args(self):
        return self.capture.read_bytes().decode().split("\0")[:-1]

    def body(self):
        args = self.gh_args()
        self.assertEqual(args[:2], ["pr", "create"])
        self.assertEqual(args.count("--body"), 1)
        return args[args.index("--body") + 1]

    def test_stack_and_template(self):
        self.setup_stack(["Older subject\n\nOlder paragraph.\n\nSecond paragraph.", "Newer subject\n\nNewer body."], "## Checklist\n- [ ] Test\n")
        result = self.run_pr()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.body(), "## Newer subject\n\nNewer body.\n\n## Older subject\n\nOlder paragraph.\n\nSecond paragraph.\n\n## Checklist\n- [ ] Test")

    def test_single_description(self):
        self.setup_stack(["Subject\n\nA line with spaces.  \nSecond line.\n\nAnother paragraph."])
        result = self.run_pr()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.body(), "## Subject\n\nA line with spaces.  \nSecond line.\n\nAnother paragraph.")

    def test_single_subject_only(self):
        self.setup_stack(["Only subject"])
        result = self.run_pr()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.body(), "## Only subject")

    def test_subject_only_and_unseparated_body_in_stack(self):
        self.setup_stack(["Older subject\nBody line.", "", "Newer subject"])
        result = self.run_pr()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.body(), "## Newer subject\n\n## Older subject\n\nBody line.")

    def test_template_list_failure_stops_creation(self):
        self.setup_stack(["Subject"])
        override = '''
function jj
    if test "$argv[1] $argv[2]" = 'file list'
        echo list-broken >&2
        return 1
    end
    command jj $argv
end
'''
        result = self.run_pr(jj_override=override)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("failed to list files", result.stderr)
        self.assertIn("list-broken", result.stderr)
        self.assertFalse(self.capture.exists())

    def test_template_read_failure_stops_creation(self):
        self.setup_stack(["Subject"], "Template")
        override = '''
function jj
    if test "$argv[1] $argv[2]" = 'file show'
        echo show-broken >&2
        return 1
    end
    command jj $argv
end
'''
        result = self.run_pr(jj_override=override)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("failed to read PR template", result.stderr)
        self.assertIn("show-broken", result.stderr)
        self.assertFalse(self.capture.exists())

    def test_draft_body_is_untouched(self):
        draft = self.repo / "draft"
        draft.write_text("# Draft title\n\nLine one\n\nLine two\n\n")
        result = self.run_pr(draft, "function jj; echo unexpected >&2; return 1; end\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.gh_args()
        self.assertEqual(args[args.index("--title") + 1], "Draft title")
        self.assertEqual(self.body(), "\nLine one\n\nLine two\n\n")

    def test_existing_pr_ignores_draft(self):
        result = self.run_pr("missing", "function jj; echo unexpected >&2; return 1; end\n", existing=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.gh_args(), ["pr", "view", "https://example.invalid/pr/1", "--web"])

    def test_jj_log_failure_stops_creation(self):
        result = self.run_pr(jj_override="function jj; echo broken >&2; return 42; end\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("failed to read commit descriptions", result.stderr)
        self.assertIn("broken", result.stderr)
        self.assertFalse(self.capture.exists())


if __name__ == "__main__":
    unittest.main()
