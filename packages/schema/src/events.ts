import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ConfidenceSchema,
  IsoTimestampSchema,
  ProvenanceRefSchema,
  SensitivitySchema,
  Sha256HashSchema,
  SourceKindSchema,
} from './common.js';
import { EdgeType } from './edge-registry.js';

/**
 * Canonical event envelope (SPEC.md §9) plus one schema per canonical event
 * family. The event ledger is append-only; canonical events are immutable after
 * append (AGENTS.md). Every event carries an integrity hash chain link and
 * bounded extensions (ADR-006).
 */

/** Producer identity of a canonical event (SPEC.md §12 adapter context). */
export const ProducerSchema = z.object({
  sourceKind: SourceKindSchema.describe('Telemetry source kind that produced the event.'),
  sourceId: z
    .string()
    .min(1)
    .describe('Stable identifier of the source record that produced this event.'),
  producerName: z
    .string()
    .min(1)
    .optional()
    .describe('Name of the producing system (e.g. adr-sensor).'),
  producerVersion: z.string().min(1).optional().describe('Version of the producing system.'),
  adapterName: z
    .string()
    .min(1)
    .optional()
    .describe('Name of the CATG adapter that normalized the event.'),
  adapterVersion: z.string().min(1).optional().describe('Version of the CATG adapter.'),
});
export type Producer = z.infer<typeof ProducerSchema>;

/** Subject context describing what the event is about (SPEC.md §9). */
export const SubjectContextSchema = z.object({
  tenantId: z
    .string()
    .min(1)
    .describe('Tenant the event belongs to; cross-tenant queries are forbidden.'),
  sessionId: z
    .string()
    .min(1)
    .optional()
    .describe('Session the event belongs to, when applicable.'),
  runId: z.string().min(1).optional().describe('Run the event belongs to, when applicable.'),
  principalId: z
    .string()
    .min(1)
    .optional()
    .describe('Principal the event is attributed to, when applicable.'),
  traceId: z.string().min(1).optional().describe('OpenTelemetry trace id, when applicable.'),
});
export type SubjectContext = z.infer<typeof SubjectContextSchema>;

/** Trace context (OpenTelemetry identifiers) for correlation (SPEC.md §9). */
export const TraceContextSchema = z.object({
  traceId: z
    .string()
    .regex(/^[a-f0-9]{32}$/, 'must be a 32-hex-char OpenTelemetry trace id')
    .optional()
    .describe('OpenTelemetry trace id (32 hex chars).'),
  spanId: z
    .string()
    .regex(/^[a-f0-9]{16}$/, 'must be a 16-hex-char OpenTelemetry span id')
    .optional()
    .describe('OpenTelemetry span id (16 hex chars).'),
  parentSpanId: z
    .string()
    .regex(/^[a-f0-9]{16}$/, 'must be a 16-hex-char OpenTelemetry span id')
    .optional()
    .describe('Parent span id (16 hex chars), when the span is nested.'),
  traceFlags: z
    .string()
    .min(1)
    .optional()
    .describe('OpenTelemetry trace flags (e.g. 01 for sampled).'),
  serviceName: z.string().min(1).optional().describe('Service that emitted the span.'),
});
export type TraceContext = z.infer<typeof TraceContextSchema>;

/** Identity context binding the event to principals/agents (SPEC.md §9). */
export const IdentityContextSchema = z.object({
  principalId: z
    .string()
    .min(1)
    .optional()
    .describe('URN of the principal associated with the event.'),
  agentId: z.string().min(1).optional().describe('URN of the agent associated with the event.'),
  sessionId: z.string().min(1).optional().describe('Session associated with the event.'),
});
export type IdentityContext = z.infer<typeof IdentityContextSchema>;

/** Security classification of an event (SPEC.md §9). */
export const SecurityClassificationSchema = z.object({
  classification: SensitivitySchema.describe(
    'Security classification (public|internal|restricted|secret).',
  ),
  handling: z
    .array(z.string().min(1))
    .default([])
    .describe('Handling caveats (e.g. do-not-forward, pseudonymize).'),
  redactionProfile: z
    .string()
    .min(1)
    .optional()
    .describe('Redaction profile applied to the event payload.'),
});
export type SecurityClassification = z.infer<typeof SecurityClassificationSchema>;

/**
 * Canonical event envelope (SPEC.md §9). `payload` is a free-form record here;
 * each event-family schema below narrows `eventType` to a literal and `payload`
 * to the family-specific payload schema.
 */
export const CanonicalEventEnvelopeSchema = z.object({
  eventId: z
    .string()
    .min(1)
    .describe(
      'Stable canonical event id — source-stable when the source provides one, otherwise derived (SPEC.md §9 idempotency).',
    ),
  schemaVersion: z.string().min(1).describe('Canonical event schema version (semver).'),
  eventType: z
    .string()
    .regex(
      /^[a-z][a-z0-9_.]*$/,
      'eventType must be a dotted lowercase canonical family name (e.g. run.started)',
    )
    .describe('Canonical event family name (SPEC.md §9).'),
  occurredAt: IsoTimestampSchema.describe(
    'When the underlying activity occurred, per source telemetry.',
  ),
  observedAt: IsoTimestampSchema.describe('When CATG observed/ingested the event.'),
  producer: ProducerSchema.describe('Producer of the event (source kind, adapter, versions).'),
  subject: SubjectContextSchema.describe(
    'Subject context (tenant, session, run, principal, trace).',
  ),
  traceContext: TraceContextSchema.describe('OpenTelemetry trace context for correlation.'),
  identityContext: IdentityContextSchema.describe(
    'Identity context binding the event to principals/agents.',
  ),
  payload: z
    .record(z.string(), z.unknown())
    .describe('Family-specific payload; event-family schemas narrow this to a typed payload.'),
  provenance: z
    .array(ProvenanceRefSchema)
    .default([])
    .describe('Provenance references to the source records this event derives from.'),
  securityClassification: SecurityClassificationSchema.describe(
    'Security classification of the event content.',
  ),
  integrityHash: Sha256HashSchema.describe(
    'sha256: content hash of the canonical serialization of this event (integrity hash chain, SPEC.md §9).',
  ),
  extensions: z
    .record(z.string(), z.unknown())
    .default({})
    .superRefine((ext, ctx) => {
      if (Object.keys(ext).length > 64) {
        ctx.addIssue({
          code: 'custom',
          path: ['extensions'],
          message: 'extensions must stay bounded (at most 64 keys, ADR-006)',
        });
      }
    })
    .describe('Bounded, non-authoritative source extensions preserved by adapters (ADR-006).'),
});
export type CanonicalEventEnvelope = z.infer<typeof CanonicalEventEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Event-family payloads (SPEC.md §9 — 25 family names listed under "24 types")
// ---------------------------------------------------------------------------

export const SourceRecordImportedPayloadSchema = z.object({
  sourceKind: SourceKindSchema.describe('Source kind of the imported record.'),
  sourceRecordId: z.string().min(1).describe('Stable id of the source record imported.'),
  recordCount: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Number of records in the import batch.'),
  firstObservedAt: IsoTimestampSchema.optional().describe(
    'Earliest observed timestamp in the batch.',
  ),
  adapterName: z.string().min(1).optional().describe('Adapter that imported the record.'),
  adapterVersion: z
    .string()
    .min(1)
    .optional()
    .describe('Adapter version that imported the record.'),
});
export type SourceRecordImportedPayload = z.infer<typeof SourceRecordImportedPayloadSchema>;

export const SessionObservedPayloadSchema = z.object({
  sessionId: z.string().min(1).describe('Session identifier observed.'),
  source: SourceKindSchema.describe('Source kind that reported the session.'),
  startedAt: IsoTimestampSchema.describe('When the session started.'),
  principalId: z
    .string()
    .min(1)
    .optional()
    .describe('Principal that initiated the session, when known.'),
  agentId: z.string().min(1).optional().describe('Agent associated with the session, when known.'),
  title: z.string().min(1).optional().describe('Optional session title.'),
});
export type SessionObservedPayload = z.infer<typeof SessionObservedPayloadSchema>;

export const RunStartedPayloadSchema = z.object({
  runId: z.string().min(1).describe('Run identifier.'),
  sessionId: z.string().min(1).optional().describe('Session containing the run.'),
  objective: z.string().min(1).optional().describe('Declared run objective.'),
  parentRunId: z.string().min(1).optional().describe('Parent run id for nested runs.'),
  startedAt: IsoTimestampSchema.describe('When the run started.'),
});
export type RunStartedPayload = z.infer<typeof RunStartedPayloadSchema>;

export const RunCompletedPayloadSchema = z.object({
  runId: z.string().min(1).describe('Run identifier.'),
  sessionId: z.string().min(1).optional().describe('Session containing the run.'),
  status: z.enum(['completed', 'failed', 'cancelled']).describe('Final run status.'),
  completedAt: IsoTimestampSchema.describe('When the run completed.'),
  durationMs: z.number().int().nonnegative().optional().describe('Run duration in milliseconds.'),
  exitReason: z
    .string()
    .min(1)
    .optional()
    .describe('Termination reason for non-normal completion.'),
});
export type RunCompletedPayload = z.infer<typeof RunCompletedPayloadSchema>;

export const MessageObservedPayloadSchema = z.object({
  messageId: z.string().min(1).describe('Message identifier.'),
  sessionId: z.string().min(1).describe('Session the message belongs to.'),
  role: z
    .enum(['user', 'assistant', 'system', 'tool', 'function', 'developer'])
    .describe('Message role.'),
  contentMode: z
    .enum(['raw', 'redacted', 'excerpt', 'hash_only', 'reference'])
    .describe('Content handling mode.'),
  contentHash: Sha256HashSchema.describe('sha256: content hash of the message body.'),
  sequenceId: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Ordering sequence within the session.'),
  tokenCount: z.number().int().nonnegative().optional().describe('Token count of the message.'),
});
export type MessageObservedPayload = z.infer<typeof MessageObservedPayloadSchema>;

export const InstructionExtractedPayloadSchema = z.object({
  instructionId: z
    .string()
    .min(1)
    .optional()
    .describe('Source-stable instruction identifier, when available.'),
  source: z
    .enum(['user', 'system', 'tool_output', 'external', 'unknown'])
    .describe('Origin of the instruction; tool_output/external origins are untrusted.'),
  instructionType: z
    .enum(['goal', 'constraint', 'context', 'injected', 'other'])
    .describe('Type of instruction extracted.'),
  contentMode: z
    .enum(['raw', 'redacted', 'excerpt', 'hash_only', 'reference'])
    .describe('Content handling mode.'),
  contentHash: Sha256HashSchema.describe('sha256: content hash of the instruction text.'),
  trustLevel: z
    .enum(['trusted', 'untrusted', 'unknown'])
    .describe('Trust assessment of the instruction origin.'),
});
export type InstructionExtractedPayload = z.infer<typeof InstructionExtractedPayloadSchema>;

export const ModelInvocationStartedPayloadSchema = z.object({
  invocationId: z.string().min(1).describe('Invocation identifier.'),
  traceId: z.string().min(1).optional().describe('OpenTelemetry trace id.'),
  spanId: z.string().min(1).optional().describe('OpenTelemetry span id.'),
  provider: z.string().min(1).optional().describe('Model provider.'),
  modelId: z.string().min(1).describe('Model identifier.'),
  operation: z
    .enum(['generate', 'chat', 'embed', 'tool_use', 'other'])
    .describe('Model operation.'),
  inputTokens: z.number().int().nonnegative().optional().describe('Input token count.'),
});
export type ModelInvocationStartedPayload = z.infer<typeof ModelInvocationStartedPayloadSchema>;

export const ModelInvocationCompletedPayloadSchema = z.object({
  invocationId: z.string().min(1).describe('Invocation identifier.'),
  traceId: z.string().min(1).optional().describe('OpenTelemetry trace id.'),
  spanId: z.string().min(1).optional().describe('OpenTelemetry span id.'),
  provider: z.string().min(1).optional().describe('Model provider.'),
  modelId: z.string().min(1).describe('Model identifier.'),
  outputTokens: z.number().int().nonnegative().optional().describe('Output token count.'),
  finishReason: z.string().min(1).optional().describe('Provider-reported finish reason.'),
  latencyMs: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Invocation latency in milliseconds.'),
});
export type ModelInvocationCompletedPayload = z.infer<typeof ModelInvocationCompletedPayloadSchema>;

export const ToolDefinitionObservedPayloadSchema = z.object({
  toolName: z.string().min(1).describe('Normalized tool name.'),
  namespace: z.string().min(1).optional().describe('Package/server namespace of the tool.'),
  version: z.string().min(1).optional().describe('Tool version.'),
  toolKind: z.enum(['function', 'mcp', 'shell', 'api', 'other']).describe('Kind of tool.'),
  serverName: z
    .string()
    .min(1)
    .optional()
    .describe('MCP server name exposing the tool, when applicable.'),
  protocolVersion: z.string().min(1).optional().describe('MCP protocol version.'),
});
export type ToolDefinitionObservedPayload = z.infer<typeof ToolDefinitionObservedPayloadSchema>;

export const ToolCallObservedPayloadSchema = z.object({
  callId: z.string().min(1).describe('Call identifier (e.g. MCP request id).'),
  toolName: z.string().min(1).describe('Name of the tool invoked.'),
  argumentsHash: Sha256HashSchema.describe('sha256: content hash of the serialized arguments.'),
  status: z
    .enum(['pending', 'executing', 'succeeded', 'failed', 'denied'])
    .describe('Call status.'),
  requestId: z.string().min(1).optional().describe('Protocol request id for correlation.'),
  messageId: z.string().min(1).optional().describe('Message that requested the call.'),
  sessionId: z.string().min(1).optional().describe('Session containing the call.'),
});
export type ToolCallObservedPayload = z.infer<typeof ToolCallObservedPayloadSchema>;

export const ToolResultObservedPayloadSchema = z.object({
  resultId: z
    .string()
    .min(1)
    .optional()
    .describe('Source-stable result identifier, when available.'),
  callId: z.string().min(1).describe('Call identifier the result belongs to.'),
  contentMode: z
    .enum(['raw', 'redacted', 'excerpt', 'hash_only', 'reference'])
    .describe('Content handling mode.'),
  contentHash: Sha256HashSchema.describe('sha256: content hash of the result body.'),
  isError: z.boolean().describe('Whether the call failed.'),
  exitCode: z.number().int().optional().describe('Process exit code for subprocess tools.'),
  durationMs: z.number().int().nonnegative().optional().describe('Call duration in milliseconds.'),
});
export type ToolResultObservedPayload = z.infer<typeof ToolResultObservedPayloadSchema>;

export const ResourceAccessedPayloadSchema = z.object({
  resourceUri: z.string().min(1).describe('URI of the accessed resource.'),
  resourceKind: z
    .enum(['file', 'database', 'api', 'url', 'memory', 'other'])
    .describe('Kind of resource.'),
  accessType: z
    .enum(['read', 'write', 'list', 'execute', 'delete', 'other'])
    .describe('Access operation performed.'),
  callerId: z.string().min(1).optional().describe('URN of the caller that accessed the resource.'),
  contentHash: Sha256HashSchema.optional().describe(
    'sha256: content hash of the resource, when known.',
  ),
});
export type ResourceAccessedPayload = z.infer<typeof ResourceAccessedPayloadSchema>;

export const DataObjectClassifiedPayloadSchema = z.object({
  objectId: z
    .string()
    .min(1)
    .optional()
    .describe('Source-stable object identifier, when available.'),
  contentHash: Sha256HashSchema.describe('sha256: content hash of the object.'),
  classification: SensitivitySchema.describe(
    'Assigned classification (public|internal|restricted|secret).',
  ),
  classifier: z
    .string()
    .min(1)
    .describe('Classifier that assigned the classification (rule, model, or analyst).'),
  reason: z.string().min(1).optional().describe('Rationale for the classification.'),
});
export type DataObjectClassifiedPayload = z.infer<typeof DataObjectClassifiedPayloadSchema>;

export const CredentialDetectedPayloadSchema = z.object({
  fingerprint: z
    .string()
    .regex(
      /^hmac:[a-f0-9]{64}$/,
      'credential fingerprints must be keyed HMAC-SHA256 (hmac: + 64 hex chars)',
    )
    .describe('Keyed HMAC fingerprint of the detected credential.'),
  credentialType: z
    .enum(['api_key', 'token', 'password', 'certificate', 'ssh_key', 'session_token', 'other'])
    .describe('Type of credential detected.'),
  targetService: z.string().min(1).optional().describe('Service the credential targets.'),
  detectionMethod: z
    .enum(['regex', 'hmac_match', 'classifier', 'manual', 'other'])
    .describe('Method that detected the credential.'),
  severity: z
    .enum(['info', 'low', 'medium', 'high', 'critical'])
    .optional()
    .describe('Severity of the detection.'),
});
export type CredentialDetectedPayload = z.infer<typeof CredentialDetectedPayloadSchema>;

export const ApprovalRequestedPayloadSchema = z.object({
  requestId: z.string().min(1).describe('Approval request identifier.'),
  requestedBy: z.string().min(1).describe('URN of the requester (agent/run).'),
  requestedAction: z.string().min(1).describe('Action requiring approval.'),
  resourceRef: z.string().min(1).optional().describe('Resource the action targets.'),
  justification: z.string().min(1).optional().describe('Requester justification.'),
  expiresAt: IsoTimestampSchema.optional().describe('Expiry of the request.'),
});
export type ApprovalRequestedPayload = z.infer<typeof ApprovalRequestedPayloadSchema>;

export const ApprovalDecidedPayloadSchema = z.object({
  requestId: z.string().min(1).describe('Approval request identifier being decided.'),
  decision: z.enum(['approved', 'denied', 'deferred']).describe('Human decision.'),
  decidedBy: z.string().min(1).describe('URN of the principal that decided.'),
  reason: z.string().min(1).optional().describe('Optional decision rationale.'),
});
export type ApprovalDecidedPayload = z.infer<typeof ApprovalDecidedPayloadSchema>;

export const DelegationObservedPayloadSchema = z.object({
  delegatorId: z.string().min(1).describe('URN of the delegating agent/principal.'),
  delegateeId: z.string().min(1).describe('URN of the delegatee.'),
  authorityScope: z.string().min(1).describe('Scope of delegated authority.'),
  revoked: z.boolean().optional().describe('Whether the delegation was revoked.'),
  expiresAt: IsoTimestampSchema.optional().describe('Optional delegation expiry.'),
});
export type DelegationObservedPayload = z.infer<typeof DelegationObservedPayloadSchema>;

export const ExternalEffectObservedPayloadSchema = z.object({
  effectKind: z
    .enum(['mutation', 'network', 'email', 'purchase', 'filesystem', 'http', 'other'])
    .describe('Kind of external effect.'),
  target: z.string().min(1).describe('External target (URL, host, path, ...).'),
  mutation: z
    .boolean()
    .describe('Whether the effect mutates external state (triggers production-mutation policy).'),
  production: z.boolean().describe('Whether the target is a production system.'),
  outcome: z.enum(['attempted', 'succeeded', 'failed', 'unknown']).describe('Observed outcome.'),
});
export type ExternalEffectObservedPayload = z.infer<typeof ExternalEffectObservedPayloadSchema>;

export const VerificationObservedPayloadSchema = z.object({
  verificationId: z.string().min(1).optional().describe('Source-stable verification identifier.'),
  verificationType: z
    .enum(['manual', 'automated', 'protocol', 'crypto', 'other'])
    .describe('Kind of verification.'),
  method: z.string().min(1).describe('Verification method description.'),
  result: z.enum(['verified', 'contradicted', 'inconclusive']).describe('Verification outcome.'),
  verifierId: z.string().min(1).describe('URN of the verifier.'),
  targetRef: z.string().min(1).optional().describe('Reference to the claim/artifact verified.'),
});
export type VerificationObservedPayload = z.infer<typeof VerificationObservedPayloadSchema>;

export const EdgeAssertedPayloadSchema = z.object({
  edgeId: z.string().min(1).describe('Immutable edge assertion identifier.'),
  edgeType: z
    .nativeEnum(EdgeType)
    .describe('Edge type being asserted (one of the 27 edge registry types).'),
  fromId: z.string().min(1).describe('Source node URN.'),
  toId: z.string().min(1).describe('Target node URN.'),
  confidence: ConfidenceSchema.describe('Confidence of the assertion on the five-value scale.'),
  confidenceScore: z.number().min(0).max(1).describe('Numeric confidence score in [0,1].'),
  causalBasis: z
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
    .describe('Linker basis establishing the edge.'),
  evidenceIds: z
    .array(z.string().min(1))
    .default([])
    .describe('Ledger event ids or content hashes evidencing the edge.'),
  linkerId: z.string().min(1).optional().describe('Linker that asserted the edge.'),
  linkerVersion: z.string().min(1).optional().describe('Linker version that asserted the edge.'),
});
export type EdgeAssertedPayload = z.infer<typeof EdgeAssertedPayloadSchema>;

export const PolicyEvaluatedPayloadSchema = z.object({
  evaluationId: z.string().min(1).optional().describe('Evaluation identifier.'),
  policyId: z.string().min(1).describe('Policy identifier evaluated.'),
  policyVersion: z.string().min(1).describe('Immutable policy version evaluated.'),
  decision: z
    .enum(['ALLOW', 'DENY', 'REQUIRE_APPROVAL', 'FLAG', 'INDETERMINATE', 'NOT_APPLICABLE'])
    .describe('Policy verdict (SPEC.md §13).'),
  subjectRef: z
    .string()
    .min(1)
    .optional()
    .describe('Reference to the subject the policy was evaluated against.'),
  ruleId: z.string().min(1).optional().describe('Rule that matched, when applicable.'),
  reason: z.string().min(1).optional().describe('Explanation of the decision.'),
});
export type PolicyEvaluatedPayload = z.infer<typeof PolicyEvaluatedPayloadSchema>;

export const DetectorExecutedPayloadSchema = z.object({
  runId: z.string().min(1).describe('Detector run identifier.'),
  detectorName: z.string().min(1).describe('Detector name.'),
  detectorVersion: z.string().min(1).describe('Detector version.'),
  verdict: z
    .enum(['malicious', 'suspicious', 'benign', 'inconclusive'])
    .describe('Detector verdict.'),
  severity: z
    .enum(['info', 'low', 'medium', 'high', 'critical'])
    .optional()
    .describe('Finding severity.'),
  evidenceSnapshotHash: Sha256HashSchema.describe(
    'sha256: hash of the evidence snapshot the verdict is based on.',
  ),
  score: z.number().min(0).max(1).optional().describe('Detector confidence score in [0,1].'),
});
export type DetectorExecutedPayload = z.infer<typeof DetectorExecutedPayloadSchema>;

export const IncidentUpdatedPayloadSchema = z.object({
  incidentId: z.string().min(1).describe('Incident identifier.'),
  status: z
    .enum(['open', 'investigating', 'contained', 'resolved', 'closed'])
    .describe('Incident lifecycle status.'),
  severity: z
    .enum(['info', 'low', 'medium', 'high', 'critical'])
    .optional()
    .describe('Incident severity.'),
  title: z.string().min(1).optional().describe('Incident title.'),
  updateType: z
    .enum(['created', 'status_changed', 'evidence_added', 'note_added', 'closed', 'other'])
    .describe('Kind of update applied to the incident.'),
  summary: z.string().min(1).optional().describe('Update summary/note.'),
});
export type IncidentUpdatedPayload = z.infer<typeof IncidentUpdatedPayloadSchema>;

export const EvidenceCreatedPayloadSchema = z.object({
  artifactId: z.string().min(1).optional().describe('Evidence artifact identifier.'),
  artifactKind: z
    .enum([
      'event_bundle',
      'edge_assertion',
      'transcript_excerpt',
      'tool_output',
      'policy_decision',
      'detector_finding',
      'other',
    ])
    .describe('Kind of evidence artifact.'),
  contentHash: Sha256HashSchema.describe('sha256: content hash of the artifact.'),
  contentMode: z
    .enum(['raw', 'redacted', 'excerpt', 'hash_only', 'reference'])
    .describe('Content handling mode.'),
  redacted: z.boolean().describe('Whether the artifact content is redacted.'),
  sourceEventIds: z
    .array(z.string().min(1))
    .default([])
    .describe('Ledger event ids captured in the artifact.'),
  description: z.string().min(1).optional().describe('Human-readable description of the evidence.'),
});
export type EvidenceCreatedPayload = z.infer<typeof EvidenceCreatedPayloadSchema>;

export const ProjectionCheckpointedPayloadSchema = z.object({
  projectionVersion: z.string().min(1).describe('Graph projection schema version.'),
  checkpointId: z.string().min(1).optional().describe('Checkpoint identifier.'),
  nodeCount: z.number().int().nonnegative().describe('Nodes projected at this checkpoint.'),
  edgeCount: z.number().int().nonnegative().describe('Edges projected at this checkpoint.'),
  eventCount: z.number().int().nonnegative().describe('Ledger events covered by this checkpoint.'),
  projectedAt: IsoTimestampSchema.optional().describe('When the checkpoint was written.'),
});
export type ProjectionCheckpointedPayload = z.infer<typeof ProjectionCheckpointedPayloadSchema>;

// ---------------------------------------------------------------------------
// Event-family schemas (SPEC.md §9). Each narrows eventType + payload.
// ---------------------------------------------------------------------------

export const SourceRecordImportedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z
    .literal('source_record.imported')
    .describe('A source record was imported into the ledger.'),
  payload: SourceRecordImportedPayloadSchema.describe('Import metadata for the source record.'),
});
export type SourceRecordImportedEvent = z.infer<typeof SourceRecordImportedEventSchema>;

export const SessionObservedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('session.observed').describe('A session was observed.'),
  payload: SessionObservedPayloadSchema.describe('Session observation metadata.'),
});
export type SessionObservedEvent = z.infer<typeof SessionObservedEventSchema>;

export const RunStartedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('run.started').describe('An agent run started.'),
  payload: RunStartedPayloadSchema.describe('Run start metadata.'),
});
export type RunStartedEvent = z.infer<typeof RunStartedEventSchema>;

export const RunCompletedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('run.completed').describe('An agent run completed.'),
  payload: RunCompletedPayloadSchema.describe('Run completion metadata.'),
});
export type RunCompletedEvent = z.infer<typeof RunCompletedEventSchema>;

export const MessageObservedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('message.observed').describe('A chat message was observed.'),
  payload: MessageObservedPayloadSchema.describe('Message observation metadata.'),
});
export type MessageObservedEvent = z.infer<typeof MessageObservedEventSchema>;

export const InstructionExtractedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z
    .literal('instruction.extracted')
    .describe('An instruction was extracted from telemetry.'),
  payload: InstructionExtractedPayloadSchema.describe('Extracted instruction metadata.'),
});
export type InstructionExtractedEvent = z.infer<typeof InstructionExtractedEventSchema>;

export const ModelInvocationStartedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('model.invocation.started').describe('A model invocation started.'),
  payload: ModelInvocationStartedPayloadSchema.describe('Model invocation start metadata.'),
});
export type ModelInvocationStartedEvent = z.infer<typeof ModelInvocationStartedEventSchema>;

export const ModelInvocationCompletedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('model.invocation.completed').describe('A model invocation completed.'),
  payload: ModelInvocationCompletedPayloadSchema.describe('Model invocation completion metadata.'),
});
export type ModelInvocationCompletedEvent = z.infer<typeof ModelInvocationCompletedEventSchema>;

export const ToolDefinitionObservedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('tool.definition.observed').describe('A tool definition was observed.'),
  payload: ToolDefinitionObservedPayloadSchema.describe('Tool definition metadata.'),
});
export type ToolDefinitionObservedEvent = z.infer<typeof ToolDefinitionObservedEventSchema>;

export const ToolCallObservedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('tool_call.observed').describe('A tool call was observed.'),
  payload: ToolCallObservedPayloadSchema.describe('Tool call metadata.'),
});
export type ToolCallObservedEvent = z.infer<typeof ToolCallObservedEventSchema>;

export const ToolResultObservedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('tool_result.observed').describe('A tool result was observed.'),
  payload: ToolResultObservedPayloadSchema.describe('Tool result metadata.'),
});
export type ToolResultObservedEvent = z.infer<typeof ToolResultObservedEventSchema>;

export const ResourceAccessedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('resource.accessed').describe('A resource was accessed.'),
  payload: ResourceAccessedPayloadSchema.describe('Resource access metadata.'),
});
export type ResourceAccessedEvent = z.infer<typeof ResourceAccessedEventSchema>;

export const DataObjectClassifiedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('data_object.classified').describe('A data object was classified.'),
  payload: DataObjectClassifiedPayloadSchema.describe('Data object classification metadata.'),
});
export type DataObjectClassifiedEvent = z.infer<typeof DataObjectClassifiedEventSchema>;

export const CredentialDetectedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('credential.detected').describe('A credential was detected.'),
  payload: CredentialDetectedPayloadSchema.describe('Credential detection metadata.'),
});
export type CredentialDetectedEvent = z.infer<typeof CredentialDetectedEventSchema>;

export const ApprovalRequestedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('approval.requested').describe('An approval was requested.'),
  payload: ApprovalRequestedPayloadSchema.describe('Approval request metadata.'),
});
export type ApprovalRequestedEvent = z.infer<typeof ApprovalRequestedEventSchema>;

export const ApprovalDecidedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('approval.decided').describe('An approval was decided.'),
  payload: ApprovalDecidedPayloadSchema.describe('Approval decision metadata.'),
});
export type ApprovalDecidedEvent = z.infer<typeof ApprovalDecidedEventSchema>;

export const DelegationObservedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('delegation.observed').describe('A delegation was observed.'),
  payload: DelegationObservedPayloadSchema.describe('Delegation metadata.'),
});
export type DelegationObservedEvent = z.infer<typeof DelegationObservedEventSchema>;

export const ExternalEffectObservedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('external_effect.observed').describe('An external effect was observed.'),
  payload: ExternalEffectObservedPayloadSchema.describe('External effect metadata.'),
});
export type ExternalEffectObservedEvent = z.infer<typeof ExternalEffectObservedEventSchema>;

export const VerificationObservedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('verification.observed').describe('A verification was observed.'),
  payload: VerificationObservedPayloadSchema.describe('Verification metadata.'),
});
export type VerificationObservedEvent = z.infer<typeof VerificationObservedEventSchema>;

export const EdgeAssertedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('edge.asserted').describe('An edge assertion was appended to the ledger.'),
  payload: EdgeAssertedPayloadSchema.describe('Edge assertion metadata.'),
});
export type EdgeAssertedEvent = z.infer<typeof EdgeAssertedEventSchema>;

export const PolicyEvaluatedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('policy.evaluated').describe('A policy was evaluated.'),
  payload: PolicyEvaluatedPayloadSchema.describe('Policy evaluation metadata.'),
});
export type PolicyEvaluatedEvent = z.infer<typeof PolicyEvaluatedEventSchema>;

export const DetectorExecutedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('detector.executed').describe('A detector executed.'),
  payload: DetectorExecutedPayloadSchema.describe('Detector execution metadata.'),
});
export type DetectorExecutedEvent = z.infer<typeof DetectorExecutedEventSchema>;

export const IncidentUpdatedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('incident.updated').describe('An incident was updated.'),
  payload: IncidentUpdatedPayloadSchema.describe('Incident update metadata.'),
});
export type IncidentUpdatedEvent = z.infer<typeof IncidentUpdatedEventSchema>;

export const EvidenceCreatedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z.literal('evidence.created').describe('An evidence artifact was created.'),
  payload: EvidenceCreatedPayloadSchema.describe('Evidence artifact metadata.'),
});
export type EvidenceCreatedEvent = z.infer<typeof EvidenceCreatedEventSchema>;

export const ProjectionCheckpointedEventSchema = CanonicalEventEnvelopeSchema.extend({
  eventType: z
    .literal('projection.checkpointed')
    .describe('A graph projection checkpoint was written.'),
  payload: ProjectionCheckpointedPayloadSchema.describe('Projection checkpoint metadata.'),
});
export type ProjectionCheckpointedEvent = z.infer<typeof ProjectionCheckpointedEventSchema>;

// ---------------------------------------------------------------------------
// Dedupe key (SPEC.md §9 idempotency)
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON stringify with sorted keys — a local approximation of the
 * canonical serialization used by `@catg/canonical-json` (which the schema
 * package must not depend on). Used only to hash payload content.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}

/** SHA-256 hex digest of a UTF-8 string. */
export function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/** sha256: content hash of a payload's canonical (sorted-key) JSON serialization. */
export function canonicalPayloadHash(payload: unknown): string {
  return `sha256:${sha256Hex(stableStringify(payload))}`;
}

/** Normalize an event type for dedupe: trim + lowercase (SPEC.md §9). */
export function normalizeEventType(eventType: string): string {
  return eventType.trim().toLowerCase();
}

/** Normalize an occurred-at timestamp for dedupe: canonical UTC ISO-8601. */
export function normalizeOccurredAt(occurredAt: string): string {
  const trimmed = occurredAt.trim();
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return trimmed;
  }
  return date.toISOString();
}

export interface DedupeKeyInput {
  /** Tenant namespace (tenant_id). */
  tenantId: string;
  /** Source kind (source_kind). */
  sourceKind: string;
  /** Stable source record id (source_record_id). */
  sourceRecordId: string;
  /** Canonical event type; normalized internally (normalized_event_type). */
  eventType: string;
  /** Occurred-at timestamp; normalized internally (normalized_occurred_at). */
  occurredAt: string;
  /** sha256: canonical content hash of the event payload (canonical_payload_hash). */
  canonicalPayloadHash: string;
}

/**
 * Compute the idempotency dedupe key (SPEC.md §9):
 * `SHA256(tenant_id || source_kind || source_record_id || normalized_event_type
 * || normalized_occurred_at || canonical_payload_hash)` — the `||` separator is
 * included literally to avoid ambiguity between component boundaries. The ledger
 * keeps a unique index on (tenant_id, dedupe_key).
 */
export function computeDedupeKey(input: DedupeKeyInput): string {
  const raw = [
    input.tenantId,
    input.sourceKind,
    input.sourceRecordId,
    normalizeEventType(input.eventType),
    normalizeOccurredAt(input.occurredAt),
    input.canonicalPayloadHash,
  ].join('||');
  return sha256Hex(raw);
}

/** All canonical event family names (SPEC.md §9 lists 25 names under a "24 types" header). */
export enum EventFamily {
  SourceRecordImported = 'source_record.imported',
  SessionObserved = 'session.observed',
  RunStarted = 'run.started',
  RunCompleted = 'run.completed',
  MessageObserved = 'message.observed',
  InstructionExtracted = 'instruction.extracted',
  ModelInvocationStarted = 'model.invocation.started',
  ModelInvocationCompleted = 'model.invocation.completed',
  ToolDefinitionObserved = 'tool.definition.observed',
  ToolCallObserved = 'tool_call.observed',
  ToolResultObserved = 'tool_result.observed',
  ResourceAccessed = 'resource.accessed',
  DataObjectClassified = 'data_object.classified',
  CredentialDetected = 'credential.detected',
  ApprovalRequested = 'approval.requested',
  ApprovalDecided = 'approval.decided',
  DelegationObserved = 'delegation.observed',
  ExternalEffectObserved = 'external_effect.observed',
  VerificationObserved = 'verification.observed',
  EdgeAsserted = 'edge.asserted',
  PolicyEvaluated = 'policy.evaluated',
  DetectorExecuted = 'detector.executed',
  IncidentUpdated = 'incident.updated',
  EvidenceCreated = 'evidence.created',
  ProjectionCheckpointed = 'projection.checkpointed',
}

/** Map of event family name → envelope schema. */
export const EVENT_FAMILY_SCHEMAS = {
  [EventFamily.SourceRecordImported]: SourceRecordImportedEventSchema,
  [EventFamily.SessionObserved]: SessionObservedEventSchema,
  [EventFamily.RunStarted]: RunStartedEventSchema,
  [EventFamily.RunCompleted]: RunCompletedEventSchema,
  [EventFamily.MessageObserved]: MessageObservedEventSchema,
  [EventFamily.InstructionExtracted]: InstructionExtractedEventSchema,
  [EventFamily.ModelInvocationStarted]: ModelInvocationStartedEventSchema,
  [EventFamily.ModelInvocationCompleted]: ModelInvocationCompletedEventSchema,
  [EventFamily.ToolDefinitionObserved]: ToolDefinitionObservedEventSchema,
  [EventFamily.ToolCallObserved]: ToolCallObservedEventSchema,
  [EventFamily.ToolResultObserved]: ToolResultObservedEventSchema,
  [EventFamily.ResourceAccessed]: ResourceAccessedEventSchema,
  [EventFamily.DataObjectClassified]: DataObjectClassifiedEventSchema,
  [EventFamily.CredentialDetected]: CredentialDetectedEventSchema,
  [EventFamily.ApprovalRequested]: ApprovalRequestedEventSchema,
  [EventFamily.ApprovalDecided]: ApprovalDecidedEventSchema,
  [EventFamily.DelegationObserved]: DelegationObservedEventSchema,
  [EventFamily.ExternalEffectObserved]: ExternalEffectObservedEventSchema,
  [EventFamily.VerificationObserved]: VerificationObservedEventSchema,
  [EventFamily.EdgeAsserted]: EdgeAssertedEventSchema,
  [EventFamily.PolicyEvaluated]: PolicyEvaluatedEventSchema,
  [EventFamily.DetectorExecuted]: DetectorExecutedEventSchema,
  [EventFamily.IncidentUpdated]: IncidentUpdatedEventSchema,
  [EventFamily.EvidenceCreated]: EvidenceCreatedEventSchema,
  [EventFamily.ProjectionCheckpointed]: ProjectionCheckpointedEventSchema,
} as const satisfies Record<EventFamily, z.ZodType<unknown>>;
