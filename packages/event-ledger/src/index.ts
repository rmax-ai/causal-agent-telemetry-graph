/**
 * CATG Event Ledger — SQLite append-only canonical event store.
 *
 * The event ledger is the source of truth. Kuzu is a rebuildable projection.
 * Enforced constraints:
 * 1. Append-only: UPDATE/DELETE on events table are blocked via triggers (outside test builds)
 * 2. Deduplication: UNIQUE(tenantId, dedupeKey) prevents duplicate imports
 * 3. Quarantine: malformed events stored in quarantine_records table
 * 4. Checkpoints: projection rebuild progress tracked via projection_checkpoints
 */
import Database, { type Database as DatabaseType } from 'better-sqlite3';

export interface EventRecord {
  eventId: string;
  schemaVersion: string;
  eventType: string;
  tenantId: string;
  dedupeKey: string;
  occurredAt: string;
  observedAt: string;
  producer: string;
  canonicalJson: string;
  integrityHash: string;
  previousHash: string | null;
  createdAt: number;
}

export interface QuarantineRecord {
  recordId: number;
  tenantId: string;
  rawJson: string;
  error: string;
  createdAt: number;
}

export interface ProjectionCheckpoint {
  checkpointId: number;
  lastEventId: string | null;
  lastEventCreatedAt: number;
  snapshotHash: string;
  createdAt: number;
}

export interface LedgerConfig {
  /** If true, UPDATE/DELETE triggers are disabled (test builds set this to false) */
  productionMode: boolean;
}

const DEFAULT_CONFIG: LedgerConfig = { productionMode: true };

export class EventLedger {
  readonly db: DatabaseType;
  private config: LedgerConfig;

  constructor(dbPath: string, config: Partial<LedgerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        eventId       TEXT NOT NULL,
        schemaVersion TEXT NOT NULL,
        eventType     TEXT NOT NULL,
        tenantId      TEXT NOT NULL,
        dedupeKey     TEXT NOT NULL,
        occurredAt    TEXT NOT NULL,
        observedAt    TEXT NOT NULL,
        producer      TEXT NOT NULL DEFAULT '',
        canonicalJson TEXT NOT NULL,
        integrityHash TEXT NOT NULL,
        previousHash  TEXT,
        createdAt     INTEGER NOT NULL DEFAULT (unixepoch('subsec')),
        UNIQUE(tenantId, dedupeKey)
      );

      CREATE INDEX IF NOT EXISTS idx_events_tenant_type
        ON events(tenantId, eventType);

      CREATE INDEX IF NOT EXISTS idx_events_created_at
        ON events(createdAt);

      CREATE TABLE IF NOT EXISTS quarantine_records (
        recordId  INTEGER PRIMARY KEY AUTOINCREMENT,
        tenantId  TEXT NOT NULL,
        rawJson   TEXT NOT NULL,
        error     TEXT NOT NULL,
        createdAt INTEGER NOT NULL DEFAULT (unixepoch('subsec'))
      );

      CREATE TABLE IF NOT EXISTS projection_checkpoints (
        checkpointId        INTEGER PRIMARY KEY AUTOINCREMENT,
        lastEventId         TEXT,
        lastEventCreatedAt  INTEGER NOT NULL DEFAULT 0,
        snapshotHash        TEXT NOT NULL,
        createdAt           INTEGER NOT NULL DEFAULT (unixepoch('subsec'))
      );
    `);

    if (this.config.productionMode) {
      this.enableAppendOnly();
    }
  }

  /** Enable append-only triggers that reject UPDATE/DELETE on the events table */
  enableAppendOnly(): void {
    // Remove any existing triggers first (idempotent)
    this.db.exec(`
      DROP TRIGGER IF EXISTS trg_events_no_update;
      DROP TRIGGER IF EXISTS trg_events_no_delete;
    `);

    this.db.exec(`
      CREATE TRIGGER trg_events_no_update
      BEFORE UPDATE ON events
      BEGIN
        SELECT RAISE(ABORT, 'events table is append-only: UPDATE rejected');
      END;

      CREATE TRIGGER trg_events_no_delete
      BEFORE DELETE ON events
      BEGIN
        SELECT RAISE(ABORT, 'events table is append-only: DELETE rejected');
      END;
    `);
  }

  /** Disable append-only triggers (for test builds) */
  disableAppendOnly(): void {
    this.db.exec(`
      DROP TRIGGER IF EXISTS trg_events_no_update;
      DROP TRIGGER IF EXISTS trg_events_no_delete;
    `);
  }

  /** Append a canonical event. Returns true if inserted, false if duplicate. */
  append(record: Omit<EventRecord, 'createdAt'>): boolean {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO events
        (eventId, schemaVersion, eventType, tenantId, dedupeKey,
         occurredAt, observedAt, producer, canonicalJson, integrityHash, previousHash)
      VALUES
        (@eventId, @schemaVersion, @eventType, @tenantId, @dedupeKey,
         @occurredAt, @observedAt, @producer, @canonicalJson, @integrityHash, @previousHash)
    `);

    const result = stmt.run({
      eventId: record.eventId,
      schemaVersion: record.schemaVersion,
      eventType: record.eventType,
      tenantId: record.tenantId,
      dedupeKey: record.dedupeKey,
      occurredAt: record.occurredAt,
      observedAt: record.observedAt,
      producer: record.producer,
      canonicalJson: record.canonicalJson,
      integrityHash: record.integrityHash,
      previousHash: record.previousHash ?? null,
    });

    return result.changes > 0;
  }

  /** Append multiple events in a transaction. Returns count of new events inserted. */
  appendBatch(records: Omit<EventRecord, 'createdAt'>[]): number {
    const txn = this.db.transaction(() => {
      let count = 0;
      for (const record of records) {
        if (this.append(record)) count++;
      }
      return count;
    });
    return txn();
  }

  /** Quarantine a malformed event for later inspection */
  quarantine(tenantId: string, rawJson: string, error: string): void {
    this.db
      .prepare(`
      INSERT INTO quarantine_records (tenantId, rawJson, error)
      VALUES (@tenantId, @rawJson, @error)
    `)
      .run({ tenantId, rawJson, error });
  }

  /** Get events for a tenant in creation order */
  getEvents(tenantId: string, limit = 100, offset = 0): EventRecord[] {
    return this.db
      .prepare(`
      SELECT * FROM events
      WHERE tenantId = @tenantId
      ORDER BY createdAt ASC
      LIMIT @limit OFFSET @offset
    `)
      .all({ tenantId, limit, offset }) as EventRecord[];
  }

  /** Get event count for a tenant */
  count(tenantId: string): number {
    const row = this.db
      .prepare(`
      SELECT COUNT(*) as cnt FROM events WHERE tenantId = @tenantId
    `)
      .get({ tenantId }) as { cnt: number };
    return row.cnt;
  }

  /** Record a projection checkpoint */
  checkpoint(lastEventId: string | null, snapshotHash: string): void {
    // Find the createdAt of the last event, or use 0
    let lastEventCreatedAt = 0;
    if (lastEventId) {
      const row = this.db
        .prepare(`
        SELECT createdAt FROM events WHERE eventId = @eventId
      `)
        .get({ eventId: lastEventId }) as { createdAt: number } | undefined;
      if (row) lastEventCreatedAt = row.createdAt;
    }

    this.db
      .prepare(`
      INSERT INTO projection_checkpoints (lastEventId, lastEventCreatedAt, snapshotHash)
      VALUES (@lastEventId, @lastEventCreatedAt, @snapshotHash)
    `)
      .run({ lastEventId, lastEventCreatedAt, snapshotHash });
  }

  /** Get the most recent projection checkpoint */
  getLatestCheckpoint(): ProjectionCheckpoint | undefined {
    return this.db
      .prepare(`
      SELECT * FROM projection_checkpoints ORDER BY checkpointId DESC LIMIT 1
    `)
      .get() as ProjectionCheckpoint | undefined;
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }
}
