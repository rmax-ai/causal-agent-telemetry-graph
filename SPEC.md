# CATG — Causal Agent Telemetry Graph

> Original specification preserved verbatim as ground-truth reference.
> Every downstream document references SPEC.md sections.

---

## 1. Executive Summary

CATG is an append-only telemetry and evidence layer that converts heterogeneous agent traces into an explicit graph of identities, activities, data objects, authorization decisions, delegations, side effects, and evidentiary relationships. Its purpose is empirical: determine whether graph-structured causal evidence improves security detection, deterministic policy evaluation, forensic explanation, and workflow debugging over transcript-only telemetry without unacceptable latency, storage, engineering, or model-token cost.

The proof of concept will ingest Uber ADR AgentEvent exports, OpenTelemetry spans, MCP client/server events, and synthetic benchmark traces. It will normalize them into immutable canonical events, resolve identities and resources, construct observed and explicitly qualified reconstructed relationships, project them into embedded Kuzu, evaluate deterministic graph policies, and optionally run semantic detectors over either transcripts or graph-derived evidence packages.

The project must not claim statistical causal inference. "Causal" means workflow causation supported by observed identifiers, declared relationships, protocol semantics, or explicitly qualified reconstruction—not philosophical, counterfactual, or probabilistic causality.

A solo senior TypeScript engineer working part-time should be able to implement the MVP in 6–8 weeks by limiting the first release to: offline and near-local ingestion; ADR, OpenTelemetry, and MCP fixture adapters; an embedded graph database; five deterministic policies; two semantic detector representations; three reproducible experiments; a focused investigation interface; no production blocking or enterprise platform simulation.

---

## 2. Research Hypothesis

### Primary Hypothesis

For multi-step agent workflows involving indirect prompt injection, credential movement, approval boundaries, delegation, or cross-tool effects, a selectively retrieved causal/provenance graph will produce higher detection quality and more faithful explanations than a raw transcript classifier at comparable model-token cost and no more than 2× end-to-end analysis latency.

### Secondary Hypotheses

| ID | Hypothesis |
|----|-----------|
| H2 | Some security and conformance questions are fundamentally graph predicates rather than language-classification problems |
| H3 | Graph retrieval should be less sensitive than raw transcript classification to large volumes of irrelevant messages and tool output |
| H4 | Separating untrusted content from graph facts, provenance metadata, and detector instructions should reduce detector-targeted prompt-injection success |
| H5 | Investigators should be able to navigate from every finding to immutable source evidence and identify unresolved uncertainty faster than when reading a transcript alone |

### Null Hypothesis

After controlling for model, token budget, prompt, and benchmark composition, graph representations provide no meaningful improvement in F1, calibration, explanation faithfulness, investigation time, or cost per correct detection.

### Success Thresholds

At least one of:
- ≥10 percentage-point absolute F1 improvement at ≤1.25× model cost
- Equivalent F1 with ≥30% lower token cost
- ≥20% improvement in explanation-faithfulness score
- ≥30% reduction in median investigator task time
- Deterministic detection of policy violations not reliably expressible from transcript text

---

## 3. Problem Definition

Existing agent telemetry commonly records a chronological transcript: user and assistant messages, model responses, tool calls and results. A transcript orders records but does not necessarily state provenance, authority, data flow, or causation.

### Dominant Constraints

| Constraint | Consequence |
|-----------|------------|
| Solo engineer, part-time, 6–8 weeks | Embedded components, offline-first, narrow adapter set |
| Sensitive telemetry | Content minimization, configurable redaction, no mandatory raw prompts |
| Adversarial imported data | Never inject raw evidence directly into privileged detector instructions |
| Out-of-order heterogeneous sources | Append-only canonical events and asynchronous enrichment |
| Research comparability | Fixed fixtures, pinned configurations, representation-controlled experiments |
| Graph uncertainty | Every non-observed relation carries method, confidence, and evidence |
| Vendor neutrality | Domain model independent of Claude, OpenAI, Cursor, or MCP implementation details |
| Reproducibility | Every result links to dataset, policy, detector, prompt, model, and code versions |
| Local developer experience | One-command setup, no Kubernetes, Kafka, or external graph service |

### Explicitly Out of Scope

Production endpoint management; fleet-wide telemetry collection; real-time prevention; statistical causal discovery; model chain-of-thought capture; universal semantic interpretation of arbitrary tool output; production identity federation; autonomous incident response; complete SIEM replacement; reconstructing events that source telemetry never exposed.

---

## 4. Scope and Non-Goals

### MVP Must

- Import ADR Sensor JSON and JSONL
- Import a defined subset of OTLP JSON spans
- Instrument a reference MCP client and server
- Produce versioned canonical events
- Store immutable evidence before derived graph state
- Project at least the required node and edge types into Kuzu
- Qualify every reconstructed or inferred edge
- Evaluate five deterministic graph policies
- Execute transcript-based and graph-summary semantic detectors
- Expose evidence through CLI, API, and UI
- Run the three required experiments
- Generate machine-readable experiment artifacts

### MVP Should

- Preserve OpenTelemetry trace and span identifiers
- Support content hashes, redacted excerpts, and external content references
- Export findings in a simplified OCSF-compatible shape
- Export evidence bundles as in-toto-style statements
- Allow re-projection from canonical events
- Support graph schema migrations by rebuilding the projection

### MVP May

- Use DuckDB for experiment aggregation
- Encrypt selected content fields locally
- Sign benchmark evidence bundles
- Add a generic JSON mapping adapter

### Non-Goals

CATG is not: a new general-purpose observability backend; a replacement for ADR; a production policy-enforcement proxy; a graph-RAG product; an employee-productivity scoring system; proof that an inferred edge represents "true" model reasoning; a guarantee of deterministic model replay.

---

## 5. Relationship to Uber ADR

Uber ADR identifies the complete workflow—not an isolated tool call—as the relevant unit for agent-security analysis. The paper describes three major components: Sensor, Explorer, and Detector, with the Detector using fast triage followed by deeper context-aware reasoning.

### Adopted from ADR

- Workflow-level security analysis
- Heterogeneous source adapters
- Session reconstruction
- Fast/cheap triage followed by selective deeper analysis
- Enterprise-style MCP fixtures
- Explicit benchmark reproducibility
- Cost and latency as first-class metrics

### Extended by CATG

- Session transcript → append-only event ledger
- Implicit chronology → typed causal/provenance graph
- Generic user/session identity → principals, agents, delegations, credentials, approvals
- Nested tool usage → separate invocation, result, resource, data, and effect entities
- Detector rationale → immutable evidence references
- Workflow context → deterministic graph-policy replay
- Session-level UUID → source-stable event and entity identifiers

### Deliberately Rejected

- Treating all message content as required telemetry
- Treating chronology as sufficient evidence of causation
- Binding CATG's schema to ADR's threat taxonomy
- Presenting production claims from the paper as repository functionality
- Reimplementing ADR Explorer
- Copying ADR's Python architecture into CATG's TypeScript core

### Compatibility Contract

```
ADR Sensor output → ADR adapter → Canonical CATG events → Graph + policy + detectors
```

CATG must accept ADR Sensor records without requiring modifications to ADR.

---

## 6. Standards and Literature Foundations

| Source | CATG Adoption | Extension | Deliberate Non-Alignment |
|--------|--------------|-----------|------------------------|
| W3C PROV-DM/O | Entity, Activity, Agent; usage, generation, derivation, association, delegation | Security-specific nodes; qualified edge confidence; policy and approval semantics | No RDF/OWL runtime |
| OpenTelemetry | Trace/span IDs, resources, events, links, attributes | Cross-trace causal links, evidence hashes, security classifications | Span tree is not authoritative graph |
| OTel GenAI conventions | Model operation, token usage, agent and MCP attributes where available | Versioned normalization layer | No dependence on unstable attribute names |
| MITRE ATLAS | Threat-category references | Evidence paths mapped to techniques | Not core ontology |
| OWASP agentic guidance | Threat model and mitigation vocabulary | Executable graph-policy examples | Not machine-verifiable policy |
| in-toto | Statement, subject digest, predicate type | Evidence and experiment attestations | Not necessarily software build |
| SLSA provenance | Builder/input/output provenance concepts | Dataset and experiment-run provenance | No SLSA compliance claim |
| OCSF | Exportable finding/event terminology | Agentic-extension fields | Not internal graph model |
| AgentDojo | Prompt-injection tasks and security outcomes | Graph conversion and detector-isolation variants | No modification without transformation manifest |
| ADR-Bench | Enterprise MCP workflows and ADR comparison | Causal graph representation and graph detector conditions | No claim of Uber production deployment |

### PROV Specialization

| CATG Concept | PROV Superclass |
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

---

## 7. System Architecture

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

**Architectural rule:** The immutable event ledger is the source of truth. Kuzu is a rebuildable materialized projection.

### Architecture Decision Records

- **ADR-001** — Immutable ledger + graph projection: SQLite append-only event ledger is authoritative; Kuzu is rebuildable
- **ADR-002** — Typed property graph, not RDF runtime: Specialize PROV semantics in property graph for TypeScript ergonomics
- **ADR-003** — Deterministic policies before semantic detectors: Rules execute first, reduce cost, improve reproducibility
- **ADR-004** — Edge assertions are immutable evidence: Old assertions must remain auditable
- **ADR-005** — No raw evidence in system instructions: Untrusted content passed as delimited data
- **ADR-006** — Preserve source telemetry extensions: Canonical events retain bounded extensions object

### Deployment Model

```
Local workstation
├── API process (Fastify)
├── Kuzu database directory
├── SQLite event ledger
├── Next.js UI
├── CLI (catg)
└── Docker-isolated benchmark runner
```

---

## 8. Domain Ontology

### Universal Node Fields

All node types inherit: id, type, schemaVersion, tenantId, environment, occurredAt, observedAt, validFrom, validTo, confidence (observed|declared|reconstructed|inferred|speculative), sensitivity, retention, provenance (ProvenanceRef[]), integrityHash, labels, attributes.

### Stable Identifier Strategy

| Object Class | Identifier |
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

### Node-Type Registry (28 types)

**Identity:** HumanPrincipal, ServicePrincipal, Agent, AgentSession
**Execution:** AgentRun, ModelInvocation, PlanStep
**Communication:** Prompt, Message, Instruction
**Tooling:** Tool, ToolCall, ToolResult, MCPServer
**Asset:** Resource, DataObject, Credential, MemoryEntry
**Governance:** Policy, PolicyDecision, ApprovalRequest, ApprovalDecision, Delegation
**Outcome:** ExternalEffect, Verification, Detection, Incident
**Evidence:** EvidenceArtifact, InvestigationContainer

### Universal Edge Fields

id, type, fromId, toId, schemaVersion, tenantId, environment, assertedAt, validFrom, validTo, confidence, confidenceScore, causalBasis, provenance, evidenceIds, linkerId, linkerVersion, sensitivity, retention, integrityHash, attributes.

### Edge-Type Registry (27 types)

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

### Confidence Semantics

| Value | Meaning |
|-------|---------|
| observed | Explicit source identifiers or instrumentation directly establish the relation |
| declared | A producer or actor asserts the relation but CATG did not independently observe it |
| reconstructed | Deterministic source/protocol rules establish the relation |
| inferred | Heuristic or semantic analysis suggests the relation |
| speculative | Weak hypothesis retained for investigation, never sufficient alone for enforcement |

---

## 9. Canonical Event Schema

CanonicalEventEnvelope includes: eventId, schemaVersion, eventType, occurredAt, observedAt, producer, subject, trace context, identity context, payload, provenance, security classification, integrity hash chain, extensions.

### Required Event Families (24 types)

source_record.imported, session.observed, run.started, run.completed, message.observed, instruction.extracted, model.invocation.started, model.invocation.completed, tool.definition.observed, tool_call.observed, tool_result.observed, resource.accessed, data_object.classified, credential.detected, approval.requested, approval.decided, delegation.observed, external_effect.observed, verification.observed, edge.asserted, policy.evaluated, detector.executed, incident.updated, evidence.created, projection.checkpointed.

### Idempotency

Stable eventId when source has stable identifier. Otherwise: `dedupe_key = SHA256(tenant_id || source_kind || source_record_id || normalized_event_type || normalized_occurred_at || canonical_payload_hash)`. Unique index on (tenant_id, dedupe_key).

---

## 10. Causal-Linking Model

### Linker Pipeline

Canonical events → Direct identifier linker → Protocol-semantic linker → Deterministic reconstruction → Heuristic data-flow linker → Optional semantic linker → Immutable edge assertions

### Linker Precedence

1. Source identifier
2. OpenTelemetry parent or link
3. MCP request ID
4. Explicit call/result ID
5. Direct resource and content fingerprint
6. Deterministic containment and sequence
7. Argument/result field-level derivation
8. Semantic inference
9. Temporal proximity alone (PRECEDED_BY only, never CAUSED)

### Confidence Mapping

| Basis | Default Confidence | Score Range |
|-------|-------------------|-------------|
| source identifier | observed | 1.00 |
| protocol semantics | observed | 0.98 |
| producer declaration | declared | 0.90 |
| deterministic reconstruction | reconstructed | 0.80–0.95 |
| exact content/field match | reconstructed | 0.75–0.90 |
| semantic inference | inferred | 0.50–0.79 |
| temporal proximity | speculative | ≤0.35 |

### Strong CAUSED Requirements

CAUSED may be emitted only when at least one holds: explicit producer relation; matching protocol request/response identifier; direct output-to-input field mapping; deterministic side-effect receipt identifying the call; analyst assertion with signed identity. Otherwise use MAY_HAVE_CAUSED.

---

## 11. Storage Design

| Data | Technology | Role |
|------|-----------|------|
| Canonical events | SQLite | Authoritative append-only ledger |
| Graph projection | Kuzu | Path traversal and investigation |
| Content artifacts | Local content-addressed directory | Redacted excerpts, encrypted originals |
| Experiment metrics | DuckDB or Parquet | Analytical comparison |
| UI settings | SQLite | Local non-evidentiary metadata |

### SQLite Ledger

Tables: events (with dedupe_key unique index), projection_checkpoints, quarantine_records. Append-only enforced via triggers rejecting UPDATE/DELETE outside test builds.

### Kuzu Model

Physical tables: Principal, Agent, Execution, Communication, Tooling, Asset, Governance, Outcome, EvidenceArtifact. Edges via typed relationship tables + generic ASSERTS relation for rare edge types.

---

## 12. Ingestion Adapters

### Adapter Interface

```typescript
interface SourceAdapter<TInput> {
  readonly name: string;
  readonly version: string;
  readonly supportedSchemas: readonly string[];
  detect(input: TInput): Promise<number>;
  parse(input: TInput, context: AdapterContext): AsyncIterable<CanonicalEventEnvelope>;
}
```

### Adapters Required

- **ADR adapter:** Maps AgentEvent → CanonicalEventEnvelope (uuid, source, session_id, timestamp, model, chat_history[], tools[])
- **OpenTelemetry adapter:** Maps OTLP JSON spans (resourceSpans, trace/span IDs, links, events, attributes)
- **MCP adapter:** Instruments client and server, matches request IDs for CALLED/RETURNED relationships
- **Direct SDK:** Programmatic API for emitting events from instrumented code
- **Benchmark imports:** ADR-Bench and AgentDojo with transformation manifests

### ADR Bridge Architecture

```
Native coding-agent log → ADR Sensor parser → AgentEvent JSONL → CATG ADR adapter
```

Python bridge invokes ADR Sensor, no policy or graph logic in Python.

---

## 13. Policy Engine

### Policy Language

YAML compiled and validated with Zod. Limited grammar: selectors, bounded paths, attributes, set inclusion, temporal comparisons, exceptions.

### Required Policies

1. **Credential exfiltration:** Credential → USED/DERIVED_FROM → ToolCall → SENT_TO → external/untrusted destination
2. **Production mutation approval:** Production ExternalEffect with mutation=true requires authorized human decision
3. **Delegation attenuation:** Child authority must be subset of parent authority
4. **Restricted data to untrusted MCP:** DataObject.classification=restricted|secret must not traverse SENT_TO into untrusted MCPServer
5. **Premature approval invalidity:** Approval invalid when decided before material arguments finalized
6. **Authorization scope mismatch:** Policy/approval cannot authorize different operation, tool, resource, environment, or data classification

### Evaluation Algorithm

1. Resolve policy selectors → 2. Build candidate subgraph → 3. Evaluate positive predicate → 4. If false: NOT_APPLICABLE → 5. Evaluate exception predicate → 6. Validate authorization evidence and scope → 7. Return ALLOW/DENY/REQUIRE_APPROVAL/FLAG/INDETERMINATE → 8. Materialize PolicyDecision

### Replay

```bash
catg policy replay --policy policies/no-credential-exfiltration@2.0.0.yaml --session sess-17 --as-of-event 845
```

---

## 14. Detector Framework

### Detector Types

- **Deterministic graph rule:** Exact path and attribute matching
- **Statistical anomaly detector:** Tool-call count, novel destination, approval-rate deviation, delegation depth
- **Transcript LLM:** Raw/redacted chronological transcript baseline
- **Graph-summary LLM:** Identities, intent, authority, untrusted inputs, causal paths, policy decisions, side effects, uncertainty
- **Retrieval-assisted investigator:** Read-only get_evidence + get_path tools
- **Hybrid cascade:** Deterministic → cheap semantic triage → graph-summary reasoning

### Detector Restrictions

Must receive immutable evidence references; must not write source events or add graph edges; must run with network/tool access disabled unless explicitly allowed; must declare model, prompt, policy, and code versions; must treat evidence content as untrusted data; must validate output against strict schema.

### Evidence Package

Structured JSON containing: intent, principals, agents, authority, untrusted inputs, sensitive paths (with edge confidence), effects, policy decisions, unknowns.

---

## 15. API Design

Base path: `/api/v1`

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

---

## 16. CLI Design

Binary: `catg`

Commands: init, dev, import (adr/otel/benchmark), validate (event/policy), project rebuild, session (list/show), graph path, policy (evaluate/replay), detect, incident explain, experiment (run/compare/attest), doctor.

Principles: JSON output via --json, stable exit codes, no interactive prompts in CI, sensitive content omitted unless --show-sensitive.

---

## 17. Investigation UI

Next.js App Router, TanStack Query, React Flow, virtualized timeline, server-side graph filtering.

### Views (10)

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

### Investigation Rule

Every textual claim in an incident explanation must expose one of: Evidence, Policy inference, Detector judgment, or Unresolved hypothesis.

---

## 18. Security and Privacy Threat Model

### Threat Table (17 threats)

Compromised producer, forged event, reordered evidence, deleted evidence, poisoned tool result, malicious MCP server, detector prompt injection, unauthorized graph access, cross-tenant leakage, provider disclosure, analyst misuse, malicious policy update, oversized session, hash guessing, replay confusion, semantic overreach.

### STRIDE Mapping

Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege.

### Field-Level Encryption

Envelope encryption: random DEK per artifact, DEK encrypted by local KEK, XChaCha20-Poly1305 or AES-256-GCM.

### Detector Sandbox

Isolated worker/container, read-only evidence, no host filesystem, no network except selected model endpoint, no MCP servers, strict token/wall-clock limits, structured output only.

### Anti-Surveillance

Pseudonymous principals by default; no productivity score; no "developer risk ranking"; configurable removal of usernames/hostnames; purpose-bound access roles; query audit logs; retention limits; docs/governance/anti-surveillance.md.

---

## 19. Experimental Design

### Dataset Structure

```
datasets/
  adr-bench/     (upstream, transformed, manifests)
  agentdojo/
  catg-synthetic/ (credential-flow, approval-fatigue, delegation, detector-injection)
  splits/        (train.json, validation.json, test.json)
```

### Experiment 1 — Transcript versus Causal Graph

Conditions: raw transcript vs structured chronological summary vs causal graph with selective evidence retrieval. Controls: same model, token budget, temperature 0, 5 repetitions, randomized ordering, no ground truth in prompts.

Metrics: precision, recall, F1, false-positive rate, AUROC, Brier score, calibration error, latency p50/p95, tokens, USD cost, cost per true positive, explanation precision/recall, evidence-support rate, robustness under irrelevant context (0%, 25%, 50%, 75% irrelevant tool output).

### Experiment 2 — Deterministic + Semantic Cascade

Conditions: no rules, rules only, rules + semantic escalation, triage + deeper reasoning. Target: ≥40% reduction in semantic-model calls while preserving ≥95% recall.

### Experiment 3 — Attack the Detector

Attack classes: instructions directed at detector, poisoned MCP/tool output, malicious source-code comments, poisoned policy descriptions, oversized distracting content, conflicting evidence, forged provenance, fake evidence IDs. Isolation conditions: direct concatenation, delimited envelope, untrusted excerpts separated, hash/reference-first retrieval, deterministic rules + semantic escalation.

### Experiment Artifacts

Each run produces: run.json, config.resolved.json, dataset.manifest.json, environment.lock.json, predictions.jsonl, metrics.json, latency.parquet, costs.parquet, prompt-manifest.json, model-manifest.json, git-state.json, attestation.json, report.md.

---

## 20. Repository Structure

```
causal-agent-telemetry-graph/
├── apps/
│   ├── api/                    (Fastify)
│   ├── investigator-ui/        (Next.js App Router)
│   └── cli/                    (catg binary)
├── packages/
│   ├── schema/                 (Zod schemas + TS types)
│   ├── canonical-json/         (deterministic serialization)
│   ├── event-ledger/           (SQLite append-only)
│   ├── graph-model/            (ontology registry)
│   ├── graph-projection/       (ledger → Kuzu)
│   ├── ingestion-core/         (import orchestration)
│   ├── adapters-adr/           (ADR mapping)
│   ├── adapters-otel/          (OTLP mapping)
│   ├── adapters-mcp/           (MCP event mapping)
│   ├── instrumentation-sdk/    (direct producer API)
│   ├── identity-resolution/    (source identities → stable IDs)
│   ├── causal-linker/          (immutable edge assertions)
│   ├── content-security/       (redaction/classification/encryption)
│   ├── policy-engine/          (deterministic graph predicates)
│   ├── detector-sdk/           (detector protocol)
│   ├── detectors-deterministic/ (graph rules)
│   ├── detectors-llm/          (transcript + graph classifiers)
│   ├── evidence-packages/      (detector/incident inputs)
│   ├── query-sdk/              (safe graph queries)
│   ├── experiment-core/        (runs, metrics, attestations)
│   ├── fixtures/               (benchmark-independent fixtures)
│   └── testkit/                (builders + assertions)
├── python/
│   ├── adr-bridge/             (ADR Sensor invocation)
│   └── benchmark-runner/       (benchmark tooling)
├── policies/default/
├── experiments/
├── datasets/
├── docs/
├── scripts/
├── docker/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
├── vitest.workspace.ts
├── docker-compose.yml
├── LICENSE
├── SECURITY.md
└── README.md
```

### Package Contracts (20 packages)

Each package defined with: responsibility, public interface, forbidden dependencies, testing requirements. Apps: API (Fastify), UI (Next.js, API only, no direct DB), CLI (embedded services for local use, calls package interfaces).

---

## 21. Testing Strategy

### Test Pyramid

- **Unit tests:** canonical serialization, ID generation, redaction, adapter field mapping, confidence assignment, policy predicates, detector output validation
- **Contract tests:** canonical event JSON schema, adapter compatibility, detector API, experiment artifact format, API OpenAPI contract
- **Golden tests:** Input fixture → exact canonical events and graph
- **Property-based tests:** import idempotency, event ordering independence, no inferred edge without evidence, no cross-tenant graph path, stable canonical hashes, policy replay immutability
- **Integration tests:** SQLite → Kuzu projection, ADR/OTLP/MCP import, policy decisions, detector execution with fake model provider
- **End-to-end tests:** Playwright (import → session → credential path → edge confidence → policy replay → detector comparison → experiment report)

### Required Test Cases (20)

T01-T20 covering: duplicate imports, out-of-order correlation, clock skew, secret handling, credential exfiltration, approval validity, delegation attenuation, data classification, forged evidence, malformed detector output, partial sessions, cross-tenant queries, projection rebuild, linker versioning, prompt injection, policy replay, oversized evidence.

### Coverage Goals

Schema and policy engine: ≥90%; ingestion/linker: ≥85%; API: ≥80%.

---

## 22. Observability and Reproducibility

CATG's own telemetry via OpenTelemetry: import duration, events accepted/quarantined, projection lag, linker candidates/assertions, graph-query latency, policy evaluation latency, detector token usage and cost, experiment progress.

Reproducibility manifest includes: catg version, git commit, pnpm lock hash, Python lock hash, OS/arch, dataset hash, policy set hash, prompt set hash, model snapshot, seed.

Experiment attestation in in-toto format with typed predicate binding claims to digested subjects.

---

## 23. Milestone Plan

| Week | Focus | Hours | Key Deliverables |
|------|-------|-------|-----------------|
| 1 | Foundation + schemas | 15-18 | Monorepo, Zod schemas, canonical hashing, SQLite ledger, ontology registry |
| 2 | ADR import + graph projection | 18-22 | ADR adapter, Python bridge, Kuzu projection, CLI import/list/path |
| 3 | MCP + OpenTelemetry adapters | 15-20 | OTLP adapter, MCP instrumentation, identity resolver, direct SDK |
| 4 | Policy engine + credential path | 20-24 | Policy schema/compiler, 6 required policies, credential classifier, policy replay |
| 5 | Investigation UI | 18-22 | Session list, graph view, timeline, evidence inspector, data-flow path, policy views |
| 6 | Detector framework + Experiment 1 | 20-25 | Detector SDK, transcript/graph classifiers, experiment runner, baseline metrics |
| 7 | Cascade + detector attack | 18-24 | Deterministic-semantic cascade, Experiments 2 + 3, experiment dashboard |
| 8 | Hardening + publication | 15-20 | Threat model docs, anti-surveillance policy, reproducibility guide, v0.1.0 tag |

---

## 24. Risks and Mitigations

| Risk | Consequence | Mitigation |
|------|------------|------------|
| Ontology too ambitious | Delivery failure | Base-node model; prioritize paths used by experiments |
| Kuzu Node binding limitations | Development delay | Encapsulate driver; retain SQLite; DuckDB fallback for analytics only |
| Weak source telemetry | False causal precision | Confidence qualification; completeness metadata |
| LLM model drift | Non-reproducible results | Pinned snapshots; store raw outputs |
| Benchmark contamination | Inflated performance | Hidden test labels; transformation manifests |
| Expensive experiments | Incomplete evaluation | Small stratified dev set; cache immutable model outputs |
| Detector injection | Invalid findings | Isolation, structured evidence, no external tools |
| Secret retention | Privacy breach | HMAC fingerprints, redaction profiles, raw-content disabled |
| Graph visual clutter | Unusable UI | Investigation presets and path-focused views |
| Policy language creep | Reinventing Rego | Deliberately constrained policy grammar |
| Cross-adapter inconsistency | Invalid comparisons | Adapter conformance suite |
| Misuse for surveillance | Organizational harm | Pseudonymization, purpose controls, documentation |
| "Causal" overclaiming | Research credibility loss | Terminology section and mandatory confidence |
| ADR comparison unfairness | Misleading conclusions | Compare public artifact behavior only |
| Solo engineer overload | Partial prototype | Defer production and universal integrations |

---

## 25. Acceptance Criteria

### Functional (14 criteria)

ADR/OTLP/MCP import, all required node/edge types, stable IDs, append-only events, rebuildable projection, 6 policies, replay, detector evidence references, transcript + graph detectors, investigation UI, 3 reproducible experiments.

### Security (10 criteria)

Raw secrets disabled by default, keyed HMAC fingerprints, no arbitrary graph-query API, detector evidence separated from privileged instructions, schema-validated detector output, isolated benchmarks, cross-tenant tests, unsigned telemetry marked unverified, versioned/hashed policy changes, audited sensitive evidence access.

### Research (9 criteria)

Fixed representation definitions, controlled model/token budget/prompt/temperature, reported metrics, documented explanation-faithfulness scoring, benchmark transformation manifests, retained null/negative findings, no production ADR claim attribution, no statistical causality claim.

### Performance (5 targets)

Import 10K events ≤60s, project 10K events ≤90s, credential path query p95 ≤500ms (10K-node graph), session graph API ≤1s after filtering, UI max 1,500 simultaneous elements.

---

## 26. Deferred Work

Production endpoint management; real-time blocking; distributed event streaming; Kafka/Pulsar; Kubernetes; clustered graph storage; production SIEM ingestion; broad OCSF; enterprise SSO; fine-grained RBAC; policy authoring UI; universal harness adapters; model-execution replay; automatic incident remediation; threat-intelligence exchange; statistical causal inference; automatic proof of data non-use; semantic interpretation of binary artifacts; continuous employee monitoring; production ADR Explorer.

---

## 27. Open Research Questions

1. Is gain caused by the graph itself or better summarization/retrieval?
2. At what reconstruction-error rate does the graph become more misleading than a transcript?
3. Can inferred edge confidence be calibrated against human-labeled workflow relations?
4. What minimum instrumentation distinguishes data exposure from data influence?
5. How should meaningful human approval be measured?
6. Can agent runtimes expose content-block provenance without retaining sensitive raw content?
7. How should CATG represent "the agent did not access X" when telemetry may be incomplete?
