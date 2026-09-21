function jprc --description "Create a GitHub PR from a jj revision"
    # Parse arguments
    argparse 'r/revision=' 'b/base=' 'h/help' -- $argv
    or return 1

    if set -q _flag_help
        echo "Usage: jprc [-r revision] [-b base]"
        echo ""
        echo "Create a GitHub PR from a jj revision using an LLM-generated branch name."
        echo ""
        echo "Options:"
        echo "  -r, --revision REV  Revision to use as PR tip (default: @-)"
        echo "  -b, --base BASE     Base branch for PR (default: auto-detect)"
        return 0
    end

    set -l rev (set -q _flag_revision; and echo $_flag_revision; or echo '@-')
    set -l base

    # --- Determine base branch ---
    if set -q _flag_base
        set base $_flag_base
    else
        # Find bookmarked ancestors (excluding the target rev itself) to use as base
        set -l candidate_lines (jj log -r "(trunk()::$rev & bookmarks()) ~ $rev" --no-graph -T 'bookmarks.join(",") ++ "\n"' 2>&1)
        if test $status -ne 0
            echo "Error: failed to query jj log" >&2
            echo $candidate_lines >&2
            return 1
        end

        set -l candidates
        for candidate_line in $candidate_lines
            set -a candidates (string split ',' -- $candidate_line)
        end

        # We want the "nearest ancestor with a bookmark" as base
        switch (count $candidates)
            case 0
                echo "Error: no bookmarked ancestors found between trunk() and $rev" >&2
                return 1
            case 1
                set base $candidates[1]
            case '*'
                # Multiple bookmarks — the last one (closest to rev) is likely the best base
                # but let the user choose
                echo "Multiple bookmarked ancestors found:"
                for i in (seq (count $candidates))
                    echo "  $i) $candidates[$i]"
                end
                read -p 'echo "Pick base (number): "' -l choice
                if not string match -qr '^\d+$' -- $choice
                    echo "Invalid choice" >&2
                    return 1
                end
                if test $choice -lt 1 -o $choice -gt (count $candidates)
                    echo "Out of range" >&2
                    return 1
                end
                set base $candidates[$choice]
        end
    end

    # Strip remote suffix (e.g. "main@origin" → "main") and tracking markers
    set base (string replace -r '@\w+' '' -- $base | string replace -r '\*$' '')

    # --- Validate base exists on origin ---
    set -l remote_check (jj bookmark list --remote origin $base 2>&1)
    if test $status -ne 0; or test -z "$remote_check"
        echo "Error: bookmark '$base' not found on origin" >&2
        echo "Push it first: jj git push --bookmark $base" >&2
        return 1
    end

    # --- Check if revision already has a bookmark ---
    set -l existing_bookmarks (jj log -r "$rev" --no-graph -T 'local_bookmarks.join(",")' 2>&1)
    if test -n "$existing_bookmarks"
        set -l bookmarks (string split ',' -- $existing_bookmarks | string replace -r '\*$' '')
        if test (count $bookmarks) -gt 1
            echo "Revision $rev has multiple bookmarks:"
            for i in (seq (count $bookmarks))
                echo "  $i) $bookmarks[$i]"
            end
            read -p 'echo "Pick bookmark (number, or Enter to create a new one): "' -l choice
            if test -n "$choice"
                if not string match -qr '^\d+$' -- $choice
                    echo "Invalid choice" >&2
                    return 1
                end
                if test $choice -lt 1 -o $choice -gt (count $bookmarks)
                    echo "Out of range" >&2
                    return 1
                end
                set -l branch_name $bookmarks[$choice]
                echo "Pushing $branch_name..."
                jj git push --bookmark $branch_name
                or return 1
                __jprc_open_or_create_pr $branch_name $base $rev
                return $status
            end
        else
            set -l clean_bookmark $bookmarks[1]
            echo "Revision $rev already has bookmark: $clean_bookmark"
            read -p 'echo "Use this bookmark? [Y/n] "' -l use_existing
            if test -z "$use_existing"; or string match -qi 'y' -- $use_existing
                set -l branch_name $clean_bookmark
                echo "Pushing $branch_name..."
                jj git push --bookmark $branch_name
                or return 1
                __jprc_open_or_create_pr $branch_name $base $rev
                return $status
            end
        end
    end

    # --- Generate branch name via LLM ---
    set -l diff_context (jj diff --from $base --to $rev 2>&1 | head -200)
    set -l log_context (jj log -r "$base..$rev" --no-graph 2>&1)

    set -l branch_prompt "Generate a short Git branch name (max 20 chars, lowercase, hyphen-separated).
No prefixes like feat/ or fix/. Just a concise descriptive name.
Reply with ONLY the branch name, nothing else.
Here is the diff and log for the changes:

--- jj log ---
$log_context

--- jj diff (truncated) ---
$diff_context"

    echo "Generating branch name..."
    set -l suggested (echo "$branch_prompt" | polytoken exec --model gpt-5.6-luna | string trim)

    if test -z "$suggested"
        echo "Error: LLM returned empty branch name" >&2
        return 1
    end

    # --- Confirm/edit branch name ---
    read -c "$suggested" -p 'echo "Branch name: "' -l branch_name
    if test -z "$branch_name"
        echo "Aborted" >&2
        return 1
    end

    # --- Push and create PR ---
    echo "Pushing $branch_name..."
    jj git push --named "$branch_name=$rev"
    or return 1

    __jprc_open_or_create_pr $branch_name $base $rev
end

function __jprc_open_or_create_pr --argument-names branch_name base rev
    set -l existing_pr (gh pr list --head $branch_name --base $base --state open --json url --jq '.[0].url' 2>/dev/null)
    if test -n "$existing_pr"
        echo "Opening existing PR: $existing_pr"
        gh pr view $existing_pr --web
        return $status
    end

    set -l commit_messages (jj log -r "$base..$rev" --no-graph -T 'description ++ "\n\n"' 2>&1 | string collect)

    echo "Creating PR from the commit messages..."
    gh pr create --head $branch_name --base $base --body "$commit_messages" --web
end
