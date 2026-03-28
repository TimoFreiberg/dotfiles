---
name: check-todos
description: "Check for open obligations on a PR: unresolved comments, self-announced follow-ups, Jira status."
argument-hint: "[pr <number>]"
allowed-tools:
  - Bash(gh *)
  - Bash(curl *)
  - Bash(jj *)
  - Bash(git *)
  - Read
  - Grep
  - Glob
---

## Repo state

- VCS: !`test -d .jj && echo "jj" || echo "git"`
- Bookmarks on or near @: !`test -d .jj && jj log -r 'heads(ancestors(@) & bookmarks())' --no-graph -T 'bookmarks.join(", ") ++ "\n"' 2>/dev/null || git branch --show-current 2>/dev/null`
- GitHub user: !`gh api user --jq '.login' 2>/dev/null || echo "unknown"`

## Step 1: Identify the PR

If `$ARGUMENTS` contains `pr <number>`, use that PR number.

Otherwise, auto-detect from the bookmarks listed above. For each bookmark, try:

```bash
gh pr view {bookmark} --json number,title,body,url --jq '"\(.number)\t\(.title)\t\(.body)\t\(.url)"'
```

Stop at the first bookmark that resolves to a PR. If none do, tell the user and stop — this skill needs a PR to work with.

Store: PR number, title, body, URL.

## Step 2: Gather data

Run these in parallel where possible:

### 2a. Unresolved review threads

Use the GraphQL API to fetch review threads with resolution status:

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes {
            isResolved
            isOutdated
            path
            line
            comments(first: 10) {
              nodes {
                author { login }
                body
                createdAt
              }
            }
          }
        }
      }
    }
  }
' -f owner='{owner}' -f repo='{repo}' -F number={pr_number}
```

Extract `{owner}` and `{repo}` from `gh repo view --json owner,name`.

Filter to threads where `isResolved: false` and `isOutdated: false`.

### 2b. Self-announced commitments

From the PR comments (both review comments from 2a and issue-level comments):

```bash
gh pr view {number} --comments --json comments --jq '.comments[] | "\(.author.login)\t\(.body)"'
```

Filter to comments authored by the current GitHub user. Look for commitment language:
- "I'll", "I will", "will do", "will fix", "will address", "let me", "going to"
- "TODO", "FIXME", "follow-up", "followup"
- "good point", "agreed" (when replying to a suggestion — implies intent to act)

### 2c. Current diff

Get the diff of the current PR branch to see what's already been addressed:

- **jj**: `jj diff --git -r 'latest(trunk())..@'`
- **git**: `git diff $(git merge-base HEAD main)..HEAD`

### 2d. Jira issue (if available)

Extract a Jira ticket ID from the PR title. Pattern: `\[([A-Z]+-\d+)\]` at the start of the title.

If found and `JIRA_URL`, `JIRA_API_TOKEN`, and `JIRA_USER_EMAIL` are all set:

```bash
curl -s -u "$JIRA_USER_EMAIL:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  "$JIRA_URL/rest/api/2/issue/{ticket_id}?fields=summary,status,assignee,subtasks,comment"
```

If env vars are missing, skip Jira with a note. If no ticket ID in the title, skip silently.

## Step 3: Analyze and cross-reference

For each unresolved, non-outdated review thread:
1. Check whether the file+region was modified in the current diff
2. If modified, read the current code to assess whether the comment was addressed
3. Classify as: **likely addressed** (code changed in that area), **still open** (no relevant change), or **unclear** (changed but not obviously related)

For each self-announced commitment:
1. Try to identify what the commitment refers to (file, concept, behavior)
2. Check the diff for evidence it was done
3. Classify as: **done**, **still open**, or **unclear**

For Jira:
1. Report the current issue status
2. List any subtasks and their statuses
3. Flag if the issue status doesn't match the PR state (e.g., issue still "To Do" but PR exists)

## Step 4: Present findings

### Summary line

Start with a one-line summary: "N open items found (X review comments, Y commitments, Z Jira items)" or "All clear — no open obligations found."

### Unresolved review comments

For each **still open** or **unclear** thread:
- File path and line number
- Reviewer and comment summary (1-2 lines)
- Your assessment: why it's still open or unclear
- If **likely addressed**, mention it briefly in a separate "probably done" list

### Unfulfilled commitments

For each **still open** commitment:
- Your comment text (abbreviated)
- What you committed to
- Current status

### Jira status

If a linked issue was found:
- Issue key, summary, current status
- Any subtasks not yet done
- Any status mismatch with PR state

### Suggested actions

For each open item, suggest a concrete next step:
- "Address reviewer comment at path/file.ts:42"
- "Follow up on your commitment to add error handling"
- "Update Jira issue status to In Progress"
