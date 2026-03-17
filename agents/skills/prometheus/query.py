#!/usr/bin/env python3
"""Prometheus query helper for the pi prometheus skill.

Queries Prometheus/Thanos HTTP API with optional mTLS support.
Configuration is read from ~/.config/prometheus/sources.json.
mTLS certificates go in ~/.config/prometheus/certs/ and are referenced by path
in ~/.config/prometheus/sources.json (see SKILL.md for format).
"""

import argparse
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import NoReturn

DEFAULT_SOURCES_FILE = Path.home() / ".config" / "prometheus" / "sources.json"


def load_source(name: str, sources_file: Path) -> dict:
    if not sources_file.exists():
        die(
            f"sources file not found: {sources_file}\n"
            "Create it with your Prometheus sources. See the prometheus skill docs for setup."
        )

    sources = json.loads(sources_file.read_text())

    if name not in sources:
        available = ", ".join(sources.keys())
        die(
            f"source '{name}' not found in {sources_file}\nAvailable sources: {available}"
        )

    return sources[name]


def expand_path(p: str) -> Path:
    return Path(os.path.expanduser(p))


def build_ssl_context(source: dict) -> ssl.SSLContext | None:
    mtls = source.get("mtls")
    if not mtls:
        return None

    cert = expand_path(mtls["cert"])
    key = expand_path(mtls["key"])
    cacert = expand_path(mtls["cacert"]) if "cacert" in mtls else None

    for label, path in [("cert", cert), ("key", key)]:
        if not path.exists():
            die(f"{label} file not found: {path}")

    ctx = ssl.create_default_context()
    ctx.load_cert_chain(certfile=cert, keyfile=key)

    if cacert is not None:
        if not cacert.exists():
            die(f"cacert file not found: {cacert}")
        ctx.load_verify_locations(cafile=cacert)

    return ctx


def parse_time(value: str) -> float:
    """Parse a human-friendly time expression to a Unix timestamp.

    Accepts:
      - "now"
      - Relative durations: "30m ago", "2h ago", "1d ago"
      - Unix timestamps: "1709123456" or "1709123456.789"
      - ISO 8601 / RFC 3339: "2024-03-01T12:00:00Z"
    """
    value = value.strip()

    if value == "now":
        return time.time()

    if m := re.fullmatch(r"(\d+)([smhd])\s+ago", value):
        amount, unit = int(m.group(1)), m.group(2)
        multipliers = {"s": 1, "m": 60, "h": 3600, "d": 86400}
        return time.time() - amount * multipliers[unit]

    if re.fullmatch(r"\d+(\.\d+)?", value):
        return float(value)

    # Try ISO 8601
    from datetime import datetime, timezone

    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(value, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp()
        except ValueError:
            continue

    die(f"cannot parse time '{value}'")


def prometheus_request(
    url: str, params: dict, ssl_context: ssl.SSLContext | None, method: str = "POST"
) -> dict:
    """Make a request to the Prometheus HTTP API and return parsed JSON."""
    encoded = urllib.parse.urlencode(params)

    if method == "GET":
        full_url = f"{url}?{encoded}" if encoded else url
        req = urllib.request.Request(full_url, method="GET")
    else:
        req = urllib.request.Request(url, data=encoded.encode(), method="POST")

    try:
        with urllib.request.urlopen(req, context=ssl_context) as resp:
            body = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            err_body = json.loads(e.read())
            error_type = err_body.get("errorType", "unknown")
            error_msg = err_body.get("error", e.reason)
            die(f"HTTP {e.code} prometheus {error_type}: {error_msg}")
        except (json.JSONDecodeError, KeyError):
            die(f"HTTP {e.code} from {url}: {e.reason}")
    except urllib.error.URLError as e:
        die(f"connection error for {url}: {e.reason}")

    if body.get("status") != "success":
        error_type = body.get("errorType", "unknown")
        error_msg = body.get("error", "unknown error")
        die(f"prometheus {error_type}: {error_msg}")

    return body


def flatten_instant_results(results: list[dict]) -> list[dict]:
    """Promote labels to top-level keys alongside __value__ and __timestamp__."""
    flattened = []
    for r in results:
        row = dict(r.get("metric", {}))
        ts, val = r["value"]
        row["__value__"] = val
        row["__timestamp__"] = ts
        flattened.append(row)
    return flattened


def die(msg: str) -> NoReturn:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Query Prometheus/Thanos HTTP API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "-s", "--source", required=True, help="Source name from sources.json"
    )
    parser.add_argument("query", nargs="?", help="PromQL query expression")
    parser.add_argument(
        "-f", "--flatten", action="store_true", help="Flatten labels (instant only)"
    )
    parser.add_argument(
        "-r", "--range", action="store_true", dest="range_query", help="Range query"
    )
    parser.add_argument(
        "--start", help="Range start (e.g. '30m ago', RFC3339, Unix timestamp)"
    )
    parser.add_argument("--end", help="Range end (default: now)")
    parser.add_argument("--step", help="Range step (e.g. 60s, 5m)")
    parser.add_argument(
        "--time", dest="eval_time", help="Evaluation time for instant query"
    )
    parser.add_argument("--timeout", help="Query timeout (e.g. 30s)")
    parser.add_argument(
        "--label-values", metavar="LABEL", help="Fetch values for this label name"
    )
    parser.add_argument("--match", help="Selector filter for label queries")
    parser.add_argument(
        "--sources-file",
        type=Path,
        default=Path(os.environ.get("PROMETHEUS_SOURCES_FILE", DEFAULT_SOURCES_FILE)),
        help="Path to sources.json",
    )

    args = parser.parse_args()

    source = load_source(args.source, args.sources_file)
    base_url = source["url"].rstrip("/")
    ssl_ctx = build_ssl_context(source)

    # --- Label values ---
    if args.label_values:
        url = f"{base_url}/label/{urllib.parse.quote(args.label_values, safe='')}/values"
        params = {}
        if args.match:
            params["match[]"] = args.match
        if args.start:
            params["start"] = parse_time(args.start)
        if args.end:
            params["end"] = parse_time(args.end)

        body = prometheus_request(url, params, ssl_ctx, method="GET")
        print(json.dumps(body["data"], indent=2))
        return

    # --- Query ---
    if not args.query:
        parser.error("a PromQL query is required (or use --label-values)")

    if args.range_query:
        if not args.start:
            parser.error("--start is required for range queries")
        if not args.step:
            parser.error("--step is required for range queries")

        params = {
            "query": args.query,
            "start": parse_time(args.start),
            "end": parse_time(args.end or "now"),
            "step": args.step,
        }
        if args.timeout:
            params["timeout"] = args.timeout

        body = prometheus_request(f"{base_url}/query_range", params, ssl_ctx)
        print(json.dumps(body["data"]["result"], indent=2))
    else:
        params = {"query": args.query}
        if args.eval_time:
            params["time"] = parse_time(args.eval_time)
        if args.timeout:
            params["timeout"] = args.timeout

        body = prometheus_request(f"{base_url}/query", params, ssl_ctx)
        results = body["data"]["result"]

        if args.flatten:
            results = flatten_instant_results(results)

        print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
