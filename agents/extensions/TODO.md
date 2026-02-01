# review.ts Code Review Findings

## Completed

- [x] **TOCTOU race condition in PR checkout** - Fixed in f246f087
- [x] **Global Mutable State (`reviewOriginId`) Creates Subtle Bugs** - Eliminated the global variable; review state is now derived entirely from session state via `getReviewOriginId()`
- [x] **Silent Failure When `gh` CLI Not Installed** - Fixed: `getPrInfo` now captures and returns `stderr`, and callers display the actual error message to the user.
- [x] **Unsafe JSON Parsing Without Validation** - Fixed: Added explicit property checks for `baseRefName`, `title`, and `headRefName` before returning.

## Remaining Issues

### 🟡 Medium Priority

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
