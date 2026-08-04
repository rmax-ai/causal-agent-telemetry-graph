/**
 * Import orchestrator — the ingestion pipeline that validates canonical
 * events, computes idempotency dedupe keys, appends valid events to the
 * append-only ledger and quarantines invalid ones (SPEC.md §9 idempotency).
 */
import { canonicalize } from '@catg/canonical-json';
import type { EventLedger } from '@catg/event-ledger';
import { type CanonicalEventEnvelope, canonicalPayloadHash, computeDedupeKey } from '@catg/schema';
import type { ImportResult, InvalidEvent, QuarantinedEvent, ValidationReport } from './types.js';
import { validateEvent } from './validator.js';

/** Options controlling a single import run. */
export interface ImportOptions {
  /** Force the tenant for every event in the batch (overrides subject.tenantId). */
  tenantId?: string;
  /**
   * Validate and classify duplicates without writing to the ledger. Useful for
   * previewing what a real import would do.
   */
  dryRun?: boolean;
}

const UNKNOWN_EVENT_ID = '<unknown>';
const UNKNOWN_TENANT = 'unknown';

/** True when the ledger already holds an event with this (tenantId, dedupeKey). */
function ledgerHasEvent(ledger: EventLedger, tenantId: string, dedupeKey: string): boolean {
  const row = ledger.db
    .prepare('SELECT 1 AS present FROM events WHERE tenantId = ? AND dedupeKey = ? LIMIT 1')
    .get(tenantId, dedupeKey);
  return row !== undefined;
}

/** Tenant used for a quarantine record — falls back when the event is malformed. */
function quarantineTenant(event: CanonicalEventEnvelope, forcedTenant: string | undefined): string {
  return forcedTenant ?? event.subject?.tenantId ?? UNKNOWN_TENANT;
}

/** Best-effort canonical serialization of an event for the quarantine table. */
function serializeForQuarantine(event: CanonicalEventEnvelope): string {
  try {
    return canonicalize(event);
  } catch {
    try {
      return JSON.stringify(event);
    } catch {
      return '{}';
    }
  }
}

/**
 * Import canonical events into the ledger.
 *
 * Pipeline:
 * 1. Validate every event, collecting errors instead of stopping at the first
 * 2. Compute the idempotency dedupe key
 *    (sha256 of tenantId || sourceKind || sourceRecordId || eventType ||
 *    occurredAt || payloadHash)
 * 3. Serialize valid events to canonical JSON for the ledger record
 * 4. Append valid events to the ledger (duplicates are skipped)
 * 5. Quarantine invalid events for later inspection
 * 6. Return counts: total, imported, duplicates, quarantined, errors
 */
export async function importEvents(
  ledger: EventLedger,
  events: CanonicalEventEnvelope[],
  options: ImportOptions = {},
): Promise<ImportResult> {
  const dryRun = options.dryRun ?? false;

  const importedEventIds: string[] = [];
  const duplicateEventIds: string[] = [];
  const quarantinedEvents: QuarantinedEvent[] = [];
  const validEvents: CanonicalEventEnvelope[] = [];
  const invalidEvents: InvalidEvent[] = [];
  const seenDedupeKeys = new Set<string>();
  let errors = 0;

  for (const event of events) {
    const validation = validateEvent(event);
    const eventId = event.eventId.trim().length > 0 ? event.eventId : UNKNOWN_EVENT_ID;

    if (!validation.valid) {
      quarantinedEvents.push({ eventId, errors: validation.errors });
      invalidEvents.push({ event, errors: validation.errors });
      if (!dryRun) {
        ledger.quarantine(
          quarantineTenant(event, options.tenantId),
          serializeForQuarantine(event),
          `ValidationError: ${validation.errors.join('; ')}`,
        );
      }
      continue;
    }

    // Valid event: compute the dedupe key (SPEC.md §9 idempotency).
    let tenantId: string;
    let dedupeKey: string;
    try {
      tenantId = options.tenantId ?? event.subject.tenantId;
      dedupeKey = computeDedupeKey({
        tenantId,
        sourceKind: event.producer.sourceKind,
        sourceRecordId: event.producer.sourceId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        canonicalPayloadHash: canonicalPayloadHash(event.payload),
      });
    } catch {
      errors += 1;
      continue;
    }

    validEvents.push(event);

    // Skip events already in the ledger or earlier in this batch.
    if (seenDedupeKeys.has(dedupeKey) || ledgerHasEvent(ledger, tenantId, dedupeKey)) {
      duplicateEventIds.push(eventId);
      continue;
    }

    if (dryRun) {
      seenDedupeKeys.add(dedupeKey);
      importedEventIds.push(eventId);
      continue;
    }

    // Serialize to canonical JSON for the ledger record (step 3).
    let canonicalJson: string;
    try {
      canonicalJson = canonicalize(event);
    } catch {
      errors += 1;
      continue;
    }

    try {
      const inserted = ledger.append({
        eventId: event.eventId,
        schemaVersion: event.schemaVersion,
        eventType: event.eventType,
        tenantId,
        dedupeKey,
        occurredAt: event.occurredAt,
        observedAt: event.observedAt,
        producer: JSON.stringify(event.producer),
        canonicalJson,
        integrityHash: event.integrityHash,
        previousHash: null,
      });
      if (inserted) {
        seenDedupeKeys.add(dedupeKey);
        importedEventIds.push(eventId);
      } else {
        duplicateEventIds.push(eventId);
      }
    } catch {
      errors += 1;
    }
  }

  const total = events.length;
  const report: ValidationReport = {
    valid: validEvents,
    invalid: invalidEvents,
    stats: {
      total,
      validCount: validEvents.length,
      invalidCount: invalidEvents.length,
    },
  };

  return {
    stats: {
      total,
      imported: importedEventIds.length,
      duplicates: duplicateEventIds.length,
      quarantined: quarantinedEvents.length,
      errors,
    },
    report,
    importedEventIds,
    duplicateEventIds,
    quarantinedEvents,
  };
}
