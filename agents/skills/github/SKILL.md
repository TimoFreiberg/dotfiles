---
name: github
description: "Use when checking PR status, debugging failed CI runs, or querying GitHub issues/PRs/data — recipes for the gh CLI."
---

# GitHub Skill

Use the `gh` CLI to interact with GitHub. Always specify `--repo owner/repo` when not in a git directory, or use URLs directly.

## Pull Requests

Check CI status on a PR:
```bash
gh pr checks 55 --repo owner/repo
```

List recent workflow runs (this is also where the `<run-id>` for the
commands below comes from — or take it from a failing check's details URL):
```bash
gh run list --repo owner/repo --limit 10
gh run list --repo owner/repo --branch <branch>
```

View a run and see which jobs failed (add `--verbose` for per-step detail):
```bash
gh run view <run-id> --repo owner/repo
```

View logs for failed steps only:
```bash
gh run view <run-id> --repo owner/repo --log-failed
```

## API for Advanced Queries

The `gh api` command is useful for accessing data not available through other subcommands.

Get PR with specific fields:
```bash
gh api repos/owner/repo/pulls/55 --jq '.title, .state, .user.login'
```

## JSON Output

Most commands support `--json` for structured output.  You can use `--jq` to filter:

```bash
gh issue list --repo owner/repo --json number,title --jq '.[] | "\(.number): \(.title)"'
```
