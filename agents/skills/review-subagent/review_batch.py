"""Dependency-free fixture mechanics for reviewer assignment and batch outcomes."""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Iterable

LEVELS = ("routine", "thorough", "critical")
PROVENANCES = ("raw-default", "explicit", "plan-facet-claimed")
MAX_DIAGNOSTIC_BYTES = 4096


class BatchError(ValueError):
    pass


def normalize_arguments(argv: list[str]) -> dict[str, Any]:
    """Strip pool controls while preserving scope and intent arguments."""
    difficulty = "thorough"
    provenance: str | None = None
    allow = False
    scope: list[str] = []
    seen: set[str] = set()
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--allow-downgrade":
            if arg in seen:
                raise BatchError("duplicate --allow-downgrade")
            seen.add(arg)
            allow = True
        elif arg in {"--difficulty", "--selection-provenance"}:
            if arg in seen:
                raise BatchError(f"duplicate {arg}")
            if index + 1 >= len(argv) or argv[index + 1].startswith("--"):
                raise BatchError(f"missing value for {arg}")
            seen.add(arg)
            value = argv[index + 1]
            if arg == "--difficulty":
                difficulty = value
            else:
                provenance = value
            index += 1
        elif arg.startswith("--difficulty=") or arg.startswith("--selection-provenance="):
            raise BatchError("control flags require a separate value")
        else:
            scope.append(arg)
        index += 1
    if difficulty not in LEVELS:
        raise BatchError("difficulty must be routine, thorough, or critical")
    if provenance is None:
        provenance = "explicit" if "--difficulty" in seen else "raw-default"
    if provenance not in PROVENANCES:
        raise BatchError("selection provenance is invalid")
    return {"difficulty": difficulty, "selection_provenance": provenance, "allow_downgrade": allow, "scope_args": scope}


def assignment_descriptions(selection: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    if kind not in {"code", "plan_conformance"}:
        raise BatchError("kind must be code or plan_conformance")
    try:
        assignments = selection["assignments"][kind]["assignments"]
    except (KeyError, TypeError) as exc:
        raise BatchError("selection has no assignment view") from exc
    return [dict(item) for item in assignments]


def code_prompt_guidance(level: str, assignment: dict[str, Any]) -> list[str]:
    if level == "routine":
        return ["CONTRACT.md", "CORRECTNESS.md", "DESIGN.md", "TESTS.md"]
    axis = assignment.get("axis")
    return {"C": ["CONTRACT.md", "CORRECTNESS.md"], "S": ["CONTRACT.md", "DESIGN.md"], "T": ["CONTRACT.md", "TESTS.md"]}[axis]


def validate_code_report(report: str, expected_axes: Iterable[str] = ("C",)) -> tuple[bool, str]:
    expected_axes = tuple(expected_axes)
    if not isinstance(report, str) or not report:
        return False, "empty output"
    if not report.startswith("# Code Review\n"):
        return False, "missing exact # Code Review heading"
    lines = report.splitlines()
    headings = ("## Coverage", "## Findings", "## Verdict")
    heading_lines = [index for index, line in enumerate(lines) if line in headings]
    if len(heading_lines) != len(headings) or [lines[index] for index in heading_lines] != list(headings):
        return False, "missing or out-of-order report headings"
    positions = [report.find(f"{heading}\n") for heading in headings]
    coverage = report[positions[0] : positions[1]]
    for axis in expected_axes:
        if not re.search(rf"\b{re.escape(axis)}\b", coverage):
            return False, f"missing expected axis {axis}"
    findings = report[positions[1] : positions[2]]
    finding_lines = [line for line in findings.splitlines() if line.strip() and not line.strip().startswith("## Findings")]
    finding_headings = [line for line in finding_lines if line.startswith("### ")]
    if finding_headings:
        allowed_prefixes = "".join(re.escape(axis) for axis in expected_axes if axis in {"C", "S", "T"})
        if any(not re.fullmatch(rf"### [{allowed_prefixes}]\d+ \[(?:critical|high|medium|low)\] .+", line) for line in finding_headings):
            return False, "malformed or misattributed finding heading"
        for index, heading in enumerate(finding_headings):
            start = findings.find(heading)
            end = findings.find(finding_headings[index + 1], start + len(heading)) if index + 1 < len(finding_headings) else len(findings)
            if "Evidence:" not in findings[start:end]:
                return False, "finding lacks Evidence line"
    elif any(line.strip().lower() != "none" for line in finding_lines):
        return False, "findings section is neither none nor structured findings"
    verdict_lines = [line.strip().lower() for line in report[positions[2] + len("## Verdict") :].splitlines() if line.strip()]
    expected_verdicts = len(tuple(expected_axes)) + 1
    if len(verdict_lines) != expected_verdicts or any(line not in {"correct", "needs attention"} for line in verdict_lines):
        return False, "missing or invalid axis/overall verdicts"
    if re.search(r"\[(?:critical|high)\]", findings, re.IGNORECASE) and verdict_lines[-1] != "needs attention":
        return False, "verdict is inconsistent with critical or high findings"
    return True, "valid"


def validate_conformance_report(report: str) -> tuple[bool, str]:
    if not isinstance(report, str) or not report.startswith("# Plan Conformance Review\n"):
        return False, "missing exact # Plan Conformance Review heading"
    headings = ("## Intent ledger", "## Findings", "## Unexpected scope", "## Verdict")
    lines = report.splitlines()
    heading_lines = [index for index, line in enumerate(lines) if line in headings]
    if len(heading_lines) != len(headings) or [lines[index] for index in heading_lines] != list(headings):
        return False, "missing or out-of-order report headings"
    positions = [report.find(f"{heading}\n") for heading in headings]
    ledger = report[positions[0] : positions[1]]
    findings = report[positions[1] : positions[2]]
    allowed_statuses = {"satisfied", "partial", "missing", "scope-deviated", "decision-violated", "deferral-violated", "indeterminate", "not-applicable"}
    ledger_items = [line for line in ledger.splitlines() if line.strip().startswith("-")]
    if not ledger_items or any(not re.search(r"\b(?:R|I|N|D|F)\d+\b.*?\b(?:satisfied|partial|missing|scope-deviated|decision-violated|deferral-violated|indeterminate|not-applicable)\b", line) for line in ledger_items):
        return False, "invalid ledger status"
    finding_lines = [line for line in findings.splitlines() if line.strip() and not line.strip().startswith("## Findings")]
    if not finding_lines and "none" not in findings.lower():
        return False, "findings section is empty or malformed"
    finding_headings = [line for line in finding_lines if line.startswith("### ")]
    if any(not line.startswith("### ") for line in finding_lines if line.strip().lower() != "none"):
        return False, "findings section is malformed"
    if any(not re.fullmatch(r"### .+ \[(?:blocking|clarification)\] .+", line) for line in finding_headings):
        return False, "invalid finding tag"
    for index, heading in enumerate(finding_headings):
        start = findings.find(heading)
        end = findings.find(finding_headings[index + 1], start + len(heading)) if index + 1 < len(finding_headings) else len(findings)
        if "Evidence:" not in findings[start:end] and "Search:" not in findings[start:end] and "Ambiguity:" not in findings[start:end]:
            return False, "finding lacks evidence"
    verdict = conformance_verdict(report)
    if verdict is None:
        return False, "missing allowed verdict"
    return True, "valid"


def conformance_verdict(report: str) -> str | None:
    marker = "## Verdict"
    if marker not in report:
        return None
    tail = report[report.rfind(marker) + len(marker) :].strip()
    lines = [line.strip().lower() for line in tail.splitlines() if line.strip()]
    if len(lines) != 1 or lines[0] not in {"clarification required", "not conformant", "conformant"}:
        return None
    return lines[0]


def redact_diagnostic(value: Any, limit: int = MAX_DIAGNOSTIC_BYTES) -> str:
    if limit < 32:
        raise ValueError("diagnostic limit is too small")
    text = str(value).replace("\r", "")
    text = "".join(char for char in text if char in "\t\n" or unicodedata.category(char) != "Cc")
    patterns = [
        (r"(?i)(authorization[\"']?)\s*[:=]\s*[\"']?(?:bearer\s+)?[^\s,}\"']+[\"']?", r"\1=<redacted>"),
        (r"(?i)([\"']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?token|refresh[_-]?token|password|secret|credential)[\"']?)\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,}]+)", r"\1=<redacted>"),
        (r"(?i)(bearer)\s+[^\s,}\"]+", r"\1 <redacted>"),
        (r"(?i)(review-pool\.local\.yaml|local_config|serialized local configuration)\s*[:=]?[^\n]*", r"\1=<redacted>"),
    ]
    for pattern, replacement in patterns:
        text = re.sub(pattern, replacement, text)
    encoded = text.encode("utf-8", errors="replace")
    if len(encoded) <= limit:
        return text
    marker = "…[truncated]"
    marker_bytes = marker.encode("utf-8")
    prefix = encoded[: limit - len(marker_bytes)]
    prefix = prefix.decode("utf-8", errors="ignore")
    return prefix + marker


def reduce_batch(kind: str, level: str, outcomes: list[dict[str, Any]]) -> dict[str, Any]:
    """Reduce fixture outcomes without retrying started failures or voting."""
    if kind not in {"code", "plan_conformance"} or level not in LEVELS:
        raise BatchError("invalid batch kind or level")
    expected = 1 if level == "routine" else 3
    valid: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    startup_rejections: list[dict[str, Any]] = []
    attempted = []
    if level == "routine":
        for outcome in outcomes:
            attempted.append(outcome)
            status = outcome.get("status")
            if status == "startup_rejected":
                startup_rejections.append(outcome)
                continue
            if status == "valid":
                checker = validate_conformance_report if kind == "plan_conformance" else validate_code_report
                axes = ("C", "S", "T") if kind == "code" else ("C",)
                ok, reason = checker(outcome.get("report", ""), axes) if kind == "code" else checker(outcome.get("report", ""))
                if ok:
                    valid.append(outcome)
                else:
                    failures.append({**outcome, "status": "invalid", "diagnostic": reason})
                break
            failures.append(outcome)
            break
        if valid and len(outcomes) != len(attempted):
            failures.append({"status": "invalid", "diagnostic": "unexpected routine outcome count"})
    else:
        attempted = outcomes[:]
        if len(outcomes) != expected:
            failures.append({"status": "invalid", "diagnostic": f"expected {expected} outcomes, got {len(outcomes)}"})
        seen_axes: set[str] = set()
        for outcome in outcomes[:expected]:
            if outcome.get("status") == "valid":
                checker = validate_conformance_report if kind == "plan_conformance" else validate_code_report
                axis = outcome.get("axis", "C")
                if kind == "code" and (axis not in {"C", "S", "T"} or axis in seen_axes):
                    failures.append({**outcome, "status": "invalid", "diagnostic": "duplicate or invalid axis"})
                    continue
                if kind == "code":
                    seen_axes.add(axis)
                axes = (axis,) if kind == "code" else ("C",)
                ok, reason = checker(outcome.get("report", ""), axes) if kind == "code" else checker(outcome.get("report", ""))
                if ok:
                    valid.append(outcome)
                else:
                    failures.append({**outcome, "status": "invalid", "diagnostic": reason})
            else:
                failures.append(outcome)
    routine_complete = level == "routine" and len(valid) == 1 and not failures
    parallel_complete = level != "routine" and len(valid) == expected and not failures and len(attempted) == expected
    if routine_complete or parallel_complete:
        status = "complete"
    elif valid or failures:
        status = "incomplete"
    elif startup_rejections:
        status = "not_started"
    else:
        status = "not_started"
    if status == "complete":
        failures = []
    else:
        failures = startup_rejections + failures
    if status == "not_started":
        verdict = "undetermined"
    elif status != "complete":
        verdict = "undetermined"
    elif kind == "plan_conformance":
        verdicts = [conformance_verdict(item.get("report", "")) for item in valid]
        if any(item == "clarification required" for item in verdicts):
            verdict = "clarification required"
        elif any(item == "not conformant" for item in verdicts):
            verdict = "not conformant"
        elif all(item == "conformant" for item in verdicts):
            verdict = "conformant"
        else:
            verdict = "undetermined"
    else:
        verdict = "complete"
    return {"kind": kind, "level": level, "expected_reports": expected, "status": status, "verdict": verdict, "valid_reports": valid, "failures": failures, "attempted": attempted, "gate_passes": status == "complete" and verdict == ("conformant" if kind == "plan_conformance" else "complete")}


def fresh_round_required(batch: dict[str, Any]) -> bool:
    return batch.get("status") in {"incomplete", "not_started"} or batch.get("verdict") == "undetermined"
