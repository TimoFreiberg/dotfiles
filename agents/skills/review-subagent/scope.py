#!/usr/bin/env python3
"""Scope-gathering for the /review skill.

Dispatches on (subcommand, VCS) to gather diff + metadata for a code review.
Writes four files to a temp directory and prints the directory path on stdout:

    scope_summary  one-line description (e.g. "default (trunk()..@, 3 changes)")
    header         commit list + diffstat (for the orchestrator to print)
    diff           unified diff (for the reviewer prompt)
    pr_context     PR metadata + comments (only for `pr <number>`; else empty)

Exits non-zero on usage errors or when there's nothing to review (empty diff,
missing merge-base, etc.) and prints the user-facing reason on stderr.

Invoked by `agents/skills/review/SKILL.md`. No third-party dependencies.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile


# ---------- shell ---------------------------------------------------------


def run(cmd: list[str], check: bool = True) -> str:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if check and r.returncode != 0:
        die(f"command failed: {' '.join(cmd)}\n{r.stderr.strip()}")
    return r.stdout


def die(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    sys.stderr.write(f"error: {msg}\n")
    sys.exit(2)


def have_jj() -> bool:
    return os.path.isdir(".jj")


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
        f.write(diff)
    with open(os.path.join(out, "pr_context"), "w") as f:
        f.write(pr_context)
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
