# Pi tooling migration — WIP

Side project: move Timo's default coding agent from Claude Code to pi, building
extensions/skills to match Claude's tool surface, plus a per-machine role→model
config. Public dotfiles repo at `~/dotfiles`; **edit canonical sources in `agents/`,
never through symlinks.** A fresh session should read this file first.

pi's only built-in tools: `read bash edit write grep find ls`. Everything else is a
custom extension (model-callable tool) or skill (script/recipe).

---

## Done — committed this session (stacked on the working line, NOT on `main`)

1. `web-search`: fix dead OAuth refresh + fail-loud on stale token + `--check` mode (`agents/skills/web-search/search.mjs`)
2. `structured-output` extension — model-callable tool returning schema-validated JSON + `terminate:true` (verified live, pi 0.79.5)
3. role→model config layer: `agents/_lib/roles.mjs` (resolver) + `config/pi/agent/roles.{home,work}.json` + migrated `summarize` and the `subagent` extension
4. Option B tracking: `roles.json` gitignored + symlink → `roles.home.json` (per-machine: `ln -s roles.{home,work}.json roles.json`)
5. `mcp-bridge` extension — stdio MCP server bridge (verified live round-trip vs `@modelcontextprotocol/server-filesystem`) — **LATER REMOVED this session; superseded by pi-mcp-adapter (see remaining).**
6. `browser-preview` extension — Playwright, 8 tools incl. `preview_screenshot`→image content (verified via direct tool execution; model-in-loop blocked only by an anthropic quota)
7. `web-search` → `web-search` role migration (provider/model from roles.json; legacy auth-probe fallback)
8. `session-search` extension + `/search-sessions` command (verified live vs 235 real sessions)
9. `answer.ts` → `structured-extraction` role (now `deepseek-v4-flash`)
10. `answer.ts` rework: restored the LLM-callable `answer` tool (options-optional schema —
    free-text / single-select / multi-select), extended `QnAComponent` for choice rendering
    + keyboard nav + a "Type something" escape, and persist the FULL Q&A (incl. options) to
    the transcript via a pure `formatQnA` (unit-tested 6/6). Tests live in `agents/_tests/`
    (NOT `extensions/` — pi auto-loads every `.ts` there and would run/err on a test file).
    Interactive widget owes a manual TUI check (see Manual tests owed).
11. Backgroundable + streaming bash: new `agents/extensions/bash-jobs/` is the sole owner of
    `bash` — `bash(command, timeout?, background?)` + `job_poll`/`job_list`/`job_abort`.
    Foreground delegates to pi's `createBashToolDefinition` (streaming + truncation +
    temp-file); background spawns detached, streams full output to a per-job temp file, polls
    return capped deltas. Env spawn hook + compact bash render MOVED out of `compact-output.ts`
    (keeps read/write/grep/find) so `bash` is single-owned (verified: no conflict with all
    extensions enabled). Review fixes: background uses pi's `getShellConfig()` (/bin/bash,
    matching foreground — was `$SHELL`); `job_poll` trusts actual `bytesRead` (no NUL padding /
    lost bytes vs the async flush). Owes a manual TUI/model-in-loop check (no API key in env).
12. Re-enabled all extensions in `settings.json` (had been globally disabled by accident via
    pi-gui): compact-output, timestamps, prompt-timestamp are back on.

## To build / remaining

- [ ] **Install pi-mcp-adapter** (decided; `mcp-bridge/` already REMOVED from the repo). Run
  `pi install npm:pi-mcp-adapter` (Timo, on each machine — it writes a `packages` entry to the
  gitignored per-machine `settings.json`, so it is NOT captured by the dotfiles repo; consider
  a tracked bootstrap note for reproducibility). The adapter (MIT, active, ~v2.10.0) gives one
  ~200-token proxy tool with lazy on-demand discovery, stdio + HTTP/SSE, OAuth/sampling/
  resources/prompts/elicitation. `pi install npm:…` fetches only the published JS bundle
  (+deps) into `~/.pi/agent/npm/` — no repo clone. No live MCP config existed, nothing migrated.
- [x] **`structured-output` → `subagent` wiring — DECIDED: skip for now (option A).**
  Keep our custom `subagent` extension; do NOT wire schema-validated JSON in. Rationale:
  the subagent is invoked by the main pi agent (an LLM) which reads the child's prose fine —
  structured output only earns its keep when the *consumer is code* (chains, code-driven
  fan-out), which we don't do today. The standalone `structured-output.ts` tool stays
  (useful for skills/direct use); only the subagent wiring is dropped. See the
  "reconsider pi-subagents" note under Key context for the trigger to revisit.
- [x] **`structured-output` → `subagent` wiring — DECIDED: skip for now (option A).**
  Keep our custom `subagent` extension; do NOT wire schema-validated JSON in. Rationale:
  the subagent is invoked by the main pi agent (an LLM) which reads the child's prose fine —
  structured output only earns its keep when the *consumer is code* (chains, code-driven
  fan-out), which we don't do today. The standalone `structured-output.ts` tool stays
  (useful for skills/direct use); only the subagent wiring is dropped. See the
  "reconsider pi-subagents" note under Key context for the trigger to revisit.

## Pending decisions / verifications

- [ ] `roles.work.json` model ids are UNVERIFIED guesses — confirm on the work machine
  via `pi --list-models`, then `ln -s roles.work.json roles.json`. Bedrock opus id is
  most trustworthy; gemini/copilot least.
- [ ] `main` bookmark: the working line diverged from the PR #29 merge; left as-is per
  Timo. Reconcile when ready (read the jj skill first).
- (resolved) MCP lazy-discovery → adopt pi-mcp-adapter (see To build).
- (resolved) structured-output→subagent → skipped, option A (see To build).

## Follow-ups from completed work

- `btw.ts`: audit-only — if it ever pins a model, route through a role
  (`straightforward-impl`/`general-review`). No change needed now.
- `web-search`: optionally lift `getAgentDir`/`readJson`/`resolveConfigValue` into
  `_lib` (dedup; search.mjs keeps its own copies for now).
- `preview`: `package-lock.json` is gitignored (judgment call — drop that `.gitignore`
  line if reproducible installs matter); `playwright` (full) vs `playwright-core` size.
- Manual tests owed:
  - subagent role migration (4 steps): scout→recon→sonnet; `PI_ROLE_RECON=deepseek/...`
    override; general-purpose→high-effort-impl→opus; back-compat (`mv roles.json` aside →
    literal-model fallback + stderr note).
  - answer.ts: try the widget (free-text / single-select / multiSelect) + `/answer`;
    confirm the transcript shows the full Q&A.
  - browser-preview: model-in-loop round trip (was quota-blocked).
  - mcp-bridge: add a server to `~/.config/pi/agent/mcp-servers.json` and exercise.

## Key context / decisions (rationale for a fresh session)

- **role→model config:** `roles.json` is per-machine, NO secrets (just `provider/model:thinking`
  strings; keys live in gitignored `auth.json`/env). Resolver `agents/_lib/roles.mjs`:
  `resolveRole` (CLI-spec face) + `resolveRoleModel(role, modelRegistry)` (extension face).
  Resolution order: call-site override → `PI_ROLE_<ROLE>` env → `roles.json` → file
  `default` → built-in `DEFAULTS`. Hardened to reject `!`/`$`; fail-loud stderr note on
  fallback.
- **Symlink import gotcha:** extensions load via the `~/.pi/agent/extensions` symlink and
  pi resolves relative imports against the symlink path — a static `../../_lib/roles.mjs`
  import BREAKS at runtime. Use the `realpathSync(fileURLToPath(import.meta.url))` →
  absolute dynamic-import pattern (see `subagent/index.ts`, `answer.ts`). Skills invoked
  by real path don't have this problem.
- **`structured-extraction` = `deepseek-v4-flash`** — Timo rates ds4-flash cheaper AND
  better than haiku; "too weak" does NOT imply "go up-tier."
- **plan-mode: NOT wanted — do not build.**
- **Subagents — reconsider `nicobailon/pi-subagents` IF orchestration needs grow.** Our
  custom `subagent/index.ts` exists for two load-bearing reasons pi-subagents doesn't give
  for free: (1) the per-machine `roles.json` role→model layer (shared with the skills), and
  (2) the custom `subagent/system-prompt.ts` that dodges Claude Code OAuth third-party-harness
  detection (pi's default prompt mentions pi + doc links and trips the gate). `pi-subagents`
  (`npm:pi-subagents`, active, v0.28.0) is otherwise a superset: structured output (per-spawn
  `outputSchema`, validated via `structured_output`), chains (`{previous}`/`{outputs.name}`),
  background/async runs + notifications, worktree isolation, fallback models, usage stats.
  TRIGGER to switch: if the Claude-app-style **workflow / multi-agent orchestration** that
  Timo's been using in greenfield work starts wanting chains or code-driven fan-out here.
  Before adopting: verify `systemPromptMode: replace` can carry our harness-safe prompt, and
  bridge `roles.json` → agent `model:` frontmatter.
- **Capability verdicts (gap analysis):** built mcp-bridge/structured-output/browser-
  preview/session-search; skip computer-use/browser-automation/notebooks; use-existing
  for notifications/todos/worktrees(jj-workspaces). The old "background-tasks→use tmux"
  verdict is SUPERSEDED by the new backgroundable-bash + streaming requests above.
  Document-authoring: low priority (license risk vendoring Anthropic skills).
- Full gap-analysis JSON: `/tmp/pi-gap-result.json` (may be gone after reboot).
