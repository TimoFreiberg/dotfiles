#!/bin/bash
# Merges base (public) and LOCAL (private) settings into settings.json

set -euo pipefail

pushd "$(dirname "$0")" > /dev/null

BASE="settings.base.jsonc"
LOCAL="settings.local.jsonc"
SETTINGS="settings.json"

# Convert JSONC (JSON with comments and trailing commas) to valid JSON
jsonc_to_json() {
  python3 -c "
import re, sys
text = sys.stdin.read()
text = re.sub(r'//[^\n]*', '', text)       # Remove // comments
text = re.sub(r',(\s*[}\]])', r'\1', text)  # Remove trailing commas
print(text)
"
}

if [[ ! -f "$BASE" ]]; then
  echo "Error: $BASE not found"
  exit 1
fi

if [[ ! -f "$LOCAL" ]]; then
  echo "No local settings found, using base only"
  jsonc_to_json < "$BASE" | jq -S . > "$SETTINGS"
else
  jq -sS '.[0] * .[1]' <(jsonc_to_json < "$BASE") <(jsonc_to_json < "$LOCAL") > "$SETTINGS"
fi

echo "Merged into $SETTINGS ($(jq 'keys | length' "$SETTINGS") keys)"

popd > /dev/null
