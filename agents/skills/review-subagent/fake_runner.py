"""Deterministic runner fixture for startup and runtime failure boundaries."""

from __future__ import annotations

from typing import Any


class Outcome:
    def __init__(self, status: str, report: str = "", diagnostic: str = ""):
        self.status = status
        self.report = report
        self.diagnostic = diagnostic


class FakeRunner:
    """Return explicit outcomes; a started failure is never converted to retry."""

    VALID = "valid"
    STARTUP_REJECTED = "startup_rejected"
    HANDLE_CREATED = "handle_created"
    TIMEOUT = "timeout"
    MALFORMED = "malformed"

    def __init__(self, outcomes: list[str | Outcome]):
        self.outcomes = [item if isinstance(item, Outcome) else Outcome(item) for item in outcomes]
        self.calls: list[int] = []

    def launch_routine(self) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for index, outcome in enumerate(self.outcomes):
            self.calls.append(index)
            result = {"worker_index": index, "status": outcome.status, "report": outcome.report, "diagnostic": outcome.diagnostic}
            results.append(result)
            if outcome.status != self.STARTUP_REJECTED:
                break
        return results

    def launch_parallel(self) -> list[dict[str, Any]]:
        results = []
        for index, outcome in enumerate(self.outcomes):
            self.calls.append(index)
            results.append({"worker_index": index, "status": outcome.status, "report": outcome.report, "diagnostic": outcome.diagnostic})
        return results
