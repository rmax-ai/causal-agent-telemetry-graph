# CATG — Causal Agent Telemetry Graph

**Append-only telemetry and evidence layer for agent workflow security analysis.**

CATG ingests heterogeneous agent traces (ADR, OpenTelemetry, MCP) into an immutable event ledger, projects them into an explicit causal/provenance graph, evaluates deterministic security policies, and runs reproducible experiments comparing graph-based vs transcript-only security detection.

> ⚠️ **Research prototype.** This is not a production security product. See [Non-Goals](#non-goals) and [Relationship to ADR](#relationship-to-uber-adr).

---

## Hypothesis

For multi-step agent workflows involving indirect prompt injection, credential movement, approval boundaries, delegation, or cross-tool effects, a **selectively retrieved causal/provenance graph produces higher detection quality and more faithful explanations** than a raw transcript classifier at comparable model-token cost.

[Read the full research design →](SPEC.md#2-research-hypothesis)

---

## Architecture

```
ADR / OTel / MCP / SDK / Benchmarks
        ↓
   Source Adapters
        ↓
   Validate → Redact → Append-Only Event Ledger (SQLite)
        ↓
   Identity Resolution → Causal Linker → Kuzu Graph Projection
        ↓
   Policy Engine (deterministic) → Detector Framework (semantic)
        ↓
   Evidence Package Builder → API / CLI / Investigation UI
```

**Core principle:** The SQLite event ledger is authoritative. Kuzu is a rebuildable materialized projection.

[Full architecture →](docs/architecture/ARCHITECTURE.md)

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Heterogeneous ingestion** | ADR AgentEvent JSON/JSONL, OTLP JSON spans, MCP client/server events, direct SDK |
| **Append-only ledger** | SQLite with hash-chained immutable canonical events, deduplication, quarantine |
| **Typed property graph** | 28 node types, 27 edge types, PROV-specialized, embedded Kuzu — no external graph DB |
| **Confidence-qualified edges** | Every non-observed relation carries method, confidence score, evidence references, linker version |
| **Deterministic policies** | 6 graph-predicate policies (credential exfiltration, production mutation, delegation attenuation, etc.) |
| **Detector framework** | Transcript LLM, graph-summary LLM, deterministic rules, hybrid cascades — all with immutable evidence references |
| **Investigation UI** | Next.js + React Flow: causal graph, timeline, evidence inspector, data-flow paths, policy decisions, transcript-vs-graph comparison |
| **Reproducible experiments** | 3 controlled experiments with in-toto attestations, pinned models, transformation manifests |
| **Content security** | HMAC secret fingerprinting, configurable redaction, detector sandbox, anti-surveillance defaults |

---

## Quick Start

> Coming in v0.1.0. See [ROADMAP.md](docs/ROADMAP.md) for milestone progress.

```bash
# One-command setup
git clone https://github.com/rmax/causal-agent-telemetry-graph
cd causal-agent-telemetry-graph
pnpm install
pnpm dev

# Import ADR telemetry
catg import adr fixtures/adr/credential-exfiltration.json --tenant research

# Evaluate policy
catg policy evaluate --policy policies/default/no-credential-exfiltration.yaml --session sess-17

# Run experiment
catg experiment run experiments/transcript-vs-graph/config.yaml
```

---

## Repository Structure

```
causal-agent-telemetry-graph/
├── apps/
│   ├── api/                    # Fastify REST API
│   ├── investigator-ui/        # Next.js App Router investigation interface
│   └── cli/                    # catg CLI binary
├── packages/                   # 20 library packages (see ARCHITECTURE.md §14)
├── python/                     # ADR bridge + benchmark runner
├── policies/default/           # Graph policy definitions (YAML)
├── experiments/                # Experiment configurations
├── datasets/                   # Benchmark fixtures and splits
├── docs/                       # Architecture, threat model, ontology, mappings
└── SPEC.md                     # Ground-truth specification
```

---

## Relationship to Uber ADR

CATG builds on Uber's [ADR](https://github.com/uber-research/agent-defense-research) by extending the session-transcript model into an explicit causal graph:

| ADR provides | CATG adds |
|-------------|-----------|
| Workflow-level security analysis | Append-only event ledger with hash chain |
| Session transcripts | Typed causal/provenance graph (28 nodes, 27 edges) |
| Fast triage + deep reasoning | Deterministic graph policies + semantic cascade |
| ADR-Bench tasks | Graph-condition experiments, detector-injection tests |
| Chronological ordering | Confidence-qualified causal links (observed → speculative) |

CATG accepts ADR Sensor output without requiring modifications to ADR. It does NOT replicate ADR Explorer or claim ADR's production deployment capabilities.

---

## Three Experiments

1. **Transcript vs Causal Graph** — Does graph retrieval improve detection F1, cost, and explanation faithfulness?
2. **Deterministic + Semantic Cascade** — Can deterministic graph policies reduce semantic-model calls by ≥40% while preserving recall?
3. **Attack the Detector** — Does structured evidence packaging reduce detector prompt-injection success?

[Full experimental design →](SPEC.md#19-experimental-design)

---

## Non-Goals

CATG is explicitly NOT:
- A production policy-enforcement proxy or real-time prevention system
- A general-purpose observability backend or SIEM replacement
- A graph-RAG product or employee-productivity scoring system
- A guarantee of deterministic model replay
- Statistical causal inference (our "causal" = workflow causation supported by observed identifiers)

---

## Documentation

| Document | Contents |
|----------|----------|
| [SPEC.md](SPEC.md) | Complete ground-truth specification (all 27 sections) |
| [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) | System architecture, components, ADRs, storage design |
| [THREAT_MODEL.md](docs/threat-model/THREAT_MODEL.md) | 17-threat register, STRIDE mapping, encryption design, anti-surveillance |
| [ROADMAP.md](docs/ROADMAP.md) | 8-week milestone plan with acceptance criteria |
| [AGENTS.md](AGENTS.md) | AI coding agent conventions (Codex, Droid) |

---

## License

MIT — see [LICENSE](LICENSE).

## Status

🔬 Research prototype. v0.1.0 in development. 6–8 week MVP target.
