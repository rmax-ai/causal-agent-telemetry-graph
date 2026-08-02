import { existsSync, unlinkSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventLedger } from '../index.js';

const TEST_DB = '/tmp/test-catg-ledger.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  if (existsSync(`${TEST_DB}-wal`)) unlinkSync(`${TEST_DB}-wal`);
  if (existsSync(`${TEST_DB}-shm`)) unlinkSync(`${TEST_DB}-shm`);
}

function makeEvent(
  overrides: Partial<{
    eventId: string;
    tenantId: string;
    dedupeKey: string;
  }> = {},
) {
  return {
    eventId: overrides.eventId ?? 'evt-001',
    schemaVersion: '1.0.0',
    eventType: 'session.observed',
    tenantId: overrides.tenantId ?? 'research',
    dedupeKey: overrides.dedupeKey ?? 'research|adr|sess-1|session.observed|2024-01-01|abc123',
    occurredAt: '2024-01-01T00:00:00Z',
    observedAt: '2024-01-01T00:00:01Z',
    producer: 'adapter-adr',
    canonicalJson: '{}',
    integrityHash: 'sha256:abc',
    previousHash: null as string | null,
  };
}

describe('EventLedger', () => {
  let ledger: EventLedger;

  beforeEach(() => {
    cleanup();
    ledger = new EventLedger(TEST_DB, { productionMode: true });
  });

  afterEach(() => {
    ledger.close();
    cleanup();
  });

  it('appends an event', () => {
    const inserted = ledger.append(makeEvent());
    expect(inserted).toBe(true);
    expect(ledger.count('research')).toBe(1);
  });

  it('rejects duplicate events via dedupeKey', () => {
    const event = makeEvent();
    expect(ledger.append(event)).toBe(true);
    expect(ledger.append(event)).toBe(false); // duplicate rejected
    expect(ledger.count('research')).toBe(1);
  });

  it('rejects UPDATE on events table', () => {
    ledger.append(makeEvent({ eventId: 'evt-001' }));
    expect(() => {
      ledger.db.exec("UPDATE events SET canonicalJson = '{}' WHERE eventId = 'evt-001'");
    }).toThrow(/append-only/);
  });

  it('rejects DELETE on events table', () => {
    ledger.append(makeEvent({ eventId: 'evt-001' }));
    expect(() => {
      ledger.db.exec("DELETE FROM events WHERE eventId = 'evt-001'");
    }).toThrow(/append-only/);
  });

  it('appends events in batch', () => {
    const events = [
      makeEvent({ eventId: 'evt-001', dedupeKey: 'research|a' }),
      makeEvent({ eventId: 'evt-002', dedupeKey: 'research|b' }),
      makeEvent({ eventId: 'evt-003', dedupeKey: 'research|c' }),
    ];
    const count = ledger.appendBatch(events);
    expect(count).toBe(3);
  });

  it('quarantines bad events', () => {
    ledger.quarantine('research', '{"bad": "json"}', 'ValidationError: missing eventId');
    const row = ledger.db.prepare('SELECT * FROM quarantine_records LIMIT 1').get() as Record<
      string,
      unknown
    >;
    expect(row.tenantId).toBe('research');
    expect(row.error).toContain('ValidationError');
  });

  it('separates tenants', () => {
    ledger.append(makeEvent({ tenantId: 'tenant-a', dedupeKey: 'a|x' }));
    ledger.append(makeEvent({ tenantId: 'tenant-b', dedupeKey: 'b|x' }));
    expect(ledger.count('tenant-a')).toBe(1);
    expect(ledger.count('tenant-b')).toBe(1);
  });

  it('records projection checkpoints', () => {
    ledger.append(makeEvent({ eventId: 'evt-001' }));
    ledger.checkpoint('evt-001', 'sha256:snapshot1');
    const cp = ledger.getLatestCheckpoint();
    expect(cp).toBeDefined();
    expect(cp?.snapshotHash).toBe('sha256:snapshot1');
  });
});
