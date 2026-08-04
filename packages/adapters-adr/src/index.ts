/**
 * @catg/adapters-adr — ADR (Agent Data Representation) ingestion adapter.
 *
 * Parses ADR AgentEvent JSON records and maps them to canonical CATG events
 * (SPEC.md §12 "ADR adapter"). The public entry point is `adapterAdr`:
 *
 * ```ts
 * const { events, errors } = adapterAdr(rawAgentEventJson);
 * ```
 *
 * - Input may be a single record, an array of records (JSONL batch), or a
 *   JSON-encoded string of either.
 * - Records are validated with Zod; invalid records are quarantined into
 *   `errors` without dropping the rest of a batch.
 * - Every produced event is validated against its canonical event-family
 *   schema before being returned.
 * - Raw content is never stored — only sha256 canonical hashes (AGENTS.md).
 */
import type { CanonicalEventEnvelope } from '@catg/schema';
import { mapAdrEvent, mappingContextFor, validateEnvelope } from './mapper.js';
import { parseAdrRecord } from './parser.js';
import { ADAPTER_VERSION } from './types.js';

export const VERSION = ADAPTER_VERSION;

/** Result of running the ADR adapter over an input payload. */
export interface AdapterAdrResult {
  /** Validated canonical CATG events (empty when every record was rejected). */
  events: CanonicalEventEnvelope[];
  /** Human-readable errors for malformed records and invalid produced events. */
  errors: string[];
}

/** Normalize input to a list of records, parsing JSON strings when needed. */
function normalizeInput(input: unknown): { records: unknown[]; error?: string } {
  let value: unknown = input;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return { records: [], error: `input is not valid JSON: ${message}` };
    }
  }
  if (Array.isArray(value)) {
    return { records: value };
  }
  return { records: [value] };
}

/**
 * Main ADR adapter entry point (SPEC.md §12): parse ADR AgentEvent JSON into
 * canonical CATG events.
 *
 * @param input - A single ADR record, an array of records, or a JSON string.
 * @returns Validated canonical events plus per-record error strings. Invalid
 *   records are skipped and reported; a completely unparseable input yields an
 *   empty `events` array and a single error.
 */
export function adapterAdr(input: unknown): AdapterAdrResult {
  const { records, error: inputError } = normalizeInput(input);
  if (inputError !== undefined) {
    return { events: [], errors: [inputError] };
  }

  const events: CanonicalEventEnvelope[] = [];
  const errors: string[] = [];

  for (const record of records) {
    const parsed = parseAdrRecord(record);
    if (!parsed.ok) {
      errors.push(parsed.error);
      continue;
    }
    const context = mappingContextFor(parsed.value);
    let mapped: CanonicalEventEnvelope[];
    try {
      mapped = mapAdrEvent(parsed.value, context);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      errors.push(`[adr record ${parsed.value.event_id}] mapping failed: ${message}`);
      continue;
    }
    for (const event of mapped) {
      const validationError = validateEnvelope(event);
      if (validationError !== undefined) {
        errors.push(
          `[adr record ${parsed.value.event_id}] event ${event.eventId}: ${validationError}`,
        );
        continue;
      }
      events.push(event);
    }
  }

  return { events, errors };
}

export {
  buildEnvelope,
  type EnvelopeSeed,
  type MappingContext,
  mapAdrEvent,
  mappingContextFor,
  validateEnvelope,
} from './mapper.js';
export { parseAdrInput, parseAdrRecord, recordIdOf } from './parser.js';
export * from './types.js';
