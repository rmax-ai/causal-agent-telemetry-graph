/**
 * @catg/graph-projection — Project canonical events from the append-only
 * ledger into a Kuzu property graph (SPEC.md §11).
 */
export const VERSION = '0.1.0';

export type { ProjectionResult, ProjectionStats } from './projector.js';
export { GraphProjection } from './projector.js';
export { EDGE_TABLE_MAPPINGS, edgeTableDdl, fullDdl, NODE_TYPE_TO_TABLE } from './schema.js';
