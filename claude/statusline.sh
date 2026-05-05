#!/usr/bin/env bash

# Read JSON input and extract all fields in a single jq call
input=$(cat)
eval "$(echo "${input}" | jq -r '
    @sh "cwd=\(.workspace.current_dir)",
    @sh "display_path=\(.workspace.current_dir | split("/") | last)",
    @sh "model_id=\(.model.id)",
    @sh "model_display=\(.model.display_name)",
    @sh "input_tokens=\(.context_window.current_usage.input_tokens // 0)",
    @sh "cache_create=\(.context_window.current_usage.cache_creation_input_tokens // 0)",
    @sh "cache_read=\(.context_window.current_usage.cache_read_input_tokens // 0)",
    @sh "ctx_size=\(.context_window.context_window_size // 0)",
    @sh "has_usage=\(.context_window.current_usage != null)",
    @sh "total_cost=\(.cost.total_cost_usd // empty)"
')"

# Define color escape sequences
RST=$'\033[0m'
C_TAN=$'\033[38;5;143m'
C_CYAN=$'\033[38;5;73m'
C_GRAY=$'\033[38;5;250m'
C_GREEN=$'\033[38;5;108m'
C_DARKGRAY=$'\033[38;5;240m'
C_SPIDER=$'\033[38;5;79m'

# Harness marker — Thiania bhamoensis kaomoji shown when running
# under a Thia harness (thia-prowl, future thia-nest). THIANIA_ROLE
# is set by the launcher; stock Claude Code leaves it unset.
# /\ are the front legs, ◉ are the forward-facing eyes, vv are the
# chelicerae (fangs).
harness_info=""
if [[ -n "${THIANIA_ROLE:-}" ]]; then
    harness_info="${C_SPIDER}/(◉ᴗᴗ◉)\\${RST} | "
fi

# VCS branch/bookmark + dirty state
vcs_info=""
if jj root --quiet -R "${cwd}" 2>/dev/null; then
    bookmark=$(jj log -R "${cwd}" -r 'latest(ancestors(@) & bookmarks())' --no-graph -T 'bookmarks' --limit 1 2>/dev/null | head -1)
    if [[ -n "${bookmark}" ]]; then
        dirty=""
        if [[ -n $(jj diff -R "${cwd}" --summary 2>/dev/null) ]]; then
            dirty="${C_TAN}*"
        fi
        vcs_info=" | ${C_GREEN}${bookmark}${dirty}"
    fi
elif git -C "${cwd}" rev-parse --git-dir &>/dev/null; then
    branch=$(git -C "${cwd}" branch --show-current 2>/dev/null)
    if [[ -n "${branch}" ]]; then
        dirty=""
        if ! git -C "${cwd}" diff --quiet 2>/dev/null || ! git -C "${cwd}" diff --cached --quiet 2>/dev/null; then
            dirty="${C_TAN}*"
        fi
        vcs_info=" | ${C_GREEN}${branch}${dirty}"
    fi
fi

# Model name - extract friendly name from model ID
if [[ "${model_id}" =~ (opus|sonnet|haiku)-([0-9]+)-?([0-9]+)? ]]; then
    family="${BASH_REMATCH[1]^}"
    major="${BASH_REMATCH[2]}"
    minor="${BASH_REMATCH[3]}"
    if [[ -n "${minor}" ]]; then
        model_name="${family} ${major}.${minor}"
    else
        model_name="${family} ${major}"
    fi
else
    model_name="${model_display}"
fi

# Context usage with progress bar
context_info=""
if [[ "${has_usage}" == "true" ]]; then
    current=$((input_tokens + cache_create + cache_read))
    pct=$((current * 100 / ctx_size))

    filled=$((pct / 10))
    empty=$((10 - filled))
    filled_bar=""
    empty_bar=""
    for ((i=0; i<filled; i++)); do filled_bar+="█"; done
    for ((i=0; i<empty; i++)); do empty_bar+="░"; done

    context_info=" | ${C_GRAY}Context: [${C_GREEN}${filled_bar}${C_DARKGRAY}${empty_bar}${C_GRAY}] ${C_GREEN}${pct}%"
fi

# Session cost
cost_info=""
if [[ -n "${total_cost}" ]]; then
    cost_info=$(printf " | ${C_GREEN}\$%.2f" "${total_cost}")
fi

# Output the status line
printf "%s%s%s%s | %s%s%s%s%s%s" \
    "${harness_info}" \
    "${C_TAN}" "${display_path}" \
    "${C_CYAN}" "${model_name}" \
    "${vcs_info}" \
    "${context_info}" \
    "${cost_info}" \
    "${RST}"
