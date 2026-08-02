# CATG — Causal Agent Telemetry Graph: Architecture

> Extracted from `SPEC.md` (the original specification, preserved verbatim as ground-truth reference).
> Every section below cites the SPEC.md section(s) it was extracted from. Where the spec defines a
> contract convention but does not enumerate concrete values (e.g., per-package forbidden-dependency
> lists), this document says so explicitly rather than inventing content.

---

## 1. Executive Summary

CATG is an append-only telemetry and evidence layer that converts heterogeneous agent traces into an explicit graph of identities, activities, data objects, authorization decisions, delegations, side effects, and evidentiary relationships. Its purpose is empirical: determine whether graph-structured causal evidence improves security detection, deterministic policy evaluation, forensic explanation, and workflow debugging over transcript-only telemetry without unacceptable latency, storage, engineering, or model-token cost. (SPEC.md §1)

The proof of concept ingests Uber ADR AgentEvent exports, OpenTelemetry spans, MCP client/server events, and synthetic benchmark traces; normalizes them into immutable canonical events; resolves identities and resources; constructs observed and explicitly qualified reconstructed relationships; projects them into embedded Kuzu; evaluates deterministic graph policies; and optionally runs semantic detectors over either transcripts or graph-derived evidence packages. The project must not claim statistical causal inference: "Causal" means workflow causation supported by observed identifiers, declared relationships, protocol semantics, or explicitly qualified reconstruction — not philosophical, counterfactual, or probabilistic causality. A solo senior TypeScript engineer working part-time should implement the MVP in 6–8 weeks by limiting the first release to: offline and near-local ingestion; ADR, OpenTelemetry, and MCP fixture adapters; an embedded graph database; five deterministic policies (six are specified in §13; see §5.3 below); two semantic detector representations; three reproducible experiments; a focused investigation interface; and no production blocking or enterprise platform simulation. (SPEC.md §1)

## 2. Architecture Overview

The system is a single linear processing pipeline terminated by four consumer surfaces. The pipeline as specified in SPEC.md §7:

```
ADR/OTEL/MCP/SDK/Bench/Synthetic → Adapters → Validate → Redact → Ledger
                                                                    ↓
                                                               Resolve → Causal Linker → Kuzu Graph
                                                                                          ↓
                                                                              Policy Engine → Detector Framework
                                                                                          ↓
                                                                              Evidence Package Builder
                                                                                          ↓
                                                                              API / CLI / UI / Experiment Runner
```

**Architectural rule (SPEC.md §7):** *The immutable event ledger is the source of truth. Kuzu is a rebuildable materialized projection.*

Key structural properties that shape every component:

- **Append-only canonical events** precede any derived graph state; evidence is stored immutable before derived state exists (SPEC.md §4, §9).
- **Every non-observed relation carries method, confidence, and evidence** — no unqualified inference (SPEC.md §3, §8).
- **Untrusted content is never injected into privileged detector instructions** — evidence is passed as delimited data (SPEC.md §3, ADR-005).
- **Source telemetry extensions are preserved** in a bounded extensions object on canonical events (ADR-006).
- **No vendor coupling**: the domain model is independent of Claude, OpenAI, Cursor, or MCP implementation details (SPEC.md §3).
- **Deterministic policies execute before semantic detectors** — rules first, reducing cost and improving reproducibility (ADR-003).

## 3. Component Architecture

Monorepo layout and package contracts are defined in SPEC.md §20. The 20 `packages/` components map onto the pipeline as follows:

| Package (SPEC.md §20) | Pipeline Stage | Public Interface Summary (per spec annotation) |
|---|---|---|
| `packages/schema` | Cross-cutting contract layer | Zod schemas + TS types for canonical events, nodes, edges, policies, detectors |
| `packages/canonical-json` | Validate / Ledger | Deterministic serialization (stable canonical hashes) |
| `packages/event-ledger` | Ledger | SQLite append-only ledger (events, dedupe, checkpoints, quarantine) |
| `packages/graph-model` | Graph | Ontology registry (node/edge types, confidence semantics) |
| `packages/graph-projection` | Projection | Ledger → Kuzu projection (rebuildable) |
| `packages/ingestion-core` | Adapters → Validate → Redact | Import orchestration |
| `packages/adapters-adr` | Adapters | ADR AgentEvent mapping |
| `packages/adapters-otel` | Adapters | OTLP JSON span mapping |
| `packages/adapters-mcp` | Adapters | MCP client/server event mapping (request-ID matching) |
| `packages/instrumentation-sdk` | Source (SDK) | Direct producer API for emitting events from instrumented code |
| `packages/identity-resolution` | Resolve | Source identities → stable IDs (`urn:catg:{tenant}:…`) |
| `packages/causal-linker` | Causal Linker | Immutable edge assertions (precedence-ordered linker) |
| `packages/content-security` | Redact | Redaction / classification / encryption (XChaCha20-Poly1305 or AES-256-GCM envelope encryption) |
| `packages/policy-engine` | Policy Engine | Deterministic graph predicates (YAML compiled with Zod) |
| `packages/detector-sdk` | Detector Framework | Detector protocol (immutable evidence references, strict output schema) |
| `packages/detectors-deterministic` | Detector Framework | Graph rules (exact path and attribute matching) |
| `packages/detectors-llm` | Detector Framework | Transcript + graph-summary classifiers |
| `packages/evidence-packages` | Evidence Package Builder | Detector/incident inputs (structured evidence JSON) |
| `packages/query-sdk` | Query layer | Safe graph queries (no arbitrary graph-query API — SPEC.md §25) |
| `packages/experiment-core` | Experiment Runner | Runs, metrics, attestations (in-toto) |
| `packages/fixtures` | Test/benchmark support | Benchmark-independent fixtures |
| `packages/testkit` | Test/benchmark support | Builders + assertions |

**Apps (SPEC.md §20):**
- `apps/api` — Fastify service exposing `/api/v1` (SPEC.md §15).
- `apps/investigator-ui` — Next.js App Router UI; **API only, no direct DB access**.
- `apps/cli` — the `catg` binary; runs embedded services for local use and calls package interfaces (SPEC.md §16).

**Python (SPEC.md §12, §20):**
- `python/adr-bridge` — invokes ADR Sensor; **no policy or graph logic in Python**.
- `python/benchmark-runner` — benchmark tooling (Docker-isolated).

Other top-level areas: `policies/default/` (YAML policies), `experiments/`, `datasets/` (adr-bench, agentdojo, catg-synthetic, splits), `docs/`, `scripts/`, `docker/`, plus `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `vitest.workspace.ts`, `docker-compose.yml`, `LICENSE`, `SECURITY.md`, `README.md`.

## 4. Deployment Topology

The deployment model is a **local workstation** (SPEC.md §7). No Kubernetes, Kafka, or external graph service (SPEC.md §3):

```
Local workstation
├── API process (Fastify)
├── Kuzu database directory
├── SQLite event ledger
├── Next.js UI
├── CLI (catg)
└── Docker-isolated benchmark runner
```

Consequences for the architecture (SPEC.md §3, §7, §11):
- All storage is embedded/local: SQLite (ledger + UI settings), Kuzu directory (graph projection), local content-addressed directory (artifacts), DuckDB or Parquet (experiment analytics).
- One-command setup is a stated constraint; offline and near-local ingestion only.
- The benchmark runner is isolated in Docker so experiment execution cannot affect the local ledger/graph.

## 5. Processing Stages

Detailed flow per SPEC.md §7, with supporting detail from §9, §12, §13, §14.

### 5.1 Source Adapters

Inputs: **ADR / OTel / MCP / SDK / Bench / Synthetic** traces (SPEC.md §7). Required adapters (SPEC.md §12):

| Adapter | Input | Mapping |
|---|---|---|
| ADR adapter | ADR AgentEvent JSON/JSONL | `AgentEvent → CanonicalEventEnvelope` (uuid, source, session_id, timestamp, model, chat_history[], tools[]) |
| OpenTelemetry adapter | OTLP JSON spans (subset) | `resourceSpans`, trace/span IDs, links, events, attributes |
| MCP adapter | Instrumented MCP client/server events | Matches request IDs for CALLED/RETURNED relationships |
| Direct SDK | Programmatic events | `instrumentation-sdk` emitting API |
| Benchmark imports | ADR-Bench and AgentDojo | Transformation manifests required |

Adapter interface (SPEC.md §12):

```typescript
interface SourceAdapter<TInput> {
  readonly name: string;
  readonly version: string;
  readonly supportedSchemas: readonly string[];
  detect(input: TInput): Promise<number>;
  parse(input: TInput, context: AdapterContext): AsyncIterable<CanonicalEventEnvelope>;
}
```

ADR bridge architecture (SPEC.md §12): `Native coding-agent log → ADR Sensor parser → AgentEvent JSONL → CATG ADR adapter`; the Python bridge invokes ADR Sensor only — **no policy or graph logic in Python**. CATG must accept ADR Sensor records without requiring modifications to ADR (compatibility contract, SPEC.md §5).

### 5.2 Validation

Adapters emit canonical events validated against the Zod schemas in `packages/schema` (SPEC.md §20). Validation errors and quarantined records are tracked: the ledger includes a `quarantine_records` table (SPEC.md §11). Duplicate imports are handled via idempotency (see §5.4).

### 5.3 Redaction

`packages/content-security` performs redaction, classification, and encryption (SPEC.md §20). Security posture (SPEC.md §3, §18, §25): content minimization, configurable redaction, **no mandatory raw prompts**; raw secrets disabled by default; keyed HMAC fingerprints for secrets (never raw retention); redacted excerpts and encrypted originals stored as content artifacts; field-level envelope encryption with a random DEK per artifact, DEK encrypted by a local KEK, using XChaCha20-Poly1305 or AES-256-GCM (SPEC.md §18).

### 5.4 Ledger Append

Canonical events are appended to the SQLite event ledger — the **authoritative source of truth** (SPEC.md §7, §11). Idempotency (SPEC.md §9): stable `eventId` when the source has a stable identifier; otherwise

```
dedupe_key = SHA256(tenant_id || source_kind || source_record_id || normalized_event_type || normalized_occurred_at || canonical_payload_hash)
```

with a unique index on `(tenant_id, dedupe_key)`. Append-only is enforced by triggers rejecting UPDATE/DELETE outside test builds (SPEC.md §11). The 24 required event families (SPEC.md §9): `source_record.imported`, `session.observed`, `run.started`, `run.completed`, `message.observed`, `instruction.extracted`, `model.invocation.started`, `model.invocation.completed`, `tool.definition.observed`, `tool_call.observed`, `tool_result.observed`, `resource.accessed`, `data_object.classified`, `credential.detected`, `approval.requested`, `approval.decided`, `delegation.observed`, `external_effect.observed`, `verification.observed`, `edge.asserted`, `policy.evaluated`, `detector.executed`, `incident.updated`, `evidence.created`, `projection.checkpointed`. `CanonicalEventEnvelope` includes: eventId, schemaVersion, eventType, occurredAt, observedAt, producer, subject, trace context, identity context, payload, provenance, security classification, integrity hash chain, extensions (SPEC.md §9).

### 5.5 Resolution

`packages/identity-resolution` maps source identities to stable, tenant-scoped IDs (SPEC.md §8; see §6.4 of this document for the identifier strategy). Resolution is asynchronous enrichment consistent with out-of-order heterogeneous sources (SPEC.md §3).

### 5.6 Causal Linking

`packages/causal-linker` turns resolved canonical events into **immutable edge assertions** using the precedence-ordered linker (SPEC.md §10; full detail in §7 of this document). Every edge carries method, confidence, confidenceScore, causalBasis, provenance, evidenceIds, linkerId, linkerVersion (SPEC.md §8).

### 5.7 Projection (Kuzu Graph)

The ledger is projected into embedded Kuzu as a rebuildable materialized projection (SPEC.md §7, §11). Physical Kuzu tables: Principal, Agent, Execution, Communication, Tooling, Asset, Governance, Outcome, EvidenceArtifact; edges via typed relationship tables plus a generic ASSERTS relation for rare edge types (SPEC.md §11). Re-projection from canonical events and schema migrations by rebuilding the projection are MVP "should" items (SPEC.md §4).

### 5.8 Policy Evaluation

The deterministic graph-policy engine evaluates compiled YAML policies against the projected graph (SPEC.md §13). Evaluation algorithm: 1. Resolve policy selectors → 2. Build candidate subgraph → 3. Evaluate positive predicate → 4. If false: NOT_APPLICABLE → 5. Evaluate exception predicate → 6. Validate authorization evidence and scope → 7. Return ALLOW/DENY/REQUIRE_APPROVAL/FLAG/INDETERMINATE → 8. Materialize PolicyDecision. Policies are versioned and hashed (SPEC.md §25); replay is supported, e.g. `catg policy replay --policy policies/no-credential-exfiltration@2.0.0.yaml --session sess-17 --as-of-event 845` (SPEC.md §13).

### 5.9 Semantic Detection

Detectors consume immutable evidence references (never raw source events), must not write source events or add graph edges, run with network/tool access disabled unless explicitly allowed, declare model/prompt/policy/code versions, treat evidence content as untrusted data, and validate output against a strict schema (SPEC.md §14). Detector representations required for MVP: two semantic detector representations plus deterministic graph rules (SPEC.md §1).

### 5.10 Explanation (Evidence Package Builder)

The Evidence Package Builder produces structured JSON evidence packages containing: intent, principals, agents, authority, untrusted inputs, sensitive paths (with edge confidence), effects, policy decisions, unknowns (SPEC.md §14). These feed incident narratives, API responses, CLI output, UI views, and experiment runs.

### 5.11 Consumer Surfaces

API (Fastify, `/api/v1`), CLI (`catg`), Next.js investigation UI, and the Docker-isolated Experiment Runner (SPEC.md §7, §15–§17).

## 6. Domain Ontology Overview

Full ontology in SPEC.md §8 — this section summarizes; the registries below are reproduced in full because they are normative.

### 6.1 Universal Node Fields

All node types inherit: `id, type, schemaVersion, tenantId, environment, occurredAt, observedAt, validFrom, validTo, confidence (observed|declared|reconstructed|inferred|speculative), sensitivity, retention, provenance (ProvenanceRef[]), integrityHash, labels, attributes` (SPEC.md §8).

### 6.2 Node-Type Registry (28 types)

- **Identity:** HumanPrincipal, ServicePrincipal, Agent, AgentSession
- **Execution:** AgentRun, ModelInvocation, PlanStep
- **Communication:** Prompt, Message, Instruction
- **Tooling:** Tool, ToolCall, ToolResult, MCPServer
- **Asset:** Resource, DataObject, Credential, MemoryEntry
- **Governance:** Policy, PolicyDecision, ApprovalRequest, ApprovalDecision, Delegation
- **Outcome:** ExternalEffect, Verification, Detection, Incident
- **Evidence:** EvidenceArtifact, InvestigationContainer

(SPEC.md §8)

### 6.3 Edge-Type Registry (27 types) and Confidence Semantics

Universal edge fields (SPEC.md §8): `id, type, fromId, toId, schemaVersion, tenantId, environment, assertedAt, validFrom, validTo, confidence, confidenceScore, causalBasis, provenance, evidenceIds, linkerId, linkerVersion, sensitivity, retention, integrityHash, attributes`.

| Edge | From → To | Meaning | Default Confidence |
|------|-----------|---------|-------------------|
| INITIATED | Principal → Session/Run | Principal started execution | observed/declared |
| ACTED_ON_BEHALF_OF | Agent → Principal | Agent exercised delegated authority | declared/reconstructed |
| DELEGATED_TO | Agent/Run → Agent/Run | Objective or authority transferred | observed/declared |
| CONTAINS | Session/Run/Prompt → child | Structural containment | observed/reconstructed |
| PRECEDED_BY | Activity → Activity | Ordering only | observed/reconstructed |
| INFORMED_BY | Activity → Activity | Earlier activity supplied relevant information | declared/reconstructed/inferred |
| USED | Activity → Entity | Activity consumed entity | observed/reconstructed |
| GENERATED | Activity → Entity | Activity produced entity | observed/reconstructed |
| DERIVED_FROM | Entity → Entity | Entity transformation lineage | declared/reconstructed/inferred |
| READ_FROM | ToolCall/DataObject → Resource | Data read from resource | observed/reconstructed |
| WROTE_TO | ToolCall/DataObject → Resource | Data written to resource | observed/reconstructed |
| CALLED | AgentRun/ModelInvocation → ToolCall/Tool | Invocation relationship | observed |
| RETURNED | ToolResult → ToolCall | Result of invocation | observed/reconstructed |
| SENT_TO | DataObject/Credential → Resource/MCPServer | Data transmitted | observed/reconstructed |
| RECEIVED_FROM | DataObject/Instruction → Resource/MCPServer | Data originated externally | observed/reconstructed |
| REQUESTED_APPROVAL | Run/ToolCall → ApprovalRequest | Authorization requested | observed |
| APPROVED_BY | ApprovalRequest/ToolCall → ApprovalDecision/Principal | Approval relationship | observed/declared |
| DENIED_BY | ApprovalRequest/ToolCall → ApprovalDecision/Principal | Denial relationship | observed/declared |
| AUTHORIZED_BY | ToolCall/Effect/Delegation → PolicyDecision/ApprovalDecision | Valid authorization basis | reconstructed |
| EVALUATED_AGAINST | Decision/Detection → Policy/Evidence | Evaluation target | observed |
| VIOLATED | Decision/Run/Call → Policy | Policy violation | deterministic/inferred |
| CAUSED | Activity/Entity → Activity/Effect | Strong workflow-causal evidence | observed/declared/reconstructed |
| MAY_HAVE_CAUSED | Activity/Entity → Activity/Effect | Plausible but uncertain influence | inferred/speculative |
| VERIFIED_BY | Entity/Effect/Decision → Verification | Supporting verification | observed |
| CONTRADICTED_BY | Assertion/Detection → Evidence/Verification | Evidence contradicts claim | observed/reconstructed |
| DETECTED_AS | Run/Path/Entity → Detection | Detector judgment | observed |
| PART_OF_INCIDENT | Detection/Evidence/Run → Incident | Investigation grouping | declared |

(SPEC.md §8)

Confidence semantics (SPEC.md §8):

| Value | Meaning |
|-------|---------|
| observed | Explicit source identifiers or instrumentation directly establish the relation |
| declared | A producer or actor asserts the relation but CATG did not independently observe it |
| reconstructed | Deterministic source/protocol rules establish the relation |
| inferred | Heuristic or semantic analysis suggests the relation |
| speculative | Weak hypothesis retained for investigation, never sufficient alone for enforcement |

### 6.4 Stable Identifier Strategy

| Object Class | Identifier (SPEC.md §8) |
|-------------|-----------|
| Source-record-backed node | `urn:catg:{tenant}:{source}:{source-stable-id}` |
| OTel span activity | `urn:catg:{tenant}:otel:{traceId}:{spanId}` |
| ADR message | `urn:catg:{tenant}:adr:{sessionId}:message:{sequenceId}` |
| ADR tool call | Hash of session, message ID, tool index, normalized tool identity |
| Content-addressed entity | `urn:catg:sha256:{canonical-content-hash}` |
| Principal | Tenant namespace + issuer + subject |
| Tool | Package/server namespace + normalized tool name + version |
| Policy | Policy namespace + policy ID + immutable version |
| Derived assertion | Hash of relation type, endpoints, method, evidence IDs, linker version |
| Finding | Hash of detector version, evidence snapshot hash, verdict, run ID |

### 6.5 PROV Mapping

| CATG Concept | PROV Superclass (SPEC.md §6) |
|-------------|----------------|
| Prompt, Message, Credential, Resource, Policy | Entity |
| AgentRun, ModelInvocation, ToolCall, Verification | Activity |
| HumanPrincipal, ServicePrincipal, Agent | Agent |
| USED, READ_FROM | used specialization |
| GENERATED, WROTE_TO | wasGeneratedBy specialization |
| DERIVED_FROM | wasDerivedFrom |
| ACTED_ON_BEHALF_OF, DELEGATED_TO | actedOnBehalfOf specialization |
| INFORMED_BY | wasInformedBy |
| INITIATED | wasAssociatedWith + CATG role |
| CAUSED | qualified workflow-causation assertion |

CATG deliberately runs **no RDF/OWL runtime** (ADR-002); PROV semantics are specialized into a typed property graph for TypeScript ergonomics (SPEC.md §6, §7).

## 7. Causal-Linking Model

Full specification in SPEC.md §10.

### 7.1 Linker Pipeline

```
Canonical events → Direct identifier linker → Protocol-semantic linker → Deterministic reconstruction → Heuristic data-flow linker → Optional semantic linker → Immutable edge assertions
```

### 7.2 Linker Precedence

1. Source identifier
2. OpenTelemetry parent or link
3. MCP request ID
4. Explicit call/result ID
5. Direct resource and content fingerprint
6. Deterministic containment and sequence
7. Argument/result field-level derivation
8. Semantic inference
9. Temporal proximity alone (PRECEDED_BY only, never CAUSED)

### 7.3 Confidence Mapping

| Basis | Default Confidence | Score Range |
|-------|-------------------|-------------|
| source identifier | observed | 1.00 |
| protocol semantics | observed | 0.98 |
| producer declaration | declared | 0.90 |
| deterministic reconstruction | reconstructed | 0.80–0.95 |
| exact content/field match | reconstructed | 0.75–0.90 |
| semantic inference | inferred | 0.50–0.79 |
| temporal proximity | speculative | ≤0.35 |

### 7.4 Strong CAUSED Requirements

**CAUSED may be emitted only when at least one holds:** explicit producer relation; matching protocol request/response identifier; direct output-to-input field mapping; deterministic side-effect receipt identifying the call; analyst assertion with signed identity. **Otherwise use MAY_HAVE_CAUSED** (SPEC.md §10).

## 8. Storage Architecture

Storage roles (SPEC.md §11):

| Data | Technology | Role |
|------|-----------|------|
| Canonical events | SQLite | Authoritative append-only ledger |
| Graph projection | Kuzu | Path traversal and investigation |
| Content artifacts | Local content-addressed directory | Redacted excerpts, encrypted originals |
| Experiment metrics | DuckDB or Parquet | Analytical comparison |
| UI settings | SQLite | Local non-evidentiary metadata |

### 8.1 SQLite Ledger

Tables: `events` (with `dedupe_key` unique index), `projection_checkpoints`, `quarantine_records`. Append-only enforced via **triggers rejecting UPDATE/DELETE outside test builds** (SPEC.md §11). Idempotency via `dedupe_key = SHA256(tenant_id || source_kind || source_record_id || normalized_event_type || normalized_occurred_at || canonical_payload_hash)`, unique on `(tenant_id, dedupe_key)` (SPEC.md §9).

### 8.2 Kuzu Model

Physical tables: Principal, Agent, Execution, Communication, Tooling, Asset, Governance, Outcome, EvidenceArtifact. Edges via **typed relationship tables + generic ASSERTS relation** for rare edge types (SPEC.md §11). The graph is a rebuildable materialized projection of the ledger; re-projection from canonical events and rebuild-based schema migrations are supported (SPEC.md §4, ADR-001).

### 8.3 Content-Addressed Artifacts

Local content-addressed directory holds redacted excerpts and encrypted originals. Content-addressed entities are identified as `urn:catg:sha256:{canonical-content-hash}` (SPEC.md §8). Encryption: envelope encryption with random DEK per artifact, DEK encrypted by local KEK, XChaCha20-Poly1305 or AES-256-GCM (SPEC.md §18). Secrets use keyed HMAC fingerprints; raw-content storage is disabled by default (SPEC.md §25).

## 9. API Design Summary

Base path: **`/api/v1`** (SPEC.md §15). The API process is Fastify (SPEC.md §7, §20).

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | /imports | Start synchronous/local import |
| GET | /imports/:id | Import status and validation report |
| GET | /sessions | Filtered session list |
| GET | /sessions/:id | Session summary |
| GET | /sessions/:id/timeline | Chronological canonical events |
| GET | /sessions/:id/graph | Investigation subgraph |
| GET | /sessions/:id/data-flows | Sensitive-data paths |
| GET | /nodes/:id | Node details |
| GET | /edges/:id | Edge assertion and provenance |
| GET | /evidence/:id | Redacted evidence metadata/content |
| POST | /policies/validate | Validate policy document |
| POST | /policy-evaluations | Evaluate or replay policy |
| GET | /policy-evaluations/:id | Decision and explanation |
| POST | /detections | Execute detector |
| GET | /detections/:id | Detector result |
| POST | /incidents | Create investigation container |
| GET | /incidents/:id/explanation | Evidence-backed incident narrative |
| POST | /experiments/runs | Run local experiment configuration |
| GET | /experiments/runs/:id | Metrics and artifact links |
| GET | /schema | Node, edge, and event registry |
| GET | /health | Process and storage health |

(SPEC.md §15)

**Security constraints (SPEC.md §18, §25):** no arbitrary graph-query API (query access is via the constrained `query-sdk` and the endpoints above); raw secrets disabled by default; keyed HMAC fingerprints; detector evidence is separated from privileged instructions; detector output schema-validated; cross-tenant tests required; unsigned telemetry marked unverified; versioned/hashed policy changes; audited sensitive-evidence access. Performance target: **session graph API ≤ 1s after filtering** (SPEC.md §25).

**Graph response format:** SPEC.md defines the graph endpoint's purpose as "Investigation subgraph" with **server-side graph filtering** (SPEC.md §15, §17); node details (`/nodes/:id`) and edge assertions with provenance (`/edges/:id`) are retrieved individually, and the schema registry is exposed at `/schema`. The wire format of the subgraph payload is not further enumerated in SPEC.md; it is defined by the OpenAPI contract tested in the contract-test suite (SPEC.md §21).

## 10. CLI Design Summary

Binary: **`catg`** (SPEC.md §16).

**Commands:** `init`, `dev`, `import` (adr/otel/benchmark), `validate` (event/policy), `project rebuild`, `session` (list/show), `graph path`, `policy` (evaluate/replay), `detect`, `incident explain`, `experiment` (run/compare/attest), `doctor`.

**Principles (SPEC.md §16):** JSON output via `--json`; stable exit codes; no interactive prompts in CI; sensitive content omitted unless `--show-sensitive`.

Example replay invocation (SPEC.md §13): `catg policy replay --policy policies/no-credential-exfiltration@2.0.0.yaml --session sess-17 --as-of-event 845`.

## 11. UI Architecture

**Technology stack (SPEC.md §17):** Next.js App Router, TanStack Query, React Flow, virtualized timeline, server-side graph filtering. The UI app is API-only with **no direct DB access** (SPEC.md §20).

**Views (10) (SPEC.md §17):**
1. Session list
2. Causal graph (type filters, confidence toggles, path highlighting, visual encoding)
3. Chronological timeline
4. Evidence inspector
5. Data-flow path
6. Policy decisions
7. Detector findings
8. Transcript-versus-graph comparison
9. Experiment dashboard (confusion matrix, PR curve, calibration)
10. Schema/provenance inspector

**Investigation rule (SPEC.md §17):** *Every textual claim in an incident explanation must expose one of: Evidence, Policy inference, Detector judgment, or Unresolved hypothesis.*

UI performance constraint: max 1,500 simultaneous elements (SPEC.md §25).

## 12. Observability and Reproducibility

**CATG's own telemetry** runs via OpenTelemetry (SPEC.md §22), covering: import duration, events accepted/quarantined, projection lag, linker candidates/assertions, graph-query latency, policy evaluation latency, detector token usage and cost, experiment progress.

**Reproducibility manifest (SPEC.md §22)** includes: catg version, git commit, pnpm lock hash, Python lock hash, OS/arch, dataset hash, policy set hash, prompt set hash, model snapshot, seed.

**Experiment attestation** is produced in in-toto format with typed predicate binding claims to digested subjects (SPEC.md §22). Each experiment run produces: `run.json`, `config.resolved.json`, `dataset.manifest.json`, `environment.lock.json`, `predictions.jsonl`, `metrics.json`, `latency.parquet`, `costs.parquet`, `prompt-manifest.json`, `model-manifest.json`, `git-state.json`, `attestation.json`, `report.md` (SPEC.md §19).

## 13. Architecture Decision Records

All six ADRs from SPEC.md §7:

- **ADR-001 — Immutable ledger + graph projection:** SQLite append-only event ledger is authoritative; Kuzu is rebuildable.
- **ADR-002 — Typed property graph, not RDF runtime:** Specialize PROV semantics in property graph for TypeScript ergonomics.
- **ADR-003 — Deterministic policies before semantic detectors:** Rules execute first, reduce cost, improve reproducibility.
- **ADR-004 — Edge assertions are immutable evidence:** Old assertions must remain auditable.
- **ADR-005 — No raw evidence in system instructions:** Untrusted content passed as delimited data.
- **ADR-006 — Preserve source telemetry extensions:** Canonical events retain bounded extensions object.

## 14. Package Contracts Summary

SPEC.md §20 defines the contract convention: **each package is defined with responsibility, public interface, forbidden dependencies, and testing requirements**. SPEC.md enumerates responsibilities (annotations in the repository tree) and states the global architectural rules from which dependency constraints derive; per-package forbidden-dependency lists beyond those rules are to be fixed at implementation time per the convention. The contract as specified:

| Package / App | Responsibility (SPEC.md §20) | Forbidden dependencies / constraints |
|---|---|---|
| `apps/api` | Fastify API process | — (serves `/api/v1`, SPEC.md §15) |
| `apps/investigator-ui` | Next.js App Router UI | **API only, no direct DB** |
| `apps/cli` | `catg` binary | Runs embedded services for local use; **calls package interfaces** (no reimplementation) |
| `packages/schema` | Zod schemas + TS types | Foundation contract layer |
| `packages/canonical-json` | Deterministic serialization | — |
| `packages/event-ledger` | SQLite append-only | Append-only enforced by triggers; write paths never exposed to detectors (SPEC.md §11, §14) |
| `packages/graph-model` | Ontology registry | — |
| `packages/graph-projection` | Ledger → Kuzu | — |
| `packages/ingestion-core` | Import orchestration | — |
| `packages/adapters-adr` | ADR mapping | Vendor-neutral domain model; no policy/graph logic (SPEC.md §3, §12) |
| `packages/adapters-otel` | OTLP mapping | No dependence on unstable attribute names (SPEC.md §6) |
| `packages/adapters-mcp` | MCP event mapping | — |
| `packages/instrumentation-sdk` | Direct producer API | — |
| `packages/identity-resolution` | Source identities → stable IDs | — |
| `packages/causal-linker` | Immutable edge assertions | Edge assertions immutable per ADR-004 |
| `packages/content-security` | Redaction/classification/encryption | Raw-content storage disabled by default (SPEC.md §25) |
| `packages/policy-engine` | Deterministic graph predicates | Deliberately constrained grammar — no Rego creep (SPEC.md §24); no LLM dependency |
| `packages/detector-sdk` | Detector protocol | Must not write source events or add graph edges; network/tool access disabled unless explicitly allowed (SPEC.md §14) |
| `packages/detectors-deterministic` | Graph rules | Exact path and attribute matching (SPEC.md §14) |
| `packages/detectors-llm` | Transcript + graph classifiers | No raw evidence in system instructions (ADR-005); evidence as untrusted data |
| `packages/evidence-packages` | Detector/incident inputs | — |
| `packages/query-sdk` | Safe graph queries | No arbitrary graph-query API (SPEC.md §25) |
| `packages/experiment-core` | Runs, metrics, attestations | — |
| `packages/fixtures` | Benchmark-independent fixtures | — |
| `packages/testkit` | Builders + assertions | — |
| `python/adr-bridge` | ADR Sensor invocation | **No policy or graph logic in Python** (SPEC.md §12) |
| `python/benchmark-runner` | Benchmark tooling | Docker-isolated (SPEC.md §7) |

Testing requirements per package follow the SPEC.md §21 pyramid (unit, contract, golden, property-based, integration, end-to-end) with coverage goals: schema and policy engine ≥90%; ingestion/linker ≥85%; API ≥80% (SPEC.md §21).

---

*End of extracted architecture. Ground truth remains `SPEC.md`; this document adds no requirements beyond those stated there.*
