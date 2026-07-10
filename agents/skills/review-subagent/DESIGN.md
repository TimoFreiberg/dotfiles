### S — Design & Structure

**Bias conservative.** Like the documentation axis, these findings feed an
unsupervised fix loop — but the blast radius is larger: a design finding makes
the fixer *rewrite structure*, not just edit a comment. A wrong "inline this
abstraction" or "extract this helper" churns code that was fine. So:

- Flag only clear violations. Debatable structure → `[medium]` or stay silent.
- Reserve `[critical]`/`[high]` for truly egregious design violations — not merely
  suboptimal structure.
- Never demand rigor beyond what the surrounding code already exhibits. Match
  the codebase's established patterns; do not impose an idealized architecture.
- Quote the specific construct and say what the better shape is, so the fixer
  changes it surgically.

**The complexity-relocation test.** Before flagging something as "cleaner if
restructured," count the concepts a reader must hold to follow the change. If a
"cleaner" version leaves that count unchanged, it is not cleaner — it just moves
the complexity around. Only propose a restructuring that genuinely *reduces* the
concept count; otherwise stay silent.

> Escalation note (not yet built): when high-priority design violations keep
> recurring across fix-loop rounds without a good resolution, that is a signal
> to escalate to the human operator rather than churning. No mechanism exists
> for this yet — left here so the intent is not lost.

#### Primary smell — wrong placement / layering violations

This is the design issue most worth catching. Flag when:

- Code lives in the wrong module or layer (business logic in a request handler,
  I/O in a pure-logic module, parsing mixed into a domain type).
- A helper reaches across a boundary it should not (a low-level utility knowing
  about high-level types, a leaf module importing back up its own tree).
- A change is bolted onto a convenient file rather than where it belongs.

#### Primary smell — mistaken backwards compatibility / shim-stacking

Extremely common from LLMs: treating the rest of the codebase as off-limits and
piling on layer after layer of backwards-compat, fallbacks, and shims to avoid
touching existing callers — when the right move is to update the call sites too.
Flag added compatibility shims, adapter layers, or dual code paths that exist
only to avoid changing callers that are freely editable in this same codebase.
The fix is usually "update the callers" — which is itself a placement/layering
correction, so this pairs with the primary smell above.

#### Secondary smells

Good to catch, but seen less often — hold the same conservative bar:

- **Premature abstraction / speculative generality.** Wrappers, factories,
  config knobs, or trait/interface layers with a single implementation and no
  second caller in sight.
- **AI verbosity where idiomatic code is shorter.** A manual loop instead of a
  stdlib call, re-implementing a standard helper, needless intermediate
  variables, scaffolding a few idiomatic lines would replace.
- **Defensive over-engineering.** Redundant nil/None checks the type system
  already guarantees, try/except around code that cannot throw, validating
  already-validated input.
- **Over-broad visibility.** Helpers, types, or constants made public that
  should be private; internals leaking into the API surface.
- **Misleading names.** Names that do not match behavior — `get` that mutates,
  `is_x` returning a non-bool, names left stale after a refactor.
- **Duplication vs. wrong-DRY.** Both copy-paste that should be shared AND
  over-eager sharing that couples unrelated code.
- **Silent compiling stubs.** When building a larger change, code that quietly
  assumes later parts ship separately and leaves a stub that *compiles and
  returns a plausible value* — often with a comment explaining it is a stub —
  instead of a loud `todo!()`/`panic!`/assert that fails immediately if reached.
  Deferred work should be loud, not silent.
- **Drive-by edits.** Reformatting, renames, refactors, or comment rewrites in
  the diff that do not trace back to the change's stated purpose. They inflate
  the diff and obscure the real change. Flag the unrelated churn, not the
  intended edit.
- **Incomplete propagation.** A rename, signature, or schema change applied only
  to the sites in the diff, leaving other call sites on the old shape. (When it
  breaks the build or behavior it is a correctness bug too; the design framing is
  "update the remaining callers rather than shim around them.")

#### Other structure checks (from the base axis)

- New dependencies: justified for what they add?
- Unnecessary abstractions, wrappers, or indirection generally.
- API design: clear, minimal, hard to misuse?
- Consistency with surrounding code patterns.
- Line-level readability: nested ternaries, long chains, dense comprehensions;
  functions doing too many things.
