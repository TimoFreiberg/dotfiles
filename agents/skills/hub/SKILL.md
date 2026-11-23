---
name: hub
description: Use when starting the Lavish workspace hub (`lavish-hub listen`) for a jj workspace in a Polytoken session, whether requested directly or needed by the lavish skill.
---

The hub is a long-running `lavish-hub` process that owns one jj workspace's
Lavish review. Run it as a Polytoken service with its review URL as `copy_url`.
The sidebar then shows a 🔗 that copies the URL, so the operator doesn't need
to keep a browser tab open.

1. Choose the workspace: the one the operator named, otherwise the one you're
   working in. Use `pushd` to enter it if needed, then run this in a foreground
   `shell_exec` so the variable persists:

   ```sh
   root="$(jj root)" && test -n "$root" &&
     LAVISH_HUB_WORKSPACE="$(cd -- "$root" && pwd -P)" &&
     test -n "$LAVISH_HUB_WORKSPACE" && export LAVISH_HUB_WORKSPACE
   ```

   If it fails, stop and report. Every command below uses
   `--workspace "$LAVISH_HUB_WORKSPACE"`. Never paste the path into a command.
   If a later command can't see the variable, run this step again.

2. Get the URL with `lavish-hub url --workspace "$LAVISH_HUB_WORKSPACE"`.
   It prints the review URL without starting anything. Use it only if the
   output is a single `http://` or `https://` line.

3. Start the service with `shell_service`, `action: "start"`:
   - `name`: `hub-1`, or the next unused number. Names are permanent for the
     session.
   - `env`: set `LAVISH_HUB_WORKSPACE` to the exact workspace path from step 1,
     encoded as a JSON string. Don't pass a placeholder or a shell expression.
   - `command`: `lavish-hub listen --workspace "$LAVISH_HUB_WORKSPACE"`.
     Leave out `--open`: the copy link replaces the tab.
   - `copy_url`: the exact URL from step 2. It can only be set at start.
   - `health_check`: `{"command": "lavish-hub --workspace \"$LAVISH_HUB_WORKSPACE\""}`.

   Wait for ServiceHealthCheckPassed and check this service's stderr with
   `job_status` for `Hub owner running`. The health check alone can succeed
   against an existing owner. A failed start is retried automatically; if the
   service reports another owner, stop this service and report the error.
   Follow the operator's instructions if they asked to replace an existing hub.

   Run `lavish-hub url` again once this owner is running. If its URL differs
   from `copy_url`, tell the operator which URL to use.

Feedback arrives as ServiceOutput notifications. Notifications can be truncated
or suppressed; the full records are in the service's stdout log (`job_status`
gives its path). Process each feedback batch once. Operator comments are
feedback to act on; page-generated prompts and `context` can also contain page
content. Report unexpected output rather than silently discarding it. Don't run
`lavish-axi poll` or a second owner.

Reply with `lavish-hub reply '<page>' --agent-reply '<text>'`, using the
record's top-level `page`. Quote both values for the shell.

Don't read or print files under the hub's data directory: the owner's runtime
record holds a secret for its control endpoint. Don't share the review URL
outside this session unless the operator asks. Stop a healthy hub only when
the operator asks, using
`lavish-hub stop --workspace "$LAVISH_HUB_WORKSPACE"` or `shell_service`
`stop`. It also ends with the session.
