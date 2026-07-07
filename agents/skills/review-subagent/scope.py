#!/usr/bin/env python3
"""Scope-gathering for the /review skill.

Dispatches on (subcommand, VCS) to gather diff + metadata for a code review.
Writes four files to a temp directory and prints the directory path on stdout:

    scope_summary  one-line description (e.g. "default (trunk()..@, 3 changes)")
    header         commit list + diffstat (for the orchestrator to print)
    diff           unified diff, gutter-annotated with new-file line numbers
                   (for the reviewer prompt)
    pr_context     PR metadata + comments (only for `pr <number>`; else empty)

Exits non-zero on usage errors or when there's nothing to review (empty diff,
missing merge-base, etc.) and prints the user-facing reason on stderr.

Invoked by `agents/skills/review-subagent/SKILL.md`. No third-party dependencies.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile


# ---------- diff annotation -----------------------------------------------


def annotate_diff(diff: str) -> str:
    """Prefix each diff body line with its real new-file source line number.

    Reviewers must cite `file:line` against the *current* source, but a unified
    diff carries only per-hunk `@@ -a,b +c,d @@` headers, forcing the reader to
    count forward by hand. Models get this wrong constantly -- often citing the
    line's position within the diff blob instead of a source line. We do the
    counting here (Python counts perfectly) and put the number in a left gutter:

        @@ -31,16 +15,13 @@ server s1 -start
            15  server s1 -start
             -  # removed line has no new-file line, so a blank gutter
            16  if -macro-defined use_rust_smiss {

    Context and added lines carry their new-file number; removed lines get a
    blank gutter (they do not exist in the current file, so they are not
    citable). Structural lines (`diff --git`, `@@`, `---`, etc.) pass through
    unchanged. The original `+`/`-`/space marker is preserved after the gutter.
    """
    # Structural prefixes that start a new file's metadata: they end any hunk
    # and must never get a gutter. `diff --git`/`index` are unambiguous. The
    # `---`/`+++` file headers also start with -/+ and would otherwise be
    # mistaken for body lines, so they are handled specially below: they only
    # count as headers when NOT inside a hunk (a real body line can begin with
    # "-- " or "++ " content, which must keep its gutter).
    file_start = ("diff --git ", "index ", "old mode ", "new mode ",
                  "similarity ", "dissimilarity ", "rename ", "copy ",
                  "new file mode ", "deleted file mode ", "Binary files ",
                  "GIT binary patch")
    out: list[str] = []
    new_lineno = 0
    in_hunk = False
    for line in diff.split("\n"):
        if line.startswith(file_start):
            # New-file metadata (or binary marker): leave hunk mode, pass through.
            in_hunk = False
            out.append(line)
            continue
        if not in_hunk and (line.startswith("--- ") or line.startswith("+++ ")):
            # File header line (only appears outside a hunk), pass through.
            out.append(line)
            continue
        if line.startswith("@@"):
            # @@ -a,b +c,d @@ optional-section-heading
            # The new-file start line is c in the "+c,d" token.
            try:
                plus = line.split("+", 1)[1]
                new_lineno = int(plus.split(",", 1)[0].split(" ", 1)[0])
                in_hunk = True
            except (IndexError, ValueError):
                in_hunk = False
            out.append(line)
            continue
        if not in_hunk:
            # File headers, index lines, mode/rename lines, etc.
            out.append(line)
            continue
        if line.startswith("+"):
            out.append(f"{new_lineno:6d}  {line}")
            new_lineno += 1
        elif line.startswith("-"):
            out.append(f"{'':6}  {line}")
        elif line.startswith("\\"):
            # "\ No newline at end of file" -- not a real line.
            out.append(f"{'':6}  {line}")
        elif line == "":
            # Trailing empty element from a final newline, or a stray blank
            # between the diff and later structural content: emit as-is, no
            # gutter and no counter bump. (Real context blank lines in a
            # unified diff carry a leading space, so they hit the else branch.)
            out.append(line)
        else:
            # Context line (leading space).
            out.append(f"{new_lineno:6d}  {line}")
            new_lineno += 1
    return "\n".join(out)


# ---------- shell ---------------------------------------------------------


def run(cmd: list[str], check: bool = True) -> str:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError:
        die(f"command not found: {cmd[0]}")
    if check and r.returncode != 0:
        die(f"command failed: {' '.join(cmd)}\n{r.stderr.strip()}")
    return r.stdout


def die(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    sys.stderr.write(f"error: {msg}\n")
    sys.exit(2)


def have_jj() -> bool:
    # `jj root` works from any subdirectory, unlike checking for ./.jj in cwd.
    try:
        return subprocess.run(["jj", "root"], capture_output=True).returncode == 0
    except FileNotFoundError:
        return False


# ---------- formatting ----------------------------------------------------


def format_commit_list(commits: list[str]) -> str:
    if not commits:
        return ""
    if len(commits) <= 5:
        return "\n".join(f"  {c}" for c in commits)
    head = "\n".join(f"  {c}" for c in commits[:2])
    tail = "\n".join(f"  {c}" for c in commits[-2:])
    return f"{head}\n  ...({len(commits) - 4} more)...\n{tail}"


def plural(n: int, word: str) -> str:
    return f"{n} {word}{'s' if n != 1 else ''}"


# ---------- gather --------------------------------------------------------


JJ_LOG_TEMPLATE = 'change_id.shortest() ++ " " ++ description.first_line() ++ "\\n"'


def gather_default() -> tuple[str, list[str], str, str]:
    """Default scope: jj `trunk()..@` or git `<merge-base>..HEAD`."""
    if have_jj():
        diff = run(["jj", "diff", "--git", "--from", "trunk()", "--to", "@"])
        stat = run(["jj", "diff", "--stat", "--from", "trunk()", "--to", "@"])
        commits = (
            run(["jj", "log", "--no-graph", "-r", "trunk()..@", "-T", JJ_LOG_TEMPLATE])
            .strip()
            .splitlines()
        )
        return (
            f"default (trunk()..@, {plural(len(commits), 'change')})",
            commits,
            diff,
            stat,
        )
    base = ""
    for branch in ("main", "master"):
        candidate = run(["git", "merge-base", "HEAD", branch], check=False).strip()
        if candidate:
            base = candidate
            break
    if not base:
        die("merge-base not found against main or master")
    diff = run(["git", "diff", f"{base}..HEAD"])
    stat = run(["git", "diff", "--stat", f"{base}..HEAD"])
    commits = run(["git", "log", "--oneline", f"{base}..HEAD"]).strip().splitlines()
    return (
        f"default ({base[:8]}..HEAD, {plural(len(commits), 'commit')})",
        commits,
        diff,
        stat,
    )


def gather_commit(revset: str) -> tuple[str, list[str], str, str]:
    if have_jj():
        diff = run(["jj", "diff", "--git", "-r", revset])
        stat = run(["jj", "diff", "--stat", "-r", revset])
        commits = (
            run(["jj", "log", "--no-graph", "-r", revset, "-T", JJ_LOG_TEMPLATE])
            .strip()
            .splitlines()
        )
        return (
            f"commit {revset} ({plural(len(commits), 'change')})",
            commits,
            diff,
            stat,
        )
    if ".." in revset:
        diff = run(["git", "diff", revset])
        stat = run(["git", "diff", "--stat", revset])
        commits = run(["git", "log", "--oneline", revset]).strip().splitlines()
    else:
        diff = run(["git", "show", revset])
        stat = run(["git", "show", "--stat", "--format=", revset])
        commits = [run(["git", "log", "-1", "--oneline", revset]).strip()]
    return f"commit {revset}", commits, diff, stat


def gather_branch(name: str) -> tuple[str, list[str], str, str]:
    if have_jj():
        diff = run(["jj", "diff", "--git", "--from", name, "--to", "@"])
        stat = run(["jj", "diff", "--stat", "--from", name, "--to", "@"])
        commits = (
            run(["jj", "log", "--no-graph", "-r", f"{name}..@", "-T", JJ_LOG_TEMPLATE])
            .strip()
            .splitlines()
        )
        return (
            f"branch {name}..@ ({plural(len(commits), 'change')})",
            commits,
            diff,
            stat,
        )
    base = run(["git", "merge-base", "HEAD", name]).strip()
    if not base:
        die(f"merge-base not found against {name}")
    diff = run(["git", "diff", f"{base}..HEAD"])
    stat = run(["git", "diff", "--stat", f"{base}..HEAD"])
    commits = run(["git", "log", "--oneline", f"{base}..HEAD"]).strip().splitlines()
    return (
        f"branch {name} ({base[:8]}..HEAD, {plural(len(commits), 'commit')})",
        commits,
        diff,
        stat,
    )


def gather_uncommitted() -> tuple[str, list[str], str, str]:
    if have_jj():
        diff = run(["jj", "diff", "--git"])
        stat = run(["jj", "diff", "--stat"])
    else:
        # git mode misses untracked files (jj auto-snapshots them).
        diff = run(["git", "diff", "HEAD"])
        stat = run(["git", "diff", "--stat", "HEAD"])
    return "uncommitted changes", [], diff, stat


def gather_file(path: str) -> tuple[str, list[str], str, str]:
    if have_jj():
        diff = run(["jj", "diff", "--git", path])
        stat = run(["jj", "diff", "--stat", path])
    else:
        diff = run(["git", "diff", "HEAD", "--", path])
        stat = run(["git", "diff", "--stat", "HEAD", "--", path])
    return f"uncommitted changes to {path}", [], diff, stat


def gather_pr(number: str) -> tuple[str, list[str], str, str, str]:
    diff = run(["gh", "pr", "diff", number])
    view = run(["gh", "pr", "view", number])
    comments = run(["gh", "pr", "view", number, "--comments"], check=False)
    pr_context = f"## PR metadata\n{view}\n\n## PR comments\n{comments}"
    return f"PR #{number}", [], diff, "", pr_context


# ---------- main ----------------------------------------------------------


def main() -> int:
    p = argparse.ArgumentParser(prog="scope.py", description="Gather review scope.")
    sub = p.add_subparsers(dest="subcommand")
    sub.add_parser("uncommitted", help="uncommitted working-copy changes")
    p_commit = sub.add_parser("commit", help="jj revset, or git ref/range")
    p_commit.add_argument("revset")
    p_branch = sub.add_parser("branch", help="diff from <name> to current")
    p_branch.add_argument("name")
    p_file = sub.add_parser("file", help="uncommitted changes to one file")
    p_file.add_argument("path")
    p_pr = sub.add_parser("pr", help="GitHub PR diff + metadata")
    p_pr.add_argument("number")
    args = p.parse_args()

    pr_context = ""
    if args.subcommand is None:
        scope_summary, commits, diff, stat = gather_default()
    elif args.subcommand == "uncommitted":
        scope_summary, commits, diff, stat = gather_uncommitted()
    elif args.subcommand == "commit":
        scope_summary, commits, diff, stat = gather_commit(args.revset)
    elif args.subcommand == "branch":
        scope_summary, commits, diff, stat = gather_branch(args.name)
    elif args.subcommand == "file":
        scope_summary, commits, diff, stat = gather_file(args.path)
    elif args.subcommand == "pr":
        scope_summary, commits, diff, stat, pr_context = gather_pr(args.number)
    else:
        die(f"unknown subcommand: {args.subcommand}")

    if not diff.strip():
        die(f"empty diff for scope: {scope_summary}")

    # Build the orchestrator-facing header (commit list + diffstat).
    header_parts = []
    commit_list = format_commit_list(commits)
    if commit_list:
        header_parts.append(commit_list)
    if stat.strip():
        header_parts.append(stat.rstrip())
    header = "\n".join(header_parts)

    # Write to a temp dir and print the path.
    out = tempfile.mkdtemp(prefix="review.")
    with open(os.path.join(out, "scope_summary"), "w") as f:
        f.write(scope_summary + "\n")
    with open(os.path.join(out, "header"), "w") as f:
        f.write(header)
        if header and not header.endswith("\n"):
            f.write("\n")
    with open(os.path.join(out, "diff"), "w") as f:
        f.write(annotate_diff(diff))
    with open(os.path.join(out, "pr_context"), "w") as f:
        f.write(pr_context)
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
