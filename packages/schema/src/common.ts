import { z } from 'zod';

/**
 * ISO-8601 timestamp with timezone offset (e.g. `2026-08-02T10:00:00.000Z`).
 * Used for every temporal field in the ontology.
 */
export const IsoTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .describe('ISO-8601 timestamp with timezone offset (e.g. 2026-08-02T10:00:00.000Z).');

/** Content hash validator: `sha256:` prefix + 64 lowercase hex chars (AGENTS.md "Code Style"). */
export const Sha256HashSchema = z
  .string()
  .regex(
    /^sha256:[a-f0-9]{64}$/,
    'content hash must use the sha256: prefix followed by 64 lowercase hex characters',
  )
  .describe('Content integrity hash in sha256: hex form (never sha-256:).');

/**
 * Strict CATG URN pattern: `urn:catg:{tenant}:{source}:{id}` (AGENTS.md "Code Style").
 * Tenant/source segments are short namespace tokens; the id segment is an opaque
 * source-stable string and may itself contain `:` (e.g. ADR message IDs).
 */
export const urnPattern: RegExp =
  /^urn:catg:[a-zA-Z0-9][a-zA-Z0-9._-]*:[a-zA-Z0-9][a-zA-Z0-9._-]*:[a-zA-Z0-9._~:/%+=?&,;-]+$/;

/**
 * Node/edge ID pattern: a strict `urn:catg:{tenant}:{source}:{id}` URN, or the
 * content-addressed form `urn:catg:sha256:{canonical-content-hash}` (SPEC.md §8
 * "Stable Identifier Strategy"). IDs are opaque — validated for format, never
 * parsed structurally (AGENTS.md).
 */
export const nodeIdPattern: RegExp =
  /^(?:urn:catg:[a-zA-Z0-9][a-zA-Z0-9._-]*:[a-zA-Z0-9][a-zA-Z0-9._-]*:[a-zA-Z0-9._~:/%+=?&,;-]+|urn:catg:sha256:[a-f0-9]{64})$/;

/** Opaque CATG node/edge identifier schema. */
export const NodeIdSchema = z
  .string()
  .regex(
    nodeIdPattern,
    'ID must be a CATG URN (urn:catg:{tenant}:{source}:{id}) or content-addressed urn:catg:sha256:{hash}',
  )
  .describe(
    'Opaque CATG identifier — either urn:catg:{tenant}:{source}:{id} or urn:catg:sha256:{hash}.',
  );

/** Five-value confidence scale shared by nodes and edges (SPEC.md §8). */
export const ConfidenceSchema = z
  .enum(['observed', 'declared', 'reconstructed', 'inferred', 'speculative'])
  .describe(
    'Confidence scale: observed > declared > reconstructed > inferred > speculative (SPEC.md §8).',
  );
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** Data sensitivity classification (SPEC.md §13 policy 4 references restricted|secret). */
export const SensitivitySchema = z
  .enum(['public', 'internal', 'restricted', 'secret'])
  .describe('Data sensitivity classification (public|internal|restricted|secret).');
export type Sensitivity = z.infer<typeof SensitivitySchema>;

/** Content handling modes for sensitive telemetry (AGENTS.md "Content Security"). */
export const ContentModeSchema = z
  .enum(['raw', 'redacted', 'excerpt', 'hash_only', 'reference'])
  .describe('Content mode: raw, redacted, excerpt, hash_only, or reference (AGENTS.md).');
export type ContentMode = z.infer<typeof ContentModeSchema>;

/** Telemetry source kinds CATG ingests (SPEC.md §12). */
export const SourceKindSchema = z
  .enum(['adr', 'otel', 'mcp', 'sdk', 'benchmark', 'synthetic'])
  .describe('Telemetry source kind that produced the record.');
export type SourceKind = z.infer<typeof SourceKindSchema>;

/** Linker basis used to establish an edge relation (SPEC.md §10 "Confidence Mapping"). */
export const CausalBasisSchema = z
  .enum([
    'source_identifier',
    'protocol_semantics',
    'producer_declaration',
    'deterministic_reconstruction',
    'exact_content_match',
    'semantic_inference',
    'temporal_proximity',
    'analyst_assertion',
  ])
  .describe(
    'Linker basis establishing an edge relation; determines the default confidence score range (SPEC.md §10).',
  );
export type CausalBasis = z.infer<typeof CausalBasisSchema>;

/**
 * Reference from a node/event back to the source record and ledger event that
 * produced it (SPEC.md §8 universal node fields `provenance`).
 */
export const ProvenanceRefSchema = z.object({
  sourceId: z
    .string()
    .min(1)
    .describe('Stable identifier of the source record that contributed this fact.'),
  eventId: z.string().min(1).describe('Canonical ledger event ID that produced this fact.'),
  observedAt: IsoTimestampSchema.describe('When the contributing event was observed/ingested.'),
});
export type ProvenanceRef = z.infer<typeof ProvenanceRefSchema>;

/**
 * Universal node fields inherited by all 28 node types (SPEC.md §8).
 * Specialized node schemas narrow `type` to a literal and add type-specific fields.
 */
export const UniversalNodeFieldsSchema = z.object({
  tenantId: z
    .string()
    .min(1)
    .describe('Tenant namespace that owns this node; cross-tenant traversal is forbidden.'),
  id: NodeIdSchema.describe(
    'Opaque CATG URN identifying this node; validated for format, never parsed.',
  ),
  type: z
    .string()
    .min(1)
    .describe('Node type discriminator; specialized schemas narrow this to a literal.'),
  schemaVersion: z
    .string()
    .min(1)
    .describe('Schema version of this node record (semver, e.g. 1.0.0).'),
  environment: z
    .string()
    .min(1)
    .describe('Runtime environment the record came from (e.g. production, staging, test).'),
  occurredAt: IsoTimestampSchema.describe(
    'When the underlying activity/entity occurred, per source telemetry.',
  ),
  observedAt: IsoTimestampSchema.describe('When CATG observed/ingested the record.'),
  validFrom: IsoTimestampSchema.describe('Start of the temporal validity window.'),
  validTo: IsoTimestampSchema.nullable().describe(
    'End of the temporal validity window; null means currently valid.',
  ),
  confidence: ConfidenceSchema.describe(
    'Confidence in the node record itself on the five-value scale.',
  ),
  sensitivity: SensitivitySchema.describe('Data sensitivity classification of this node.'),
  retention: z
    .string()
    .min(1)
    .describe('Retention policy or duration (e.g. ISO-8601 duration P30D).'),
  provenance: z
    .array(ProvenanceRefSchema)
    .default([])
    .describe(
      'Provenance references to the source records and ledger events that produced this node.',
    ),
  integrityHash: Sha256HashSchema.describe(
    'sha256: content hash of the canonical serialization of this node.',
  ),
  labels: z
    .record(z.string(), z.string())
    .default({})
    .describe('Arbitrary string key/value labels for querying.'),
  attributes: z
    .record(z.string(), z.unknown())
    .default({})
    .describe('Free-form type-specific attributes; not indexed.'),
});
export type UniversalNodeFields = z.infer<typeof UniversalNodeFieldsSchema>;

/**
 * Universal edge fields: universal node fields plus edge-specific fields
 * (SPEC.md §8). Every edge assertion is itself a ledger event (`edge.asserted`,
 * SPEC.md §9) and is never written directly to Kuzu (AGENTS.md).
 *
 * Cross-field rule (AGENTS.md rule 2): inferred/reconstructed edges MUST carry
 * `linkerId`, `linkerVersion`, and at least one `evidenceId`.
 */
export const UniversalEdgeFieldsSchema = UniversalNodeFieldsSchema.extend({
  type: z
    .string()
    .min(1)
    .describe('Edge type discriminator; specialized schemas narrow this to a literal.'),
  fromId: NodeIdSchema.describe('URN of the source node this edge originates from.'),
  toId: NodeIdSchema.describe('URN of the target node this edge points to.'),
  assertedAt: IsoTimestampSchema.describe(
    'When this edge assertion was created (immutable ledger event).',
  ),
  confidenceScore: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Numeric confidence score in [0,1]; must fall in the range documented for causalBasis.',
    ),
  causalBasis: CausalBasisSchema.describe(
    'Linker basis that established the relation; determines the default confidence score range (SPEC.md §10).',
  ),
  evidenceIds: z
    .array(z.string().min(1))
    .default([])
    .describe(
      'Ledger event IDs or content hashes evidencing this relation; required for CAUSED and for inferred/reconstructed edges.',
    ),
  linkerId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'ID of the linker that asserted this edge; mandatory for inferred/reconstructed edges.',
    ),
  linkerVersion: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Version of the linker that asserted this edge; mandatory for inferred/reconstructed edges.',
    ),
}).superRefine((edge, ctx) => {
  if (edge.confidence === 'inferred' || edge.confidence === 'reconstructed') {
    if (!edge.linkerId) {
      ctx.addIssue({
        code: 'custom',
        path: ['linkerId'],
        message: 'inferred/reconstructed edges must carry a linkerId (AGENTS.md rule 2)',
      });
    }
    if (!edge.linkerVersion) {
      ctx.addIssue({
        code: 'custom',
        path: ['linkerVersion'],
        message: 'inferred/reconstructed edges must carry a linkerVersion (AGENTS.md rule 2)',
      });
    }
    if (edge.evidenceIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message:
          'inferred/reconstructed edges must carry at least one evidenceId (AGENTS.md rule 2)',
      });
    }
  }
});
export type UniversalEdgeFields = z.infer<typeof UniversalEdgeFieldsSchema>;
