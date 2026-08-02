# TS_DEVELOPMENT.md — CATG TypeScript Engineering Conventions

> Day-to-day engineering guide for human and AI contributors working in this monorepo.
> This document operationalizes [AGENTS.md](AGENTS.md) and SPEC.md §20 (Repository Structure) and §21 (Testing Strategy).
> Ground truth remains SPEC.md; where this document and SPEC.md disagree, SPEC.md wins.

## 1. Prerequisites

- **Node.js 22+** and **TypeScript 5.x** with `strict: true` (AGENTS.md "Tech Stack")
- **pnpm** — the only package manager, using the workspace protocol (AGENTS.md)
- **Biome** for lint and format — not ESLint, not Prettier (AGENTS.md)
- **Vitest** (workspace config) for all package tests (AGENTS.md)
- **Python 3.12+** only inside `python/` bridges — no pip packages beyond the ADR Sensor bridge (AGENTS.md)

## 2. Monorepo Layout and Dependency Direction

```
apps/      — Runtimes (api, investigator-ui, cli) — may depend on packages/
packages/  — Libraries — may depend on other packages/ but NOT on apps/
python/    — Python bridges (ADR Sensor, benchmarks) — no policy or graph logic
```

(AGENTS.md "Monorepo Structure"; SPEC.md §20)

Two consequences to internalize:

1. `apps/` are the only place that wires packages together into runnable services.
2. Nothing in `packages/` may ever import from `apps/` — the dependency graph is a DAG from packages up to apps.

## 3. pnpm Workspace Conventions

- `pnpm-workspace.yaml` at the repo root declares `apps/*` and `packages/*` (SPEC.md §20).
- **Internal dependencies use the workspace protocol** (`workspace:*`) — never registry versions or relative file paths for sibling packages.
- Add a dependency to one package with a filter; never install at the root by accident:

```bash
pnpm add zod --filter @catg/schema          # add to a specific package
pnpm add -D vitest --filter @catg/schema    # dev dependency
```

- Keep `pnpm-lock.yaml` committed; a `pnpm install --frozen-lockfile` must succeed in CI.

## 4. The Daily Loop

| Command | What it does | CI gate |
|---------|--------------|---------|
| `pnpm install` | Install all workspaces | — |
| `pnpm format` | `biome format --write .` | — |
| `pnpm lint` | `biome check` | ✅ |
| `pnpm typecheck` | `tsc --noEmit` across workspaces | ✅ |
| `pnpm test` | `vitest run` for every package | ✅ |
| `pnpm test <pkg>` | Run one package's tests only | — |
| `python -m pytest python/` | Python bridge tests | ✅ |

Fix order when something is red: `pnpm lint` → `pnpm typecheck` → `pnpm test`.
Golden fixture tests run in CI as part of `pnpm test` (AGENTS.md "CI/CD").

## 5. TypeScript Strict Conventions

- `strict: true` in every tsconfig; **no implicit `any`** (AGENTS.md "Code Style").
- **`noUncheckedIndexedAccess` is on** — array/index access yields `T | undefined`; handle the `undefined` branch before use. No blanket `!` to silence it.
- **Explicit return types on public API functions** — the public surface of every package is fully annotated (AGENTS.md; SPEC.md §20 package contracts).
- **Zod schemas, not raw type assertions** — data crossing any trust boundary (ingestion, API, ledger, detectors) is validated with a Zod schema, then the inferred type is used. `as` casts are reserved for internal narrowing with a comment.
- Content hashes use the **`sha256:`** prefix — never `sha-256:` (AGENTS.md "Code Style").
- URN format for stable IDs: **`urn:catg:{tenant}:{source}:{id}`** (AGENTS.md; SPEC.md §8).
- **Node IDs are opaque strings** — validate format, but never parse structure out of them (AGENTS.md).
- Private members/files are not exported; the barrel file is the contract (see §6).

## 6. Package Contracts

Every package in `packages/` (SPEC.md §20; AGENTS.md "Package Contracts"):

- `src/index.ts` — the **public interface**; everything else in the package is private.
- `__tests__/` — **colocated tests** next to the code they test.
- Explicit **`exports` field** in `package.json` — no deep imports like `@catg/schema/dist/foo`.
- **Vitest** for testing; no Jest, no Mocha.
- One responsibility per package, declared in the tree annotation of SPEC.md §20 (e.g., `schema` = "Zod schemas + TS types"; `causal-linker` = "immutable edge assertions").

Before adding an export, ask: does this break the package's declared responsibility or its forbidden-dependency row (§7)?

## 7. Forbidden Dependencies (Hard Rules)

From AGENTS.md "Forbidden Dependencies" — these are enforced, not aspirational:

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

Additional constraints from ARCHITECTURE.md §14: `apps/investigator-ui` is **API only, no direct DB**; `apps/cli` calls package interfaces and never reimplements them; `python/` contains **no policy or graph logic** (SPEC.md §12); `query-sdk` is the only graph-query surface — there is **no arbitrary graph-query API** (SPEC.md §25).

## 8. Graph Conventions

- Edge confidence ordering: **`observed` > `declared` > `reconstructed` > `inferred` > `speculative`** (AGENTS.md; SPEC.md §8).
- **`PRECEDED_BY` must never be automatically upgraded to `CAUSED`** — temporal proximity alone yields `PRECEDED_BY` at best (AGENTS.md; SPEC.md §10, precedence rule 9).
- `CAUSED` requires explicit evidence: identifier match, protocol semantics, direct field mapping, deterministic side-effect receipt, or a signed analyst assertion; otherwise use `MAY_HAVE_CAUSED` (SPEC.md §10 "Strong CAUSED Requirements").
- **Every edge assertion is an event in the ledger** (`edge.asserted`, SPEC.md §9) — never write edges directly to Kuzu (AGENTS.md; ADR-004).
- Every inferred/reconstructed edge carries `confidence`, `confidenceScore`, `causalBasis`, `evidenceIds`, `linkerId`, `linkerVersion` (SPEC.md §8 universal edge fields).

## 9. Content Security

- Raw secrets are **disabled by default** — use keyed HMAC fingerprints (SPEC.md §18, §25).
- Redaction profiles control what reaches detectors; content modes: `raw`, `redacted`, `excerpt`, `hash_only`, `reference` (AGENTS.md).
- Detector evidence packages are **structured JSON**, never free-text concatenation of untrusted tool output (AGENTS.md; ADR-005).
- Field-level encryption uses envelope encryption (random DEK per artifact, DEK encrypted by a local KEK; XChaCha20-Poly1305 or AES-256-GCM) when enabled (SPEC.md §18).

## 10. Schema Evolution

- Canonical events are **immutable** — never modify after append (SPEC.md §9; ADR-001).
- Schema migration produces **new events** with `DERIVED_FROM` linking to originals (AGENTS.md).
- The Kuzu projection is **always rebuildable from the ledger** — schema migrations proceed by rebuilding the projection (SPEC.md §4, §7; ADR-001).
- Nodes and edges carry `validFrom`/`validTo` for temporal queries (SPEC.md §8).
- Event idempotency: stable `eventId` from the source when available; otherwise `dedupe_key = SHA256(tenant_id || source_kind || source_record_id || normalized_event_type || normalized_occurred_at || canonical_payload_hash)`, unique on `(tenant_id, dedupe_key)` (SPEC.md §9).

## 11. Performance Bounds

Hard targets from AGENTS.md "Performance Bounds" and SPEC.md §25 — treat regressions as bugs:

| Bound | Target |
|-------|--------|
| Import | 10K events ≤ 60s |
| Project | 10K events ≤ 90s |
| Credential path query | p95 ≤ 500ms (10K-node graph) |
| Session graph API | ≤ 1s after filtering (SPEC.md §25) |
| UI | never render > 1,500 elements simultaneously |
| API graph responses | truncated, with `truncation` metadata |

## 12. Testing Requirements

Per AGENTS.md "Testing Requirements" and SPEC.md §21:

1. **Unit tests** for every package — schemas, serialization, ID generation, redaction, policy predicates.
2. **Golden tests** for adapters — input fixture → exact canonical events + graph.
3. **Property-based tests** (`fast-check`) — idempotency, ordering independence, cross-tenant isolation.
4. **Integration tests** — SQLite → Kuzu projection, full import pipelines, policy evaluation.
5. **E2E tests** — Playwright for investigator UI critical flows.

**Rule: no PR merges without tests.** Coverage targets: schema/policy ≥ 90%, ingestion/linker ≥ 85%, API ≥ 80% (AGENTS.md; SPEC.md §21).

## 13. Commit Style

Conventional commits with the package/app name as scope (AGENTS.md "Commit Style"):

```
feat(schema): add ToolCall validation
fix(causal-linker): stop upgrading PRECEDED_BY to CAUSED
test(adapters-adr): add partial-session golden fixture
docs(api): document truncation metadata
refactor(graph-projection): encapsulate Kuzu driver behind interface
chore: bump pnpm lockfile
```

- Scope = the package or app the change primarily touches.
- Behavior-changing commits cite the relevant SPEC.md section or ADR in the body.
- Never rewrite history on `main`; the ledger is append-only, and so is the commit log.

## 14. CI/CD Gates

`pnpm test`, `pnpm lint`, `pnpm typecheck`, and `python -m pytest python/` must all pass (AGENTS.md "CI/CD"). Golden fixture tests run in CI. Nothing merges red.
