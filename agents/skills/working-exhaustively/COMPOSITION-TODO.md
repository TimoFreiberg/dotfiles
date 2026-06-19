# Composition for `working-exhaustively` — parked idea

Status: **parked** (2026-06-19). Not needed now. Tier 0–1 below covers
interactive work — validated in skill testing: the in-context falsification floor
fired 3/3 with zero subagent spawns, so the prose stance carried the load without
any orchestration. Build upward only when a batch-shaped workload makes the pain
real — and watch for overengineering (see caveat).

## What composition would add

The prose skill gives the *stance* (decompose, sweep, falsify, declare caps) for
free. Programmatic composition — a Workflow-style engine that orchestrates
subagents in code — buys only what needs **state/control outside any single
agent's context**:

- **Enforcement.** A code loop can't be skipped; prose can (round-1 test: 0/9
  compliance on a spawn step before the floor was added).
- **Independence at scale + aggregation.** "3 verifiers × 12 findings, majority-
  vote each, dedup survivors" needs a coordinator outside the biased contexts.
- **Width / fan-out.** Audit 40 files, migrate 60 call-sites — real parallelism.
- **Typed handoff + resume.** Schema-validated returns between stages; resumable runs.

Root: composition earns its keep when work is too **wide** or **many-staged** for
one context to hold reliably. Interactive coding turns almost never are.

## The ladder (stop where your workload stops)

- **Tier 0 — prose skill + in-context falsification floor.** Have it. ~95% of turns.
- **Tier 1 — ad-hoc single-subagent verify.** Have it (pi subagents). Advisory.
- **Tier 2 — one primitive: `verify_claim`.** See sketch below. ← first build.
- **Tier 3 — full engine.** fan-out / loop-until-dry / judge panels / schema /
  resume. Only when a real audit/migration shows Tier 2 capping out.

## Tier 2 build sketch — `verify_claim` tool

Feasibility CONFIRMED. pi spawns subagents as subprocesses
(`spawn("pi", ["--mode","json","-p","--no-session", …])`, parse the JSON event
stream); `../../extensions/structured-output.ts` already returns schema-validated
JSON off `tool_execution_end.result.details`. Assembly, not invention.

Shape: register one model-callable tool `verify_claim{claim, context, k=3}`. It
spawns k refuters as separate pi processes — each gets ONLY the bare claim+context
(never the parent's reasoning), system-prompted to refute, defaulting to
refuted-if-unsure, ending on a `structured_output` verdict `{refuted, counterexample}`.
Majority-vote in code; return survives/refuted + counterexamples.

Three things it does that the in-context floor structurally **cannot**:
- True independence — a separate process can't see the parent's reasoning.
- Enforcement — k spawns + vote run in code; can't be skipped (round 1 was 0/9).
- Variance reduction — k-vote kills the single-refuter fluke.

Reuse: spawn+JSON-parse from `../../extensions/subagent/index.ts`; the
`structured_output` tool; the `roles.mjs` resolver for the refuter model. New:
~40-line tool + `runRefuter` + refuter prompt + capture `tool_execution_end`
(already a TODO in structured-output.ts). ~half a day.

Workflow unlocked: discipline #3 becomes "call `verify_claim` per load-bearing
finding; report only survivors." For review: N findings → verify each → surface
survivors with their counterexample. The Claude-app adversarial-verify pattern as
one tool, no engine. `runRefuter` is the atom a future Tier 3 reuses.

## Overengineering caveat

Owner flagged (2026-06-19): might not pay off. The test pass showed the *stance* is
free and Opus self-falsification is already decent, so `verify_claim`'s marginal
value is only the three structural wins above — most valuable on high-confidence
claims (confirmation bias worst) and ambiguous high-stakes calls. For a personal
single-user tool, real but incremental. Default to NOT building until a concrete
review workload makes a verified-findings-only pass visibly worth it.

## Related, more ambitious: durable subagents via RPC

The subagent extension spawns children in `--mode json -p` (one-shot: prompt in,
event stream out, process exits). pi's `--mode rpc` (docs/rpc.md) is a persistent
stdin/stdout JSONL process supporting `prompt` / `follow_up` / `steer` /
`get_messages` on a live session — i.e. durable subagents the parent can re-prompt,
steer mid-run, and inspect (pi's version of Claude Code's continuable subagents).
Two routes: subprocess RPC (`src/modes/rpc/rpc-client.ts`) or, cleaner for a TS
extension, in-process `AgentSession` (`src/core/agent-session.ts`) — no subprocess
or JSONL framing.

Different interaction model (stateful, one-at-a-time conversation), not a flag swap
on the existing parallel-delegation tool — likely a NEW capability beside it.
Further up the effort/overengineering axis than `verify_claim`; capture only.

## Open question — RESOLVED

pi CAN spawn subagents programmatically (the subagent extension does) and return
structured output. Feasibility was never the blocker; payoff vs overengineering is.
