# API Test Fixtures

This directory stores synthetic or fully anonymized API-shaped responses reused by unit tests across
`src/shared`.

The layout is snapshot-based:

```text
snapshots/{captured-date}-{server}/
  manifest.json
  lcu/{api-group}/...
  sgp/{api-group}/...
```

Preserve response structure, not real identity or secrets. Never add real player/match payloads,
PUUIDs, tokens or identifying metadata. Manifest metadata may describe synthetic source, server type
and coverage gaps; it must not identify a real source player. Existing historical fixtures are not
permission to capture more data. This documentation change does not certify their anonymization.

The current snapshot was captured from a Tencent server login, so it should be
used to validate Tencent-reachable LCU/SGP behavior. It should not be treated as
proof that the same API route works on every Riot region.
