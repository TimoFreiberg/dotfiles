---
name: writing-agent-instructions
description: "Use when writing or reviewing agent skills, prompts, or AGENTS.md / CLAUDE.md files — loads the relevant dotfiles authoring guides on demand."
disable-model-invocation: true
polytoken:
  disable_model_invocation: true
---

# Writing Agent Instructions

Read the authoring guides from `$HOME/dotfiles/.polytoken/skills/` as files;
they are repo-local and may not be registered in the current project's skill
registry. Resolve `$HOME` to the user's home directory before passing paths
to a file tool; file tools need not expand environment variables.

Read `writing-claude-directives/SKILL.md` first, then select only the guides
needed for the task:

| Task | Guide under the directory above |
|------|---------------------------------|
| Create, edit, or review a skill | `writing-skills/SKILL.md` |
| Create or update AGENTS.md / CLAUDE.md | `writing-claude-md-files/SKILL.md` |
| Pressure-test a skill's behavioral rules | `testing-skills-with-subagents/SKILL.md` |
| Write instructions involving shell commands, environment variables, credentials, file creation, or version control | `prompt-security-hardening/SKILL.md` |

Apply the selected guides to the user's requested task in the current project.
Resolve relative links from each guide's own directory, not the project cwd.
If a guide is missing or access requires approval, report that and request
access rather than silently proceeding without it. Keep the underlying guides
repo-local; reading them does not require copying or globally registering them.
