#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["PyYAML==6.0.2"]
# ///
"""Validate and resolve the shared reviewer pool before a skill launches workers."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path
from typing import Any

import yaml

SCHEMA_VERSION = 1
LEVELS = ("routine", "thorough", "critical")
DOWNGRADE_CHAIN = ("critical", "thorough", "routine")
PROVENANCES = ("raw-default", "explicit", "plan-facet-claimed")
STRATEGIES = {"routine": "ordered-fallback", "parallel": "parallel"}
MODEL_RE = re.compile(r"^(?P<base>[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)?)(?:\((?P<reasoning>none|low|medium|high|xhigh|max)\))?$")
ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")


class PoolError(ValueError):
    """A bounded, operator-actionable resolver failure."""


class _UniqueSafeLoader(yaml.SafeLoader):
    pass


def _construct_mapping(loader: _UniqueSafeLoader, node: yaml.MappingNode, deep: bool = False) -> dict[Any, Any]:
    mapping: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        try:
            duplicate = key in mapping
        except TypeError as exc:
            raise PoolError("mapping keys must be hashable") from exc
        if duplicate:
            raise PoolError(f"duplicate YAML key: {key!r}")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_UniqueSafeLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_mapping)


def parse_model_reference(reference: str) -> tuple[str, str | None]:
    if not isinstance(reference, str) or not reference.strip():
        raise PoolError("worker model must be a non-empty string")
    match = MODEL_RE.fullmatch(reference)
    if not match:
        raise PoolError(f"malformed model reference: {reference!r}")
    return match.group("base"), match.group("reasoning")


def model_override(reference: str) -> str:
    parse_model_reference(reference)
    return reference


def _mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise PoolError(f"{label} must be a mapping")
    return value


def validate_config(document: Any) -> dict[str, Any]:
    root = _mapping(document, "pool document")
    if set(root) != {"version", "workers", "levels"}:
        unknown = [key for key in root if key not in {"version", "workers", "levels"}]
        missing = sorted({"version", "workers", "levels"} - set(root))
        detail = []
        if unknown:
            detail.append(f"unknown keys: {', '.join(repr(key) for key in unknown)}")
        if missing:
            detail.append(f"missing keys: {', '.join(missing)}")
        raise PoolError("invalid pool schema (" + "; ".join(detail) + ")")
    if root["version"] != SCHEMA_VERSION or isinstance(root["version"], bool):
        raise PoolError("version must be integer 1")

    workers = _mapping(root["workers"], "workers")
    if not workers:
        raise PoolError("workers must not be empty")
    normalized_workers: dict[str, dict[str, str]] = {}
    for worker_id, raw_worker in workers.items():
        if not isinstance(worker_id, str) or not ID_RE.fullmatch(worker_id):
            raise PoolError(f"invalid worker id: {worker_id!r}")
        worker = _mapping(raw_worker, f"worker {worker_id}")
        if set(worker) != {"model"}:
            raise PoolError(f"worker {worker_id} must contain only model")
        model = worker["model"]
        parse_model_reference(model)
        normalized_workers[worker_id] = {"model": model}

    levels = _mapping(root["levels"], "levels")
    if set(levels) != set(LEVELS):
        raise PoolError("levels must contain exactly routine, thorough, critical")
    normalized_levels: dict[str, dict[str, Any]] = {}
    for level in LEVELS:
        raw_level = _mapping(levels[level], f"level {level}")
        if set(raw_level) != {"strategy", "workers"}:
            raise PoolError(f"level {level} must contain only strategy and workers")
        strategy = raw_level["strategy"]
        expected = "ordered-fallback" if level == "routine" else "parallel"
        if strategy != expected:
            raise PoolError(f"level {level} must use strategy {expected}")
        selected = raw_level["workers"]
        if not isinstance(selected, list) or not selected or any(not isinstance(item, str) for item in selected):
            raise PoolError(f"level {level} workers must be a non-empty list")
        if len(set(selected)) != len(selected):
            raise PoolError(f"level {level} contains duplicate workers")
        expected_count = 1 if level == "routine" else 3
        if level != "routine" and len(selected) != expected_count:
            raise PoolError(f"level {level} requires exactly three model workers")
        missing_workers = [item for item in selected if item not in normalized_workers]
        if missing_workers:
            raise PoolError(f"level {level} references unknown workers: {', '.join(missing_workers)}")
        normalized_levels[level] = {"strategy": strategy, "workers": selected[:]}
    return {"version": 1, "workers": normalized_workers, "levels": normalized_levels}


def load_pool(path: Path) -> dict[str, Any]:
    try:
        with path.open(encoding="utf-8") as stream:
            document = yaml.load(stream, Loader=_UniqueSafeLoader)
    except PoolError:
        raise
    except (OSError, TypeError, UnicodeError, yaml.YAMLError) as exc:
        raise PoolError(f"cannot read pool configuration: {type(exc).__name__}") from exc
    return validate_config(document)


def normalize_catalog(document: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(document, dict) or set(document) != {"default_model", "default_small_model", "models"}:
        raise PoolError("model catalog has an unsupported root shape")
    entries = document["models"]
    if not isinstance(entries, list):
        raise PoolError("model catalog models must be an array")
    normalized: dict[str, dict[str, Any]] = {}
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise PoolError(f"model catalog entry {index} is not an object")
        for key in ("name", "provider", "reasoning", "selectable"):
            if key not in entry:
                raise PoolError(f"model catalog entry {index} lacks {key}")
        if not isinstance(entry["name"], str) or not isinstance(entry["provider"], str):
            raise PoolError(f"model catalog entry {index} has invalid identity")
        reasoning = entry["reasoning"]
        if not isinstance(reasoning, dict):
            raise PoolError(f"model catalog entry {index} has invalid reasoning metadata")
        levels = reasoning.get("levels", [])
        if not isinstance(levels, list) or not all(isinstance(level, str) for level in levels):
            raise PoolError(f"model catalog entry {index} has invalid reasoning levels")
        values = entry["selectable"]
        if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
            raise PoolError(f"model catalog entry {index} has invalid selectable values")
        name = entry["name"]
        if name in normalized:
            raise PoolError(f"model catalog contains duplicate identity: {name}")
        normalized[name] = {"levels": set(levels), "selectable": set(values)}
    return normalized


def reference_resolvable(reference: str, catalog: dict[str, dict[str, Any]] | set[str]) -> tuple[bool, str]:
    base, reasoning = parse_model_reference(reference)
    if isinstance(catalog, set):
        selectable = catalog
        if reasoning is None:
            return (base in selectable, "selectable base" if base in selectable else "base is not selectable")
        return (reference in selectable, "resolved" if reference in selectable else "exact reasoning variant is not selectable")
    entry = catalog.get(base)
    if entry is None:
        return False, "base model is not in the catalog"
    selectable = entry["selectable"]
    if reasoning is None:
        return (base in selectable, "selectable base" if base in selectable else "base is not selectable")
    if reasoning != "none" and reasoning not in entry["levels"]:
        return False, "reasoning level is not enabled"
    if reference not in selectable:
        return False, "exact reasoning variant is not selectable"
    return True, "resolved"


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def config_source() -> tuple[Path, str]:
    root = Path(__file__).resolve().parent
    local = root / "review-pool.local.yaml"
    if local.exists():
        return local, "local"
    return root / "review-pool.example.yaml", "example"


def _safe_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(_repo_root()).as_posix()
    except ValueError:
        return path.name


def load_catalog() -> dict[str, dict[str, Any]]:
    if shutil.which("uv") is None:
        raise PoolError("uv command is unavailable; preflight failed closed")
    if shutil.which("polytoken") is None:
        raise PoolError("polytoken command is unavailable; preflight failed closed")
    try:
        result = subprocess.run(
            ["polytoken", "models", "--format", "json"],
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        )
    except (OSError, UnicodeError, subprocess.SubprocessError) as exc:
        raise PoolError(f"model catalog preflight failed: {type(exc).__name__}") from exc
    try:
        document = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise PoolError("model catalog output is not JSON") from exc
    return normalize_catalog(document)


def _level_readiness(config: dict[str, Any], level: str, selectable: dict[str, dict[str, Any]] | set[str]) -> tuple[bool, list[dict[str, Any]], list[str]]:
    worker_ids = config["levels"][level]["workers"]
    statuses: list[dict[str, Any]] = []
    resolved: list[str] = []
    for worker_id in worker_ids:
        reference = config["workers"][worker_id]["model"]
        ok, reason = reference_resolvable(reference, selectable)
        statuses.append({"worker_id": worker_id, "model": reference, "resolvable": ok, "reason": reason})
        if ok:
            resolved.append(worker_id)
    ready = bool(resolved) if level == "routine" else len(resolved) == 3
    return ready, statuses, resolved


def _assignments(config: dict[str, Any], effective: str, selectable: dict[str, dict[str, Any]] | set[str]) -> dict[str, Any]:
    ids = config["levels"][effective]["workers"]
    ready, statuses, resolved = _level_readiness(config, effective, selectable)
    if not ready:
        raise PoolError(f"level {effective} is not fully resolvable")
    code: list[dict[str, Any]] = []
    conformance: list[dict[str, Any]] = []
    if effective == "routine":
        for candidate_index, worker_id in enumerate(ids, start=1):
            worker = config["workers"][worker_id]
            item = {"candidate": candidate_index, "worker_id": worker_id, "model": worker["model"], "model_override": model_override(worker["model"]), "resolvable": worker_id in resolved}
            code.append({**item, "slot": 1, "axis": "C+S+T"})
            conformance.append({**item, "slot": 1, "replica": "P1"})
    else:
        slot = 0
        for worker_id in ids:
            worker = config["workers"][worker_id]
            for axis in ("C", "S", "T"):
                slot += 1
                item = {"slot": slot, "worker_id": worker_id, "model": worker["model"], "model_override": model_override(worker["model"]), "axis": axis}
                code.append(item)
                conformance.append({"slot": slot, "worker_id": worker_id, "model": worker["model"], "model_override": model_override(worker["model"]), "replica": f"P{slot}"})
    expected_slots = 1 if effective == "routine" else 9
    return {"code": {"strategy": config["levels"][effective]["strategy"], "expected_slots": expected_slots, "assignments": code, "preflight": statuses}, "plan_conformance": {"strategy": config["levels"][effective]["strategy"], "expected_slots": expected_slots, "assignments": conformance, "preflight": statuses}}


def resolve_selection(difficulty: str = "thorough", provenance: str = "raw-default", allow_downgrade: bool = False, *, config_path: Path | None = None, catalog: Any = None) -> dict[str, Any]:
    if difficulty not in LEVELS:
        raise PoolError("difficulty must be routine, thorough, or critical")
    if provenance not in PROVENANCES:
        raise PoolError("selection provenance is invalid")
    if config_path is None:
        config_path, source_kind = config_source()
    else:
        source_kind = "local" if config_path.name.endswith(".local.yaml") else "example"
    config = load_pool(config_path)
    selectable = normalize_catalog(catalog) if isinstance(catalog, dict) else (catalog if isinstance(catalog, set) else load_catalog())

    events: list[dict[str, Any]] = []
    effective: str | None = None
    readiness: dict[str, list[dict[str, Any]]] = {}
    candidates = DOWNGRADE_CHAIN[DOWNGRADE_CHAIN.index(difficulty) :]
    for candidate in candidates:
        ready, statuses, _ = _level_readiness(config, candidate, selectable)
        readiness[candidate] = statuses
        if ready:
            effective = candidate
            break
        events.append({"level": candidate, "event": "rejected", "reason": "required assignments are not resolvable", "workers": statuses})
        if not allow_downgrade:
            break
    if effective is None:
        raise PoolError(f"requested level {difficulty} is unavailable; use --allow-downgrade for pre-launch fallback")
    if effective != difficulty:
        events.append({"event": "downgrade", "requested": difficulty, "effective": effective})
    assignments = _assignments(config, effective, selectable)
    return {
        "schema_version": 1,
        "requested_difficulty": difficulty,
        "effective_difficulty": effective,
        "selection_provenance": provenance,
        "allow_downgrade": allow_downgrade,
        "config_source": {"kind": source_kind, "path": _safe_path(config_path)},
        "workers": {worker_id: data["model"] for worker_id, data in config["workers"].items()},
        "assignments": assignments,
        "events": events,
    }


def parse_cli(argv: list[str]) -> tuple[str, str, bool]:
    difficulty = "thorough"
    provenance: str | None = None
    allow = False
    difficulty_seen = False
    provenance_seen = False
    index = 0
    while index < len(argv):
        flag = argv[index]
        if flag == "--allow-downgrade":
            if allow:
                raise PoolError("duplicate --allow-downgrade")
            allow = True
            index += 1
            continue
        if flag in {"--difficulty", "--selection-provenance"}:
            if index + 1 >= len(argv) or argv[index + 1].startswith("--"):
                raise PoolError(f"missing value for {flag}")
            if flag == "--difficulty":
                if difficulty_seen:
                    raise PoolError("duplicate --difficulty")
                difficulty = argv[index + 1]
                difficulty_seen = True
            else:
                if provenance_seen:
                    raise PoolError("duplicate --selection-provenance")
                provenance = argv[index + 1]
                provenance_seen = True
            index += 2
            continue
        raise PoolError(f"unknown or unexpected argument: {flag!r}")
    if provenance is None:
        provenance = "explicit" if difficulty_seen else "raw-default"
    if difficulty not in LEVELS:
        raise PoolError("difficulty must be routine, thorough, or critical")
    if provenance not in PROVENANCES:
        raise PoolError("selection provenance is invalid")
    return difficulty, provenance, allow


def _redact_diagnostic(text: str) -> str:
    patterns = [
        (r"(?i)(authorization[\"']?)\s*[:=]\s*[\"']?(?:bearer\s+)?[^\s,}\"']+[\"']?", r"\1=<redacted>"),
        (r"(?i)([\"']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?token|refresh[_-]?token|password|secret|credential|private[_-]?key)[\"']?)\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,}]+)", r"\1=<redacted>"),
        (r"(?i)(bearer)\s+[^\s,}\"]+", r"\1 <redacted>"),
    ]
    for pattern, replacement in patterns:
        text = re.sub(pattern, replacement, text)
    return text


def main(argv: list[str] | None = None) -> int:
    try:
        difficulty, provenance, allow = parse_cli(list(sys.argv[1:] if argv is None else argv))
        result = resolve_selection(difficulty, provenance, allow)
    except PoolError as exc:
        diagnostic = str(exc).replace("\n", " ")
        diagnostic = _redact_diagnostic(diagnostic)
        diagnostic = "".join(char for char in diagnostic if char in "\t\n" or unicodedata.category(char) != "Cc")
        diagnostic = diagnostic.encode("utf-8", errors="replace")[:4096].decode("utf-8", errors="ignore")
        print(f"review pool preflight failed: {diagnostic}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
