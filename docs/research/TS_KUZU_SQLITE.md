# Kuzu + SQLite Patterns — Embedded Graph Projection over an Append-Only Ledger

> Companion research doc for CATG. Applies to `packages/event-ledger` (SQLite via better-sqlite3)
> and `packages/graph-projection` (Kuzu). Library versions current as of Aug 2026:
> `kuzu` npm 0.11.x, `better-sqlite3` 11.x/12.x, Node.js 22+.
>
> Sources: kuzudb.github.io/api-docs/nodejs, kuzudb.github.io/docs (Cypher reference),
> WiseLibs/better-sqlite3 docs/api.md + docs/performance.md, SPEC.md §11, ADR-001.
>
> ⚠️ KuzuDB was archived upstream (Oct 2025) and the project is transitioning; prior releases
> (pin `kuzu@0.11.3`) remain usable unchanged.

## 1. Architecture: no direct Kuzu↔SQLite link

SQLite and Kuzu are separate embedded engines. There is **no foreign key, ATTACH, or shared
catalog** between them — the link is a *projection pipeline* (ADR-001):

```
better-sqlite3 (ledger, authoritative)  →  read canonical events  →  transform  →  Kuzu (rebuildable view)
```

- **Direction is one-way**: the ledger is the source of truth; Kuzu is rebuilt from it. Never
  write graph state back into the ledger, and never treat Kuzu as authoritative.
- **Identity link is logical**: Kuzu node primary keys are the same opaque `urn:catg:{tenant}:...`
  strings used in the ledger (AGENTS.md: node IDs are opaque — validate, never parse).
- **Rebuild**: `DROP TABLE` + re-project from the ledger; verify by snapshot hash
  (sorted serialized graph → sha256) to prove rebuild reproducibility (SPEC.md §11, ROADMAP
  Phase 1 acceptance).

## 2. Kuzu Node.js API basics

```ts
import { Database, Connection } from "kuzu";

// Path-backed DB, or ":memory:" for tests. Optional 2nd arg: buffer pool size in bytes.
const db = new Database("./data/graph", 512 * 1024 * 1024);
// Optional 2nd arg: number of worker threads.
const conn = new Connection(db, 4);

// Schema (DDL is idempotent-friendly with IF NOT EXISTS)
await conn.query(`
  CREATE NODE TABLE IF NOT EXISTS Principal(
    id STRING, kind STRING, PRIMARY KEY (id)
  );
`);
await conn.query(`
  CREATE NODE TABLE IF NOT EXISTS Agent(
    id STRING, name STRING, PRIMARY KEY (id)
  );
`);
await conn.query(`
  CREATE REL TABLE IF NOT EXISTS INITIATED(
    FROM Principal TO Agent, assertedAt TIMESTAMP, confidence STRING
  );
`);
```

- Node tables need an explicit `PRIMARY KEY`; rel (edge) tables declare `FROM X TO Y` endpoints
  and optional properties.
- All `conn.query(...)` calls are **async** and return a `QueryResult` (sync variants
  `querySync`/`prepareSync`/`executeSync` exist but block the main thread — scripts only).

## 3. Inserts: prepared statements + parameterized Cypher

```ts
const insertPrincipal = await conn.prepare(`
  MERGE (p:Principal {id: $id})
  ON CREATE SET p.kind = $kind
`);

// Parameters are a plain object keyed by $name. Allowed value types:
// boolean | number | string | Date | BigInt — lists/arrays are NOT yet supported
// (kuzudb/kuzu#4582), so pass IDs one at a time, not as arrays.
await conn.execute(insertPrincipal, { id: "urn:catg:acme:adr:alice", kind: "human" });
```

Edge creation requires matching both endpoints (rel tables always connect existing nodes).
Parameterized queries go through `prepare` + `execute` (the documented signature of
`conn.query` takes a statement only):

```ts
const createInitiated = await conn.prepare(`
  MATCH (p:Principal {id: $p}), (a:Agent {id: $a})
  CREATE (p)-[:INITIATED {assertedAt: $at, confidence: 'observed'}]->(a)
`);
await conn.execute(createInitiated, { p: "...", a: "...", at: new Date() });
```

Batch strategy for projection: prepare once, `execute` per row; wrap the whole batch in a
transaction (see §5) — do **not** issue one `conn.query` per event without batching.

## 4. Queries and result iteration

```ts
const result = await conn.query(`
  MATCH (p:Principal)-[r:INITIATED]->(a:Agent)
  RETURN p.id AS principal, a.id AS agent, r.confidence AS confidence
`);

const rows = await result.getAll(); // array of plain objects keyed by alias:
// [ { principal: 'urn:catg:...', agent: 'urn:catg:...', confidence: 'observed' }, ... ]

// Streaming alternative for large result sets:
while (result.hasNext()) {
  const row = await result.getNext();
  // row is an object keyed by alias
}
await result.close(); // free native memory — see §6
```

Safe graph access (SPEC.md §25: no arbitrary user Cypher) means the API layer only ever calls
**parameterized, allow-listed** queries from `packages/query-sdk`.

## 5. Transactions

Kuzu has no dedicated transaction API — use Cypher transaction statements:

```ts
await conn.query("BEGIN");
try {
  await conn.execute(insertPrincipal, { id: a, kind: "human" });
  await conn.execute(insertPrincipal, { id: b, kind: "service" });
  await conn.query("COMMIT");
} catch (err) {
  await conn.query("ROLLBACK");
  throw err;
}
```

## 6. Resource lifecycle (native bindings)

Kuzu's Node client wraps C++ objects; close order matters to avoid corrupted memory:

```text
close QueryResult / PreparedStatement handles  →  conn.close()  →  db.close()
```

```ts
// Always close in this order:
await result.close();
await conn.close();
await db.close();
```

## 7. better-sqlite3 ledger patterns (`packages/event-ledger`)

better-sqlite3 is **synchronous** (faster than async wrappers for local file I/O). Open once at
startup, set pragmas, prepare statements once, reuse.

```ts
import Database from "better-sqlite3";

const db = new Database(ledgerPath, { timeout: 5000 });
db.pragma("journal_mode = WAL"); // readers don't block writers
db.pragma("synchronous = NORMAL"); // WAL-safe; FULL if you need max durability
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id   TEXT NOT NULL,
    tenant_id  TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    payload    TEXT NOT NULL,
    sha256     TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    UNIQUE (tenant_id, dedupe_key)   -- idempotency: SPEC.md §9 formula
  );
`);

// Prepared statement — compile once, bind per row
const insert = db.prepare(`
  INSERT OR IGNORE INTO events (event_id, tenant_id, dedupe_key, payload, sha256, observed_at)
  VALUES (@eventId, @tenantId, @dedupeKey, @payload, @sha256, @observedAt)
`);
```

### 7.1 Transactions (`.transaction()`)

```ts
const appendMany = db.transaction((events: CanonicalEvent[]) => {
  let appended = 0;
  for (const ev of events) {
    const info = insert.run({
      eventId: ev.eventId, tenantId: ev.tenantId,
      dedupeKey: computeDedupeKey(ev), payload: JSON.stringify(ev),
      sha256: ev.integrityHash, observedAt: ev.occurredAt,
    });
    // info.changes === 0 → INSERT OR IGNORE hit the unique index → duplicate
    appended += info.changes;
  }
  return appended;
});

const count = appendMany(batch); // runs inside BEGIN…COMMIT automatically
```

- `.transaction(fn)` wraps the function in BEGIN/COMMIT; `txn.immediate(...)` takes the write
  lock up front (avoids deferred-upgrade deadlocks under concurrency).
- Never mix raw `BEGIN`/`COMMIT` strings with `.transaction()` — pick one style.
- Because better-sqlite3 is synchronous, Node's event loop serializes writes naturally; keep
  write transactions short.

### 7.2 Append-only enforcement (AGENTS.md rule 1)

Triggers reject UPDATE/DELETE on `events` outside test builds (SPEC.md §11):

```sql
CREATE TRIGGER IF NOT EXISTS events_no_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'append-only: UPDATE on events is forbidden');
END;

CREATE TRIGGER IF NOT EXISTS events_no_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'append-only: DELETE on events is forbidden');
END;
```

Test builds that need to reset the ledger `DROP TRIGGER` first (and never ship that path).

### 7.3 Deduplication

- Idempotency key per SPEC.md §9:
  `SHA256(tenant_id || source_kind || source_record_id || normalized_event_type || normalized_occurred_at || canonical_payload_hash)`.
- The `UNIQUE (tenant_id, dedupe_key)` index + `INSERT OR IGNORE` makes re-imports idempotent:
  duplicates return `info.changes === 0` and are counted as duplicate/quarantined, never
  double-appended. Use `INSERT OR IGNORE` (not `ON CONFLICT DO NOTHING` on the whole row) so the
  UNIQUE constraint is the single dedupe arbiter.

## 8. Projection pattern (SQLite → Kuzu)

```ts
export async function projectLedger(db: Database, conn: Connection): Promise<ProjectionStats> {
  const rows = db.prepare(
    `SELECT payload FROM events WHERE event_id > @afterSeq ORDER BY seq`
  ).all({ afterSeq: checkpointSeq });

  await conn.query("BEGIN");
  try {
    for (const { payload } of rows) {
      const ev = JSON.parse(payload) as CanonicalEvent;
      await upsertNode(conn, ev);   // prepared MERGE per node type
      await upsertEdges(conn, ev);  // only ledger-asserted edges (SPEC.md §8)
    }
    await conn.query("COMMIT");
  } catch (err) {
    await conn.query("ROLLBACK");
    throw err;
  }
  // record projection_checkpoints row in SQLite; verify with snapshot hash
  return { projected: rows.length };
}
```

Checklist:

- Every node/edge written to Kuzu must already exist as a ledger event (AGENTS.md:
  "Every edge assertion is an event in the ledger — never write edges directly to Kuzu").
- Store `projection_checkpoints` in SQLite so incremental projection can resume
  (`event_id > @afterSeq`); after a full re-project, serialize nodes+edges sorted, hash, and
  compare against the stored snapshot hash for rebuild determinism.
- Use `:memory:` Kuzu in tests for speed; identical projection code, no I/O.
