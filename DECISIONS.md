# DECISIONS.md — CATG Architecture Decisions

> Record of the architecture decisions behind CATG, with rationale and rejected alternatives.
> The six architecture decision records are extracted from SPEC.md §7 and expanded in `docs/adr/ADR-001.md` … `ADR-006.md`.
> Ground truth remains SPEC.md; this document adds no new decisions beyond those stated there.

## 1. The Six Architecture Decisions (SPEC.md §7)

| ADR | Decision | Rationale (per SPEC.md) |
|-----|----------|-------------------------|
| ADR-001 | **Immutable ledger + graph projection** — SQLite append-only event ledger is authoritative; Kuzu is a rebuildable materialized projection | Out-of-order heterogeneous sources (§3); evidence must precede derived graph state (§4); rebuildable projection and append-only events are acceptance criteria (§25); Kuzu driver limitations are encapsulated so SQLite remains the durable truth (§24) |
| ADR-002 | **Typed property graph, not RDF runtime** — PROV semantics specialized into a property graph for TypeScript ergonomics | W3C PROV-DM/O adopted with "No RDF/OWL runtime" as deliberate non-alignment (§6); research-grade TypeScript monorepo (§1, §20) |
| ADR-003 | **Deterministic policies before semantic detectors** — rules execute first, reducing cost and improving reproducibility | Fast/cheap triage before deep analysis is adopted from ADR (§5); cascade target ≥40% semantic-call reduction (§19, Experiment 2); reproducibility requires deterministic replay (§22) |
| ADR-004 | **Edge assertions are immutable evidence** — old assertions remain auditable | Every non-observed relation carries method, confidence, and evidence (§3, §8); policy replay must not mutate original decisions (§21); assertions are ledger events (`edge.asserted`, §9) |
| ADR-005 | **No raw evidence in system instructions** — untrusted content passed as delimited data | Adversarial imported data constraint (§3); detector must treat evidence as untrusted data (§14); detector prompt injection is a modeled threat (§18); isolation conditions tested in Experiment 3 (§19) |
| ADR-006 | **Preserve source telemetry extensions** — canonical events retain a bounded `extensions` object | OpenTelemetry attributes preserved without depending on unstable attribute names (§6); cross-adapter consistency requires preserving source-specific fields (§24) |

Full context/decision/consequences for each: `docs/adr/ADR-001.md` … `ADR-006.md`.

### Why these six, and why now

- They are the decisions that **cannot be reversed cheaply later**: changing the source of truth (ADR-001), the graph substrate (ADR-002), the evaluation order (ADR-003), or the evidence model (ADR-004, ADR-005, ADR-006) after implementation would invalidate stored data, experiments, or the threat model.
- Each maps to a stated constraint in SPEC.md §3 (solo engineer, adversarial imports, reproducibility, local setup) and to acceptance criteria in §25 — they are load-bearing for the research design, not stylistic choices.
- ROADMAP Phase 0 lists writing ADR-001…ADR-006 as the first documentation task; they are recorded here before implementation so later phases can cite them.

## 2. Key Design Decisions

### 2.1 Embedded Kuzu over an external graph database

- **Decision:** Embedded, local graph storage (Kuzu) with no external graph service (SPEC.md §7, §11).
- **Why:** The dominant constraints are a solo engineer, part-time, 6–8 weeks, and a local developer experience with one-command setup — no Kubernetes, Kafka, or external graph service (§3). The deployment model is a local workstation (§7). Storage roles are fixed: SQLite ledger, Kuzu projection, content-addressed directory, DuckDB/Parquet analytics (§11).
- **Risk accepted:** Kuzu node-binding limitations may cause development delay; mitigated by encapsulating the driver, retaining SQLite as truth, and keeping DuckDB as an analytics-only fallback (§24).
- **What this means in practice:** the graph is a materialized view, not a service — any machine with the ledger can rebuild the projection (SPEC.md §4, ADR-001).

### 2.2 TypeScript over Python for the core

- **Decision:** The core pipeline (schema, ledger, graph, policies, detectors) is TypeScript; Python is limited to the ADR Sensor bridge and benchmark tooling (SPEC.md §12, §20).
- **Why:** CATG deliberately rejects copying ADR's Python architecture into its TypeScript core (§5 "Deliberately Rejected"). Python bridges invoke ADR Sensor only — **no policy or graph logic in Python** (§12). Python is 3.12+ and invoked as a subprocess, with no pip packages beyond the bridge (AGENTS.md).
- **What this means in practice:** the TypeScript packages are the only place policy and graph logic may live; `python/` is a thin adapter shell for ADR Sensor and Docker-isolated benchmarks (SPEC.md §7, §12).

### 2.3 Property graph over RDF

- **Decision:** A typed property graph specializing PROV semantics, with no RDF/OWL runtime (ADR-002; SPEC.md §6, §7).
- **Why:** TypeScript ergonomics (§7), research-grade monorepo constraints (§1), and no dependence on an RDF stack that adds runtime complexity without serving the graph-path investigation use case (§11 Kuzu model).
- **What this means in practice:** the ontology registry (`packages/graph-model`, SPEC.md §20) is a typed registry — node/edge types map to Zod schemas and TS types, with the PROV mapping table (SPEC.md §6) as the semantic reference (NODES.md, EDGES.md).

### 2.4 Append-only ledger as the source of truth

- **Decision:** The immutable event ledger is authoritative; the graph is always rebuildable from it (ADR-001; SPEC.md §7).
- **Why:** Immutable evidence before derived graph state is an MVP must (§4); idempotency via dedupe keys requires stable append semantics (§9); append-only is enforced by triggers rejecting UPDATE/DELETE outside test builds (§11).
- **What this means in practice:** all derived artifacts — graph, policies, detector evidence — trace back to immutable ledger events; corrections are new events, never edits (SPEC.md §9; AGENTS.md rule 1).

## 3. Rejected Alternatives and Why

| Rejected | Why (SPEC.md reference) |
|----------|-------------------------|
| RDF/OWL runtime | Deliberate non-alignment with PROV-DM/O (§6); TypeScript property-graph ergonomics (ADR-002) |
| External graph DB / Kubernetes / Kafka | Constraint: no external graph service, one-command local setup (§3, §7) |
| DuckDB as the graph store | DuckDB's assigned role is analytical comparison only; Kuzu owns path traversal and investigation (§11) |
| Rego-style policy language | "Policy language creep — reinventing Rego" is a tracked risk; grammar deliberately constrained (§13, §24) |
| Chronology as sufficient evidence of causation | Deliberately rejected (§5); temporal proximity alone yields `PRECEDED_BY`, never `CAUSED` (§10) |
| Treating all message content as required telemetry | Deliberately rejected (§5); content minimization and no mandatory raw prompts (§3, §18) |
| Binding CATG's schema to ADR's threat taxonomy | Deliberately rejected (§5); vendor neutrality (§3) |
| Reimplementing ADR Explorer / copying ADR's Python architecture | Deliberately rejected (§5) |
| Statistical causal inference claims | Explicitly out of scope; "causal" means qualified workflow causation (§1, §3) |
| Reconstructing events source telemetry never exposed | Out of scope — the graph cannot invent evidence the source never recorded (§3, §26) |
| Raw transcript as the primary analysis representation | Rejected by the research hypothesis itself — graph-based detection is the object of study (§2) |

## 4. Explicitly Out of Scope / Deferred

Production endpoint management, real-time prevention, distributed event streaming, clustered graph storage, enterprise SSO, fine-grained RBAC, policy authoring UI, universal harness adapters, model-execution replay, automatic incident remediation, statistical causal inference, continuous employee monitoring, production ADR Explorer (SPEC.md §3, §26).

## 5. Decision Review

- These decisions are **provisional by design**: the project's null hypothesis is that graph representation provides no measurable improvement over transcript-only detection (SPEC.md §2). If experiments falsify the hypothesis, decisions that assumed graph value (ADR-002's substrate, ADR-003's order) are candidates for reversal — the ledger-first design (ADR-001, ADR-004) is what makes such a reversal cheap.
- Open research questions — e.g., whether gains come from the graph itself or from better summarization/retrieval, and whether inferred-edge confidence can be calibrated against human-labeled relations — are tracked in SPEC.md §27 and may prompt amendments to these records.
- New decisions that change stored data semantics, the evidence model, or evaluation order should be recorded as amendments to the relevant ADR rather than buried in commit messages.
