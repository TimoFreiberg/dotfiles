---
name: prometheus
description: "Query Prometheus/Thanos metrics via the HTTP API. Use for investigating production metrics, checking host status, validating alerts, or any PromQL query against observability infrastructure."
---

# Prometheus

Query Prometheus and Thanos endpoints using Python (stdlib only). Supports mTLS authentication.

## Quick Reference

All commands use the helper script in this skill directory.

```bash
# Instant query (most common)
python3 query.py -s <source> '<promql>'

# Instant query, flatten labels into columns
python3 query.py -s <source> -f '<promql>'

# Range query (returns time series)
python3 query.py -s <source> -r --start '30m ago' --end 'now' --step 60s '<promql>'

# Label values
python3 query.py -s <source> --label-values <label_name>

# Label values filtered by selector
python3 query.py -s <source> --label-values <label_name> --match '<selector>'
```

### Source names

Sources are configured in `~/.config/prometheus/sources.json`. List your configured sources there.

### Tips

- Use `count by (label) (metric)` to explore what labels exist
- Use `group by (label) (metric)` to get distinct label combinations without values
- `--flatten` / `-f` makes output much easier to read for the agent — prefer it for instant queries
- For large result sets, add PromQL filters or `topk(10, ...)` / `bottomk(10, ...)`
- Filter by specific label values using PromQL selectors: `{instance="host:port"}`

## Setup

### 1. Obtain mTLS certificates (if required)

If your Prometheus/Thanos endpoint requires mTLS, obtain a client certificate, private key, and CA certificate from your infrastructure team.

### 2. Store certificates

Place certs wherever you like. A suggested location:

```bash
mkdir -p ~/.config/prometheus/certs
# Copy your certs there:
#   ~/.config/prometheus/certs/client.crt
#   ~/.config/prometheus/certs/client.key
#   ~/.config/prometheus/certs/ca.crt
```

### 3. Configure sources

Create `~/.config/prometheus/sources.json`:

```json
{
  "prod": {
    "url": "https://prometheus.example.com/api/v1",
    "mtls": {
      "cert": "~/.config/prometheus/certs/client.crt",
      "key": "~/.config/prometheus/certs/client.key",
      "cacert": "~/.config/prometheus/certs/ca.crt"
    }
  },
  "local": {
    "url": "http://localhost:9090/api/v1"
  }
}
```

Sources without an `mtls` block are queried without client certificate auth.

### 4. Verify

```bash
python3 query.py -s prod 'count(up) by (job)' | head -20
```

## Interpreting Output

### Instant query (default)

Returns JSON array of results. Each element has `metric` (name + labels) and `value` (timestamp + value):

```json
[
  {"metric": {"__name__": "up", "job": "myservice"}, "value": [1709123456, "1"]}
]
```

### Instant query with `--flatten`

Returns JSON array with labels promoted to top-level keys alongside `__value__` and `__timestamp__`:

```json
[
  {"__name__": "up", "job": "myservice", "__value__": "1", "__timestamp__": 1709123456}
]
```

### Range query

Returns JSON array where each element has `metric` and `values` (array of [timestamp, value] pairs):

```json
[
  {"metric": {"__name__": "up", "job": "myservice"}, "values": [[1709123400, "1"], [1709123460, "1"]]}
]
```

### Errors

On error, the script exits non-zero and prints the Prometheus error message to stderr.
