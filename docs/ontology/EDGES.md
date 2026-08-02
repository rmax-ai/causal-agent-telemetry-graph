# CATG Ontology — Edge-Type Registry (EDGES.md)

> Extracted from SPEC.md §8 (Domain Ontology), §6 (PROV Specialization), and §10 (Causal-Linking Model).
> Ground truth remains SPEC.md; every table below cites its source section.
> Companion document: [NODES.md](NODES.md).

## 1. Universal Edge Fields

All edge types inherit (SPEC.md §8):

`id, type, fromId, toId, schemaVersion, tenantId, environment, assertedAt, validFrom, validTo, confidence, confidenceScore, causalBasis, provenance, evidenceIds, linkerId, linkerVersion, sensitivity, retention, integrityHash, attributes`

- `evidenceIds` and `linkerVersion` are mandatory for every inferred/reconstructed edge (AGENTS.md; SPEC.md §8).
- Every edge assertion is itself an event in the ledger (`edge.asserted`, SPEC.md §9) — edges are never written directly to Kuzu (AGENTS.md; ADR-004).

## 2. Edge-Type Registry (27 types)

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

## 3. Confidence Semantics

| Value | Meaning |
|-------|---------|
| observed | Explicit source identifiers or instrumentation directly establish the relation |
| declared | A producer or actor asserts the relation but CATG did not independently observe it |
| reconstructed | Deterministic source/protocol rules establish the relation |
| inferred | Heuristic or semantic analysis suggests the relation |
| speculative | Weak hypothesis retained for investigation, never sufficient alone for enforcement |

(SPEC.md §8)

**Ordering rule:** `observed` > `declared` > `reconstructed` > `inferred` > `speculative` (AGENTS.md; SPEC.md §8).

## 4. Confidence Score Mapping (linker basis → score)

| Basis | Default Confidence | Score Range |
|-------|--------------------|-------------|
| source identifier | observed | 1.00 |
| protocol semantics | observed | 0.98 |
| producer declaration | declared | 0.90 |
| deterministic reconstruction | reconstructed | 0.80–0.95 |
| exact content/field match | reconstructed | 0.75–0.90 |
| semantic inference | inferred | 0.50–0.79 |
| temporal proximity | speculative | ≤ 0.35 |

(SPEC.md §10)

## 5. Strong CAUSED Requirements

**CAUSED may be emitted only when at least one holds** (SPEC.md §10): explicit producer relation; matching protocol request/response identifier; direct output-to-input field mapping; deterministic side-effect receipt identifying the call; analyst assertion with signed identity. **Otherwise use MAY_HAVE_CAUSED.**

- `PRECEDED_BY` must never be automatically upgraded to `CAUSED` (AGENTS.md).
- Temporal proximity alone → `PRECEDED_BY` only, at confidence `speculative` ≤ 0.35 (SPEC.md §10, linker precedence rule 9).

## 6. PROV Specialization Mapping

| CATG Edge | PROV Superclass / Relation (SPEC.md §6) |
|-----------|------------------------------------------|
| USED, READ_FROM | `used` specialization |
| GENERATED, WROTE_TO | `wasGeneratedBy` specialization |
| DERIVED_FROM | `wasDerivedFrom` |
| ACTED_ON_BEHALF_OF, DELEGATED_TO | `actedOnBehalfOf` specialization |
| INFORMED_BY | `wasInformedBy` |
| INITIATED | `wasAssociatedWith` + CATG role |
| CAUSED | qualified workflow-causation assertion |

CATG runs **no RDF/OWL runtime** (ADR-002); PROV semantics are specialized into the typed property graph (SPEC.md §6, §7).

## 7. Linker Pipeline and Precedence

Linker pipeline (SPEC.md §10): `Canonical events → Direct identifier linker → Protocol-semantic linker → Deterministic reconstruction → Heuristic data-flow linker → Optional semantic linker → Immutable edge assertions`

Linker precedence (SPEC.md §10): 1. Source identifier → 2. OpenTelemetry parent or link → 3. MCP request ID → 4. Explicit call/result ID → 5. Direct resource and content fingerprint → 6. Deterministic containment and sequence → 7. Argument/result field-level derivation → 8. Semantic inference → 9. Temporal proximity alone (`PRECEDED_BY` only, never `CAUSED`).

## 8. Storage of Edges in Kuzu

Edges are stored via typed relationship tables plus a generic `ASSERTS` relation for rare edge types (SPEC.md §11). The graph is a rebuildable materialized projection of the ledger (SPEC.md §7; ADR-001).
