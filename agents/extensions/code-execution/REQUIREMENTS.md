# callTool API and callSignature field — Requirements

## Summary

Two additions to the extension system:

1. **`pi.callTool()`** — Call any registered tool by name and get its result,
   without adding anything to the session or conversation history.

2. **`callSignature` on ToolDefinition** — A TypeScript function signature
   describing how to call the tool programmatically. Used by `code_execution`
   to auto-generate the function docs injected into the system prompt.

## callTool API

### On ExtensionAPI (pi.*)

```typescript
interface ExtensionAPI {
    callTool(
        name: string,
        params: Record<string, unknown>,
        options?: CallToolOptions,
    ): Promise<CallToolResult>;
}

interface CallToolOptions {
    /** AbortSignal for cancellation. */
    signal?: AbortSignal;

    /**
     * Whether to fire tool_call/tool_result extension events.
     * Default: false.
     *
     * When true, extension hooks (permission gates, logging, etc.) run.
     * When false, the tool executes directly — avoids recursion when the
     * caller is itself a tool.
     */
    emitEvents?: boolean;
}

interface CallToolResult {
    content: (TextContent | ImageContent)[];
    details: unknown;
    isError: boolean;
}
```

### Implementation

- `emitEvents: false` (default) uses `_unwrappedToolRegistry` — tools without
  extension hook wrapping.
- `emitEvents: true` uses `_toolRegistry` — tools wrapped with `tool_call` and
  `tool_result` event emission.
- Does NOT add messages to session, emit agent events, or appear in history.

### Edge Cases

- Tool not found: throws `Error("Tool not found: {name}")`
- Tool throws: returns `{ content: [error message], details: {}, isError: true }`
- Signal aborted: passed through to tool

## callSignature field

### On ToolDefinition

```typescript
interface ToolDefinition {
    // ... existing fields ...

    /**
     * TypeScript function signature for programmatic calling.
     * Used by code_execution to generate in-scope function docs.
     *
     * Example:
     *   "async function read(path: string, options?: { offset?: number }): Promise<string>"
     *
     * If not provided, the tool won't appear in code_execution's available functions.
     */
    callSignature?: string;
}
```

### On ToolInfo (returned by getAllTools())

```typescript
type ToolInfo = Pick<ToolDefinition, "name" | "description" | "parameters" | "callSignature">;
```

### Built-in signatures

Built-in tools (read, write, edit, bash, grep, ls, find) have signatures defined
in `BUILTIN_CALL_SIGNATURES` in `agent-session.ts`. Extension tools provide their
own via the `callSignature` field on `ToolDefinition`.

The `code_execution` extension reads `pi.getAllTools()`, filters for tools with
`callSignature`, and auto-generates the system prompt documentation. This means:
- New tools automatically appear in code_execution if they set `callSignature`
- Tool overrides can provide their own signature
- No hand-maintained signature strings to keep in sync
