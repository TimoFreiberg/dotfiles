#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home" XDG_STATE_HOME="$tmp/state" PATH="$tmp/bin:$PATH"
mkdir -p "$HOME" "$tmp/bin" "$tmp/project/dir" "$tmp/jj-review-diff.12345678/old/dir" "$tmp/jj-review-diff.12345678/new/dir" "$XDG_STATE_HOME/zed-review"
printf 'first\n  real line  \n' > "$tmp/project/dir/file"
printf 'first\n  old line  \n' > "$tmp/jj-review-diff.12345678/old/dir/file"
printf 'first\n  snapshot line  \n' > "$tmp/jj-review-diff.12345678/new/dir/file"
jq -n --arg root "$tmp/project" '{root:$root,revset:"@",terminal:"term-1",created:"test"}' > "$XDG_STATE_HOME/zed-review/current.json"
export ZED_ROW=2 ZED_COLUMN=3
export ZED_FILE="$tmp/project/dir/file"
output=$(printf 'fix this\n' | bash "$repo/bin/zed-review" comment)
[[ $output == *'Comment on dir/file:2 (new)'* ]]
export ZED_FILE="$tmp/jj-review-diff.12345678/old/dir/file"
output=$(printf 'restore this\n' | bash "$repo/bin/zed-review" comment)
[[ $output == *'Comment on dir/file:2 (old)'* ]]
export ZED_FILE="$tmp/jj-review-diff.12345678/new/dir/file" ZED_SELECTED_TEXT=$'selection one\nselection two'
output=$(printf 'snapshot note\n' | bash "$repo/bin/zed-review" comment)
[[ $output == *'Comment on dir/file:2 (new)'* ]]
unset ZED_SELECTED_TEXT
export ZED_FILE="$tmp/outside"
printf 'outside\n' > "$ZED_FILE"
if printf 'no\n' | bash "$repo/bin/zed-review" comment 2>/dev/null; then echo 'outside path accepted' >&2; exit 1; fi
jq -se 'length == 3 and .[0].quote == "  real line  " and .[1].side == "old" and .[2].quote == "selection one\nselection two"' "$XDG_STATE_HOME/zed-review/drafts.jsonl" >/dev/null
message=$(bash "$repo/bin/zed-review" drafts)
# Literal backticks and shell variables are part of the test data.
# shellcheck disable=SC2016
[[ $message == *'- dir/file:2 (`real line`)'* && $message == *'- dir/file:2 (deleted line) (`old line`)'* && $message == *'  restore this'* ]] || { echo 'Unexpected message format' >&2; exit 1; }
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\nprintf "%%s" "$3" > "$HOME/sent"\n' > "$tmp/bin/hc"
chmod +x "$tmp/bin/hc"
printf '\n' | bash "$repo/bin/zed-review" send | grep -q 'Sent.'
[[ $(<"$HOME/sent") == "$message" && ! -e $XDG_STATE_HOME/zed-review/drafts.jsonl ]]
# A failed send must retain the draft.
export ZED_FILE="$tmp/project/dir/file"
printf 'keep me\n' | bash "$repo/bin/zed-review" comment >/dev/null
printf '#!/usr/bin/env bash\nexit 1\n' > "$tmp/bin/hc"
if printf '\n' | bash "$repo/bin/zed-review" send >/dev/null 2>&1; then echo 'Failed send reported success' >&2; exit 1; fi
[[ -s $XDG_STATE_HOME/zed-review/drafts.jsonl ]]

# Exercise open without launching Zed or touching a real repository.
mkdir -p "$HOME/.config/herdr-app/mods/jj-review"
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\nif [[ $1 == root ]]; then printf "%%s\\n" "$HOME/project"; elif [[ $* == *"-r @-"* ]]; then printf "diff --git a/dir/file b/dir/file\\n--- a/dir/file\\n+++ b/dir/file\\n@@ -1 +1 @@\\n-old\\n+new\\n"; fi\n' > "$tmp/bin/jj"
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\nprintf "%%s" "$3" > "$HOME/files.json"\n' > "$HOME/.config/herdr-app/mods/jj-review/open-diff"
chmod +x "$tmp/bin/jj" "$HOME/.config/herdr-app/mods/jj-review/open-diff"
bash "$repo/bin/zed-review" open --to term-2 >/dev/null
jq -e 'length == 1 and .[0].path == "dir/file" and .[0].old == "dir/file" and .[0].next == "dir/file"' "$HOME/files.json" >/dev/null
jq -e '.revset == "@-" and .terminal == "term-2"' "$XDG_STATE_HOME/zed-review/current.json" >/dev/null
[[ ! -e $XDG_STATE_HOME/zed-review/drafts.jsonl ]]
echo 'zed-review mapping, message, send failure and open tests passed'
