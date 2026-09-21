#!/usr/bin/env python3
"""Print every agent skill name and its SKILL.md path.

The scan includes common global agent-skill locations and every ``.agents``
directory below the user's home directory, except under ``~/.cargo`` and
``~/.cache``. Output is sorted and tab-separated:

    skill-name<TAB>/absolute/path/to/SKILL.md
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator


SKILL_FILE = "SKILL.md"


@dataclass(frozen=True)
class Skill:
    name: str
    path: Path


def global_skill_roots(home: Path) -> Iterator[Path]:
    """Yield configured global skill roots, including this machine's layout."""
    candidates = [
        home / ".agents",
        home / ".config" / "agents",
        home / ".config" / "pi" / "agent" / "skills",
        home / ".pi" / "agent" / "skills",
        home / "dotfiles" / "agents" / "skills",
    ]

    configured = os.environ.get("PI_CODING_AGENT_DIR")
    if configured:
        candidates.append(Path(configured).expanduser() / "skills")

    seen: set[Path] = set()
    for candidate in candidates:
        resolved = candidate.expanduser().resolve(strict=False)
        if resolved not in seen:
            seen.add(resolved)
            yield resolved


def fd_paths(*arguments: str | Path) -> list[Path]:
    """Run fd and return its NUL-delimited paths."""
    executable = shutil.which("fd")
    if executable is None:
        raise RuntimeError("fd is required; install it or put it on PATH")

    result = subprocess.run(
        [executable, *map(str, arguments)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    # fd uses exit status 1 when there are no matches.
    if result.returncode not in (0, 1):
        detail = result.stderr.decode(errors="replace").strip()
        raise RuntimeError(f"fd failed with exit status {result.returncode}: {detail}")

    return [
        Path(os.fsdecode(raw)).resolve(strict=False)
        for raw in result.stdout.split(b"\0")
        if raw
    ]


def project_agent_directories(home: Path) -> Iterator[Path]:
    """Find every .agents directory below home without following symlinks."""
    yield from sorted(
        set(
            fd_paths(
                "--hidden",
                "--no-ignore",
                "--type",
                "d",
                "--glob",
                ".agents",
                "--exclude",
                ".cargo",
                "--exclude",
                ".cache",
                "--absolute-path",
                "--print0",
                home,
            )
        ),
        key=str,
    )


def skill_files(roots: list[Path]) -> Iterator[Path]:
    """Find SKILL.md files below all supplied roots."""
    yield from sorted(
        set(
            fd_paths(
                "--hidden",
                "--no-ignore",
                "--type",
                "f",
                "--glob",
                SKILL_FILE,
                "--absolute-path",
                "--print0",
                *roots,
            )
        ),
        key=str,
    )


def discover_skills(home: Path) -> list[Skill]:
    roots = list(global_skill_roots(home))
    roots.extend(project_agent_directories(home))

    by_file: dict[Path, Skill] = {}
    by_inode: set[tuple[int, int]] = set()
    for path in skill_files(roots):
        try:
            stat = path.stat()
        except OSError:
            continue

        identity = (stat.st_dev, stat.st_ino)
        if identity in by_inode or path in by_file:
            continue

        by_file[path] = Skill(path.parent.name, path)
        by_inode.add(identity)

    return sorted(by_file.values(), key=lambda skill: (skill.name, str(skill.path)))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--home",
        type=Path,
        default=Path.home(),
        help="home directory to scan (default: %(default)s)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        skills = discover_skills(args.home.expanduser().resolve())
    except RuntimeError as error:
        print(f"list-agent-skills.py: {error}", file=sys.stderr)
        return 1

    for skill in skills:
        print(f"{skill.name}\t{skill.path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
