/**
 * Validation for canonical event envelopes before they are appended to the
 * ledger. Canonical events are immutable after append (AGENTS.md "Schema
 * Evolution"), so every integrity property must be checked at ingestion time.
 */
import { hashCanonical } from '@catg/canonical-json';
import { type CanonicalEventEnvelope, CanonicalEventEnvelopeSchema } from '@catg/schema';
import type { EventValidation, ValidationReport } from './types.js';

/**
 * Semantic version pattern (semver.org): major.minor.patch with optional
 * pre-release and build metadata.
 */
export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Compute the canonical integrity hash of an event: the sha256: content hash
 * of the RFC 8785 canonical serialization of the event body with the
 * self-referential `integrityHash` field excluded (SPEC.md §9).
 */
export function computeIntegrityHash(event: CanonicalEventEnvelope): string {
  const body: Record<string, unknown> = { ...event };
  delete body.integrityHash;
  return hashCanonical(body);
}

function requireField(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${label} is required and must be a non-empty string`);
  }
}

/**
 * Validate a single canonical event envelope. Collects every problem instead
 * of stopping at the first one so callers get a complete picture.
 */
export function validateEvent(event: CanonicalEventEnvelope): EventValidation {
  const errors: string[] = [];

  // 1. eventId must be non-empty (SPEC.md §9 idempotency)
  requireField(event.eventId, 'eventId', errors);

  // 2. schemaVersion must be valid semver
  if (typeof event.schemaVersion !== 'string' || !SEMVER_PATTERN.test(event.schemaVersion)) {
    errors.push(
      `schemaVersion must be a valid semver string, got ${JSON.stringify(event.schemaVersion)}`,
    );
  }

  // 3. Required fields must be present and non-empty
  requireField(event.subject?.tenantId, 'subject.tenantId', errors);
  requireField(event.eventType, 'eventType', errors);
  requireField(event.occurredAt, 'occurredAt', errors);
  requireField(event.observedAt, 'observedAt', errors);

  // 4. integrityHash must match the canonical serialization of the event body
  const expectedHash = computeIntegrityHash(event);
  if (event.integrityHash !== expectedHash) {
    errors.push(
      `integrityHash mismatch: expected ${expectedHash}, got ${JSON.stringify(event.integrityHash)}`,
    );
  }

  // 5. Structural validation against the canonical envelope schema
  const parsed = CanonicalEventEnvelopeSchema.safeParse(event);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 5)) {
      errors.push(`${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a batch of events, partitioning them into valid and invalid sets
 * without stopping on the first failure.
 */
export function validateBatch(events: CanonicalEventEnvelope[]): ValidationReport {
  const valid: CanonicalEventEnvelope[] = [];
  const invalid: ValidationReport['invalid'] = [];

  for (const event of events) {
    const result = validateEvent(event);
    if (result.valid) {
      valid.push(event);
    } else {
      invalid.push({ event, errors: result.errors });
    }
  }

  return {
    valid,
    invalid,
    stats: {
      total: events.length,
      validCount: valid.length,
      invalidCount: invalid.length,
    },
  };
}
