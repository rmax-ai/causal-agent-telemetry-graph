# CATG Ontology — Node-Type Registry (NODES.md)

> Extracted from SPEC.md §8 (Domain Ontology), §6 (PROV Specialization), and §9 (Canonical Event Schema).
> Ground truth remains SPEC.md; every row below cites the SPEC.md section it comes from.
> Companion document: [EDGES.md](EDGES.md).

## 1. Universal Node Fields

All node types inherit (SPEC.md §8):

`id, type, schemaVersion, tenantId, environment, occurredAt, observedAt, validFrom, validTo, confidence (observed|declared|reconstructed|inferred|speculative), sensitivity, retention, provenance (ProvenanceRef[]), integrityHash, labels, attributes`

Notes:

- `confidence` on a node uses the same five-value scale as edges (SPEC.md §8; see EDGES.md §3).
- `validFrom`/`validTo` support temporal queries and are required on nodes as well as edges (SPEC.md §8; AGENTS.md "Schema Evolution").
- Node `id`s are **opaque strings** — validated for URN format, never parsed structurally (AGENTS.md "Code Style").

## 2. Type-Specific Fields

SPEC.md §8 does **not** enumerate per-type field lists beyond the universal fields; per-type schemas are fixed at implementation time in `packages/schema` (Zod schemas + TS types, SPEC.md §20) following the package-contract convention (ARCHITECTURE.md §14). What SPEC.md *does* specify per type is reproduced below for each node: its **PROV superclass** (§6), its **identifier strategy** (§8), its **edge participation** (§8 edge registry), and its corresponding **event family** (§9).

## 3. Stable Identifier Strategy

| Object Class | Identifier (SPEC.md §8) |
|--------------|-------------------------|
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

## 4. Registry Note

SPEC.md §8 labels the registry "Node-Type Registry (28 types)" but its enumeration lists **29 node names** (4 + 3 + 3 + 4 + 4 + 5 + 4 + 2). ARCHITECTURE.md §6.2 reproduces the same label and the same enumeration. This document reproduces the enumeration **verbatim** — all 29 listed names — and flags the count discrepancy for resolution when `packages/graph-model` (ontology registry, SPEC.md §20) is implemented.

## 5. Node Types by Category

### 5.1 Identity (4)

| Type | PROV (§6) | Identifier (§8) | Key edge participation (§8) | Event family (§9) |
|------|-----------|-----------------|-----------------------------|-------------------|
| `HumanPrincipal` | Agent | Tenant namespace + issuer + subject | from: `INITIATED`; to: `ACTED_ON_BEHALF_OF`, `APPROVED_BY`, `DENIED_BY` | `session.observed` |
| `ServicePrincipal` | Agent | Tenant namespace + issuer + subject | from: `INITIATED`; to: `ACTED_ON_BEHALF_OF`, `APPROVED_BY`, `DENIED_BY` | `session.observed` |
| `Agent` | Agent | Source-record-backed node | from: `ACTED_ON_BEHALF_OF`, `DELEGATED_TO`; to: `DELEGATED_TO` | `session.observed` |
| `AgentSession` | — (not enumerated) | Source-record-backed node (e.g., ADR `sessionId`) | from: `CONTAINS`; to: `INITIATED` | `session.observed` |

### 5.2 Execution (3)

| Type | PROV (§6) | Identifier (§8) | Key edge participation (§8) | Event family (§9) |
|------|-----------|-----------------|-----------------------------|-------------------|
| `AgentRun` | Activity | Source-record-backed node; OTel span activity row where applicable | to: `INITIATED`; from: `DELEGATED_TO`, `CONTAINS`, `PRECEDED_BY`, `INFORMED_BY`, `USED`, `GENERATED`, `CALLED`, `REQUESTED_APPROVAL`, `VIOLATED`, `CAUSED`, `MAY_HAVE_CAUSED`, `DETECTED_AS`, `PART_OF_INCIDENT` | `run.started`, `run.completed` |
| `ModelInvocation` | Activity | OTel span activity: `urn:catg:{tenant}:otel:{traceId}:{spanId}` | from: `CALLED`, `PRECEDED_BY`, `INFORMED_BY`, `USED`, `GENERATED`, `CAUSED`, `MAY_HAVE_CAUSED` | `model.invocation.started`, `model.invocation.completed` |
| `PlanStep` | — (not enumerated) | Source-record-backed node | from: `PRECEDED_BY`, `INFORMED_BY`, `USED`, `GENERATED`, `CAUSED`, `MAY_HAVE_CAUSED` (Activity-class endpoints) | `message.observed` / `instruction.extracted` |

### 5.3 Communication (3)

| Type | PROV (§6) | Identifier (§8) | Key edge participation (§8) | Event family (§9) |
|------|-----------|-----------------|-----------------------------|-------------------|
| `Prompt` | Entity | Source-record-backed node | from: `CONTAINS`; to: `USED`, `GENERATED`, `CAUSED`, `MAY_HAVE_CAUSED` | `message.observed` |
| `Message` | Entity | ADR message: `urn:catg:{tenant}:adr:{sessionId}:message:{sequenceId}` | from/to: `DERIVED_FROM`; to: `USED`, `GENERATED`, `CAUSED`, `MAY_HAVE_CAUSED` | `message.observed` |
| `Instruction` | — (not enumerated) | Source-record-backed node | from: `RECEIVED_FROM`; to: `USED`, `GENERATED`, `CAUSED`, `MAY_HAVE_CAUSED` | `instruction.extracted` |

### 5.4 Tooling (4)

| Type | PROV (§6) | Identifier (§8) | Key edge participation (§8) | Event family (§9) |
|------|-----------|-----------------|-----------------------------|-------------------|
| `Tool` | — (not enumerated) | Package/server namespace + normalized tool name + version | to: `CALLED` | `tool.definition.observed` |
| `ToolCall` | Activity | ADR tool call: hash of session, message ID, tool index, normalized tool identity | to: `CALLED`, `RETURNED`; from: `READ_FROM`, `WROTE_TO`, `REQUESTED_APPROVAL`, `APPROVED_BY`, `DENIED_BY`, `AUTHORIZED_BY`, `VIOLATED`, `USED`, `GENERATED`, `CAUSED`, `MAY_HAVE_CAUSED` | `tool_call.observed` |
| `ToolResult` | — (not enumerated) | Source-record-backed node | from: `RETURNED`; to: `USED`, `GENERATED` | `tool_result.observed` |
| `MCPServer` | — (not enumerated) | Source-record-backed node (server namespace) | to: `SENT_TO`, `RECEIVED_FROM` | `tool.definition.observed` |

### 5.5 Asset (4)

| Type | PROV (§6) | Identifier (§8) | Key edge participation (§8) | Event family (§9) |
|------|-----------|-----------------|-----------------------------|-------------------|
| `Resource` | Entity | Content-addressed entity: `urn:catg:sha256:{canonical-content-hash}` | to: `READ_FROM`, `WROTE_TO`, `SENT_TO`, `RECEIVED_FROM`, `USED`, `GENERATED` | `resource.accessed` |
| `DataObject` | — (not enumerated) | Content-addressed entity | from: `READ_FROM`, `WROTE_TO`, `SENT_TO`, `RECEIVED_FROM`, `DERIVED_FROM`; to: `USED`, `GENERATED` | `data_object.classified` |
| `Credential` | Entity | Content-addressed entity (HMAC fingerprint — SPEC.md §18, §25) | from: `SENT_TO`, `DERIVED_FROM`; to: `USED`, `GENERATED`; target of exfiltration policy path (§13 policy 1) | `credential.detected` |
| `MemoryEntry` | — (not enumerated) | Source-record-backed node | to: `USED`, `GENERATED`; from/to: `DERIVED_FROM` | `data_object.classified` |

### 5.6 Governance (5)

| Type | PROV (§6) | Identifier (§8) | Key edge participation (§8) | Event family (§9) |
|------|-----------|-----------------|-----------------------------|-------------------|
| `Policy` | Entity | Policy namespace + policy ID + immutable version | to: `EVALUATED_AGAINST`, `VIOLATED` | `policy.evaluated` |
| `PolicyDecision` | — (not enumerated) | Derived assertion (hash-based; SPEC.md §8) | from: `EVALUATED_AGAINST`, `VIOLATED`, `VERIFIED_BY`; to: `AUTHORIZED_BY` | `policy.evaluated` |
| `ApprovalRequest` | — (not enumerated) | Source-record-backed node | to: `REQUESTED_APPROVAL`; from: `APPROVED_BY`, `DENIED_BY` | `approval.requested` |
| `ApprovalDecision` | — (not enumerated) | Source-record-backed node | to: `APPROVED_BY`, `DENIED_BY`, `AUTHORIZED_BY` | `approval.decided` |
| `Delegation` | — (not enumerated) | Source-record-backed node | from: `AUTHORIZED_BY`; subject of delegation-attenuation policy (§13 policy 3) | `delegation.observed` |

### 5.7 Outcome (4)

| Type | PROV (§6) | Identifier (§8) | Key edge participation (§8) | Event family (§9) |
|------|-----------|-----------------|-----------------------------|-------------------|
| `ExternalEffect` | — (not enumerated) | Source-record-backed node | from: `AUTHORIZED_BY`; to: `CAUSED`, `MAY_HAVE_CAUSED`, `USED`, `GENERATED`; `mutation=true` triggers production-mutation policy (§13 policy 2) | `external_effect.observed` |
| `Verification` | Activity | Source-record-backed node | to: `VERIFIED_BY`, `CONTRADICTED_BY` | `verification.observed` |
| `Detection` | — (not enumerated) | Finding: hash of detector version, evidence snapshot hash, verdict, run ID | from: `EVALUATED_AGAINST`, `CONTRADICTED_BY`, `PART_OF_INCIDENT`; to: `DETECTED_AS` | `detector.executed` |
| `Incident` | — (not enumerated) | Created via `POST /incidents` (SPEC.md §15) | to: `PART_OF_INCIDENT` | `incident.updated` |

### 5.8 Evidence (2)

| Type | PROV (§6) | Identifier (§8) | Key edge participation (§8) | Event family (§9) |
|------|-----------|-----------------|-----------------------------|-------------------|
| `EvidenceArtifact` | — (not enumerated) | Content-addressed entity: `urn:catg:sha256:{canonical-content-hash}` | to: `EVALUATED_AGAINST`, `CONTRADICTED_BY`, `VERIFIED_BY`; from: `PART_OF_INCIDENT` | `evidence.created` |
| `InvestigationContainer` | — (not enumerated) | Created via `POST /incidents` (SPEC.md §15) | — (holds investigation state; grouping via `PART_OF_INCIDENT` on Incident) | `incident.updated` |

## 6. Kuzu Physical Grouping

Kuzu physical tables group the ontology into: `Principal`, `Agent`, `Execution`, `Communication`, `Tooling`, `Asset`, `Governance`, `Outcome`, `EvidenceArtifact` (SPEC.md §11). The graph is a **rebuildable materialized projection** of the ledger — never a second source of truth (SPEC.md §7; ADR-001).

## 7. PROV Specialization

PROV superclass mapping for the ontology's core classes (SPEC.md §6):

| CATG Concept | PROV Superclass |
|--------------|-----------------|
| Prompt, Message, Credential, Resource, Policy | Entity |
| AgentRun, ModelInvocation, ToolCall, Verification | Activity |
| HumanPrincipal, ServicePrincipal, Agent | Agent |

Edge-level PROV specialization (used/generated/derived/… mappings) is in [EDGES.md](EDGES.md) §6.
