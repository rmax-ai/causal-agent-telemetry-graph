# CATG Roadmap

> Extracted from SPEC.md §23 (Milestone Plan). Each phase's stories link to ARCHITECTURE.md sections.

## Phase 0 — Foundation & Schemas (Week 1, 15–18 hrs)

**Focus:** Monorepo bootstrap, type system, event storage

- [ ] Initialize pnpm monorepo with workspace config
- [ ] `packages/schema` — Zod schemas for all node types (28), edge types (27), canonical events (24 families)
- [ ] `packages/canonical-json` — RFC 8785 deterministic serialization + SHA-256 hashing
- [ ] `packages/event-ledger` — SQLite append-only ledger with deduplication, quarantine, checkpoints
- [ ] `packages/graph-model` — Ontology type registry, PROV specialization, identifier strategy
- [ ] Write ADR-001 through ADR-006 as `docs/architecture/adr/`
- [ ] `vitest.workspace.ts`, `tsconfig.base.json`, `biome.json`
- [ ] Python bridge scaffold (`python/adr-bridge/`, `python/benchmark-runner/`)

**Acceptance:** `pnpm test` passes; duplicate events rejected; UPDATE/DELETE blocked on events table; all node/edge types in registry.

## Phase 1 — ADR Import & Graph Projection (Week 2, 18–22 hrs)

**Focus:** First end-to-end pipeline: ingest → ledger → graph → query

- [ ] `packages/adapters-adr` — ADR AgentEvent parser, field mapping, chunk handling
- [ ] `packages/ingestion-core` — Import orchestration, streaming, validation reports
- [ ] `python/adr-bridge/` — Python subprocess invoking ADR Sensor, emitting JSONL
- [ ] `packages/graph-projection` — Ledger → Kuzu projection, rebuild, snapshot hashes
- [ ] `apps/cli` — `catg import adr`, `catg session list|show`, `catg graph path`
- [ ] 3 golden ADR fixtures (benign, credential-exfiltration, partial-session)

**Acceptance:** ADR JSON → canonical events → Kuzu graph → `catg graph path`. No raw secrets in graph properties. Projection rebuild yields identical snapshot hash.

## Phase 2 — MCP & OpenTelemetry Adapters (Week 3, 15–20 hrs)

**Focus:** Broader telemetry sources, identity resolution

- [ ] `packages/adapters-otel` — OTLP JSON span mapping, parent/link resolution, attribute preservation
- [ ] `packages/adapters-mcp` — Client/server instrumentation, request/result correlation
- [ ] `packages/identity-resolution` — Source identities → stable URNs, collision detection
- [ ] `packages/instrumentation-sdk` — Direct `catg.startRun()` / `run.toolCall()` API
- [ ] Cross-trace link handling, out-of-order event correlation
- [ ] OTel and MCP golden fixtures

**Acceptance:** MCP call/result correlation reconstructed without semantic model. OTel extensions preserved. No baggage values treated as trusted authorization.

## Phase 3 — Policy Engine & Credential Path (Week 4, 20–24 hrs)

**Focus:** Deterministic graph predicates, secret handling

- [ ] `packages/content-security` — Redaction profiles, credential classifier, HMAC fingerprinting
- [ ] `packages/policy-engine` — Policy schema (YAML→Zod), graph predicate compiler, evaluator
- [ ] 6 required policies (credential exfiltration, production mutation, delegation attenuation, restricted data to untrusted MCP, premature approval, scope mismatch)
- [ ] `packages/causal-linker` — 5-stage linker pipeline, edge assertion events
- [ ] `catg policy evaluate|replay` — CLI + API endpoints
- [ ] Policy truth table tests (T04–T11)
- [ ] Credential exfiltration demo fixture

**Acceptance:** Same evidence → same decision. Every decision includes policy digest + evidence IDs. Policy replay does not mutate original decision.

## Phase 4 — Investigation UI (Week 5, 18–22 hrs)

**Focus:** Visual graph investigation, evidence navigation

- [ ] `apps/api` — Fastify server, all 22 endpoints, dependency wiring, rate limits
- [ ] `apps/investigator-ui` — Next.js App Router, TanStack Query, React Flow
- [ ] Session list view (columns: time, principal, agent, environment, tools, violations)
- [ ] Causal graph view (type filters, confidence toggles, path highlighting, collapse)
- [ ] Timeline view (event time vs observation time)
- [ ] Evidence inspector (source adapter, integrity hash, redaction transforms)
- [ ] Data-flow path view (source → data → model → tool → destination)
- [ ] Policy decision view (matched path, authorization scope, missing evidence)
- [ ] Detector findings view (cost, latency, confidence, evidence, unresolved questions)
- [ ] Transcript-vs-graph comparison view
- [ ] Playwright E2E critical flow

**Acceptance:** Every displayed edge exposes confidence + evidence. Inferred edges visibly distinct. 1,000-node sessions usable through server-side filtering.

## Phase 5 — Detector Framework & Experiment 1 (Week 6, 20–25 hrs)

**Focus:** Semantic detection, experimental comparison

- [ ] `packages/detector-sdk` — DetectionRequest/Result schemas, fake provider for testing
- [ ] `packages/detectors-deterministic` — Exact graph-path rules
- [ ] `packages/detectors-llm` — Transcript classifier, chronological-summary classifier, graph-summary classifier
- [ ] `packages/evidence-packages` — Structured evidence package builder
- [ ] `packages/experiment-core` — Runner, metrics collection, artifact generation
- [ ] Experiment 1 execution: transcript vs chronological-summary vs causal-graph
- [ ] Metrics: precision, recall, F1, calibration, latency, cost, explanation faithfulness
- [ ] Irrelevant-context robustness test (0%, 25%, 50%, 75%)

**Acceptance:** Full Experiment 1 from single command. Artifacts contain all version hashes. Graph condition has no access to labels.

## Phase 6 — Cascade & Detector Attack (Week 7, 18–24 hrs)

**Focus:** Hybrid detection, prompt-injection resistance

- [ ] `packages/detectors-deterministic` → `packages/detectors-llm` cascade
- [ ] Detector-injection synthetic fixtures (instructions, poisoned output, forged provenance)
- [ ] Experiment 2: deterministic + semantic cascade, target ≥40% semantic-call reduction
- [ ] Experiment 3: 5 isolation conditions against 9 attack classes
- [ ] Experiment dashboard UI view (confusion matrix, PR curve, calibration)
- [ ] AgentDojo benchmark import + transformation manifest

**Acceptance:** Malformed detector output fails closed. Attack success rate computable per condition. Deterministic and semantic costs separated.

## Phase 7 — Hardening & Publication (Week 8, 15–20 hrs)

**Focus:** Documentation, reproducibility, release

- [ ] `docs/governance/anti-surveillance.md`
- [ ] `docs/experiments/` — full experiment documentation
- [ ] `docs/mappings/` — adapter field-mapping reference
- [ ] Reproducibility guide: clean clone → setup → import → policy → detector → experiment
- [ ] `SECURITY.md` — vulnerability reporting, threat model link
- [ ] All benchmark transformation manifests
- [ ] Architecture article diagrams (Mermaid → render)
- [ ] CI pipeline: lint → typecheck → test → golden fixtures → E2E
- [ ] Tag `v0.1.0`
- [ ] Final README polish

**Acceptance:** Clean install in documented environment. Exact commands reproduce tables from stored predictions. README clearly distinguishes CATG from ADR claims.
