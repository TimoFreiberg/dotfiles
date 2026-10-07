---
name: prompt-security-hardening
description: "Use when writing skills, AGENTS.md files, agent prompts, or shell snippets that touch environment variables, API credentials, file creation, or git operations. Covers keeping secrets out of context, safe shell patterns, and credential exposure."
---

Anything in your context goes to the model provider and its logs, so treat a
secret that enters context as leaked. Partial values and lengths count.

- Check that a secret exists, never its value: `[[ -v VAR ]] && echo set`.
  In config files, `grep -q VAR <file> && echo found`.
- Don't read files likely to hold secrets (`.env*`, `.envrc`, credential and
  key files, `~/.aws/credentials`, `~/.netrc`, MCP configs with `env` blocks).
  List key names instead (`grep -oE '^(export )?[A-Za-z_]+=' .env`). To check
  that a credential works, use it and look at the status code.
- In code, examples, and templates, read credentials from the environment.
  Never write real, fake, or placeholder values; `.env.example` gets empty
  values.
- Before creating a secret-bearing file, make sure git ignores it
  (`git check-ignore -v <file>`), and set mode 600 before writing to it.
- Keep tokens out of URLs and command-line arguments, where logs and `ps` see
  them: `curl -H @<(echo "Authorization: Bearer $TOKEN") …`. No tokens in git
  remote URLs.
- Quote shell variables built from tool output or input, and validate their
  shape before use.

When writing instructions for other agents, spell out the safe pattern
wherever one of these applies; agents drift to the unsafe default.
