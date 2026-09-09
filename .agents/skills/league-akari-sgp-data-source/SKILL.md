---
name: league-akari-sgp-data-source
description: Implement or review League Akari SGP/LCU data access and analytics provenance. Use for source selection, SGP clients, League Servers remote config, Tencent cross-region behavior, token handling, endpoint interoperability, freshness, missingness, comparability, or data-source errors.
---

# League Akari SGP Data Source

Use this skill before changing logic that decides whether a feature uses LCU or SGP, touches
SGP server config, adds SGP endpoints, or reasons about cross-region access.

## Mental Model

- **LCU** is the local League Client HTTP/WebSocket abstraction: `Akari -> LeagueClient.exe`.
- **SGP** means Service Gateway Proxy, the private HTTP API used by the League Client to talk to
  Riot/Tencent backend services: `LeagueClient.exe -> server`.
- SGP is undocumented. Endpoint knowledge comes from observed client traffic and remote config, not
  from a stable public contract.
- League Akari can call SGP directly because the League Client exposes usable SGP auth material
  through LCU events.
- SGP can expose backend data that LCU hides or reshapes, but support is endpoint-specific.
- **SGP server ID** is a League Akari abstraction, not necessarily a backend region name.
- SGP endpoint URLs are packet-captured configuration. Do not infer URL patterns from server IDs.

Core tension: SGP is the direct backend path, but it is undocumented, config-sensitive, and more
fragile across networks. LCU is local and narrower, but more stable.

## Tokens And Access

- Keep token type boundaries in code unless deliberately changing the SGP auth layer.
- Current auth model has two token streams: league session and entitlements.
- Token readiness is only an auth precondition. It is not proof that the target server, endpoint, or
  cross-region request is valid.
- Do not design partial-token behavior unless the SGP auth layer changes.

## Region And Cross-Region Rules

Cross-region access is not a general SGP feature.

- Some Tencent endpoints may accept tokens from another Tencent sub-server; many endpoints still
  validate token region. Treat interoperability as endpoint-specific.
- Non-Tencent regions generally validate token region. Shared hosts or similar URL shapes do not
  imply cross-region support.
- LCU queries the current local client region. It is not a cross-region backend.

## Remote Config And Endpoint Fragility

SGP endpoint knowledge is configuration, not protocol truth.

- Missing server config means Akari does not know how to call that SGP server.
- Path variables and backend identifiers can differ from Akari's server IDs.
- Region identifiers and endpoints can change. LCU may keep working because it abstracts the local
  client, while SGP immediately breaks when configured addresses or path variables are stale.
- Legacy remote-config fields may exist for compatibility. Do not generalize new behavior from old
  config shape alone.

## Network And Proxy Caveats

SGP direct requests do not always follow the same network path as the League Client.

- In accelerator/VPN scenarios, the League Client may be accelerated while League Akari's direct SGP
  HTTP is not.
- LCU can remain healthy because it is local and the League Client owns its backend connectivity.
- Treat direct SGP network failures separately from "player/server not found" and from local LCU
  availability.

## Analytics Data Contract

Data-source correctness includes interpretation, not only a successful response.

- Record the source path (`LCU`, direct `SGP`, remote configuration, or derived local result), target
  server, fetch time, relevant patch/time range, and source-specific identifiers in typed main-process
  data. Expose only the minimum renderer fields needed for user interpretation.
- Keep raw source facts separate from derived metrics. Name transformations, denominators, filters,
  and aggregation windows in code so a renderer cannot accidentally reinterpret formatted strings.
- Do not merge LCU and SGP fields solely because their names or shapes look similar. Verify identity,
  units, population, time window, queue scope, patch semantics, and nullability first.
- Preserve zero, missing, unavailable, forbidden, stale, not applicable, and not yet fetched as
  distinct states. Never coerce an absent SGP field or failed request to numeric zero.
- A partial response can still be useful, but its completeness must be explicit. Preserve eligible
  counts and denominators for ratios so the UI can show what was actually observed.
- If an endpoint is undocumented or empirically inferred, avoid product language that implies an
  official, stable Riot contract. Treat method changes as semantic changes that require fixtures and
  before/after review, not as UI-only refactors.

## Privacy, Persistence, And Game Integrity

- Tokens remain in main-process memory and must not enter renderer state, logs, screenshots,
  fixtures, persisted analytics, exports, or error messages.
- Player/match payloads and derived caches belong under Electron `userData` only. Tests use synthetic
  or anonymized fixtures; never capture a real user's dataset in the repository.
- Use allowlisted typed Electron IPC for renderer access. Do not add a loopback HTTP service, generic
  proxy, renderer filesystem access, or renderer-side direct SGP fetch.
- Rate-limit and cancel long-running collection. A stale or unavailable external source must not
  block unrelated local LCU workflows.
- Assistance surfaces should present evidence and choices, not automate live gameplay decisions or
  imply certainty from incomplete/private endpoints.

## Error Taxonomy

Keep these conditions distinguishable through the controller and renderer boundary:

- League Client disconnected or local LCU unavailable;
- auth token absent/expired;
- server configuration missing or stale;
- endpoint unsupported for the requested server/region;
- cross-region authorization rejected;
- direct network/proxy/timeout failure;
- player or match not found;
- schema/parse incompatibility;
- partial data or stale cached fallback;
- user cancellation.

Map each condition to a stable typed result or error code. User-visible text should state what is
unavailable and the safe next action, without exposing endpoints, tokens, or internal stack details.

## Implementation Guardrails

- Search current call sites instead of relying on file paths or business examples in this skill.
- Before issuing an SGP request, distinguish server config availability, token readiness, endpoint
  capability, region compatibility, and network failure.
- Pass an explicit target server only for calls that intentionally target a specific SGP server.
- Do not infer support from shared hosts, similar URLs, or legacy interoperability arrays alone.
- Validate the adapter with representative success, partial, empty, stale, cancellation, and failure
  fixtures. Tests should assert domain results and source metadata, not request implementation strings.
- When source semantics change, inspect at least one downstream analytical view for units,
  denominators, missingness, and freshness labels; a passing HTTP mock is not end-to-end evidence.
