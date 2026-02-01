# review.ts Code Review Findings

## Completed

- [x] **TOCTOU race condition in PR checkout** - Fixed in f246f087
- [x] **Global Mutable State (`reviewOriginId`) Creates Subtle Bugs** - Eliminated the global variable; review state is now derived entirely from session state via `getReviewOriginId()`

## Remaining Issues

### 🟡 Medium Priority

**Silent Failure When `gh` CLI Not Installed**

File: `review.ts:191-200`

```typescript
async function getPrInfo(pi: ExtensionAPI, prNumber: number): Promise<{ ... } | null> {
    const { stdout, code } = await pi.exec("gh", [...]);
    if (code !== 0) return null;  // Could be "command not found" or auth error
}
```

When `gh` fails, the error message says "Make sure gh is authenticated and the PR exists" - but the actual error could be:
- `gh` not installed
- Network failure
- Rate limiting
- Auth token expired

**Recommendation:** Capture and display `stderr` from the `gh` command to provide actionable error messages.

---

**Unsafe JSON Parsing Without Validation**

File: `review.ts:202-209`

```typescript
try {
    const data = JSON.parse(stdout);
    return {
        baseBranch: data.baseRefName,
        title: data.title,
        headBranch: data.headRefName,
    };
} catch {
    return null;
}
```

If `gh` returns valid JSON but with unexpected structure (e.g., GitHub API change), accessing `data.baseRefName` returns `undefined`, which propagates as an invalid return value rather than an error.

**Recommendation:** Add explicit property checks: `if (!data.baseRefName || !data.title || !data.headRefName) return null;`

---

**Inconsistent Error Handling Patterns**

Throughout the file, errors are handled inconsistently:
- Some functions use `try/catch` and return `null`
- Some check return codes and return `null`
- Some throw exceptions
- Error details are often discarded

**Recommendation:** Establish a consistent error handling pattern. Consider using a `Result<T, E>` type or at minimum, always log/display the underlying error message.

---

### 🟢 Low Priority

**`hasUncommittedChanges` Naming Could Be Clearer**

File: `review.ts:205-209`

```typescript
async function hasUncommittedChanges(pi: ExtensionAPI): Promise<boolean> {
    // Returns true for ANY changes (including untracked)
}
```

The name doesn't clearly convey that it includes untracked files.

**Recommendation:** Rename to `hasAnyUncommittedChanges` or add JSDoc comments.

---

**Review Session Can Be Orphaned**

If the user closes the terminal or the process crashes during a review session:
- The working tree may be on the PR branch
- No indication exists that a review was in progress

**Recommendation:** Consider checking for orphaned review state on extension load and prompting the user.

---

**Missing Input Sanitization Documentation for Custom Review Instructions**

File: `review.ts:443`

```typescript
case "custom": {
    const instructions = parts.slice(1).join(" ");
    if (!instructions) return null;
    return { type: "custom", instructions };
}
```

**Recommendation:** Document that custom instructions are passed verbatim to the LLM, not executed as shell commands.
