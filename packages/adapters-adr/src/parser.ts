/**
 * ADR parsing — validates raw JSON input against the ADR Zod schemas and
 * normalizes it into typed ADR AgentEvent records (SPEC.md §12).
 *
 * Parsing is strict (Zod): a record that fails validation is rejected with a
 * formatted error string so the caller can quarantine it without losing the
 * rest of a batch.
 */
import { type AdrAgentEvent, AdrAgentEventSchema } from './types.js';

/** Result of parsing a single ADR record. */
export type AdrRecordParseResult =
  | { ok: true; value: AdrAgentEvent }
  | { ok: false; error: string };

/** Result of parsing an adapter input (record or array of records). */
export type AdrInputParseResult =
  | { ok: true; value: AdrAgentEvent[] }
  | { ok: false; error: string };

/** Format a Zod issue list into a single human-readable error string. */
function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

/** Extract a best-effort record id for error messages (never throws). */
export function recordIdOf(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null) {
    const maybe = (value as Record<string, unknown>).event_id;
    if (typeof maybe === 'string' && maybe.length > 0) {
      return maybe;
    }
  }
  return undefined;
}

/**
 * Parse a single unknown value as an ADR AgentEvent record.
 * Returns a typed record on success, or a formatted validation error.
 */
export function parseAdrRecord(value: unknown): AdrRecordParseResult {
  const parsed = AdrAgentEventSchema.safeParse(value);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  const id = recordIdOf(value);
  const detail = formatIssues(parsed.error.issues);
  return { ok: false, error: `[adr record ${id ?? '<unknown>'}] ${detail}` };
}

/**
 * Parse an adapter input (single record or array of records) into typed ADR
 * records. Non-object/non-array inputs are rejected. Unlike per-record
 * parsing, this does not quarantine individual bad records — use
 * `parseAdrRecord` per record to keep batch processing resilient.
 */
export function parseAdrInput(input: unknown): AdrInputParseResult {
  const records = Array.isArray(input) ? input : [input];
  const out: AdrAgentEvent[] = [];
  for (const record of records) {
    const parsed = parseAdrRecord(record);
    if (parsed.ok) {
      out.push(parsed.value);
    } else {
      return { ok: false, error: parsed.error };
    }
  }
  return { ok: true, value: out };
}
