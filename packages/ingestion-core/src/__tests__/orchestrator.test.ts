import { canonicalize } from '@catg/canonical-json';
import { EventLedger } from '@catg/event-ledger';
import { type CanonicalEventEnvelope, canonicalPayloadHash, computeDedupeKey } from '@catg/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeIntegrityHash, importEvents } from '../index.js';

const TS = '2026-08-02T10:00:00.000Z';

/** Build a structurally valid canonical event envelope with a correct integrity hash. */
function makeEnvelope(overrides: Partial<CanonicalEventEnvelope> = {}): CanonicalEventEnvelope {
  const base: CanonicalEventEnvelope = {
    eventId: 'evt-1',
    schemaVersion: '1.0.0',
    eventType: 'session.observed',
    occurredAt: TS,
    observedAt: '2026-08-02T10:00:01.000Z',
    producer: { sourceKind: 'adr', sourceId: 'sess-42' },
    subject: { tenantId: 'acme', sessionId: 'sess-42' },
    traceContext: {},
    identityContext: {},
    payload: { sessionId: 'sess-42', source: 'adr', startedAt: TS },
    provenance: [],
    securityClassification: { classification: 'internal', handling: [] },
    integrityHash: '',
    extensions: {},
  };
  const merged = { ...base, ...overrides } as CanonicalEventEnvelope & { _skipHash?: boolean };
  // Only recompute if the caller didn't explicitly set a hash
  if (merged._skipHash) {
    delete merged._skipHash;
    return merged as CanonicalEventEnvelope;
  }
  return { ...merged, integrityHash: computeIntegrityHash(merged) };
}

function quarantineRows(ledger: EventLedger): Array<Record<string, unknown>> {
  return ledger.db.prepare('SELECT * FROM quarantine_records ORDER BY recordId ASC').all() as Array<
    Record<string, unknown>
  >;
}

describe('importEvents', () => {
  let ledger: EventLedger;

  beforeEach(() => {
    ledger = new EventLedger(':memory:', { productionMode: false });
  });

  afterEach(() => {
    ledger.close();
  });

  it('imports a single event and persists its canonical record', async () => {
    const event = makeEnvelope();

    const result = await importEvents(ledger, [event]);

    expect(result.stats).toEqual({
      total: 1,
      imported: 1,
      duplicates: 0,
      quarantined: 0,
      errors: 0,
    });
    expect(result.importedEventIds).toEqual(['evt-1']);
    expect(result.report.valid).toHaveLength(1);
    expect(result.report.invalid).toHaveLength(0);

    expect(ledger.count('acme')).toBe(1);
    const row = ledger.getEvents('acme')[0];
    expect(row?.eventId).toBe('evt-1');
    expect(row?.integrityHash).toBe(event.integrityHash);
    expect(row?.canonicalJson).toBe(canonicalize(event));
    expect(JSON.parse(row?.producer ?? '{}')).toEqual(event.producer);

    // Dedupe key matches the SPEC.md §9 definition.
    const expectedDedupeKey = computeDedupeKey({
      tenantId: 'acme',
      sourceKind: 'adr',
      sourceRecordId: 'sess-42',
      eventType: 'session.observed',
      occurredAt: TS,
      canonicalPayloadHash: canonicalPayloadHash(event.payload),
    });
    expect(row?.dedupeKey).toBe(expectedDedupeKey);
  });

  it('imports a batch and counts in-batch duplicates', async () => {
    const first = makeEnvelope({ eventId: 'evt-1' });
    const second = makeEnvelope({
      eventId: 'evt-2',
      payload: { sessionId: 'sess-43', source: 'adr', startedAt: TS },
    });

    const result = await importEvents(ledger, [first, second, first]);

    expect(result.stats).toEqual({
      total: 3,
      imported: 2,
      duplicates: 1,
      quarantined: 0,
      errors: 0,
    });
    expect(result.importedEventIds).toEqual(['evt-1', 'evt-2']);
    expect(result.duplicateEventIds).toEqual(['evt-1']);
    expect(ledger.count('acme')).toBe(2);
  });

  it('quarantines invalid events instead of appending them', async () => {
    const valid = makeEnvelope({ eventId: 'evt-good' });
    const tampered = makeEnvelope({
      eventId: 'evt-tampered',
      integrityHash: `sha256:${'0'.repeat(64)}`,
      _skipHash: true,
    } as any);
    const missingId = makeEnvelope({ eventId: '' });

    const result = await importEvents(ledger, [valid, tampered, missingId]);

    expect(result.stats).toEqual({
      total: 3,
      imported: 1,
      duplicates: 0,
      quarantined: 2,
      errors: 0,
    });
    expect(result.quarantinedEvents).toHaveLength(2);
    expect(result.quarantinedEvents[0]?.errors.join('; ')).toContain('integrityHash mismatch');
    expect(result.quarantinedEvents[1]?.errors.join('; ')).toContain('eventId');
    expect(ledger.count('acme')).toBe(1);

    const rows = quarantineRows(ledger);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.error).toContain('integrityHash mismatch');
    expect(rows[1]?.error).toContain('eventId');
  });

  it('dry run validates and classifies without writing to the ledger', async () => {
    const first = makeEnvelope({ eventId: 'evt-1' });
    const second = makeEnvelope({
      eventId: 'evt-2',
      payload: { sessionId: 'sess-43', source: 'adr', startedAt: TS },
    });
    const tampered = makeEnvelope({
      eventId: 'evt-bad',
      integrityHash: `sha256:${'1'.repeat(64)}`,
      _skipHash: true,
    } as any);

    // Preview on an empty ledger: reports what a real import would do.
    const preview = await importEvents(ledger, [first, second, tampered], { dryRun: true });
    expect(preview.stats).toEqual({
      total: 3,
      imported: 2,
      duplicates: 0,
      quarantined: 1,
      errors: 0,
    });
    expect(ledger.count('acme')).toBe(0);
    expect(quarantineRows(ledger)).toHaveLength(0);

    // Now import for real, then preview a re-import: duplicates are detected.
    await importEvents(ledger, [first]);
    const rePreview = await importEvents(ledger, [first, second], { dryRun: true });
    expect(rePreview.stats).toEqual({
      total: 2,
      imported: 1,
      duplicates: 1,
      quarantined: 0,
      errors: 0,
    });
    expect(rePreview.duplicateEventIds).toEqual(['evt-1']);
    expect(ledger.count('acme')).toBe(1);
  });

  it('is idempotent: re-importing the same events appends nothing', async () => {
    const first = makeEnvelope({ eventId: 'evt-1' });
    const second = makeEnvelope({
      eventId: 'evt-2',
      payload: { sessionId: 'sess-43', source: 'adr', startedAt: TS },
    });

    const firstRun = await importEvents(ledger, [first, second]);
    expect(firstRun.stats.imported).toBe(2);

    const secondRun = await importEvents(ledger, [first, second]);
    expect(secondRun.stats).toEqual({
      total: 2,
      imported: 0,
      duplicates: 2,
      quarantined: 0,
      errors: 0,
    });
    expect(secondRun.importedEventIds).toEqual([]);
    expect(secondRun.duplicateEventIds).toEqual(['evt-1', 'evt-2']);
    expect(ledger.count('acme')).toBe(2);
  });

  it('honors a forced tenantId from options', async () => {
    const event = makeEnvelope({ eventId: 'evt-1' });

    const result = await importEvents(ledger, [event], { tenantId: 'tenant-b' });

    expect(result.stats.imported).toBe(1);
    expect(ledger.count('tenant-b')).toBe(1);
    expect(ledger.count('acme')).toBe(0);
    expect(ledger.getEvents('tenant-b')[0]?.eventId).toBe('evt-1');
  });
});
