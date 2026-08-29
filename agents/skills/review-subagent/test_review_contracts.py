from __future__ import annotations

import importlib.util
import pathlib
import unittest

HERE = pathlib.Path(__file__).parent

def load(name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

pool = load("review_pool_contracts", HERE / "review_pool.py")
batch = load("review_batch_contracts", HERE / "review_batch.py")


class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = {
            "default_model": "codex/gpt-5.6-luna",
            "default_small_model": "deepseek/deepseek-v4-flash",
            "models": [
                {"name": "zai/glm-5.3-flash", "provider": "zai", "reasoning": {"levels": ["high"]}, "selectable": ["zai/glm-5.3-flash", "zai/glm-5.3-flash(high)"]},
                {"name": "codex/gpt-5.6-luna", "provider": "codex", "reasoning": {"levels": ["xhigh"]}, "selectable": ["codex/gpt-5.6-luna", "codex/gpt-5.6-luna(xhigh)"]},
                {"name": "deepseek/deepseek-v4-flash", "provider": "deepseek", "reasoning": {"levels": ["high"]}, "selectable": ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-flash(high)"]},
                {"name": "codex/gpt-5.6-sol", "provider": "codex", "reasoning": {"levels": ["medium"]}, "selectable": ["codex/gpt-5.6-sol", "codex/gpt-5.6-sol(medium)"]},
            ],
        }

    def test_routine_code_prompt_requests_all_axes(self):
        selection = pool.resolve_selection("routine", "explicit", False, catalog=self.catalog)
        assignment = selection["assignments"]["code"]["assignments"][0]
        self.assertEqual(assignment["axis"], "C+S+T")
        self.assertEqual(batch.code_prompt_guidance("routine", assignment), ["CONTRACT.md", "CORRECTNESS.md", "DESIGN.md", "TESTS.md"])

    def test_parallel_code_slots_are_c_s_t_in_pool_order(self):
        selection = pool.resolve_selection("thorough", "explicit", False, catalog=self.catalog)
        assignments = selection["assignments"]["code"]["assignments"]
        self.assertEqual([item["axis"] for item in assignments], ["C", "S", "T"])
        self.assertEqual([item["worker_id"] for item in assignments], ["glm_flash", "codex_luna", "deepseek"])
        self.assertEqual(batch.code_prompt_guidance("thorough", assignments[1]), ["CONTRACT.md", "DESIGN.md"])

    def test_conformance_routine_and_replicated_slots(self):
        routine = pool.resolve_selection("routine", "explicit", False, catalog=self.catalog)
        thorough = pool.resolve_selection("thorough", "explicit", False, catalog=self.catalog)
        self.assertEqual(routine["assignments"]["plan_conformance"]["expected_slots"], 1)
        self.assertEqual([item["replica"] for item in routine["assignments"]["plan_conformance"]["assignments"]], ["P1", "P1", "P1"])
        self.assertEqual([item["replica"] for item in thorough["assignments"]["plan_conformance"]["assignments"]], ["P1", "P2", "P3"])
        self.assertEqual([item["worker_id"] for item in thorough["assignments"]["plan_conformance"]["assignments"]], ["glm_flash", "codex_luna", "deepseek"])

    def test_startup_rejection_can_fallback_only_for_routine(self):
        routine = batch.reduce_batch("code", "routine", [{"status": "startup_rejected"}, {"status": "valid", "report": "# Code Review\n## Coverage\nC S T\n## Findings\nnone\n## Verdict\ncorrect\ncorrect\ncorrect\ncorrect"}])
        self.assertEqual(routine["status"], "complete")
        parallel = batch.reduce_batch("code", "thorough", [{"status": "startup_rejected"}, {"status": "valid"}, {"status": "valid"}])
        self.assertEqual(parallel["status"], "incomplete")

    def test_runtime_failure_is_not_retried(self):
        result = batch.reduce_batch("code", "routine", [{"status": "timeout"}, {"status": "valid"}])
        self.assertEqual(len(result["attempted"]), 1)
        self.assertEqual(result["status"], "incomplete")

    def test_plan_facet_passes_selection_provenance(self):
        text = pathlib.Path("config/polytoken/facets/plan.md").read_text()
        self.assertIn("--selection-provenance plan-facet-claimed", text)
        self.assertIn("--allow-downgrade", text)
        self.assertIn("record the classification and rationale", text)

    def test_orchestrator_uses_effective_cardinality(self):
        text = pathlib.Path("agents/skills/orchestrator/SKILL.md").read_text()
        self.assertIn("effective level's cardinality", text)
        self.assertNotIn("all four reports", text)
        self.assertIn("fresh\nexplicitly numbered outer review round", text)

    def test_review_directives_cover_outer_output_contract(self):
        code = (HERE / "SKILL.md").read_text()
        conformance = (HERE.parent / "plan-conformance-review" / "SKILL.md").read_text()
        self.assertIn("## Reviewer: <worker-id> (<axis-or-combined>)", code)
        self.assertIn("## Reviewer: <worker-id> (<replica>)", conformance)
        self.assertIn("mechanically", code)
        self.assertIn("majority-vote", conformance)


if __name__ == "__main__":
    unittest.main()
