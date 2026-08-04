/**
 * @catg/ingestion-core — import orchestration, validation, and event
 * deduplication pipeline for canonical CATG events (SPEC.md §9 idempotency).
 */
export const VERSION = '0.1.0';

export type { ImportOptions } from './orchestrator.js';
export { importEvents } from './orchestrator.js';
export type {
  EventValidation,
  ImportBatch,
  ImportResult,
  IngestionStats,
  InvalidEvent,
  QuarantinedEvent,
  ValidationReport,
} from './types.js';
export { computeIntegrityHash, SEMVER_PATTERN, validateBatch, validateEvent } from './validator.js';
