#!/usr/bin/env bash

# Read JSON input
input=$(cat)

# Define color escape sequences once
RST=$'\033[0m'
C_TAN=$'\033[38;5;143m'
C_CYAN=$'\033[38;5;73m'
C_GRAY=$'\033[38;5;250m'
C_GREEN=$'\033[38;5;108m'
C_DARKGRAY=$'\033[38;5;240m'

# Get current directory basename
display_path=$(echo "${input}" | jq -r '.workspace.current_dir | split("/") | last')

# Model name - extract friendly name from ARN or model ID
model_id=$(echo "${input}" | jq -r '.model.id')
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
    model_name=$(echo "${input}" | jq -r '.model.display_name')
fi

# Context usage with progress bar
context_info=""
usage=$(echo "${input}" | jq '.context_window.current_usage')
if [[ "${usage}" != "null" ]]; then
    current=$(echo "${usage}" | jq '.input_tokens + .cache_creation_input_tokens + .cache_read_input_tokens')
    size=$(echo "${input}" | jq '.context_window.context_window_size')
    pct=$((current * 100 / size))

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
total_cost=$(echo "${input}" | jq -r '.cost.total_cost_usd // empty')
if [[ -n "${total_cost}" ]]; then
    cost_info=$(printf " | ${C_GREEN}\$%.2f" "${total_cost}")
fi

# Output the status line
printf "%s%s%s | %s%s%s%s%s" \
    "${C_TAN}" "${display_path}" \
    "${C_CYAN}" "${model_name}" \
    "${context_info}" \
    "${cost_info}" \
    "${RST}"
