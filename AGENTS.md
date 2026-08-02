# AGENTS.md — CATG Development Conventions

> For Codex CLI, Droid, and other AI coding agents working on this repository.
> Reference: SPEC.md §20 (Repository Structure), §21 (Testing Strategy), §8 (Domain Ontology)

## Project DNA

CATG is a **research-grade TypeScript monorepo** that ingests heterogeneous agent telemetry (ADR, OpenTelemetry, MCP) into an append-only event ledger, projects it into an embedded Kuzu property graph, evaluates deterministic security policies, and runs reproducible experiments comparing graph-based vs transcript-based security detection.

**Three non-negotiable rules:**
1. The SQLite event ledger is append-only — never UPDATE or DELETE outside test builds.
2. Every inferred or reconstructed edge must carry confidence, basis, evidence IDs, and linker version.
3. Untrusted content must never be concatenated into privileged detector instructions.

## Repo Conventions

### Monorepo Structure

```
apps/          — Runtimes (api, investigator-ui, cli) — may depend on packages/
packages/      — Libraries — may depend on other packages/ but NOT on apps/
python/        — Python bridges (ADR Sensor, benchmarks) — no policy or graph logic
```

### Package Contracts

Each package in `packages/` follows:
- `src/index.ts` — public interface (everything else is private)
- `__tests__/` — colocated tests
- Explicit `package.json` exports field
- `vitest` for testing

### Forbidden Dependencies (Hard Rules)

| Package | Must NOT depend on |
|---------|-------------------|
| `schema` | Kuzu, API, UI |
| `event-ledger` | Kuzu, detectors |
| `graph-model` | adapters |
| `causal-linker` | UI |
| `policy-engine` | LLM SDKs |
| `detector-sdk` | provider-specific clients |
| `detectors-llm` | direct Kuzu writes |
| `query-sdk` | raw user Cypher |

### Tech Stack

- **Runtime:** Node.js 22+, TypeScript 5.x strict mode
- **Package manager:** pnpm (workspace protocol)
- **Lint/Format:** Biome (not ESLint + Prettier)
- **Testing:** Vitest with workspace config
- **API:** Fastify + Zod validation
- **UI:** Next.js App Router, TanStack Query, React Flow
- **Graph DB:** Kuzu (embedded, no external service)
- **Event store:** SQLite via better-sqlite3
- **Analytics:** DuckDB (experiments only)
- **Python:** 3.12+, invoked as subprocess, no pip packages beyond ADR Sensor bridge

### Testing Requirements

1. **Unit tests** for every package — schemas, serialization, ID generation, redaction, policy predicates
2. **Golden tests** for adapters — input fixture → exact canonical events + graph
3. **Property-based tests** with `fast-check` — idempotency, ordering independence, cross-tenant isolation
4. **Integration tests** — SQLite → Kuzu projection, full import pipelines, policy evaluation
5. **E2E tests** — Playwright for investigator UI critical flows

**Rule:** No PR merges without tests. Coverage targets: schema/policy ≥90%, ingestion/linker ≥85%, API ≥80%.

### Code Style

- `strict: true` in tsconfig — no implicit any, noUncheckedIndexedAccess
- Explicit return types on public API functions
- Zod schemas, not raw type assertions
- Content hashes use `sha256:` prefix (not `sha-256:`)
- URN format: `urn:catg:{tenant}:{source}:{id}`
- Node IDs are opaque strings — validate but never parse structurally

### Graph Conventions

- Edge confidence: `observed` > `declared` > `reconstructed` > `inferred` > `speculative`
- `PRECEDED_BY` must never be automatically upgraded to `CAUSED`
- `CAUSED` requires explicit evidence (identifier match, protocol semantics, direct field mapping, or signed analyst assertion)
- Temporal proximity alone → `PRECEDED_BY` only
- Every edge assertion is an event in the ledger — never write edges directly to Kuzu

### Content Security

- Raw secrets disabled by default — use HMAC fingerprints
- Redaction profiles control what reaches detectors
- Content modes: `raw`, `redacted`, `excerpt`, `hash_only`, `reference`
- Detector evidence packages are structured JSON, never free-text concatenation of untrusted tool output

### Schema Evolution

- Canonical events are immutable — never modify after append
- Schema migration produces new events with `DERIVED_FROM` linking to originals
- Graph projection is always rebuildable from the ledger
- `validFrom`/`validTo` on nodes and edges for temporal queries

### Performance Bounds

- Import: 10K events ≤ 60s
- Project: 10K events ≤ 90s
- Credential path query: p95 ≤ 500ms (10K-node graph)
- UI: never render >1,500 elements simultaneously
- API: graph responses truncated with `truncation` metadata

### CI/CD

- `pnpm test` must pass (all packages)
- `pnpm lint` (biome check)
- `pnpm typecheck` (tsc --noEmit)
- Python tests via `python -m pytest python/`
- Golden fixture tests run in CI

### Commit Style

Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`
Scope references package name: `feat(schema): add ToolCall validation`
