#!/usr/bin/env python3
"""Shows key/value pairs in settings.json that aren't in base or local sources."""

import json
import re
import sys
from pathlib import Path


def parse_jsonc(path: Path) -> dict:
    """Parse JSONC (JSON with comments and trailing commas)."""
    if not path.exists():
        return {}
    text = path.read_text()
    text = re.sub(r"//[^\n]*", "", text)
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    return json.loads(text)


def find_orphaned(settings: dict, base: dict, local_settings: dict) -> dict:
    """Recursively find keys/values in settings not present in base or local."""
    orphaned = {}

    if not isinstance(settings, dict):
        return orphaned

    for key, value in settings.items():
        in_base = key in base if isinstance(base, dict) else False
        in_local = key in local_settings if isinstance(local_settings, dict) else False

        if not in_base and not in_local:
            orphaned[key] = value
        elif isinstance(value, dict):
            base_val = base.get(key, {}) if isinstance(base, dict) else {}
            local_val = local_settings.get(key, {}) if isinstance(local_settings, dict) else {}
            nested = find_orphaned(value, base_val, local_val)
            if nested:
                orphaned[key] = nested
        elif isinstance(value, list):
            # jq's * merge replaces arrays entirely, so expected is local's if present, else base's
            base_arr = base.get(key, []) if isinstance(base, dict) else []
            local_arr = local_settings.get(key, []) if isinstance(local_settings, dict) else []
            expected = local_arr if in_local else base_arr

            orphaned_elements = [elem for elem in value if elem not in expected]
            if orphaned_elements:
                orphaned[key] = orphaned_elements

    return orphaned


def main():
    script_dir = Path(__file__).parent

    settings_path = script_dir / "settings.json"
    if not settings_path.exists():
        print(f"Error: {settings_path} not found", file=sys.stderr)
        sys.exit(1)

    base = parse_jsonc(script_dir / "settings.base.jsonc")
    local_settings = parse_jsonc(script_dir / "settings.local.jsonc")
    settings = parse_jsonc(settings_path)

    orphaned = find_orphaned(settings, base, local_settings)

    if orphaned:
        print(json.dumps(orphaned, indent=2))
    else:
        print("No orphaned settings found.")


if __name__ == "__main__":
    main()
