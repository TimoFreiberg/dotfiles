from __future__ import annotations

import importlib.util
import pathlib
import unittest

HERE = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("review_batch", HERE / "review_batch.py")
assert spec and spec.loader
batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch)


def code_report(axes: str = "C") -> str:
    axis_list = axes.split()
    verdicts = "\n".join(["correct"] * (len(axis_list) + 1))
    return f"# Code Review\n\nreviewed\n## Coverage\n- {axes}\n## Findings\nnone\n## Verdict\n{verdicts}\n"


def conformance_report(verdict: str) -> str:
    return f"# Plan Conformance Review\n\nreviewed\n## Intent ledger\n- R1 satisfied\n## Findings\nnone\n## Unexpected scope\nnone\n## Verdict\n{verdict}\n"


class BatchTests(unittest.TestCase):
    def test_fake_runner_exposes_explicit_start_boundary(self):
        fake = importlib.util.spec_from_file_location("fake_runner", HERE / "fake_runner.py")
        assert fake and fake.loader
        fixture = importlib.util.module_from_spec(fake)
        fake.loader.exec_module(fixture)
        runner = fixture.FakeRunner([fixture.FakeRunner.STARTUP_REJECTED, fixture.FakeRunner.VALID])
        results = runner.launch_routine()
        self.assertEqual([item["status"] for item in results], ["startup_rejected", "valid"])
        self.assertEqual(runner.calls, [0, 1])
        started = fixture.FakeRunner([fixture.FakeRunner.HANDLE_CREATED, fixture.FakeRunner.VALID])
        started_results = started.launch_routine()
        self.assertEqual([item["status"] for item in started_results], ["handle_created"])
        self.assertEqual(started.calls, [0])
        for status in (fixture.FakeRunner.TIMEOUT, fixture.FakeRunner.MALFORMED):
            outcome = fixture.FakeRunner([status]).launch_routine()
            self.assertEqual([item["status"] for item in outcome], [status])

    def test_difficulty_flags_are_not_forwarded_to_scope(self):
        parsed = batch.normalize_arguments(["--instructions", "focus", "--difficulty", "critical", "--allow-downgrade", "commit", "abc"])
        self.assertEqual(parsed["scope_args"], ["--instructions", "focus", "commit", "abc"])
        self.assertEqual(parsed["difficulty"], "critical")
        self.assertTrue(parsed["allow_downgrade"])
        with self.assertRaises(batch.BatchError):
            batch.normalize_arguments(["--difficulty", "routine", "--difficulty", "critical"])

    def test_selection_provenance_and_allow_downgrade_are_auditable(self):
        result = batch.normalize_arguments(["--selection-provenance", "plan-facet-claimed", "--allow-downgrade"])
        self.assertEqual(result["selection_provenance"], "plan-facet-claimed")
        self.assertTrue(result["allow_downgrade"])

    def test_fixture_batch_status_invariants(self):
        complete = batch.reduce_batch("code", "routine", [{"status": "valid", "report": code_report("C S T")}])
        self.assertEqual((complete["status"], complete["verdict"], complete["gate_passes"]), ("complete", "complete", True))
        incomplete = batch.reduce_batch("code", "thorough", [{"status": "valid", "axis": "C", "report": code_report("C")}, {"status": "timeout"}, {"status": "valid", "axis": "T", "report": code_report("T")}])
        self.assertEqual((incomplete["status"], incomplete["verdict"], incomplete["gate_passes"]), ("incomplete", "undetermined", False))

    def test_not_started_is_undetermined_and_not_gate_passing(self):
        result = batch.reduce_batch("code", "routine", [{"status": "startup_rejected"}, {"status": "startup_rejected"}])
        self.assertEqual(result["status"], "not_started")
        self.assertEqual(result["valid_reports"], [])
        self.assertFalse(result["gate_passes"])
        self.assertEqual(result["verdict"], "undetermined")

    def test_fixture_conformance_reduces_literal_verdict_tokens(self):
        result = batch.reduce_batch("plan_conformance", "thorough", [{"status": "valid", "report": conformance_report("conformant")}] * 3)
        self.assertEqual(result["verdict"], "conformant")
        result = batch.reduce_batch("plan_conformance", "thorough", [{"status": "valid", "report": conformance_report("conformant")}, {"status": "valid", "report": conformance_report("not conformant")}, {"status": "valid", "report": conformance_report("conformant")}])
        self.assertEqual(result["verdict"], "not conformant")
        result = batch.reduce_batch("plan_conformance", "thorough", [{"status": "valid", "report": conformance_report("clarification required")}, {"status": "valid", "report": conformance_report("not conformant")}, {"status": "valid", "report": conformance_report("conformant")}])
        self.assertEqual(result["verdict"], "clarification required")
        finding = "### A1 [blocking] R1 — requirement is missing\n\nThe implementation omits the requirement.\n\nEvidence: src/main.py:42 `missing_call()`\n"
        report = conformance_report("not conformant").replace("none", finding, 1)
        self.assertTrue(batch.validate_conformance_report(report)[0])
        reduced = batch.reduce_batch("plan_conformance", "routine", [{"status": "valid", "report": report}])
        self.assertEqual(reduced["verdict"], "not conformant")
        bad_status = report.replace("R1 satisfied", "R1 not satisfied")
        self.assertFalse(batch.validate_conformance_report(bad_status)[0])
        contradictory_status = report.replace("R1 satisfied", "R1 not satisfied; partial implementation")
        self.assertFalse(batch.validate_conformance_report(contradictory_status)[0])
        bad_prose = report.replace("### A1 [blocking]", "unstructured prose\n### A1 [blocking]")
        self.assertFalse(batch.validate_conformance_report(bad_prose)[0])

    def test_incomplete_round_requires_fresh_round(self):
        result = batch.reduce_batch("code", "thorough", [{"status": "valid", "report": code_report("C")}, {"status": "handle_created"}])
        self.assertTrue(batch.fresh_round_required(result))

    def test_independent_skill_selection_preserves_requested_policy(self):
        code = batch.normalize_arguments(["--difficulty", "routine", "--allow-downgrade"])
        plan = batch.normalize_arguments(["--difficulty", "routine", "--allow-downgrade"])
        self.assertEqual(code["difficulty"], plan["difficulty"])
        self.assertEqual(code["selection_provenance"], plan["selection_provenance"])

    def test_routine_success_after_startup_rejection_is_complete(self):
        result = batch.reduce_batch("code", "routine", [{"status": "startup_rejected"}, {"status": "valid", "report": code_report("C S T")}])
        self.assertEqual(result["status"], "complete")
        self.assertEqual(len(result["valid_reports"]), 1)
        trailing = batch.reduce_batch("code", "routine", [{"status": "valid", "report": code_report("C S T")}, {"status": "timeout"}])
        self.assertEqual(trailing["status"], "incomplete")

    def test_all_routine_startup_rejections_are_not_started(self):
        result = batch.reduce_batch("plan_conformance", "routine", [{"status": "startup_rejected"}] * 3)
        self.assertEqual(result["status"], "not_started")

    def test_started_failure_is_incomplete_without_retry(self):
        result = batch.reduce_batch("code", "routine", [{"status": "handle_created"}, {"status": "valid", "report": code_report("C S T")}])
        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(len(result["attempted"]), 1)

    def test_diagnostic_redaction_bounds_and_removes_secrets(self):
        value = "api_key=secret-token\x00\n" + "x" * 10000
        redacted = batch.redact_diagnostic(value)
        self.assertLessEqual(len(redacted.encode()), 4096)
        self.assertNotIn("secret-token", redacted)
        self.assertNotIn("\x00", redacted)
        self.assertIn("truncated", redacted)
        json_redacted = batch.redact_diagnostic('{"api_key": "json-secret", "Authorization": "Bearer bearer-secret"}')
        self.assertNotIn("json-secret", json_redacted)
        self.assertNotIn("bearer-secret", json_redacted)
        header_redacted = batch.redact_diagnostic("Authorization: Bearer header-secret authToken=camel-secret refresh_token=refresh-secret")
        self.assertNotIn("header-secret", header_redacted)
        self.assertNotIn("camel-secret", header_redacted)
        self.assertNotIn("refresh-secret", header_redacted)

    def test_report_validation_rejects_bad_severity_and_inconsistent_verdict(self):
        bad_severity = code_report("C").replace("none", "### C1 [blocker] bad")
        self.assertFalse(batch.validate_code_report(bad_severity)[0])
        contradictory = code_report("C").replace("none", "### C1 [critical] bad\n\nEvidence: file.py:1 \"bad\"").replace("correct", "needs attention")
        self.assertTrue(batch.validate_code_report(contradictory)[0])
        duplicate_axes = batch.reduce_batch("code", "thorough", [{"status": "valid", "axis": "C", "report": code_report("C")}] * 3)
        self.assertEqual(duplicate_axes["status"], "incomplete")
        extra = batch.reduce_batch("code", "thorough", [{"status": "valid", "axis": axis, "report": code_report(axis)} for axis in ("C", "S", "T")] + [{"status": "valid", "axis": "C", "report": code_report("C")}])
        self.assertEqual(extra["status"], "incomplete")
        self.assertFalse(extra["gate_passes"])
        self.assertIsNone(batch.conformance_verdict(conformance_report("conformant") + "extra"))
        self.assertFalse(batch.validate_code_report(code_report("C").replace("correct", "garbage"))[0])
        contradictory_final = code_report("C").replace("none", "### C1 [critical] bad").replace("correct", "C: needs attention\ncorrect")
        self.assertFalse(batch.validate_code_report(contradictory_final)[0])

    def test_fixture_diagnostics_are_bounded_and_redacted(self):
        self.test_diagnostic_redaction_bounds_and_removes_secrets()

    def test_successful_reports_are_preserved_on_partial_batch(self):
        report = code_report("C")
        result = batch.reduce_batch("code", "thorough", [{"status": "valid", "axis": "C", "report": report}, {"status": "malformed"}, {"status": "valid", "axis": "T", "report": code_report("T")}])
        self.assertEqual(result["valid_reports"][0]["report"], report)
        self.assertEqual(result["status"], "incomplete")

    def test_incomplete_batch_is_undetermined_and_not_gate_passing(self):
        result = batch.reduce_batch("plan_conformance", "thorough", [{"status": "valid", "report": conformance_report("conformant")}, {"status": "timeout"}, {"status": "valid", "report": conformance_report("conformant")}])
        self.assertEqual(result["verdict"], "undetermined")
        self.assertFalse(result["gate_passes"])

    def test_no_majority_vote_for_conflicting_reports(self):
        result = batch.reduce_batch("plan_conformance", "thorough", [{"status": "valid", "report": conformance_report("conformant")}, {"status": "valid", "report": conformance_report("not conformant")}, {"status": "valid", "report": conformance_report("conformant")}])
        self.assertEqual(len(result["valid_reports"]), 3)
        self.assertEqual(result["verdict"], "not conformant")


if __name__ == "__main__":
    unittest.main()
