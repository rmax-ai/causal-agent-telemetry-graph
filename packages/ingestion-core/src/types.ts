import type { CanonicalEventEnvelope } from '@catg/schema';

/**
 * Import pipeline types for @catg/ingestion-core (SPEC.md §9 idempotency,
 * AGENTS.md "Testing Requirements" — integration tests cover full import).
 */

/** A batch of canonical events submitted for import. */
export interface ImportBatch {
  events: CanonicalEventEnvelope[];
}

/** Outcome of validating a single event. */
export interface EventValidation {
  valid: boolean;
  errors: string[];
}

/** A validation failure for a single event, kept for quarantine/debugging. */
export interface InvalidEvent {
  event: CanonicalEventEnvelope;
  errors: string[];
}

/** Aggregated validation report for a batch of events. */
export interface ValidationReport {
  /** Events that passed every validation check. */
  valid: CanonicalEventEnvelope[];
  /** Events that failed validation, with the reasons. */
  invalid: InvalidEvent[];
  stats: {
    total: number;
    validCount: number;
    invalidCount: number;
  };
}

/**
 * Counters describing one import run. Invariant:
 * `total === imported + duplicates + quarantined + errors`.
 */
export interface IngestionStats {
  /** Number of events submitted. */
  total: number;
  /** Events appended to the ledger. */
  imported: number;
  /** Valid events already present in the ledger or earlier in the batch. */
  duplicates: number;
  /** Events rejected by validation and sent to quarantine. */
  quarantined: number;
  /** Valid events that failed during processing (e.g. append threw). */
  errors: number;
}

/** A quarantine entry: the event id plus the reasons it was rejected. */
export interface QuarantinedEvent {
  eventId: string;
  errors: string[];
}

/** Result of an import run. */
export interface ImportResult {
  stats: IngestionStats;
  report: ValidationReport;
  /** Event ids appended to the ledger, in input order. */
  importedEventIds: string[];
  /** Event ids rejected as duplicates (already in the ledger or earlier in the batch). */
  duplicateEventIds: string[];
  /** Event ids quarantined with their validation errors, in input order. */
  quarantinedEvents: QuarantinedEvent[];
}
