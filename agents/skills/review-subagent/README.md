# Reviewer model groups

This directory contains the shared reviewer guidance used by
`review-subagent` and `plan-conformance-review`. Model routing is configured in
`config/polytoken/config.yaml` under `modelgroups`.

## Model groups

- **routine** uses `review_routine`: GLM → Luna → DeepSeek for one combined
  report. The worker receives `CONTRACT.md`, `CORRECTNESS.md`, `DESIGN.md`, and
  `TESTS.md` and covers C, S, and T together.
- **thorough** uses `review_thorough`: GLM, Luna, and DeepSeek in three counted
  workers mapped to C/S/T by clone ordinal 1/2/3.
- **critical** uses `review_critical`: GLM, Sol, and DeepSeek in three counted
  workers mapped to C/S/T by clone ordinal 1/2/3.

Routine launches one worker with `mg:review_routine`. Thorough and critical
launch three counted workers with the corresponding group. Each clone starts at
a different group candidate, and Polytoken may advance an individual clone
after provider failure. Reports remain attributable and are never deduplicated
or majority-voted.

The configured model catalog can be inspected with:

```sh
polytoken models --format json
```
