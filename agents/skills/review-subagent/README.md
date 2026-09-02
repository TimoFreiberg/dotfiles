# Reviewer pool

This directory contains the shared, credential-free reviewer pool used by
`review-subagent` and `plan-conformance-review`.

## Machine override

Copy the tracked example to the ignored local replacement and edit only the
worker model references:

```sh
cp review-pool.example.yaml review-pool.local.yaml
uv run review_pool.py --difficulty thorough --selection-provenance explicit
```

`review-pool.local.yaml` is a complete replacement, not a merge with the
example. A malformed local file fails closed; it never silently falls back.
Authentication belongs in Polytoken configuration or the environment, never in
this YAML file. The root `.gitignore` rule protects the local replacement.

Use exact selectable identifiers from `polytoken models --format json`, such as
`gpt-5.6-luna(xhigh)`. Provider names are catalog metadata, not part of an
identifier unless the configured model name itself contains a slash. The
resolver passes the identifier unchanged to the subagent launcher and fails
closed when it is not selectable. `uv` is required because `review_pool.py`
declares pinned `PyYAML==6.0.2` using PEP 723 metadata.

## Levels

- **routine** uses the configured workers in order for one eventual report. The
  code reviewer receives `CONTRACT.md`, `CORRECTNESS.md`, `DESIGN.md`, and
  `TESTS.md` and covers C, S, and T together. Only a pre-handle startup rejection
  may advance to the next candidate.
- **thorough** runs each configured model against C, S, and T in parallel, in
  model-major order.
- **critical** does the same with the critical configured model list.

Higher-level assignment counts are three times the selected pool size.
Conformance review produces the same number of independent copies; it does not
add artificial axes.
Reports remain attributable and are never deduplicated or majority-voted.

Raw skill invocations default to `thorough` with provenance `raw-default`.
Supplying `--difficulty` uses provenance `explicit`; the plan facet uses
`plan-facet-claimed`. `--allow-downgrade` is a visible operator opt-in that
allows only a pre-launch fallback from critical to thorough to routine. It is
not an authentication boundary. The selection notice records requested and
effective levels, provenance, config source, expected assignments, and any
preflight fallback.

The configured catalog is the authority for model availability. Inspect it with:

```sh
polytoken models --format json
```
