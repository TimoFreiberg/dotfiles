### C — Correctness & Security

**Bias toward surfacing.** Unlike the documentation, design, and test axes —
where an unsupervised fixer's danger is destructive edits, so the bar to flag is
high — the expensive failure for correctness is a *missed* real bug that ships.
Lower the bar for raising genuine defects here.

**But gate on verifiable evidence.** A confident-but-wrong correctness finding
makes the fixer add a defensive check or rewrite arithmetic that was fine,
churning correct code. So surface generously only for concrete, pointable
defects: every finding must cite real `file:line` + quoted code a reader can
verify in under 30 seconds. Drop speculative concerns — "this could overflow if
callers ever pass a huge value" with no such caller is not a finding.

#### Primary smell — silent error-swallowing / fallback-masking

The operator's failure philosophy: *prefer crashing over silent workarounds; a
failure you can diagnose beats corrupted state downstream.* Flag code that hides
failures instead of surfacing them loudly:

- try/except (or equivalent) that logs and continues past a real error.
- `unwrap_or(default)`, `?? fallback`, or similar that substitutes a plausible
  value for a failure, masking it.
- Empty catch blocks; swallowed or ignored error returns.
- Fallbacks that let the program limp along in a corrupted state rather than
  failing fast.

(A stub that silently *compiles and returns a plausible value* instead of a loud
`todo!()`/`panic!` is related — but flag that in the design axis, since the
defining trait is deferred-work decomposition, not a wrong computation.)

#### Context-boundary wrongness (LLM-characteristic)

Generated code tends to be plausible, locally consistent, and wrong exactly
where the generator's context ended. Read out-of-diff ground truth to catch:

- **Fabricated API.** Calls to methods, fields, options, or config keys that do
  not exist, or exist with a different signature or semantics. Verify against the
  actual definition, not the plausible-looking call.
- **Context-boundary drift.** Code internally consistent but inconsistent with
  unseen code it depends on — call-site contracts, serialization pairs (encode
  vs decode), config schemas, save/load compatibility.
- **Incomplete propagation.** A rename, signature change, or schema change
  applied only to the sites in the diff and not to the other call sites that
  need it. (When the fix is "update the remaining callers," this pairs with the
  design axis; when it leaves the program broken, it is a correctness bug.)

#### Core correctness smells

- Logic bugs, off-by-one, incorrect control flow, boundary/edge cases (nil,
  empty collections, integer limits, Unicode edges).
- Memory safety: use-after-free, double-free, uninitialized reads, unsound
  `unsafe`, lifetime issues.
- Integer issues: overflow/truncation on cast, unchecked arithmetic.
- Untrusted input → shell/path/format/serialization (prefer escaping over
  sanitization).
- Concurrency: data races, missing synchronization, lock ordering, TOCTOU.
- Resource leaks.
- Error handling generally: unchecked errors, wrong error codes.
- Behavioral regressions: changed return values, dropped side effects, altered
  invariants.
