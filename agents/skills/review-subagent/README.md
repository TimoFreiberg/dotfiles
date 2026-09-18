# Reviewer model groups

Shared reviewer guidance used by `review-subagent`. Model routing is configured
in `config/polytoken/config.yaml` under `modelgroups`.

## Axes

`CONTRACT.md` defines the report shape; each axis brief defines what to look for:

- `CORRECTNESS.md` — **C**, Correctness & Intent (owns test validity and, when an
  intent source is supplied, plan conformance)
- `STYLE.md` — **S**, Style & Design (owns test shape)
- `LEANNESS.md` — **L**, Leanness & Simplification (owns test machinery)

## Worker counts

| Difficulty | Group | Workers |
|---|---|---|
| routine | `review_routine` | 1, covering C+S+L |
| thorough | `review_thorough` | 3, one per axis |
| critical | `review_critical` | 3 × N, each axis on each of the N candidates |

Routine and thorough launch each assignment on its own, so every worker starts
at the group's first candidate and advances only on provider failure. Critical
launches one counted batch per axis, where clone *i* starts at candidate *i*, so
each axis is reviewed once per model. Reports stay attributable and are never
deduplicated or majority-voted.

Inspect the configured catalog with:

```sh
polytoken models --format json
```

Every model named in a group must appear there, or the whole group is
unroutable.
