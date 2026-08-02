# TS_API_DESIGN.md — CATG TypeScript API Design Conventions

> Conventions for the Fastify API (`apps/api`), package public interfaces, and evidence-package JSON.
> Sources: ARCHITECTURE.md §9 (API Design Summary), SPEC.md §15 (API Design), §14 (Detector Framework / Evidence Package), §13 (Policy Engine), §25 (Acceptance Criteria), AGENTS.md (Package Contracts).

## 1. API Surface Overview

- **Base path:** `/api/v1` (SPEC.md §15).
- **Runtime:** Fastify (SPEC.md §7, §20).
- The API exposes 22 endpoints (SPEC.md §15) grouped by resource: imports, sessions, nodes/edges, evidence, policies, policy-evaluations, detections, incidents, experiments, schema, health.
- The UI app consumes the API only — **no direct DB access** from `apps/investigator-ui` (ARCHITECTURE.md §14).

## 2. Fastify + Zod Patterns

### 2.1 One route module per resource

Each resource family is a Fastify plugin registered on the base path, e.g. `sessions.routes.ts` registers `/sessions`, `/sessions/:id`, `/sessions/:id/timeline`, `/sessions/:id/graph`, `/sessions/:id/data-flows`.

### 2.2 Zod at every boundary

- `packages/schema` owns the Zod schemas (SPEC.md §20); route modules import them rather than re-declaring shapes.
- Every route declares `params`, `querystring`, `body`, and `response` schemas — request validation and response serialization are explicit, never ad hoc.
- The inferred TypeScript type of a schema is the source of truth for handlers: `type SessionListQuery = z.infer<typeof sessionListQuerySchema>`.
- Fastify's schema compiler is configured to use Zod; a validation failure is a **structured 400/422**, not a stack trace.

### 2.3 Command vs read endpoints

- **POST** for state-changing commands: `/imports`, `/policies/validate`, `/policy-evaluations`, `/detections`, `/incidents`, `/experiments/runs` (SPEC.md §15).
- **GET** for reads, with `:id` resources returning a single entity: `/imports/:id`, `/sessions/:id`, `/nodes/:id`, `/edges/:id`, `/evidence/:id`, `/policy-evaluations/:id`, `/detections/:id`, `/experiments/runs/:id` (SPEC.md §15).
- Replay is a command: `POST /policy-evaluations` takes policy, session, and `as-of-event` (SPEC.md §13); replay must not mutate the original decision (SPEC.md §21 T-list; ROADMAP Phase 3 acceptance).

### 2.4 Worked example — a Fastify + Zod route

```typescript
// apps/api/src/routes/sessions.ts (illustrative — schemas live in packages/schema)
import type { FastifyInstance } from 'fastify';
import { sessionSummaryParamsSchema, sessionSummaryResponseSchema } from '@catg/schema';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sessions/:id', {
    schema: {
      params: sessionSummaryParamsSchema,      // Zod — compiled into Fastify validation
      response: { 200: sessionSummaryResponseSchema, 404: errorSchema },
    },
  }, async (req, reply) => {
    const { id } = sessionSummaryParamsSchema.parse(req.params); // parsed & typed
    const summary = await req.sessionStore.summary(id);
    if (!summary) return reply.code(404).send({ error: { code: 'RESOURCE_NOT_FOUND', message: `no session ${id}` } });
    return summary; // serialized through the 200 response schema
  });
}
```

Handlers stay thin: validate → call a package interface (`query-sdk`, `event-ledger`, …) → serialize. Business logic lives in packages, never in route handlers (SPEC.md §20).

## 3. Error Handling Conventions

- Errors are returned in a stable envelope:

```json
{ "error": { "code": "RESOURCE_NOT_FOUND", "message": "no node with id ...", "details": {} } }
```

- **404** for unknown resource ids (`/nodes/:id`, `/edges/:id`, …); **400/422** for Zod validation failures; **500** only for genuinely unexpected faults.
- **Idempotent imports:** duplicate `POST /imports` succeed and return the existing result — deduplication is by `(tenant_id, dedupe_key)` (SPEC.md §9), never by rejecting on conflict.
- Import validation problems surface in the **validation/quarantine report** returned by `GET /imports/:id` (SPEC.md §15; ledger `quarantine_records`, SPEC.md §11).
- **Errors never leak raw evidence.** Evidence content is returned redacted per the requester's permission profile; raw secrets are not stored by default (SPEC.md §18, §25).
- Graph responses are truncated with a **`truncation` metadata field** (AGENTS.md "Performance Bounds"); the session-graph endpoint must respond ≤ 1s after server-side filtering (SPEC.md §25).

## 4. Package Public Interface Design

- Each package's public surface is `src/index.ts`; everything else is private (AGENTS.md "Package Contracts").
- `package.json` has an explicit `exports` field — consumers can only import the declared entry points (SPEC.md §20).
- **Explicit return types on all public functions**; inputs validated with Zod, never raw `as` casts (AGENTS.md "Code Style").
- `packages/schema` is the contract layer: canonical events, nodes, edges, policies, detectors (ARCHITECTURE.md §14). Other packages import schemas from it; `schema` must never depend on Kuzu, API, or UI (AGENTS.md).
- **No arbitrary graph-query API:** all graph reads go through `packages/query-sdk`; the API never accepts raw Cypher (SPEC.md §25; AGENTS.md).
- Schemas are versioned (`schemaVersion` on nodes/edges/events, SPEC.md §8–§9) and must evolve by additive change or new version, never mutation.

## 5. Evidence Package JSON Conventions

From SPEC.md §14 — evidence packages are **structured JSON**, never free-text concatenation of untrusted tool output (AGENTS.md; ADR-005):

```json
{
  "intent": "...",
  "principals": ["..."],
  "agents": ["..."],
  "authority": ["..."],
  "untrusted_inputs": ["..."],
  "sensitive_paths": [{ "path": "...", "edge_confidence": "observed" }],
  "effects": ["..."],
  "policy_decisions": ["..."],
  "unknowns": ["..."]
}
```

- Detectors receive **immutable evidence references** (ids + hashes), never writable source events; they must not write source events or add graph edges (SPEC.md §14).
- Evidence content is treated as **untrusted data** by detectors — never injected into privileged instructions (ADR-005).
- Detector output is validated against a **strict schema** before it is stored or displayed; malformed output fails closed (SPEC.md §14; ROADMAP Phase 6 acceptance).
- Exports: findings in a simplified **OCSF-compatible** shape; evidence bundles as **in-toto-style statements** (SPEC.md §4).

## 6. Endpoint Design Patterns (ARCHITECTURE.md §9)

- **Sessions:** list (`GET /sessions`, filtered), summary (`GET /sessions/:id`), timeline of chronological canonical events (`/sessions/:id/timeline`), investigation subgraph (`/sessions/:id/graph`, server-side filtered per SPEC.md §17), sensitive-data paths (`/sessions/:id/data-flows`).
- **Entities:** node details (`GET /nodes/:id`), edge assertion + provenance (`GET /edges/:id`), redacted evidence metadata/content (`GET /evidence/:id`).
- **Policies:** validate a policy document (`POST /policies/validate`) and evaluate/replay (`POST /policy-evaluations`), then fetch decision + explanation (`GET /policy-evaluations/:id`).
- **Detectors & incidents:** execute a detector (`POST /detections`), fetch its result (`GET /detections/:id`); create an investigation container (`POST /incidents`), fetch an evidence-backed narrative (`GET /incidents/:id/explanation`) — every claim in the narrative exposes Evidence, Policy inference, Detector judgment, or Unresolved hypothesis (SPEC.md §17).
- **Experiments:** run a local configuration (`POST /experiments/runs`), fetch metrics and artifact links (`GET /experiments/runs/:id`) (SPEC.md §19).
- **Registry & health:** `GET /schema` exposes the node, edge, and event registries (SPEC.md §15); `GET /health` reports process and storage health.

## 7. Performance and Security Constraints

- Session graph API ≤ 1s after filtering; graph payloads truncated with `truncation` metadata; UI never renders > 1,500 elements (SPEC.md §25; AGENTS.md).
- No raw secrets over the wire; keyed HMAC fingerprints instead; sensitive evidence access is audited (SPEC.md §25).
- Detector execution is sandboxed (network/tool access disabled unless explicitly allowed) and returns structured output only (SPEC.md §18).
- Contract tests cover the API OpenAPI contract (SPEC.md §21); API coverage target ≥ 80% (SPEC.md §21).
