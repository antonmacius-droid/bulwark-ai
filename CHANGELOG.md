# Changelog

## [0.2.0] - 2026-04-10

### Added
- **Per-tenant governance config** — PII, budgets, prompt guard, allowed models, rate limits per tenant
- **Circuit breaker** — auto-trips after provider failures, half-open test, auto-reset after max cycles
- **Concurrency limiter** — returns 429 when `maxConcurrentRequests` reached
- **Response caching** — SHA-256 keyed, deterministic requests only (temperature=0)
- **ML-based prompt injection detection** — embedding similarity against 27 curated examples
- **Prompt CI/CD pipeline** — versioned prompts, golden datasets, embedding-based regression testing, instant rollback
- **LLM Provider SLA Monitor** — latency percentiles, error rates, cost tracking, alert rules
- **Async database layer** — `queryOne`/`queryAll` return `Promise`, Postgres support ready
- **Python SDK** — full async port, 89 tests, RAG wired into gateway pipeline
- **Unicode/homoglyph injection defense** — Cyrillic, Greek, fullwidth, leet speak, whitespace evasion detection
- **Streaming PII buffering** — output buffered and redacted before reaching client when action is redact/block
- **Redis atomic rate limiting** — Lua script for INCR+EXPIRE in one call
- **Admin API endpoints** — circuit breaker status, tenant governance CRUD, SLA health, gateway status
- **Admin UI** — gateway health panel, circuit breaker state badges, feature status cards
- **Composite DB indexes** — `(action, timestamp)` and `(provider, timestamp)` for dashboard performance

### Fixed
- **CRITICAL: HMAC timing attack** — license key now uses `timingSafeEqual`
- **CRITICAL: Auth bypass** — userId/tenantId no longer falls back to query params
- **SSRF** — blocks IPv6 private ranges, 0.0.0.0, IPv4-mapped IPv6
- **ML embedding poisoning** — customExamples capped (50 max, 1000 chars)
- **Audit export** — paginated with 5000 cap per page
- **SOC 2 immutableAudit** — now enforced (anonymize instead of delete)
- **GDPR deleteAndCount** — properly awaits delete operation
- **CCPA delete** — now includes RAG chunks
- **GATEWAY_DISABLED** — returns 503 instead of 500
- **Azure routing** — requires explicit `azure/` prefix, no longer silently preferred
- **Budget scopeType** — validated against enum
- **Error messages** — no longer leak filesystem paths
- **HTML parser** — iterative script/style stripping (no ReDoS)
- **String escaping** — LIKE queries escape backslash before % and _
- **Python middleware** — no longer exposes internal exception details
- **CI** — workflow permissions added, integration tests run on PRs

### Changed
- Gateway pre-flight logic deduplicated (`runPreflightChecks()` shared between `chat()` and `chatStream()`)
- `PromptGuard.config` → `PromptGuard.guardConfig` (public readonly accessor)
- `GatewayConfig.cache` typed as `CacheStore` (was `unknown`)
- `national_id` PII regex narrowed to specific EU formats
- Tenant PII/Guard instances cached alongside config (no per-request allocation)

## [0.1.4] - 2026-04-04

### Added
- Offline license key verification (HMAC-SHA256)
- KB Chat standalone app
- Config presets (strict/balanced/dev) and failMode
- Legal disclaimers

## [0.1.3] - 2026-04-03

### Added
- Initial public release
- 6 LLM providers, PII detection, prompt injection guard
- Budget control, audit logging, RAG knowledge base
- GDPR/SOC 2/HIPAA/CCPA compliance modules
- Express/Next.js/Fastify middleware
- Admin UI (9 pages)
- 136 tests (42 unit + 94 integration)
