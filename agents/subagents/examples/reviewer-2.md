---
name: reviewer-2
description: Review code for the review-subagent skill.
polytoken:
  # Optional local pin, e.g. `model: provider/model-name` or `model: default_model:full`.
  inherit_tools: true
  allow_subagent_spawn: false
  skills_allow: []
  skills_deny: []
  exit_tool_schema:
    type: object
    additionalProperties: false
    required: [summary]
    properties:
      summary:
        type: string
      files:
        type: array
        items:
          type: string
---
{{ transclude("reviewer-system-prompt.md") }}

When the review is complete, call `exit_tool` with `summary` set to your full
review report. The summary must start with `# Code Review`.
