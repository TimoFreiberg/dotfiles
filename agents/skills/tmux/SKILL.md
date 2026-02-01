---
name: tmux
description: Run commands in a dedicated tmux session that humans can watch in real-time. Use this when the user wants to observe your work live, for long-running processes, or when interactive terminal access is needed.
---

# Tmux Session Skill

Run commands in a dedicated tmux session so a human can watch your work in real-time.

## Setup

Ensure tmux is installed:
```bash
which tmux || echo "tmux not installed"
```

## Usage

### Create or attach to a session

Create a new session named `pi-work` (or any name):
```bash
tmux new-session -d -s pi-work -c "$(pwd)"
```

### Run commands in the session

Send commands to the session:
```bash
tmux send-keys -t pi-work 'your-command-here' Enter
```

### Check command output

Capture the current pane content:
```bash
tmux capture-pane -t pi-work -p
```

Or capture with more history:
```bash
tmux capture-pane -t pi-work -p -S -100
```

### Wait for a command to complete

For long-running commands, you can poll the pane or use a marker:
```bash
# Send command with an end marker
tmux send-keys -t pi-work 'your-command; echo "===DONE==="' Enter

# Then check for the marker in output
tmux capture-pane -t pi-work -p | grep -q "===DONE==="
```

### Interactive programs

For programs that need input:
```bash
# Send input
tmux send-keys -t pi-work 'y' Enter

# Or send special keys
tmux send-keys -t pi-work C-c  # Ctrl+C
tmux send-keys -t pi-work C-d  # Ctrl+D
```

### Kill the session when done

```bash
tmux kill-session -t pi-work
```

## Human Watching

Tell the user to attach to the session in another terminal:
```bash
tmux attach -t pi-work
```

Or if they want read-only access:
```bash
tmux attach -t pi-work -r
```

## Best Practices

1. **Always capture output** after running commands to verify success
2. **Use unique session names** to avoid conflicts (e.g., include project name)
3. **Clean up sessions** when the work is complete
4. **Inform the user** of the session name so they can attach
5. **Handle errors** - check if session exists before sending commands:
   ```bash
   tmux has-session -t pi-work 2>/dev/null && echo "exists" || echo "not found"
   ```

## Workflow Example

1. Create session: `tmux new-session -d -s pi-work -c "$(pwd)"`
2. Tell user: "You can watch my work with: `tmux attach -t pi-work`"
3. Run commands via `tmux send-keys`
4. Capture and verify output with `tmux capture-pane`
5. When done: `tmux kill-session -t pi-work`
