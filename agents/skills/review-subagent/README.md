# Reviewer model groups

This directory contains the shared reviewer guidance used by
`review-subagent` and `plan-conformance-review`. Model routing is configured in
`config/polytoken/config.yaml` under `modelgroups`.

## Model groups

- **routine** uses `review_routine` for one combined C/S/T/L report. The worker
  receives `CONTRACT.md`, `CORRECTNESS.md`, `DESIGN.md`, `TESTS.md`, and
  `LEANNESS.md`.
- **thorough** uses `review_thorough` for four counted workers mapped to C/S/T/L
  by clone ordinal 1/2/3/4.
- **critical** uses `review_critical` with the same four-worker mapping.

Starting candidates rotate through the configured group, wrapping when needed;
provider failover may advance an individual clone. Reports remain attributable
and are never deduplicated or majority-voted. `plan-conformance-review` retains
its separate one/three-worker assignments.

The configured model catalog can be inspected with:

```sh
polytoken models --format json
```
