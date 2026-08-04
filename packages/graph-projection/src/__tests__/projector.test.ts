import { createHash } from 'node:crypto';
import { EventLedger } from '@catg/event-ledger';
import type { CanonicalEventEnvelope } from '@catg/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GraphProjection } from '../projector.js';

function computeIntegrityHash(event: Record<string, unknown>): string {
  const payload = JSON.stringify(event, Object.keys(event).sort());
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

function makeEvent(overrides: Partial<CanonicalEventEnvelope> = {}): CanonicalEventEnvelope {
  const base: CanonicalEventEnvelope = {
    eventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    schemaVersion: '1.0.0',
    eventType: 'session.observed',
    occurredAt: '2026-08-04T10:00:00.000Z',
    observedAt: '2026-08-04T10:00:01.000Z',
    producer: { sourceKind: 'adr', sourceId: 'sess-1' },
    subject: { tenantId: 'test' },
    traceContext: {},
    identityContext: {},
    payload: { sessionId: 'sess-1', source: 'adr', startedAt: '2026-08-04T10:00:00.000Z' },
    provenance: [],
    securityClassification: { classification: 'internal', handling: [] },
    integrityHash: '',
    extensions: {},
  };
  const merged = { ...base, ...overrides };
  return { ...merged, integrityHash: computeIntegrityHash(merged) };
}

describe('GraphProjection', () => {
  let ledger: EventLedger;
  let projection: GraphProjection;

  beforeEach(() => {
    ledger = new EventLedger(':memory:', { productionMode: false });
    projection = new GraphProjection(ledger, ':memory:');
  });

  afterEach(async () => {
    await projection.close();
    ledger.close();
  });

  function appendEvent(event: CanonicalEventEnvelope): void {
    ledger.append({
      eventId: event.eventId,
      schemaVersion: event.schemaVersion,
      eventType: event.eventType,
      tenantId: event.subject.tenantId,
      dedupeKey: `${event.subject.tenantId}:${event.eventId}`,
      occurredAt: event.occurredAt,
      observedAt: event.observedAt,
      producer: JSON.stringify(event.producer),
      canonicalJson: JSON.stringify(event),
      integrityHash: event.integrityHash,
      previousHash: null,
    });
  }

  it('builds an empty projection on an empty ledger', async () => {
    const result = await projection.buildFull('test');
    expect(result.stats.eventsProcessed).toBe(0);
    expect(result.stats.nodesCreated).toBe(0);
    expect(result.snapshotHash).toMatch(/^sha256:/);
  });

  it('projects a session.observed event into a node', async () => {
    const event = makeEvent({
      eventType: 'session.observed',
      payload: { sessionId: 'sess-42', source: 'adr', startedAt: '2026-08-04T10:00:00.000Z' },
    });
    appendEvent(event);

    const result = await projection.buildFull('test');
    expect(result.stats.nodesCreated).toBe(1);
    expect(result.stats.eventsProcessed).toBe(1);
  });

  it('projects a run.started with edge to session', async () => {
    const session = makeEvent({
      eventId: 'evt-sess',
      eventType: 'session.observed',
      subject: { tenantId: 'test', sessionId: 'sess-1' },
      payload: { sessionId: 'sess-1', source: 'adr', startedAt: '2026-08-04T10:00:00.000Z' },
    });
    appendEvent(session);

    const run = makeEvent({
      eventId: 'evt-run',
      eventType: 'run.started',
      subject: { tenantId: 'test', sessionId: 'sess-1' },
      payload: { runId: 'run-1', sessionId: 'sess-1', startedAt: '2026-08-04T10:00:05.000Z' },
    });
    appendEvent(run);

    const result = await projection.buildFull('test');
    expect(result.stats.nodesCreated).toBe(2); // session + run
    expect(result.stats.edgesCreated).toBe(1); // CONTAINS
  });

  it('rebuilds are idempotent — same snapshot hash', async () => {
    const event = makeEvent({
      eventType: 'session.observed',
      payload: { sessionId: 'sess-99', source: 'adr', startedAt: '2026-08-04T10:00:00.000Z' },
    });
    appendEvent(event);

    const r1 = await projection.buildFull('test');
    const r2 = await projection.buildFull('test');
    expect(r1.snapshotHash).toBe(r2.snapshotHash);
  });
});
