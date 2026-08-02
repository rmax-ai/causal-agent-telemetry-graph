# CATG — Threat Model

> **Derived document.** Source of truth is `SPEC.md` (preserved verbatim in this repository). Every control in this document cites the SPEC section it implements. Where SPEC.md is silent, this document states the design decision explicitly and labels it as such.
>
> **Status:** Draft v0.1 — deliverable of Milestone Week 8 "Hardening + publication" (SPEC §23). Referenced from `SECURITY.md` (SPEC §20).
>
> **Scope:** MVP deployment model — single-operator local workstation, embedded SQLite/Kuzu, Docker-isolated benchmark runner (SPEC §7, §4). Production endpoint management, enterprise SSO, and fine-grained RBAC are explicitly deferred (SPEC §26); this model does not claim production-hardened posture.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Threat-Modeling Methodology](#2-threat-modeling-methodology)
3. [Trust Zones and Data Flow](#3-trust-zones-and-data-flow)
4. [STRIDE Mapping](#4-stride-mapping)
5. [Detailed Threat Register (17 Threats)](#5-detailed-threat-register-17-threats)
6. [Detector Sandbox (SPEC §14, §18)](#6-detector-sandbox)
7. [Field-Level Encryption Design (SPEC §18)](#7-field-level-encryption-design)
8. [Integrity Protections (SPEC §8, §9, §11, §19, §25)](#8-integrity-protections)
9. [Content Security (SPEC §3, §4, §11, §16, §24)](#9-content-security)
10. [Anti-Surveillance Controls (SPEC §18, §24)](#10-anti-surveillance-controls)
11. [Policy Security (SPEC §8, §13, §25)](#11-policy-security)
12. [Cross-Tenant Isolation (SPEC §8, §9, §15, §20, §21, §25)](#12-cross-tenant-isolation)
13. [Risk Register (SPEC §24)](#13-risk-register)
14. [Residual Risk Assessment and Open Security Questions](#14-residual-risk-assessment-and-open-security-questions)
15. [SPEC Section Reference Map](#15-spec-section-reference-map)

---

## 1. Executive Summary

CATG is an append-only telemetry and evidence layer that converts heterogeneous agent traces into an explicit causal/provenance graph (SPEC §1). Its security problem is unusual: the **inputs are adversarial** (indirect prompt injection, poisoned tool output, malicious MCP servers — SPEC §3, §19) while the **outputs must be trustworthy enough** to drive deterministic policy decisions, forensic explanation, and reproducible experiments (SPEC §1, §17).

Three properties must hold simultaneously:

1. **Evidence integrity** — the event ledger is append-only and canonical; graph projections are rebuildable from it (ADR-001, SPEC §7); old edge assertions remain auditable (ADR-004).
2. **Confidentiality with privacy-by-default** — sensitive telemetry is minimized at ingestion (SPEC §3), redacted and selectively encrypted at rest (SPEC §18), never placed raw into privileged detector instructions (ADR-005, SPEC §14), and pseudonymous by default (§18).
3. **Tenant isolation** — every node, edge, event, and artifact carries `tenantId` (SPEC §8, §9) and all query paths enforce it (SPEC §20 `query-sdk`, §21 property tests, §25 acceptance criterion "no arbitrary graph-query API").

This model enumerates **17 threats** (16 named in SPEC §18 plus one gap-fill, T-17, justified in §5), maps them to STRIDE (§4), and specifies preventive, detective, and recovery controls for each (§5). The three highest-severity items:

| ID | Threat | Severity | Decisive controls |
|----|--------|----------|-------------------|
| T-07 | Detector prompt injection | **Critical** | Instruction/data separation (ADR-005), isolated sandbox with no tools/network except allowlisted model endpoint, strict token/wall-clock limits, structured schema-validated output (§14, §18) |
| T-09 | Cross-tenant leakage | **Critical** | `tenantId` in every table with composite unique indexes (§9), query-builder–enforced tenant predicate in `query-sdk`, no arbitrary graph-query API (§25), property tests for no cross-tenant path (§21) |
| T-02 | Forged event | **High** | RFC 8785 canonical JSON + SHA-256 hash chain (§9), append-only triggers (§11), Ed25519 signatures where producer keys exist, mandatory "unverified" marking for unsigned telemetry (§25) |

**Overall posture:** the MVP trusts the local operator's host (single-user workstation, SPEC §7) and defends primarily against adversarial *data*, not adversarial *hosts*. Residual risks concentrate in four areas: unsigned telemetry default, KEK co-located with ciphertext on the same host, residual LLM-injection surface in semantic detectors, and model-provider visibility of redacted content (§14).

---

## 2. Threat-Modeling Methodology

### 2.1 Assets

| Asset | Location / form | Primary security property |
|-------|-----------------|---------------------------|
| Canonical event ledger | SQLite, tables `events`, `projection_checkpoints`, `quarantine_records` (SPEC §11) | Integrity, availability |
| Graph projection | Kuzu directory, 9 physical tables + typed relationship tables (SPEC §11) | Integrity (rebuildable), confidentiality |
| Content artifacts | Local content-addressed directory: redacted excerpts, encrypted originals (SPEC §11) | Confidentiality |
| Policies | `policies/default/` YAML, compiled with Zod (SPEC §13, §20) | Integrity, authenticity |
| Evidence packages | Structured JSON to detectors (SPEC §14) | Integrity, confidentiality |
| Detector outputs | Findings, `Detection` nodes (SPEC §8, §14) | Integrity, availability |
| Keys / KEK / DEKs | Local key store (OS keyring / age identity / derived) (SPEC §18) | Confidentiality |
| Audit logs / query logs | SQLite + application logs (SPEC §18) | Integrity, accountability |
| Experiment artifacts | `run.json`, `attestation.json`, metrics (SPEC §19, §22) | Integrity, reproducibility |

### 2.2 Security Objectives

- **Confidentiality:** telemetry content readable only by authorized, purpose-bound principals; raw secrets never persisted (SPEC §24 risk "Secret retention"; §25 "raw secrets disabled by default").
- **Integrity:** events, edges, policies, and evidence packages cannot be modified after acceptance; tampering is detectable (hash chain, SPEC §9).
- **Availability:** local service remains usable; no single session, import, or detector run can exhaust storage, tokens, or wall-clock budget (SPEC §14 token/wall-clock limits).
- **Accountability (non-repudiation):** every policy decision, evidence access, and analyst assertion is attributable and auditable (SPEC §10 signed analyst identity, §18 query audit logs, §22 in-toto attestations).
- **Privacy / anti-surveillance:** pseudonymous principals, purpose-bound access, no productivity scoring (SPEC §18).

### 2.3 Approach

1. **Asset inventory and trust-zone identification** (§3) from the SPEC §7 architecture.
2. **Threat identification** from the SPEC §18 threat table (16 named threats), gap-filled to 17 using the §19 Experiment-3 attack classes and §25 security acceptance criteria.
3. **STRIDE categorization** (§4) with explicit component mapping.
4. **Control mapping:** every control is traced to a SPEC requirement; where SPEC names only an algorithm family (e.g., "XChaCha20-Poly1305 or AES-256-GCM"), this document fixes concrete parameters and labels them as design decisions.
5. **Severity rating** using the rubric below, with residual risk stated per threat.
6. **Maintenance:** this register is reviewed in Milestone Week 8 hardening (SPEC §23); changes to SPEC §18 require a matching update here. Security acceptance is measured against the 10 criteria in SPEC §25.

### 2.4 Severity Rubric

| Rating | Definition |
|--------|-----------|
| **Critical** | Cross-tenant breach, raw-secret disclosure, or wholesale evidence forgery achievable with low attacker effort; no compensating control fully contains it. |
| **High** | Significant integrity/confidentiality/availability impact; partially mitigated; residual risk requires operational vigilance. |
| **Medium** | Localized impact with effective compensating controls; residual risk acceptable for MVP. |
| **Low** | Heavily mitigated, low-likelihood, or low-impact; accepted. |

---

## 3. Trust Zones and Data Flow

The SPEC §7 architecture, annotated with trust zones and the controls applied at each boundary:

```
 Z0 producers (UNTRUSTED)
   ADR Sensor / OTel / MCP client-server / Direct SDK / Bench / Synthetic
        │  raw telemetry
        ▼
 Z1 ingestion boundary — validate → redact → quarantine
   adapters (SPEC §12): schema validation, normalization,
   content-hash + redaction profiles (SPEC §7 "Validate → Redact → Ledger")
        │  canonical events (versioned, hashed, hash-chained)
        ▼
 Z2 trusted store
   SQLite append-only ledger (SPEC §11: triggers reject UPDATE/DELETE outside tests)
        │  resolve → causal linker → immutable edge assertions
        ▼
   Kuzu graph projection (rebuildable; ADR-001)
        │  deterministic policies FIRST (ADR-003)
        ▼
   Policy Engine (SPEC §13) → Detector Framework (SPEC §14)
        │  evidence packages (immutable references, §14)
        ▼
 Z3 investigators: API / CLI / UI (SPEC §15-17) — purpose-bound roles, query audit logs (§18)
        │
        ├──► Z4 detector sandbox: isolated worker/container, read-only evidence,
        │     no host FS, no MCP servers, network ONLY to allowlisted model endpoint (§18)
        │              │
        │              ▼
        │         Z5 model provider (external, HTTPS, pinned) — receives redacted/excerpt content only
        │
        └──► Z6 benchmark runner: Docker-isolated (SPEC §7)
```

| Zone | Trust level | Key controls |
|------|-------------|--------------|
| Z0 Producers | Untrusted | Schema validation, quarantine (`quarantine_records`, SPEC §11), dedupe keys (SPEC §9), unverified marking when unsigned (SPEC §25) |
| Z1 Ingestion | Semi-trusted (code) | Redaction profiles, content minimization (SPEC §3), stable-ID derivation (SPEC §8), no raw evidence into privileged instructions (ADR-005) |
| Z2 Ledger + graph | Trusted store | Append-only triggers (SPEC §11), hash chain (SPEC §9), integrityHash on nodes/edges (SPEC §8), immutable edge assertions (ADR-004) |
| Z3 Investigators | Purpose-bound | Authentication for write paths, purpose-bound roles (SPEC §18), query audit logs (SPEC §18), `--show-sensitive` opt-in (SPEC §16), no arbitrary graph-query API (SPEC §25) |
| Z4 Detector sandbox | Isolated untrusted-content processor | Read-only evidence, no host FS, no tools/MCP, token/wall-clock limits, structured output only (SPEC §14, §18) |
| Z5 Model provider | External | Allowlisted endpoint only, redacted/excerpt/hash-only content modes (§9), no raw secrets (§25) |
| Z6 Benchmark runner | Isolated | Docker isolation (SPEC §7), hidden test labels (SPEC §24), transformation manifests (SPEC §19) |

---

## 4. STRIDE Mapping

| STRIDE category | CATG components at risk | Representative threats | Primary controls (SPEC refs) |
|-----------------|-------------------------|------------------------|------------------------------|
| **Spoofing** (identity forgery) | Identity resolution, stable-ID derivation, Principal/Agent/MCPServer nodes, evidence IDs, producer identity | T-01, T-02, T-06, T-17 | Stable `urn:catg:{tenant}:...` identifiers (SPEC §8); Ed25519 verification where producer keys exist (§19); pseudonymous principals (§18); MCP request-ID matching for CALLED/RETURNED (§12); unverified marking (§25) |
| **Tampering** (modification) | Event ledger, graph edges, policies, evidence packages, experiment artifacts | T-02, T-04, T-12 | RFC 8785 canonical JSON + SHA-256 hash chain (§9, §20 `canonical-json`); append-only triggers (§11); signed/versioned/hashed policies (§25); in-toto attestations with digested subjects (§22) |
| **Repudiation** (deniability) | Producer actions, analyst assertions, policy decisions, evidence access | T-01, T-11 | Append-only ledger (ADR-001); signed analyst identity for strong CAUSED assertions (§10); query audit logs (§18); typed in-toto attestations (§22); immutable PolicyDecision with EVALUATED_AGAINST edge (§8) |
| **Information disclosure** | Graph API, UI, evidence endpoint, model provider, content artifacts, keys | T-08, T-09, T-10, T-11 | Field-level envelope encryption (§18); redaction profiles (§3, §11); content modes raw/redacted/excerpt/hash_only/reference (§9 of this doc; SPEC §4); purpose-bound roles (§18); tenant predicates on all queries (§8, §9, §21); no arbitrary graph-query API (§25) |
| **Denial of service** | Detector sandbox, ingestion pipeline, query paths, storage | T-05, T-06, T-07, T-13 | Token + wall-clock limits (§14, §18); quarantine of malformed/oversized records (§11); dedupe keys bound storage (§9); pagination and server-side filtering (§15, §17); deterministic-first cascade reduces semantic calls ≥40% (SPEC §19 Exp. 2) |
| **Elevation of privilege** | Policy engine, approvals, delegation, policy updates, detector trust | T-05, T-12, T-16 | Evaluation step 6 "validate authorization evidence and scope" (§13); six required policies incl. delegation attenuation, approval validity, authorization scope mismatch (§13); immutable policy versions (§8); DENY/REQUIRE_APPROVAL/INDETERMINATE semantics (§13) |

---

## 5. Detailed Threat Register (17 Threats)

> **Note on count:** SPEC §18's heading reads "Threat Table (17 threats)" but enumerates 16. **T-17 is a labeled gap-fill**: the missing threat is taken from the explicitly specified attack class "forged provenance / fake evidence IDs" in SPEC §19 (Experiment 3), which §18's list otherwise omits. It is marked `[gap-fill]` so the discrepancy remains auditable.

### T-01 Compromised Producer

| Field | Detail |
|-------|--------|
| Attack description | A telemetry producer (ADR Sensor instance, OTel collector, instrumented MCP client, or Direct SDK process) is compromised or malicious and emits fabricated or misleading canonical events with valid-looking structure. |
| Asset at risk | Event ledger integrity; downstream graph, policy decisions, detections. |
| Security boundary | Z0 → Z1 (producer → ingestion). |
| STRIDE | Spoofing, Repudiation. |
| Severity | **High** |
| Preventive controls | Producer identity captured in `producer` envelope field (SPEC §9); stable-ID strategy binds entities to source + source-stable ID so fabricated identities collide detectably (§8); schema validation and Zod-validated event envelopes reject structurally invalid input (§12, §20); policy engine requires `observed`/`declared` confidence with causal basis — fabricated claims cannot satisfy strong CAUSED without an observed basis (§10); no production-claim attribution to ADR (§5 "Deliberately Rejected"). |
| Detective controls | Quarantine of malformed records (`quarantine_records`, §11); confidence semantics expose `declared` vs `observed` (§8); dedupe-key collisions flag replay of producer records (§9); cross-source inconsistency detected by adapter conformance suite (§24). |
| Recovery controls | Quarantined events excluded from projection; rebuild projection from ledger (`catg project rebuild`, §16); re-import from verified source after producer remediation. |
| Residual risk | A fully compromised producer that emits *plausible* telemetry is indistinguishable at ingestion; mitigated by provenance marking but not eliminated. **Medium residual.** |

### T-02 Forged Event

| Field | Detail |
|-------|--------|
| Attack description | Attacker injects a non-existent event into the ledger or mutates an existing event (change a timestamp, tool result, or approval decision) to alter policy outcomes or investigation findings. |
| Asset at risk | Ledger integrity; every downstream artifact (graph, decisions, findings, attestations). |
| Security boundary | Z1 → Z2 (ledger write path). |
| STRIDE | Spoofing, Tampering. |
| Severity | **High** |
| Preventive controls | Canonical serialization per RFC 8785 (JCS) via `canonical-json` package so hashes are implementation-independent (§20); every event carries an integrity hash chain binding it to its predecessor (§9); append-only SQLite with triggers rejecting UPDATE/DELETE outside test builds (§11); dedupe key `SHA256(tenant_id ‖ source_kind ‖ source_record_id ‖ normalized_event_type ‖ normalized_occurred_at ‖ canonical_payload_hash)` with unique index on `(tenant_id, dedupe_key)` blocks duplicate/conflicting insertion (§9); Ed25519 signatures on events from producers that possess keys (design decision: signature covers canonical JSON bytes of the envelope; verification on import; see §8). |
| Detective controls | Hash-chain verification on read and on projection rebuild (any break surfaces immediately); policy replay (`catg policy replay --as-of-event`, §13) re-derives decisions from stored events and would diverge from original decisions if events were forged; property-based test "stable canonical hashes" (§21). |
| Recovery controls | Rebuild projection from the authoritative ledger (§16); restore ledger from backup; re-sign and re-import from verified producer. |
| Residual risk | Unsigned telemetry (the default, §25) can be forged by anyone with write access to the local ledger — the local host is trusted for MVP. Detection requires the hash chain + replay checks. **Medium residual.** |

### T-03 Reordered Evidence

| Field | Detail |
|-------|--------|
| Attack description | Events are presented or ingested out of their true causal order (maliciously or via out-of-order heterogeneous sources), producing wrong PRECEDED_BY/CAUSED relationships. |
| Asset at risk | Causal-graph correctness; detection and investigation conclusions. |
| Security boundary | Z0 → Z1 → Z2 (ordering across ingestion). |
| STRIDE | Tampering. |
| Severity | **Medium** |
| Preventive controls | `occurredAt` vs `observedAt` distinguished in every event envelope (§9); linker precedence forbids temporal proximity from ever producing CAUSED — only PRECEDED_BY at ≤0.35 confidence (§10); strong CAUSED requires explicit identifier/protocol/field-mapping basis (§10); linker version recorded on every edge assertion for replay fidelity (§8 edge fields `linkerId`, `linkerVersion`). |
| Detective controls | Out-of-order correlation and clock-skew cases are required test scenarios (SPEC §21 T-list: "out-of-order correlation", "clock skew"); confidence qualification surfaces weak ordering (`speculative` ≤0.35, §8, §10). |
| Recovery controls | Re-link from ledger with a corrected linker version; rebuild projection (§16). |
| Residual risk | Heterogeneous clocks can still misorder genuinely concurrent events; mitigated by confidence but inherent to telemetry quality. **Low residual.** |

### T-04 Deleted Evidence

| Field | Detail |
|-------|--------|
| Attack description | Events, evidence artifacts, or projection data are deleted (accidentally or maliciously), erasing the audit trail or breaking evidence references. |
| Asset at risk | Ledger availability and durability; forensic completeness; evidence-package references. |
| Security boundary | Z2 (storage). |
| STRIDE | Tampering, Denial of Service. |
| Severity | **Medium** |
| Preventive controls | Append-only enforcement via triggers (§11); events written to ledger *before* derived graph state (SPEC §4 "Store immutable evidence before derived graph state"); content-addressed artifact store (`urn:catg:sha256:{hash}`, §8) makes deletions detectable as dangling references; dedupe keys prevent silent re-insertion of different content under the same identity (§9). |
| Detective controls | Evidence references in edges (`evidenceIds`, §8) and evidence packages (§14) are validated to resolve; dangling-reference check on rebuild; projection lag is observable via CATG's own OTel metrics ("projection lag", §22). |
| Recovery controls | Rebuild projection from ledger (§16); restore from local backup; re-import from source. |
| Residual risk | No replication in MVP (single workstation); backup discipline is operator responsibility. Deferred: distributed event streaming (SPEC §26). **Medium residual.** |

### T-05 Poisoned Tool Result

| Field | Detail |
|-------|--------|
| Attack description | A tool returns attacker-influenced content (injected instructions, malicious source-code comments, deceptive data) that is ingested as a `tool_result.observed` event and later influences detectors or policy evaluation. |
| Asset at risk | Detector validity; policy decisions that consume tool content; graph content nodes. |
| Security boundary | Z0 → Z1 → Z4 (tool output into evidence and detector input). |
| STRIDE | Elevation of Privilege, Denial of Service. |
| Severity | **High** |
| Preventive controls | Tool results are treated as untrusted *content*, never as instructions (ADR-005: no raw evidence in system instructions); untrusted excerpts are delimited/separated in evidence packages (§19 Exp. 3 isolation conditions); deterministic graph rules (which cannot be injected against) run before any semantic detector (ADR-003, §14 hybrid cascade); content hashes bind results to their producing ToolCall (RETURNED edge, §8). |
| Detective controls | Experiment 3 explicitly measures injection success across isolation conditions (direct concatenation vs delimited envelope vs untrusted excerpts separated vs hash/reference-first retrieval, §19); detector output is schema-validated so injected content cannot change output shape (§14, §25). |
| Recovery controls | Quarantine poisoned events (§11); re-run detectors against evidence packages excluding the poisoned artifact; mark affected findings with CONTRADICTED_BY evidence (§8). |
| Residual risk | Semantic detectors can still be influenced by injected content even when delimited; research question is precisely how much the graph representation reduces this (SPEC §2 H4). **Medium residual** for semantic detectors; deterministic rules are immune. |

### T-06 Malicious MCP Server

| Field | Detail |
|-------|--------|
| Attack description | A rogue MCP server responds to tool calls with malicious content or exfiltrates data; CATG ingests its events and must not treat the server as trusted. |
| Asset at risk | Confidentiality of data passed to the server; integrity of ingested MCP events; graph truth about tooling. |
| Security boundary | Z0 (MCP server) → Z1 → Z2. |
| STRIDE | Spoofing, Information Disclosure. |
| Severity | **High** |
| Preventive controls | MCPServer is a first-class node with stable identity (package/server namespace + normalized name + version, §8); restricted/secret DataObjects must not traverse SENT_TO into untrusted MCPServer — required policy #4 (§13); MCP adapter correlates request IDs so CALLED/RETURNED and RECEIVED_FROM edges are observed, not guessed (§12, §10 linker precedence #3); untrusted servers never receive raw credentials (credential.detected events are HMAC-fingerprinted, §24/§25). |
| Detective controls | Data-flow path queries (`GET /sessions/:id/data-flows`, §15) expose sensitive paths to untrusted destinations; policy #4 produces DENY/FLAG decisions that surface in policy views (§17). |
| Recovery controls | Quarantine events from the rogue server (§11); rebuild projection; revoke server identity and re-import remaining sources. |
| Residual risk | MCP instrumentation itself runs in-process with the client; a fully malicious server with valid protocol behavior can still induce *observed* (but bad) events — the graph records truthfully what happened; prevention of the underlying action is out of scope (SPEC §3 "real-time prevention" out of scope). **Medium residual.** |

### T-07 Detector Prompt Injection

| Field | Detail |
|-------|--------|
| Attack description | Evidence content (tool output, messages, malicious code comments, policy descriptions) contains instructions that manipulate the LLM detector into suppressing findings, fabricating findings, or exfiltrating data. This is the research target of Experiment 3 (SPEC §19). |
| Asset at risk | Detector integrity and validity; findings fed to investigations; confidentiality of evidence shown to the model. |
| Security boundary | Z2/Z3 → Z4 (evidence → sandboxed detector). |
| STRIDE | Elevation of Privilege, Information Disclosure. |
| Severity | **Critical** |
| Preventive controls | **Instruction/data separation:** no raw evidence in system instructions (ADR-005); evidence is passed as delimited data with untrusted excerpts separated from trusted graph facts (§14, §19 Exp. 3 isolation conditions); **isolation:** detectors run in an isolated worker/container with read-only evidence, no host filesystem, no MCP servers, and network disabled except the selected model endpoint (SPEC §18); **limits:** strict token and wall-clock limits prevent injection-driven resource abuse (§14, §18); **deterministic-first:** graph rules and cheap semantic triage run before graph-summary reasoning, so a compromised LLM stage cannot veto deterministic DENY findings (ADR-003, §14 hybrid cascade; §19 Exp. 2); **output discipline:** detectors must validate output against a strict schema — injection cannot change result shape (§14, §25 "schema-validated detector output"). |
| Detective controls | Experiment 3 measures injection success across attack classes and isolation conditions (§19); detector version/model/prompt pinned and declared so drift is attributable (§14); CATG OTel metrics record detector token usage and cost anomalies (§22). |
| Recovery controls | Re-run detector against a rebuilt evidence package with stronger isolation (e.g., hash/reference-first retrieval); findings are immutable evidence but can be superseded by CONTRADICTED_BY / DETECTED_AS relationships (§8); escalate to deterministic rules only. |
| Residual risk | Semantic stages remain susceptible to sophisticated injection even when delimited — the core research question (SPEC §2 H4, §27 Q1). Mitigation depth is why this is rated Critical despite strong controls. **Medium-High residual** for semantic detectors; deterministic stages carry zero injection surface. |

### T-08 Unauthorized Graph Access

| Field | Detail |
|-------|--------|
| Attack description | An unauthenticated or over-privileged principal reads graph data, evidence, or findings through the API, CLI, or UI — including raw sensitive content. |
| Asset at risk | Confidentiality of telemetry, credentials, evidence, findings. |
| Security boundary | Z3 (investigator access paths). |
| STRIDE | Information Disclosure. |
| Severity | **High** |
| Preventive controls | API surface is endpoint-scoped and read-model–only for graph (SPEC §15; write paths limited to import/validate/evaluate/detect/incident); CLI omits sensitive content unless `--show-sensitive` is passed (§16); evidence endpoint serves redacted metadata/content (`GET /evidence/:id` "Redacted evidence metadata/content", §15); no arbitrary graph-query API — only `query-sdk` safe queries (SPEC §20, §25); purpose-bound access roles (§18). |
| Detective controls | Query audit logs record every graph/API access with principal, purpose, and scope (§18); audited sensitive-evidence access is a security acceptance criterion (§25); UI is server-side filtered (§17). |
| Recovery controls | Rotate access credentials; revoke role; audit-log review to scope the exposure; re-encrypt affected content artifacts (DEK rotation, §7). |
| Residual risk | MVP has no enterprise SSO or fine-grained RBAC (SPEC §26 deferred); access control is coarse (operator-level roles). **Medium residual.** |

### T-09 Cross-Tenant Leakage

| Field | Detail |
|-------|--------|
| Attack description | A query, projection, or rebuild for tenant A returns nodes/edges/events belonging to tenant B (maliciously crafted query, buggy projection, or shared-cache bleed). |
| Asset at risk | Confidentiality of every tenant's telemetry. |
| Security boundary | Z2 → Z3 (storage → query paths). |
| STRIDE | Information Disclosure. |
| Severity | **Critical** |
| Preventive controls | `tenantId` is a universal field on every node and edge (SPEC §8) and part of every event envelope; dedupe uniqueness is scoped per tenant — unique index on `(tenant_id, dedupe_key)` (SPEC §9); Kuzu physical tables carry `tenantId` in the projection (SPEC §11, §8); **query-builder enforcement:** `query-sdk` is the only graph-query path and injects the tenant predicate on every query — there is no raw Cypher/query passthrough API (SPEC §20, §25 "no arbitrary graph-query API"); API endpoints derive tenant from the authenticated session context (SPEC §15); policies and evidence packages are tenant-scoped by construction. |
| Detective controls | Property-based test "no cross-tenant graph path" (SPEC §21); required test case "cross-tenant queries" (SPEC §21 T-list); cross-tenant tests are a security acceptance criterion (SPEC §25). |
| Recovery controls | Rebuild projection from ledger (projection is disposable, ADR-001); re-verify tenant scoping after any schema migration (SPEC §4 "support graph schema migrations by rebuilding the projection"). |
| Residual risk | Single-operator MVP means one host; a compromised host process can read all tenants regardless of application controls. Application-level isolation is verified by tests but host-level isolation is out of scope. **Low-Moderate residual** at application layer, **High** at host layer (accepted for MVP deployment model). |

### T-10 Provider Disclosure

| Field | Detail |
|-------|--------|
| Attack description | Sensitive telemetry content is sent to the external LLM provider (model endpoint) during semantic detection, exceeding the operator's intended disclosure. |
| Asset at risk | Confidentiality of evidence content; compliance posture. |
| Security boundary | Z4 → Z5 (sandbox → model provider). |
| STRIDE | Information Disclosure. |
| Severity | **Medium** |
| Preventive controls | Content modes gate what leaves the host: raw content is never the default; evidence packages carry redacted/excerpt/hash-only/reference forms (§9 of this doc; SPEC §3 "no mandatory raw prompts", §4 "content hashes, redacted excerpts, and external content references"); network egress from the sandbox is allowlisted to the selected model endpoint only (SPEC §18); raw secrets are disabled by default and represented as keyed HMAC fingerprints (§25, §24); CLI/UI require `--show-sensitive`/role elevation to reveal raw content (§16). |
| Detective controls | Detector token usage and cost are recorded per run (SPEC §22); prompt manifests are stored per experiment run so exactly what was sent to the provider is auditable (`prompt-manifest.json`, §19). |
| Recovery controls | Rotate model endpoint/credentials; re-run detector with stricter content mode (e.g., hash_only); document disclosure in the run's attestation (§22). |
| Residual risk | Redaction is heuristic; a detector prompt that requests raw evidence could still receive it if a role allows raw mode. Operators control this via content-mode policy. **Low residual** when raw mode is disabled. |

### T-11 Analyst Misuse

| Field | Detail |
|-------|--------|
| Attack description | An authorized investigator uses CATG beyond its purpose: bulk-extracting personal data, building productivity profiles, or investigating individuals without authorization. |
| Asset at risk | Privacy of principals; organizational trust. |
| Security boundary | Z3 (human access). |
| STRIDE | Repudiation, Information Disclosure. |
| Severity | **Medium** |
| Preventive controls | Pseudonymous principals by default — `HumanPrincipal` identity is tenant namespace + issuer + subject, not raw username (SPEC §8, §18); configurable removal of usernames/hostnames (§18); purpose-bound access roles (§18); no productivity score and no "developer risk ranking" exist as features (SPEC §18; non-goal §4 "an employee-productivity scoring system"); raw content requires explicit opt-in (`--show-sensitive`, §16). |
| Detective controls | Query audit logs record who queried what, when, and for which purpose (SPEC §18); sensitive-evidence access is audited (SPEC §25); retention limits bound how long data can be aggregated (§18, §8 `retention` field). |
| Recovery controls | Revoke role; purge tenant data per retention policy; audit-log review; governance doc `docs/governance/anti-surveillance.md` defines escalation (SPEC §18). |
| Residual risk | A determined operator with host access can bypass application controls; mitigations are organizational + audit, not technical. Continuous employee monitoring is explicitly deferred/out of scope (SPEC §26, §4). **Medium residual** (accepted by design). |

### T-12 Malicious Policy Update

| Field | Detail |
|-------|--------|
| Attack description | An attacker (or supply-chain compromise) replaces or alters a policy YAML so that evaluations return ALLOW for exfiltration or DENY for legitimate actions — or a policy is swapped mid-investigation to change past decisions. |
| Asset at risk | Policy integrity and authenticity; every downstream decision and finding. |
| Security boundary | Z2/Z3 → policy store. |
| STRIDE | Tampering, Elevation of Privilege. |
| Severity | **High** |
| Preventive controls | Policy identity is namespace + policy ID + **immutable version** (SPEC §8); policies are versioned and hashed — "versioned/hashed policy changes" is a security acceptance criterion (§25); policy YAML is compiled and validated with Zod (limited grammar, §13) so structural tampering is rejected at compile time; policy set hash is part of the reproducibility manifest (§22); **signed policies** (design decision consistent with §19 signing of evidence bundles): policy files may carry an Ed25519 signature over their canonical (RFC 8785) form; unsigned policies are accepted only from the local `policies/default/` tree and flagged at load. |
| Detective controls | `POST /policies/validate` (SPEC §15) validates documents before activation; policy replay (`catg policy replay --as-of-event`, §13) lets investigators re-derive any past decision from the stored policy version — a swapped policy would produce different decisions than the original run; policy evaluation results are immutable PolicyDecision nodes with EVALUATED_AGAINST edges (§8). |
| Recovery controls | Restore pinned policy version from `policies/default/` or backup; re-run evaluations against the correct immutable version; quarantine events ingested under the malicious policy if they affect findings. |
| Residual risk | If the attacker controls the host (or the policy signing key), all bets are off — host trust assumed for MVP. Supply-chain risk on dependencies is managed via pnpm lock hash in the reproducibility manifest (§22). **Low-Moderate residual.** |

### T-13 Oversized Session

| Field | Detail |
|-------|--------|
| Attack description | A session import or query is so large (many events, huge tool outputs, deep graphs) that storage, memory, tokens, or wall-clock time are exhausted — degrading or denying service for legitimate use. |
| Asset at risk | Availability of the local service; detector token budget; storage. |
| Security boundary | Z1 (ingestion), Z3 (query), Z4 (detector). |
| STRIDE | Denial of Service. |
| Severity | **Medium** |
| Preventive controls | Dedupe keys and unique indexes prevent duplicate-bloat (§9); quarantine records isolate malformed/oversized input (§11); detector sandbox enforces strict token and wall-clock limits per run (§14, §18); UI enforces server-side graph filtering and a 1,500-element rendering cap (§17, §25 performance target); API supports pagination/filtering (`GET /sessions`, `GET /sessions/:id/timeline`, §15). |
| Detective controls | CATG OTel metrics track import duration, events accepted/quarantined, graph-query latency, and detector token usage (§22) — anomalous spikes are observable; Experiment 3 includes "oversized distracting content" as an explicit attack class (§19); required test case "oversized evidence" (SPEC §21). |
| Recovery controls | Kill/quarantine the offending import or run; rebuild projection from the ledger excluding quarantined events; raise per-run limits only deliberately. |
| Residual risk | Import of a genuinely huge session is legitimate workload; limits are operator-configurable and a mis-set limit can still cause resource pressure. Performance targets bound the expected envelope (10K events import ≤60s, §25). **Low residual.** |

### T-14 Hash Guessing

| Field | Detail |
|-------|--------|
| Attack description | Attacker guesses or precomputes content hashes to forge content-addressed artifacts, spoof evidence IDs, or fake dedupe keys. |
| Asset at risk | Integrity of content-addressed store (`urn:catg:sha256:{hash}`) and evidence references. |
| Security boundary | Z1/Z2 (content addressing). |
| STRIDE | Spoofing, Tampering. |
| Severity | **Low** |
| Preventive controls | SHA-256 (256-bit) content addressing per SPEC §8 — collision/preimage resistance is cryptographically sound for this threat; content hashes are computed over RFC 8785 canonical bytes (deterministic, §20 `canonical-json`); secrets are never content-addressed in plaintext — they exist as keyed HMAC fingerprints (SPEC §25), so a guessed hash cannot reveal or forge a secret artifact; evidence IDs in edges (`evidenceIds`, §8) must resolve to real artifacts (validated on package build, §14). |
| Detective controls | Property-based test "stable canonical hashes" (§21) verifies hash determinism; dangling evidence references surface on rebuild. |
| Recovery controls | Rebuild artifacts from source events; re-sign evidence bundles (in-toto, §22). |
| Residual risk | Negligible for SHA-256 with random or high-entropy inputs; low-entropy content (e.g., a known tool result string) can be dictionary-matched — hence HMAC keying for secrets. **Low residual** (accepted). |

### T-15 Replay Confusion

| Field | Detail |
|-------|--------|
| Attack description | Old events, old decisions, or old evidence are re-presented as current — e.g., re-importing an old session, replaying a stale approval, or confusing investigators with duplicate/conflicting evidence — to corrupt current conclusions. |
| Asset at risk | Decision correctness; investigation accuracy; ledger consistency. |
| Security boundary | Z1 (re-import), Z3 (investigation), Z2 (ledger). |
| STRIDE | Spoofing, Tampering. |
| Severity | **Medium** |
| Preventive controls | Dedupe key includes `normalized_occurred_at` + canonical payload hash, so re-imports of identical records are idempotent and *different* records under the same source ID collide loudly (SPEC §9); events are immutable with a hash chain fixing order (§9); approvals carry validity semantics — policy #5 "premature approval invalidity" rejects approvals decided before material arguments finalized, and policy #6 forbids scope mismatch (§13); policy replay is a *controlled* feature (`--as-of-event`, §13) that snapshots the event state, not a mechanism for injecting new state. |
| Detective controls | Required test "import idempotency" and "policy replay immutability" (SPEC §21); conflicting evidence is an explicit Experiment-3 attack class and surfaces as CONTRADICTED_BY relationships (§8, §19). |
| Recovery controls | Quarantine the replayed records; rebuild projection; re-run policy evaluation against the correct as-of event. |
| Residual risk | Distinguishing legitimate re-import (recovery) from malicious replay requires operator judgment; controls make the two distinguishable in the audit trail. **Low residual.** |

### T-16 Semantic Overreach

| Field | Detail |
|-------|--------|
| Attack description | CATG (or its consumers) treats inferred, reconstructed, or speculative relationships as established fact — e.g., a heuristic data-flow edge or a semantic-inference CAUSED being used for enforcement — producing false accusations or false exonerations. |
| Asset at risk | Epistemic integrity of the graph; trust in findings; research credibility. |
| Security boundary | Z2 (graph construction) → Z3 (consumption). |
| STRIDE | Elevation of Privilege (of inference over evidence). |
| Severity | **Medium** |
| Preventive controls | Every edge carries `confidence` (observed/declared/reconstructed/inferred/speculative) + `confidenceScore` + `causalBasis` + `evidenceIds` (SPEC §8); strong CAUSED is emitted only under the five enumerated conditions, otherwise MAY_HAVE_CAUSED (§10); temporal proximity alone can never yield CAUSED (only PRECEDED_BY ≤0.35, §10); the project explicitly disclaims statistical causal inference (SPEC §1, §24 risk "'Causal' overclaiming"); UI exposes confidence toggles and path highlighting so uncertainty is visible (§17). |
| Detective controls | Confidence mapping table is enforced by the linker (§10); property-based test "no inferred edge without evidence" (SPEC §21); Experiment 1 measures explanation faithfulness (SPEC §2, §19). |
| Recovery controls | Correct the linker version and rebuild projection (edges carry `linkerId`/`linkerVersion`, §8); annotate affected findings with CONTRADICTED_BY evidence. |
| Residual risk | Reconstruction heuristics can still mislabel workflows; confidence qualification is the mitigation, not elimination. Open research question Q2 (at what reconstruction-error rate does the graph mislead more than a transcript? — SPEC §27). **Medium residual.** |

### T-17 Forged Provenance / Fake Evidence IDs `[gap-fill]`

| Field | Detail |
|-------|--------|
| Attack description | An attacker fabricates provenance metadata or evidence identifiers (fake `evidenceIds`, forged source identifiers, invented causal bases) so that an assertion appears evidence-backed when it is not. Listed explicitly as an Experiment-3 attack class ("forged provenance, fake evidence IDs", SPEC §19). |
| Asset at risk | Trustworthiness of edge assertions, evidence packages, and findings. |
| Security boundary | Z1/Z2 (assertion construction) → Z3/Z4 (consumption). |
| STRIDE | Spoofing, Tampering. |
| Severity | **High** |
| Preventive controls | Edge assertions are immutable and carry `evidenceIds`, `linkerId`, `linkerVersion`, `causalBasis` (SPEC §8); derived-assertion IDs are hashes of relation type + endpoints + method + evidence IDs + linker version (§8), so altering any cited evidence changes the assertion ID; evidence packages reference immutable, content-addressed artifacts (SPEC §14, §8) — fake IDs fail resolution at package build; unsigned telemetry is marked unverified so it cannot masquerade as observed evidence (§25); strong CAUSED requires an observed basis or a signed analyst identity (§10). |
| Detective controls | Evidence-reference validation on package build and on read; Experiment 3 measures detection under forged provenance (§19); investigation rule requires every textual claim to expose Evidence / Policy inference / Detector judgment / Unresolved hypothesis (§17). |
| Recovery controls | Quarantine the offending assertion chain (edges are immutable but can be superseded via CONTRADICTED_BY, §8); rebuild projection; re-run affected detectors. |
| Residual risk | If the attacker controls the ledger write path (host compromise), forged provenance is indistinguishable — same host-trust assumption as T-02. **Medium residual.** |

---

## 6. Detector Sandbox

Requirements distilled from SPEC §14 (Detector Restrictions) and §18 (Detector Sandbox). The sandbox is the control boundary for T-05, T-06, T-07, T-10, and T-13.

### 6.1 Isolation Requirements

- **Isolated worker/container** (SPEC §18): each detector run executes in its own container/worker process with no shared mutable state with the API, ledger, or graph.
- **No host filesystem:** the sandbox has no mounts of the SQLite ledger, Kuzu directory, or content-artifact store. Scratch space is an ephemeral tmpfs that is destroyed after the run.
- **No MCP servers and no external tools** (SPEC §18, §14): the detector cannot call MCP servers, shells, or arbitrary tools. The only permitted tools are the read-only retrieval tools (`get_evidence`, `get_path`) that service the retrieval-assisted investigator detector type (SPEC §14) and are served by the sandbox host over a scoped in-memory interface.
- **Network egress allowlist:** no network except the selected model endpoint (SPEC §18). Egress is restricted to the model provider over HTTPS with pinned certificates; DNS and all other destinations are blocked. (Design decision: an egress proxy with an allowlist of one upstream — model endpoint host — enforced at the container network layer.)
- **Read-only evidence:** detectors receive *immutable evidence references* and an evidence package snapshot (SPEC §14); they must not write source events or add graph edges (SPEC §14); any write attempt is rejected by the sandbox API and logged.
- **Version declaration:** every run declares model, prompt, policy, and code versions (SPEC §14), enabling attribution and reproducible re-runs (§22).

### 6.2 Read-Only Evidence

- Evidence packages are structured JSON: intent, principals, agents, authority, untrusted inputs, sensitive paths (with edge confidence), effects, policy decisions, unknowns (SPEC §14).
- Evidence content is **untrusted data** (SPEC §14) — the sandbox treats it as payload, never as instructions (ADR-005). Untrusted excerpts are delimited and separated from trusted graph facts in the package (SPEC §19 Exp. 3 "untrusted excerpts separated").
- Content arrives in the package in a content mode appropriate to the detector (redacted/excerpt/hash_only/reference — see §9); hash/reference-first retrieval is the strongest isolation condition (SPEC §19).

### 6.3 No Host Filesystem / No External Tools

- Container has no bind mounts into the repo or data directories; artifacts are passed via an in-memory evidence channel.
- Tool execution is limited to the two read-only retrieval tools; they return snapshots already present in the evidence package (no live ledger access).
- (Design decision: `docker/` in SPEC §20 hosts the sandbox image; the benchmark runner is separately Docker-isolated per SPEC §7 so experiments cannot touch the operator's data.)

### 6.4 Token and Wall-Clock Limits

- **Strict token limits** per run (SPEC §18): a per-detector token budget enforced by the model client (max_tokens + a budget counter across calls); budget exhaustion terminates the run with an explicit `budget_exceeded` result rather than partial output.
- **Wall-clock limits** (SPEC §18): a per-run timeout kills the container; plus retry limits and cost caps (SPEC §22 records token usage and cost per run).
- **Structured output only** (SPEC §18): detector output must validate against a strict Zod schema (SPEC §14, §20 `detector-sdk`); malformed output is rejected/quarantined — required test "malformed detector output" (SPEC §21).
- The deterministic-first cascade (ADR-003, §14 hybrid cascade; §19 Exp. 2) targets ≥40% reduction in semantic-model calls at ≥95% recall, which both cuts cost and shrinks the injection surface.

### 6.5 Isolation Conditions (Experiment 3, SPEC §19)

The four tested isolation conditions, weakest to strongest:

1. **Direct concatenation** — untrusted content concatenated with instructions (baseline; expected worst injection success).
2. **Delimited envelope** — evidence wrapped in explicit delimiters inside the prompt.
3. **Untrusted excerpts separated** — excerpts isolated from trusted graph facts.
4. **Hash/reference-first retrieval** — detector sees hashes/references and retrieves content only on demand.

Deterministic rules + semantic escalation is the fifth condition combining graph rules with any of the above. Experiment 3's attack classes (instructions directed at detector, poisoned MCP/tool output, malicious source-code comments, poisoned policy descriptions, oversized distracting content, conflicting evidence, forged provenance, fake evidence IDs) are the acceptance suite for the sandbox.

---

## 7. Field-Level Encryption Design

Requirement: "Envelope encryption: random DEK per artifact, DEK encrypted by local KEK, XChaCha20-Poly1305 or AES-256-GCM" (SPEC §18). Scope: "encrypt selected content fields locally" (SPEC §4 MVP May) — field-level, not whole-database.

### 7.1 Envelope Structure

| Component | Specification |
|-----------|---------------|
| Data Encryption Key (DEK) | 256-bit random, generated fresh per artifact/field from a CSPRNG (e.g., `crypto.getRandomValues` / OpenSSL RAND_bytes). Never reused across artifacts. Never persisted in plaintext. |
| Key Encryption Key (KEK) | 256-bit, local to the operator (SPEC §18 "local KEK"). Sources, in order of preference: OS keyring (Secret Service / macOS Keychain / Windows DPAPI), an `age` identity, or a passphrase-derived key via **Argon2id (RFC 9106)** — design parameters: m=64 MiB, t=3, p=1 (OWASP-recommended baseline), producing 32 bytes. |
| Wrapped DEK | `DEK_wrapped = AEAD_KEK(DEK || context)` stored alongside the artifact header (or in a `key_wraps` table in the UI-settings SQLite, SPEC §11 — non-evidentiary metadata). |
| Ciphertext | `CT = AEAD_DEK(plaintext)` with Associated Data (AAD). |
| Algorithm choice | **XChaCha20-Poly1305** (IETF variant via HChaCha20; 24-byte random nonce, 16-byte tag) — preferred for local files: the 192-bit nonce allows random nonces with negligible collision risk and it is fast in software (libsodium/tweetnacl-style implementations). **AES-256-GCM** (NIST SP 800-38D; 96-bit random nonce, 128-bit tag) — used when hardware AES (AES-NI/WebCrypto) is available and nonce uniqueness is enforced by the encryptor. Both are 256-bit AEAD constructions; SPEC §18 permits either. |
| AAD | Binds `tenant_id ‖ artifact_id ‖ field_path ‖ schema_version ‖ content_mode`. Prevents ciphertext/header swap attacks across tenants, fields, or schema migrations. |
| Nonce handling | Random 24-byte (XChaCha20) or 12-byte (GCM) nonce generated per encryption and stored in the artifact header; GCM path adds a per-key nonce counter check to guarantee uniqueness. |

### 7.2 Key Lifecycle

- **Rotation:** KEK rotation re-wraps all DEKs without re-encrypting artifacts; DEK rotation re-encrypts the affected artifact (used for T-08 recovery). Key version is recorded in the artifact header; `integrityHash` covers the header so version/algorithm tampering is detected (SPEC §8).
- **Storage boundaries:** KEK lives in the OS keyring/age identity, never in the repository, never in the SQLite ledger, never in the content-addressed directory. The ledger stores only wrapped DEKs and ciphertext.
- **Encryption scope:** `credential.detected` payloads, raw prompts (when retained at all — content minimization per SPEC §3), DataObject contents, and content-artifact originals ("Redacted excerpts, encrypted originals", SPEC §11). Redacted excerpts remain readable for investigation; encrypted originals are decrypted only on explicit `--show-sensitive`-grade access (SPEC §16) under audit (§18).

### 7.3 Interaction with Hashing and Search

- Encryption destroys searchability: matching and deduplication over secret material use **keyed HMAC fingerprints** instead of plaintext or plain hashes (SPEC §24, §25 "keyed HMAC fingerprints"), so identical secrets dedupe without revealing them.
- Content hashes (`urn:catg:sha256:{hash}`, SPEC §8) are computed over plaintext *before* encryption for dedup and integrity; the ciphertext is content-addressed separately under its own hash.

---

## 8. Integrity Protections

Requirement family: canonical events with integrity hash chain (SPEC §9), `integrityHash` on all nodes/edges (§8), append-only ledger (§11), signed benchmark evidence bundles (§4), unsigned telemetry marked unverified (§25), in-toto attestations (§22).

### 8.1 Canonicalization — RFC 8785

- `canonical-json` package (SPEC §20) serializes all envelope payloads deterministically per **RFC 8785 (JCS)**: lexicographic key order, minimal number encoding, deterministic string escaping. Purpose: identical logical content yields identical bytes on every platform/implementation, so hashes and signatures are stable — verified by property-based test "stable canonical hashes" (SPEC §21).
- The event envelope (`eventId, schemaVersion, eventType, occurredAt, observedAt, producer, subject, trace context, identity context, payload, provenance, security classification, integrity hash chain, extensions`, SPEC §9) is hashed in canonical form; `extensions` are bounded (ADR-006) so the hash domain cannot be inflated.

### 8.2 Hash Chain

- Each event's `integrity hash chain` field links to the previous event's hash in the same tenant+source sequence (SPEC §9): `H_i = SHA-256(canonical(event_i) ‖ H_{i-1})`. Any reordering, deletion, or modification breaks the chain.
- Dedupe key reuses the canonical payload hash (SPEC §9), binding identity to content.
- Nodes and edges carry `integrityHash` (SPEC §8); edge assertions are immutable (ADR-004) — old assertions remain auditable and are superseded via CONTRADICTED_BY rather than deleted (§8).

### 8.3 Signatures — Ed25519

- **Ed25519** (RFC 8032, 32-byte public key, 64-byte signature) is the designated signature scheme (design decision; consistent with SPEC §4 "Sign benchmark evidence bundles" and §19 in-toto attestations). Rationale: small signatures, deterministic (no nonce-reuse class of bugs), fast verification, well-supported in TypeScript (tweetnacl/libsodium wrappers).
- Signed objects: benchmark evidence bundles and experiment attestations (`attestation.json`, typed in-toto statement binding claims to digested subjects, SPEC §22, §6 in-toto/SLSA), and — where a producer possesses a key — event envelopes and policy files (T-02, T-12).
- Signature input is the RFC 8785 canonical byte string of the object; public keys are recorded as producer/principal attributes (SPEC §8 principal identity = tenant namespace + issuer + subject).

### 8.4 Unsigned Import Marking

- Telemetry without a verifiable signature is **marked unverified** — security acceptance criterion "unsigned telemetry marked unverified" (SPEC §25). Concretely: an `integrity.verification` field on the envelope takes `verified | unverified | verification_failed`; `verification_failed` records are quarantined (§11).
- Confidence semantics interoperate: `observed` requires explicit source identifiers or instrumentation (SPEC §8) — verification status is tracked separately from confidence, so an unverified record can never silently upgrade to trusted evidence for enforcement purposes (T-02, T-17).

---

## 9. Content Security

Requirement family: content minimization and configurable redaction (SPEC §3), content hashes / redacted excerpts / external content references (SPEC §4), redacted excerpts + encrypted originals in the content store (SPEC §11), sensitive content omitted unless `--show-sensitive` (SPEC §16), raw-content disabled + HMAC fingerprints + redaction profiles (SPEC §24).

### 9.1 Redaction Profiles

- Profiles are per-source/per-field rule sets applied at the ingestion boundary (SPEC §7 "Validate → Redact → Ledger") and implemented by the `content-security` package (SPEC §20).
- Default profile: raw prompts are **not** mandatory telemetry (SPEC §3 "no mandatory raw prompts"); usernames/hostnames are removable (SPEC §18); secrets detected by `credential.detected` are replaced with keyed HMAC fingerprints before any storage beyond the encrypted artifact store (SPEC §24, §25).
- Redaction happens before the ledger write for derived fields; the encrypted original (if retained) lives only in the content-addressed store under field-level encryption (§7).

### 9.2 Content Modes

The storage/representation mode of any content-bearing field (design taxonomy derived from SPEC §4 "content hashes, redacted excerpts, and external content references"; SPEC §11 "Redacted excerpts, encrypted originals"):

| Mode | What is stored/served | Use case | SPEC basis |
|------|-----------------------|----------|------------|
| `raw` | Full original content | Only for explicitly opted-in, purpose-bound access with `--show-sensitive`/role elevation; never a default | §16, §18 |
| `redacted` | Original with profile-based redactions applied | Default for investigation views and evidence packages | §3, §11 |
| `excerpt` | Bounded, context-relevant fragment | Detector inputs, UI previews, timeline | §4 |
| `hash_only` | Content-addressed SHA-256 + keyed HMAC fingerprints for secrets | Dedup, correlation, and matching without disclosure; strongest isolation condition (Exp. 3) | §8, §19, §25 |
| `reference` | External content reference (URI + hash) with no content copied | External content references per §4; keeps CATG storage minimal | §4 |

- Serving rules: `GET /evidence/:id` returns redacted metadata/content (SPEC §15); CLI omits sensitive content unless `--show-sensitive` (SPEC §16); detector evidence packages select modes per detector class (§6.4) — semantic detectors typically receive `redacted`/`excerpt`, never `raw` by default (T-10).

### 9.3 Trust-Zone Content Rules

| From → To | Allowed modes | Enforcement |
|-----------|---------------|-------------|
| Z1 → Z2 (ingest → ledger) | `raw` (encrypted) in artifact store; `redacted`/`excerpt`/`hash_only` in event payloads | Redaction pipeline before ledger write (§7) |
| Z2 → Z3 (store → investigator) | `redacted`, `excerpt`, `hash_only`, `reference`; `raw` only with elevation | API/CLI gating + query audit logs (§15, §16, §18) |
| Z2/Z3 → Z4 (evidence → detector) | `redacted`, `excerpt`, `hash_only`, `reference` | Evidence package builder (SPEC §14) |
| Z4 → Z5 (sandbox → model provider) | Same as Z4 input (never `raw` by default) | Sandbox egress policy (§6.4, T-10) |

---

## 10. Anti-Surveillance Controls

Requirement: SPEC §18 Anti-Surveillance + risk "Misuse for surveillance" (SPEC §24) + non-goal "an employee-productivity scoring system" (SPEC §4).

| Control | Specification | SPEC ref |
|---------|---------------|----------|
| **Pseudonymous principals by default** | `HumanPrincipal` identity is tenant namespace + issuer + subject — not an employee username; agents get generated stable IDs (`urn:catg:{tenant}:...`) | §8, §18 |
| **No productivity scoring** | No feature computes throughput, velocity, or quality scores per principal; "no productivity score" is explicit | §18, §4 non-goal |
| **No "developer risk ranking"** | No ranking or risk-scoring of individuals exists as a product capability | §18 |
| **Removable identifiers** | Configurable removal of usernames and hostnames via redaction profiles at ingestion | §18, §9 of this doc |
| **Purpose-bound access roles** | Read roles are scoped to investigation purpose (session/incident/experiment); no blanket export role; write roles limited to import/attestation paths | §18, §15 |
| **Query audit logs** | Every graph/API query is logged: principal, purpose, scope, timestamp, result count; sensitive-evidence access audited | §18, §25 |
| **Retention limits** | `retention` universal field on nodes/edges/events (SPEC §8) with per-class retention policies; content modes allow hash-only retention so raw material expires | §18, §8, §9 of this doc |
| **Governance artifact** | `docs/governance/anti-surveillance.md` documents acceptable use, escalation, and review | §18 |
| **Design guardrails** | Continuous employee monitoring is deferred/out of scope (§26, §4); automatic proof of data non-use is deferred (§26) | §26, §4 |

---

## 11. Policy Security

Requirement family: policy identity = namespace + ID + immutable version (SPEC §8); YAML compiled/validated with Zod, limited grammar (§13); evaluation step 6 "validate authorization evidence and scope" (§13); policy #6 authorization scope mismatch (§13); versioned/hashed policy changes (§25); policy replay as-of-event (§13); policy set hash in reproducibility manifest (§22).

### 11.1 Signed, Versioned, Hashed Policies

- Policies live in `policies/default/` (SPEC §20) as versioned YAML; the Policy node identity binds namespace + policy ID + immutable version (§8).
- **Hashed:** every policy version's RFC 8785 canonical hash is recorded; the aggregate "policy set hash" is part of the reproducibility manifest (SPEC §22), so any change is attributable to a specific run.
- **Signed** (design decision consistent with SPEC §4 signing of evidence bundles): policy files may carry an Ed25519 signature; `POST /policies/validate` (SPEC §15) and the CLI `validate policy` command (SPEC §16) verify signature + schema before activation. Unsigned local policies are flagged at load (mirroring the unverified-marking principle, §8.4).
- **Versioned:** versions are immutable; updates create a new Policy node version rather than mutating the old one (T-12).

### 11.2 Approval-Scope Validation

- Evaluation algorithm step 6: "Validate authorization evidence and scope" (SPEC §13) — the engine checks that any approval/authorization cited by a decision covers the operation, tool, resource, environment, and data classification actually in play; policy #6 (authorization scope mismatch) and policy #5 (premature approval invalidity) encode this as first-class predicates (§13).
- AUTHORIZED_BY edges (reconstructed confidence) link effects/decisions to their PolicyDecision/ApprovalDecision basis (SPEC §8); missing or mismatched authorization yields REQUIRE_APPROVAL or DENY, never ALLOW by default (§13 evaluation returns).
- Analyst-asserted relationships require a **signed identity** to qualify as strong CAUSED (SPEC §10), so human assertions are attributable (T-11, T-16).

### 11.3 Replay-Attack Prevention

- **Controlled replay, not injection:** `catg policy replay --policy ... --session ... --as-of-event N` (SPEC §13) re-derives decisions from the *stored* event ledger at a fixed event index — it cannot introduce new state (T-15).
- Every PolicyDecision is an immutable node with an EVALUATED_AGAINST edge to the exact policy version and evidence snapshot used (§8); decisions carry the as-of event index, so comparing a replayed decision to the original surfaces any drift (T-02, T-12 detective control).
- Property-based test "policy replay immutability" (SPEC §21) enforces that replayed decisions equal original decisions given an unchanged ledger.

---

## 12. Cross-Tenant Isolation

Requirement family: `tenantId` universal field (SPEC §8); unique index `(tenant_id, dedupe_key)` (§9); property test "no cross-tenant graph path" (§21); test case "cross-tenant queries" (§21); acceptance criterion "no arbitrary graph-query API" (§25); `query-sdk` safe graph queries (§20).

### 12.1 Tenant Key in Every Table

| Store | Tenant enforcement |
|-------|--------------------|
| SQLite `events` | `tenant_id` column; dedupe uniqueness per tenant: unique index on `(tenant_id, dedupe_key)` (SPEC §9) |
| SQLite `projection_checkpoints`, `quarantine_records` | `tenant_id` column on every row (SPEC §11) |
| Kuzu physical tables (Principal, Agent, Execution, Communication, Tooling, Asset, Governance, Outcome, EvidenceArtifact) | `tenantId` universal node field (SPEC §8, §11); edge tables carry `tenantId` in universal edge fields (§8) |
| Content artifacts | AAD binds tenant (SPEC §18 envelope design, §7 of this doc); content-addressed IDs are tenant-scoped (`urn:catg:{tenant}:...`, §8) |
| Policies, evidence packages, findings | Tenant-scoped Policy/PolicyDecision/Detection nodes; finding IDs hash detector version + evidence snapshot + run ID (§8) |

### 12.2 Query-Builder Enforcement

- `query-sdk` is the **only** graph-query interface (SPEC §20 "safe graph queries"); it injects the tenant predicate from the caller's authenticated tenant context into every node/edge query, including subqueries and path traversals.
- **No arbitrary graph-query API** (SPEC §25): the API exposes scoped read-model endpoints only (`GET /sessions/:id/graph`, `GET /nodes/:id`, etc., SPEC §15); raw Cypher/graph-query passthrough is not exposed.
- Enforcement is verified by: property-based test "no cross-tenant graph path" (§21), required test "cross-tenant queries" (§21), and the cross-tenant security acceptance criterion (§25).
- Projection rebuilds and schema migrations must preserve tenant scoping (SPEC §4 migration-by-rebuild; §21 test "projection rebuild").

---

## 13. Risk Register

Reproduction of SPEC §24's 15 risks with the threat(s) each maps to and the control home in this document.

| # | Risk (SPEC §24) | Consequence | Mitigation (SPEC §24) | Related threats / controls |
|---|------------------|-------------|------------------------|----------------------------|
| R1 | Ontology too ambitious | Delivery failure | Base-node model; prioritize paths used by experiments | T-16: confidence qualification keeps ambitious edges honest (§5 T-16) |
| R2 | Kuzu Node binding limitations | Development delay | Encapsulate driver; retain SQLite; DuckDB fallback for analytics only | T-04: SQLite ledger is authoritative (ADR-001), projection rebuildable (§8) |
| R3 | Weak source telemetry | False causal precision | Confidence qualification; completeness metadata | T-03, T-16: confidence/causalBasis on every edge (§8, §10) |
| R4 | LLM model drift | Non-reproducible results | Pinned snapshots; store raw outputs | T-07/T-10: version declaration (§14), prompt/model manifests (§19), attestations (§22) |
| R5 | Benchmark contamination | Inflated performance | Hidden test labels; transformation manifests | T-05: isolated benchmark runner (§7 Z6), manifests (§19) |
| R6 | Expensive experiments | Incomplete evaluation | Small stratified dev set; cache immutable model outputs | T-13: token/cost caps (§6.4); cascade ≥40% call reduction (§19 Exp. 2) |
| R7 | Detector injection | Invalid findings | Isolation, structured evidence, no external tools | **T-07** (§5, §6) |
| R8 | Secret retention | Privacy breach | HMAC fingerprints, redaction profiles, raw-content disabled | T-10, T-11: §7.3, §9.1, §25 |
| R9 | Graph visual clutter | Unusable UI | Investigation presets and path-focused views | T-13: server-side filtering + 1,500-element cap (§17, §25) |
| R10 | Policy language creep | Reinventing Rego | Deliberately constrained policy grammar | T-12: Zod-validated limited grammar (§13, §11 of this doc) |
| R11 | Cross-adapter inconsistency | Invalid comparisons | Adapter conformance suite | T-01: conformance suite (§21 contract tests) |
| R12 | Misuse for surveillance | Organizational harm | Pseudonymization, purpose controls, documentation | **T-11**: §10 anti-surveillance controls |
| R13 | "Causal" overclaiming | Research credibility loss | Terminology section and mandatory confidence | T-16: §1, §8 confidence semantics |
| R14 | ADR comparison unfairness | Misleading conclusions | Compare public artifact behavior only | T-01: no production-claim attribution (§5 "Deliberately Rejected") |
| R15 | Solo engineer overload | Partial prototype | Defer production and universal integrations | Scope discipline (§4, §26); hardening milestone Week 8 (§23) |

---

## 14. Residual Risk Assessment and Open Security Questions

### 14.1 Residual Risk Summary

| Area | Residual risk | Rationale | Accepted? |
|------|---------------|-----------|-----------|
| Unsigned telemetry (T-02, T-17) | Medium | Most imports are unsigned; marking is `unverified`, but forged plausible telemetry from a compromised producer is indistinguishable | Accepted for MVP research use; re-evaluate for enforcement-grade deployments |
| Host compromise (T-08, T-09, T-12) | High at host layer | Single-workstation model trusts the operator's OS; a compromised host defeats app-layer controls (KEK co-located with data) | Accepted per SPEC §7 deployment model; SPEC §26 defers production hardening |
| Semantic detector injection (T-07) | Medium-High | Delimited evidence + sandbox reduce but cannot eliminate LLM injection; central research question (SPEC §2 H4) | Accepted as research scope; deterministic stages carry zero injection surface |
| Provider disclosure (T-10) | Low | Content modes + allowlisted endpoint + prompt manifests; depends on operator keeping raw mode disabled | Accepted with operator guidance |
| Key management ergonomics (T-08) | Medium | OS keyring/age/Argon2id passphrase all place KEK on the same host as ciphertext; no HSM/KMS in MVP | Accepted; KEK rotation supported (§7.2) |
| Reconstruction error (T-16) | Medium | Heuristic linking can mislabel workflows; confidence qualification mitigates, does not eliminate | Accepted; open question Q2 (SPEC §27) |
| Availability (T-13) | Low | Limits + quarantine + performance targets bound the envelope (§25) | Accepted |

### 14.2 Open Security Questions

From SPEC §27, mapped to this model:

1. **Q1 — Graph vs summarization:** is detection gain from the graph itself or better retrieval? Affects how much of T-07's mitigation is architectural vs prompt-engineering.
2. **Q2 — Reconstruction-error threshold:** at what error rate does the graph mislead more than a transcript? Directly bounds acceptable residual risk for T-16.
3. **Q3 — Confidence calibration:** can inferred-edge confidence be calibrated against human-labeled relations? Would let T-16's residual risk be quantified.
4. **Q4 — Exposure vs influence:** what minimum instrumentation distinguishes data exposure from data influence? Determines whether SENT_TO/RECEIVED_FROM edges (T-05/T-06) can be made observationally precise.
5. **Q5 — Meaningful approval:** how should meaningful human approval be measured? Feeds policy #5/#6 scope validation quality (T-12).
6. **Q6 — Content-block provenance without retention:** can runtimes expose content-block provenance without retaining sensitive raw content? Would convert T-10/T-11 residual risk into a structural guarantee (hash/reference-only pipelines).
7. **Q7 — Representing non-access:** how to represent "the agent did not access X" with incomplete telemetry? Bears on T-16 (absence of evidence vs evidence of absence) and on anti-surveillance accuracy (T-11).

Additional open questions introduced by this model:

- Should MVP ship a mandatory-signature mode for policy files (T-12) even though most producers cannot sign events?
- Does the sandbox's egress proxy need a mutual-TLS option for the model endpoint (T-10)?
- Can the KEK be moved to a separate device (FIDO2/age recipient) without breaking the one-command local DX (SPEC §3)?

### 14.3 Control Baseline (SPEC §25 Security Acceptance Criteria)

This model satisfies the 10 security acceptance criteria as follows: raw secrets disabled by default (§7.3, §9.1); keyed HMAC fingerprints (§7.3); no arbitrary graph-query API (§12.2); detector evidence separated from privileged instructions (§6.1, ADR-005); schema-validated detector output (§6.4); isolated benchmarks (§3 Z6); cross-tenant tests (§12.2); unsigned telemetry marked unverified (§8.4); versioned/hashed policy changes (§11.1); audited sensitive evidence access (§10, §8.3 audit logs).

---

## 15. SPEC Section Reference Map

| This document | SPEC.md sections |
|---------------|------------------|
| §1 Executive Summary | §1, §3, §7, §18, §25 |
| §2 Methodology | §4, §18, §23, §25 |
| §3 Trust zones | §7, §11, §12, §14, §17, §18 |
| §4 STRIDE | §8, §9, §10, §11, §12, §13, §14, §18, §19, §25 |
| §5 Threat register | §8, §9, §10, §11, §13, §14, §15, §17, §18, §19, §21, §25, §26 |
| §6 Detector sandbox | §14, §18, §19, §20, §22 |
| §7 Field-level encryption | §4, §8, §11, §16, §18, §24, §25 |
| §8 Integrity | §4, §6, §8, §9, §11, §19, §20, §21, §22, §25 |
| §9 Content security | §3, §4, §7, §8, §11, §15, §16, §18, §24, §25 |
| §10 Anti-surveillance | §4, §8, §15, §18, §24, §25, §26 |
| §11 Policy security | §8, §10, §13, §15, §16, §22, §25 |
| §12 Cross-tenant isolation | §4, §8, §9, §11, §15, §20, §21, §25 |
| §13 Risk register | §19, §21, §23, §24, §25, §26 |
| §14 Residual risk | §2, §3, §7, §25, §26, §27 |

