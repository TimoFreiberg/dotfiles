---
name: prompt-security-hardening
description: "Use when writing skills, CLAUDE.md files, agent prompts, or shell snippets that touch environment variables, API credentials, file creation, or git operations. Covers keeping secrets out of context, safe shell patterns, and credential exposure."
user-invocable: false
---

# Prompt Security Hardening

The agent's context window is sent to an API provider. Anything in context
becomes data shared with that provider — and, often, with anything
downstream that logs the conversation. The simplest model: any secret that
enters the agent's context is a leaked secret.

This skill is the small set of patterns that keep credentials out of
context, terminals, logs, and committed files. It applies whenever a
directive involves shell commands, environment variables, secret-bearing
files, or git operations.

## 1. Check for secrets without reading them

When you need to know whether an env var is set, check existence — don't
read the value.

```bash
# Safe: existence check, no value in output
[[ -v STRIPE_SECRET_KEY ]] && echo "set" || echo "not set"

# Also safe: works on older bash
[ -z "${STRIPE_SECRET_KEY+x}" ] && echo "not set" || echo "set"
```

```bash
# Unsafe — these put the value in your context
echo "$STRIPE_SECRET_KEY"
printenv STRIPE_SECRET_KEY
echo "Preview: ${STRIPE_SECRET_KEY:0:8}..."   # partial values still leak entropy
echo "Length: ${#STRIPE_SECRET_KEY}"           # length narrows the search space
env | grep STRIPE_SECRET_KEY                   # shows the value
```

A partial value or a length is still a leak. An 8-character prefix of an
API key narrows the search space dramatically; a length confirms format.

When checking shell config files (`~/.zshrc`, `~/.bashrc`, `~/.envrc`),
match for the variable's presence without printing the matching line:

```bash
# Safe — tells you whether the export exists, nothing about the value
grep -qc 'ANTHROPIC_API_KEY' ~/.zshrc && echo "found" || echo "not found"

# Unsafe — prints the full export line, value included
grep 'ANTHROPIC_API_KEY' ~/.zshrc
```

## 2. Keep secrets out of generated code and templates

Code examples in directives shape the code agents produce next. Always
reference env vars; never inline real or fake credentials.

```python
# Safe
stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

# Unsafe — reproduces training-data patterns, even with "test" keys
stripe.api_key = "sk_live_..."
stripe.api_key = "sk_test_..."
```

```yaml
# Safe
environment:
  DATABASE_URL: ${DATABASE_URL}

# Unsafe
environment:
  DATABASE_URL: postgresql://admin:password123@db:5432/myapp
```

Placeholder values like `changeme`, `your-api-key-here`, or
`postgres://user:password@localhost/db` look harmless but cost twice: they
train developers to put real values in the same spot, and they desensitize
secret-scanners (real alerts get lost in placeholder noise).

For committed `.env.example` files, prefer empty values:

```bash
# Safe — the shape is documented, no value is suggested
STRIPE_SECRET_KEY=
DATABASE_URL=
JWT_SECRET=

# Unsafe — fake credentials normalize the pattern
STRIPE_SECRET_KEY=sk_test_your_key_here
JWT_SECRET=change-this-to-something-secure
```

## 3. Restrict permissions on secret-bearing files

When creating any file that holds secrets — `.env`, `.envrc`, key files,
config with embedded tokens — set `0600` immediately, before populating it.

```bash
touch .env && chmod 600 .env
# now safe to write secrets to it

chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub
```

Default umask usually produces `0644` — world-readable. SSH refuses to use
keys with open perms; `.env` files have no such guardrail, so the
discipline has to come from the workflow.

## 4. Verify .gitignore before creating secret files

Before creating a secret-bearing file, make sure git will ignore it.

```bash
git check-ignore -v .env || echo ".env" >> .gitignore
touch .env && chmod 600 .env

# Same pattern for direnv
git check-ignore -v .envrc || echo ".envrc" >> .gitignore
```

This applies to anything that will hold credentials: `.env`, `.envrc`,
`secrets.conf`, `credentials.json`, key files, MCP configs with embedded
tokens.

## 5. Keep tokens out of URLs and process arguments

Tokens in URLs end up in server access logs, proxy logs, and browser
history. Tokens in command-line arguments are visible to other users via
`ps aux`.

```bash
# Safe — token in a header
curl -H "Authorization: Bearer ${API_TOKEN}" https://api.example.com/data

# Unsafe — token in URL query string, logged everywhere
curl "https://api.example.com/data?api_key=${API_TOKEN}"
```

For git, avoid embedding tokens in clone URLs:

```bash
# Unsafe — token persists in .git/config and shell history
git clone "https://${GITHUB_TOKEN}@github.com/org/repo.git"

# Safer — credential helper or GIT_ASKPASS
git config --global credential.helper store
echo "https://oauth2:${GITHUB_TOKEN}@github.com" | git credential-store store
git clone https://github.com/org/repo.git
```

If a CLI insists on taking the token as an argument and there's no header
or stdin alternative, use process substitution to shrink the exposure
window:

```bash
curl -H @<(echo "Authorization: Bearer ${API_TOKEN}") https://api.example.com/data
```

## 6. Quote variables, validate external input

When constructing shell commands from file contents, tool output, or user
input, quote everything and validate the input shape.

```bash
# Unsafe — unquoted, vulnerable to metacharacter injection
FILENAME=$(some_tool_output)
cat $FILENAME

# Safe
cat "$FILENAME"
```

```bash
# Unsafe — user input interpolated raw
USER_INPUT="$1"
find . -name $USER_INPUT

# Safe — validated and quoted
USER_INPUT="$1"
[[ "$USER_INPUT" =~ ^[a-zA-Z0-9._-]+$ ]] || { echo "invalid input" >&2; exit 1; }
find . -name "$USER_INPUT"
```

For SQL inside shell, use parameter binding rather than string
interpolation:

```bash
# Unsafe
psql -c "SELECT * FROM users WHERE name = '$USERNAME'"

# Safe — psql variable binding
psql --variable="username=$USERNAME" -c "SELECT * FROM users WHERE name = :'username'"
```

## 7. Be deliberate about which files you read

Reading a file pulls its contents into the context window. Before reading,
ask whether the file might contain secrets.

Files that commonly do:

- `.env`, `.envrc`, `*.env.*`
- `credentials.json`, `secrets.*`, `*-key.pem`
- MCP configs with `env` blocks
- Docker `.env` files
- `~/.aws/credentials`, `~/.netrc`, `~/.npmrc` with auth tokens

When debugging configuration, you usually need *structure*, not values:

```bash
wc -l .env                              # number of entries
grep -c '=' .env                        # number of key=value pairs
grep '^[A-Z_]*=' .env | cut -d= -f1     # list keys, not values
stat .env                               # metadata
```

## Applying this to directives you write

When writing a skill, CLAUDE.md, or agent prompt:

- Code examples reference env vars or secret managers — never placeholder
  credentials.
- Shell snippets that check configuration use existence checks, not value
  reads.
- Workflows involving credentials spell the safe pattern out — defaults
  drift toward the unsafe one.
- File-creation steps include `chmod 600` and a gitignore check.
- Verification steps inspect structure or key names, never values.

## Quick reference

| Need                       | Safe                                                  | Unsafe                                  |
|----------------------------|-------------------------------------------------------|-----------------------------------------|
| Check env var exists       | `[[ -v VAR ]]` or `[ -z "${VAR+x}" ]`                | `echo $VAR`, `printenv VAR`             |
| Use credential in code     | `os.environ["KEY"]`                                  | `key = "sk_live_..."`                  |
| Create secret file         | `touch f && chmod 600 f`                             | `echo "secret" > f` (mode 644)          |
| Pre-commit safety          | `git check-ignore -v .env` first                     | Create `.env` and hope                  |
| API auth                   | `-H "Authorization: Bearer $TOKEN"`                  | `?api_key=$TOKEN` in URL                |
| Git clone with token       | Credential helper or `GIT_ASKPASS`                   | `https://token@github.com/...`          |
| Inspect config             | `grep '^KEY=' f \| cut -d= -f1`                      | `cat f`, `source f`                    |
| Use a shell variable       | `"$VAR"` (quoted)                                    | `$VAR` (unquoted)                       |
