import { z } from 'zod';
import { type CausalBasisSchema, UniversalEdgeFieldsSchema } from './common.js';

/**
 * Zod schemas + inferred types for all 27 CATG edge types (SPEC.md §8
 * "Edge-Type Registry"). Each edge extends the universal edge fields. From/to
 * endpoint constraints follow EDGES.md §2; confidence/score semantics follow
 * SPEC.md §10.
 */

/** Documented default confidence score ranges per linker basis (SPEC.md §10 "Confidence Mapping"). */
export const BASIS_SCORE_RANGES: Readonly<
  Record<z.infer<typeof CausalBasisSchema>, { min: number; max: number }>
> = {
  source_identifier: { min: 1, max: 1 },
  protocol_semantics: { min: 0.98, max: 0.98 },
  producer_declaration: { min: 0.9, max: 0.9 },
  deterministic_reconstruction: { min: 0.8, max: 0.95 },
  exact_content_match: { min: 0.75, max: 0.9 },
  semantic_inference: { min: 0.5, max: 0.79 },
  temporal_proximity: { min: 0, max: 0.35 },
  analyst_assertion: { min: 0, max: 1 },
};

/** Confidence score range documented for a given causal basis (SPEC.md §10). */
export function confidenceScoreRangeForBasis(basis: z.infer<typeof CausalBasisSchema>): {
  min: number;
  max: number;
} {
  return BASIS_SCORE_RANGES[basis];
}

/** Shared superRefine: confidenceScore must fall in the documented range for causalBasis. */
function scoreMatchesBasis(
  edge: { confidenceScore: number; causalBasis: z.infer<typeof CausalBasisSchema> },
  ctx: z.RefinementCtx,
): void {
  const { min, max } = confidenceScoreRangeForBasis(edge.causalBasis);
  if (edge.confidenceScore < min || edge.confidenceScore > max) {
    ctx.addIssue({
      code: 'custom',
      path: ['confidenceScore'],
      message: `confidenceScore ${edge.confidenceScore} is outside the documented range [${min}, ${max}] for causalBasis '${edge.causalBasis}' (SPEC.md §10)`,
    });
  }
}

// ---------------------------------------------------------------------------
// 27 edge types (SPEC.md §8 / EDGES.md §2)
// ---------------------------------------------------------------------------

/** INITIATED — Principal → Session/Run: principal started execution (default observed/declared). */
export const InitiatedSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('INITIATED')
    .describe('Principal started execution (PROV wasAssociatedWith + CATG role).'),
  role: z
    .string()
    .min(1)
    .optional()
    .describe('CATG role the principal played in starting the execution.'),
}).superRefine(scoreMatchesBasis);
export type Initiated = z.infer<typeof InitiatedSchema>;

/** ACTED_ON_BEHALF_OF — Agent → Principal: agent exercised delegated authority (default declared/reconstructed). */
export const ActedOnBehalfOfSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('ACTED_ON_BEHALF_OF')
    .describe('Agent exercised authority on behalf of a principal.'),
  authorityRef: z
    .string()
    .min(1)
    .optional()
    .describe('Reference to the delegation/authority that licensed this act.'),
}).superRefine(scoreMatchesBasis);
export type ActedOnBehalfOf = z.infer<typeof ActedOnBehalfOfSchema>;

/** DELEGATED_TO — Agent/Run → Agent/Run: objective or authority transferred (default observed/declared). */
export const DelegatedToSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('DELEGATED_TO')
    .describe('Objective or authority transferred between agents/runs.'),
  authorityScope: z
    .string()
    .min(1)
    .optional()
    .describe('Scope of delegated authority (e.g. tool:read:repo).'),
  attenuation: z
    .boolean()
    .optional()
    .describe(
      'Whether the child authority is attenuated relative to the parent (SPEC.md §13 policy 3).',
    ),
}).superRefine(scoreMatchesBasis);
export type DelegatedTo = z.infer<typeof DelegatedToSchema>;

/** CONTAINS — Session/Run/Prompt → child: structural containment (default observed/reconstructed). */
export const ContainsSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('CONTAINS')
    .describe('Structural containment of a child node within a session/run/prompt.'),
  containmentKind: z
    .enum(['session', 'run', 'prompt', 'other'])
    .optional()
    .describe('Kind of container relationship.'),
}).superRefine(scoreMatchesBasis);
export type Contains = z.infer<typeof ContainsSchema>;

/** PRECEDED_BY — Activity → Activity: ordering only; must never be upgraded to CAUSED (default observed/reconstructed). */
export const PrecededBySchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('PRECEDED_BY')
    .describe(
      'Ordering-only relationship; temporal proximity must never be treated as causation (AGENTS.md).',
    ),
  orderingBasis: z
    .enum(['source_sequence', 'timestamp', 'otel_parent', 'other'])
    .optional()
    .describe('Basis used to establish the ordering.'),
}).superRefine((edge, ctx) => {
  scoreMatchesBasis(edge, ctx);
  if (edge.causalBasis === 'temporal_proximity' && edge.confidenceScore > 0.35) {
    ctx.addIssue({
      code: 'custom',
      path: ['confidenceScore'],
      message:
        'temporal-proximity PRECEDED_BY edges are capped at confidenceScore 0.35 (SPEC.md §10 linker precedence rule 9)',
    });
  }
});
export type PrecededBy = z.infer<typeof PrecededBySchema>;

/** INFORMED_BY — Activity → Activity: earlier activity supplied relevant information (default declared/reconstructed/inferred). */
export const InformedBySchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('INFORMED_BY')
    .describe(
      'Earlier activity supplied relevant information to a later activity (PROV wasInformedBy).',
    ),
  informationType: z
    .string()
    .min(1)
    .optional()
    .describe('Type of information conveyed (e.g. context, tool_result, instruction).'),
}).superRefine(scoreMatchesBasis);
export type InformedBy = z.infer<typeof InformedBySchema>;

/** USED — Activity → Entity: activity consumed an entity (default observed/reconstructed). */
export const UsedSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z.literal('USED').describe('Activity consumed an entity (PROV used specialization).'),
}).superRefine(scoreMatchesBasis);
export type Used = z.infer<typeof UsedSchema>;

/** GENERATED — Activity → Entity: activity produced an entity (default observed/reconstructed). */
export const GeneratedSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('GENERATED')
    .describe('Activity produced an entity (PROV wasGeneratedBy specialization).'),
}).superRefine(scoreMatchesBasis);
export type Generated = z.infer<typeof GeneratedSchema>;

/** DERIVED_FROM — Entity → Entity: entity transformation lineage (default declared/reconstructed/inferred). */
export const DerivedFromSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z.literal('DERIVED_FROM').describe('Entity transformation lineage (PROV wasDerivedFrom).'),
  derivationKind: z
    .enum(['transformation', 'copy', 'aggregation', 'other'])
    .optional()
    .describe('Kind of derivation.'),
}).superRefine(scoreMatchesBasis);
export type DerivedFrom = z.infer<typeof DerivedFromSchema>;

/** READ_FROM — ToolCall/DataObject → Resource: data read from resource (default observed/reconstructed). */
export const ReadFromSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z.literal('READ_FROM').describe('Data read from a resource (PROV used specialization).'),
}).superRefine(scoreMatchesBasis);
export type ReadFrom = z.infer<typeof ReadFromSchema>;

/** WROTE_TO — ToolCall/DataObject → Resource: data written to resource (default observed/reconstructed). */
export const WroteToSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('WROTE_TO')
    .describe('Data written to a resource (PROV wasGeneratedBy specialization).'),
}).superRefine(scoreMatchesBasis);
export type WroteTo = z.infer<typeof WroteToSchema>;

/** CALLED — AgentRun/ModelInvocation → ToolCall/Tool: invocation relationship (default observed). */
export const CalledSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('CALLED')
    .describe('Invocation relationship between an activity and a tool/tool call.'),
  callProtocol: z
    .enum(['mcp', 'function', 'http', 'other'])
    .optional()
    .describe('Protocol used for the invocation.'),
}).superRefine(scoreMatchesBasis);
export type Called = z.infer<typeof CalledSchema>;

/** RETURNED — ToolResult → ToolCall: result of invocation (default observed/reconstructed). */
export const ReturnedSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z.literal('RETURNED').describe('A tool result returned to its originating tool call.'),
}).superRefine(scoreMatchesBasis);
export type Returned = z.infer<typeof ReturnedSchema>;

/** SENT_TO — DataObject/Credential → Resource/MCPServer: data transmitted (default observed/reconstructed). */
export const SentToSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z.literal('SENT_TO').describe('Data transmitted to an external resource/MCP server.'),
  transport: z
    .enum(['network', 'http', 'mcp', 'file', 'other'])
    .optional()
    .describe('Transport used for the transmission.'),
}).superRefine(scoreMatchesBasis);
export type SentTo = z.infer<typeof SentToSchema>;

/** RECEIVED_FROM — DataObject/Instruction → Resource/MCPServer: data originated externally (default observed/reconstructed). */
export const ReceivedFromSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('RECEIVED_FROM')
    .describe('Data originated from an external resource/MCP server.'),
  transport: z
    .enum(['network', 'http', 'mcp', 'file', 'other'])
    .optional()
    .describe('Transport over which the data was received.'),
}).superRefine(scoreMatchesBasis);
export type ReceivedFrom = z.infer<typeof ReceivedFromSchema>;

/** REQUESTED_APPROVAL — Run/ToolCall → ApprovalRequest: authorization requested (default observed). */
export const RequestedApprovalSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('REQUESTED_APPROVAL')
    .describe('An activity requested authorization via an approval request.'),
}).superRefine(scoreMatchesBasis);
export type RequestedApproval = z.infer<typeof RequestedApprovalSchema>;

/** APPROVED_BY — ApprovalRequest/ToolCall → ApprovalDecision/Principal: approval relationship (default observed/declared). */
export const ApprovedBySchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z.literal('APPROVED_BY').describe('An approval decision approved a request/action.'),
}).superRefine(scoreMatchesBasis);
export type ApprovedBy = z.infer<typeof ApprovedBySchema>;

/** DENIED_BY — ApprovalRequest/ToolCall → ApprovalDecision/Principal: denial relationship (default observed/declared). */
export const DeniedBySchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z.literal('DENIED_BY').describe('An approval decision denied a request/action.'),
}).superRefine(scoreMatchesBasis);
export type DeniedBy = z.infer<typeof DeniedBySchema>;

/** AUTHORIZED_BY — ToolCall/Effect/Delegation → PolicyDecision/ApprovalDecision: valid authorization basis (default reconstructed). */
export const AuthorizedBySchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('AUTHORIZED_BY')
    .describe('A policy/approval decision provides the valid authorization basis for an action.'),
}).superRefine(scoreMatchesBasis);
export type AuthorizedBy = z.infer<typeof AuthorizedBySchema>;

/** EVALUATED_AGAINST — Decision/Detection → Policy/Evidence: evaluation target (default observed). */
export const EvaluatedAgainstSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('EVALUATED_AGAINST')
    .describe('A decision/detection was evaluated against a policy or evidence.'),
}).superRefine(scoreMatchesBasis);
export type EvaluatedAgainst = z.infer<typeof EvaluatedAgainstSchema>;

/** VIOLATED — Decision/Run/Call → Policy: policy violation (default deterministic/inferred). */
export const ViolatedSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z.literal('VIOLATED').describe('A policy was violated by a decision/run/call.'),
  ruleId: z.string().min(1).optional().describe('Specific policy rule that was violated.'),
  violationSeverity: z
    .enum(['info', 'low', 'medium', 'high', 'critical'])
    .optional()
    .describe('Severity of the violation.'),
}).superRefine(scoreMatchesBasis);
export type Violated = z.infer<typeof ViolatedSchema>;

/**
 * CAUSED — Activity/Entity → Activity/Effect: strong workflow-causal evidence
 * (default observed/declared/reconstructed). Requires at least one evidenceId
 * and a causation method satisfying the strong-CAUSED requirements (SPEC.md §10).
 */
export const CausedSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('CAUSED')
    .describe('Strong workflow-causal relationship backed by explicit evidence.'),
  causationMethod: z
    .enum([
      'explicit_producer_relation',
      'protocol_identifier_match',
      'direct_field_mapping',
      'side_effect_receipt',
      'signed_analyst_assertion',
    ])
    .describe(
      'Which strong-CAUSED requirement is satisfied: explicit producer relation, matching protocol request/response id, direct field mapping, deterministic side-effect receipt, or signed analyst assertion (SPEC.md §10).',
    ),
  evidenceIds: z
    .array(z.string().min(1))
    .min(1)
    .describe('CAUSED requires at least one evidenceId (AGENTS.md; SPEC.md §10).'),
}).superRefine(scoreMatchesBasis);
export type Caused = z.infer<typeof CausedSchema>;

/** MAY_HAVE_CAUSED — Activity/Entity → Activity/Effect: plausible but uncertain influence (default inferred/speculative). */
export const MayHaveCausedSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('MAY_HAVE_CAUSED')
    .describe('Plausible but uncertain influence; never sufficient alone for enforcement.'),
}).superRefine((edge, ctx) => {
  scoreMatchesBasis(edge, ctx);
  if (edge.confidence !== 'inferred' && edge.confidence !== 'speculative') {
    ctx.addIssue({
      code: 'custom',
      path: ['confidence'],
      message:
        "MAY_HAVE_CAUSED confidence must be 'inferred' or 'speculative' (SPEC.md §8 default confidence)",
    });
  }
});
export type MayHaveCaused = z.infer<typeof MayHaveCausedSchema>;

/** VERIFIED_BY — Entity/Effect/Decision → Verification: supporting verification (default observed). */
export const VerifiedBySchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('VERIFIED_BY')
    .describe('A claim/entity was supported by a verification activity.'),
}).superRefine(scoreMatchesBasis);
export type VerifiedBy = z.infer<typeof VerifiedBySchema>;

/** CONTRADICTED_BY — Assertion/Detection → Evidence/Verification: evidence contradicts claim (default observed/reconstructed). */
export const ContradictedBySchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('CONTRADICTED_BY')
    .describe('Evidence or verification contradicts a claim/detection.'),
}).superRefine(scoreMatchesBasis);
export type ContradictedBy = z.infer<typeof ContradictedBySchema>;

/** DETECTED_AS — Run/Path/Entity → Detection: detector judgment (default observed). */
export const DetectedAsSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z.literal('DETECTED_AS').describe('An entity/run/path was judged by a detector.'),
}).superRefine(scoreMatchesBasis);
export type DetectedAs = z.infer<typeof DetectedAsSchema>;

/** PART_OF_INCIDENT — Detection/Evidence/Run → Incident: investigation grouping (default declared). */
export const PartOfIncidentSchema = UniversalEdgeFieldsSchema.safeExtend({
  type: z
    .literal('PART_OF_INCIDENT')
    .describe('Investigation grouping of detections/evidence/runs into an incident.'),
  incidentRole: z
    .enum(['primary', 'contributing', 'related'])
    .optional()
    .describe('Role the source plays in the incident.'),
}).superRefine(scoreMatchesBasis);
export type PartOfIncident = z.infer<typeof PartOfIncidentSchema>;
