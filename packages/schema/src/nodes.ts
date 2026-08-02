import { z } from 'zod';
import {
  ContentModeSchema,
  IsoTimestampSchema,
  SensitivitySchema,
  Sha256HashSchema,
  SourceKindSchema,
  UniversalNodeFieldsSchema,
} from './common.js';

/**
 * Zod schemas + inferred types for all 28 CATG node types (SPEC.md §8
 * "Node-Type Registry"). Each type extends the universal node fields and adds
 * type-specific fields. Field choices are derived from SPEC.md §8 (identifier
 * strategy, edge participation) and §9 (corresponding event families).
 */

// ---------------------------------------------------------------------------
// Identity (4)
// ---------------------------------------------------------------------------

/** Human principal — tenant namespace + issuer + subject identifier (SPEC.md §8). */
export const HumanPrincipalSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('HumanPrincipal').describe('A human user principal in the tenant namespace.'),
  issuer: z
    .string()
    .min(1)
    .describe('Identity issuer (e.g. tenant SSO provider) that vouches for the principal.'),
  subject: z
    .string()
    .min(1)
    .describe(
      'Subject identifier issued by the issuer; combined with issuer forms the stable identity.',
    ),
  displayName: z
    .string()
    .min(1)
    .optional()
    .describe('Human-readable display name; may be pseudonymized per anti-surveillance policy.'),
  email: z
    .string()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'must be a valid email address')
    .optional()
    .describe('Contact email for the principal; never used as the opaque id.'),
  roles: z
    .array(z.string().min(1))
    .default([])
    .describe('RBAC roles granted to the principal in the tenant.'),
});
export type HumanPrincipal = z.infer<typeof HumanPrincipalSchema>;

/** Service principal — non-human automation identity (SPEC.md §8). */
export const ServicePrincipalSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('ServicePrincipal').describe('A non-human service/automation principal.'),
  issuer: z.string().min(1).describe('Identity issuer that vouches for the service principal.'),
  subject: z
    .string()
    .min(1)
    .describe(
      'Subject identifier issued by the issuer; combined with issuer forms the stable identity.',
    ),
  serviceName: z.string().min(1).describe('Name of the service this principal belongs to.'),
  purpose: z
    .string()
    .min(1)
    .optional()
    .describe('Declared purpose of the service principal (e.g. ci-runner, backup-worker).'),
  roles: z
    .array(z.string().min(1))
    .default([])
    .describe('RBAC roles granted to the service principal in the tenant.'),
});
export type ServicePrincipal = z.infer<typeof ServicePrincipalSchema>;

/** Agent — an LLM-backed or autonomous agent acting on behalf of principals (SPEC.md §8). */
export const AgentSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('Agent').describe('An agent that exercises delegated authority.'),
  provider: z
    .string()
    .min(1)
    .optional()
    .describe('Model/provider vendor (e.g. anthropic, openai); vendor-neutral if unknown.'),
  modelName: z
    .string()
    .min(1)
    .optional()
    .describe('Model identifier used by this agent (e.g. claude-sonnet-4).'),
  agentKind: z
    .enum(['coding', 'general', 'autonomous', 'assistant', 'other'])
    .describe('Kind of agent (coding agent, autonomous workflow, assistant, other).'),
  instructionsRef: z
    .string()
    .min(1)
    .optional()
    .describe('Reference to the instruction set governing this agent (URN or content hash).'),
});
export type Agent = z.infer<typeof AgentSchema>;

/** AgentSession — a session that contains activities (e.g. ADR sessionId) (SPEC.md §8). */
export const AgentSessionSchema = UniversalNodeFieldsSchema.extend({
  type: z
    .literal('AgentSession')
    .describe('A session grouping agent activities (e.g. ADR sessionId).'),
  sessionId: z.string().min(1).describe('Source-stable session identifier (e.g. ADR sessionId).'),
  source: SourceKindSchema.describe('Source kind that reported the session (adr, otel, mcp, ...).'),
  title: z.string().min(1).optional().describe('Optional human-readable session title.'),
  parentSessionId: z
    .string()
    .min(1)
    .optional()
    .describe('Parent session id when sessions are nested.'),
});
export type AgentSession = z.infer<typeof AgentSessionSchema>;

// ---------------------------------------------------------------------------
// Execution (3)
// ---------------------------------------------------------------------------

/** AgentRun — a run of an agent workflow (SPEC.md §8; event families run.started/run.completed). */
export const AgentRunSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('AgentRun').describe('A run of an agent workflow.'),
  runId: z.string().min(1).describe('Source-stable run identifier (source-record-backed).'),
  sessionId: z.string().min(1).optional().describe('Session that contains this run.'),
  status: z
    .enum(['started', 'completed', 'failed', 'cancelled'])
    .describe('Lifecycle status of the run at the time this node was recorded.'),
  objective: z.string().min(1).optional().describe('Declared objective of the run.'),
  exitReason: z
    .string()
    .min(1)
    .optional()
    .describe('Reason for termination when the run did not complete normally.'),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

/** ModelInvocation — an LLM invocation recorded as an OTel span (SPEC.md §8 identifier strategy). */
export const ModelInvocationSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('ModelInvocation').describe('An LLM model invocation.'),
  traceId: z
    .string()
    .regex(/^[a-f0-9]{32}$/, 'must be a 32-hex-char OpenTelemetry trace id')
    .describe('OpenTelemetry trace id (32 hex chars).'),
  spanId: z
    .string()
    .regex(/^[a-f0-9]{16}$/, 'must be a 16-hex-char OpenTelemetry span id')
    .describe('OpenTelemetry span id (16 hex chars).'),
  provider: z.string().min(1).optional().describe('Model provider (e.g. anthropic, openai).'),
  modelId: z.string().min(1).describe('Model identifier (e.g. claude-sonnet-4).'),
  operation: z
    .enum(['generate', 'chat', 'embed', 'tool_use', 'other'])
    .describe('Kind of model operation performed.'),
  inputTokens: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Input token count reported by the provider.'),
  outputTokens: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Output token count reported by the provider.'),
  finishReason: z
    .string()
    .min(1)
    .optional()
    .describe('Provider-reported finish reason (e.g. end_turn, tool_use).'),
});
export type ModelInvocation = z.infer<typeof ModelInvocationSchema>;

/** PlanStep — a step within a plan executed by an agent (SPEC.md §8). */
export const PlanStepSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('PlanStep').describe('A step within an agent plan.'),
  stepId: z.string().min(1).describe('Source-stable step identifier.'),
  planId: z.string().min(1).optional().describe('Identifier of the plan this step belongs to.'),
  stepIndex: z
    .number()
    .int()
    .nonnegative()
    .describe('Zero-based index of this step within the plan.'),
  description: z.string().min(1).optional().describe('Natural-language description of the step.'),
  status: z
    .enum(['pending', 'in_progress', 'completed', 'failed', 'skipped'])
    .describe('Execution status of the step.'),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

// ---------------------------------------------------------------------------
// Communication (3)
// ---------------------------------------------------------------------------

/** Prompt — the input sent to a model (SPEC.md §8; event family message.observed). */
export const PromptSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('Prompt').describe('A prompt submitted to a model.'),
  contentMode: ContentModeSchema.describe(
    'Content handling mode (raw, redacted, excerpt, hash_only, reference).',
  ),
  contentHash: Sha256HashSchema.describe('sha256: content hash of the prompt content.'),
  templateId: z
    .string()
    .min(1)
    .optional()
    .describe('Identifier of the prompt template this prompt instantiates, if any.'),
  tokenCount: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Approximate token count of the prompt.'),
});
export type Prompt = z.infer<typeof PromptSchema>;

/** Message — an ADR chat message (SPEC.md §8 identifier strategy: urn:catg:adr:{sessionId}:message:{sequenceId}). */
export const MessageSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('Message').describe('A chat message in a session transcript.'),
  messageId: z.string().min(1).describe('Source-stable message identifier (e.g. ADR sequenceId).'),
  sessionId: z.string().min(1).describe('Session this message belongs to.'),
  role: z
    .enum(['user', 'assistant', 'system', 'tool', 'function', 'developer'])
    .describe('Message role in the conversation.'),
  contentMode: ContentModeSchema.describe('Content handling mode for the message body.'),
  contentHash: Sha256HashSchema.describe('sha256: content hash of the message body.'),
  sequenceId: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Ordering sequence of the message within the session.'),
});
export type Message = z.infer<typeof MessageSchema>;

/** Instruction — an extracted instruction (event family instruction.extracted). */
export const InstructionSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('Instruction').describe('An instruction extracted from telemetry.'),
  instructionType: z
    .enum(['goal', 'constraint', 'context', 'injected', 'other'])
    .describe('Type of instruction (goal, constraint, context, injected, other).'),
  origin: z
    .enum(['user', 'system', 'tool_output', 'external', 'unknown'])
    .describe('Origin of the instruction; tool_output/external origins are untrusted.'),
  contentMode: ContentModeSchema.describe('Content handling mode for the instruction text.'),
  contentHash: Sha256HashSchema.describe('sha256: content hash of the instruction text.'),
});
export type Instruction = z.infer<typeof InstructionSchema>;

// ---------------------------------------------------------------------------
// Tooling (4)
// ---------------------------------------------------------------------------

/** Tool — a tool definition (SPEC.md §8 identifier strategy: package/server namespace + name + version). */
export const ToolSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('Tool').describe('A tool definition available to agents.'),
  toolName: z.string().min(1).describe('Normalized tool name.'),
  namespace: z
    .string()
    .min(1)
    .optional()
    .describe('Package or server namespace the tool belongs to.'),
  version: z.string().min(1).optional().describe('Tool version.'),
  toolKind: z
    .enum(['function', 'mcp', 'shell', 'api', 'other'])
    .describe('Kind of tool (function, mcp, shell, api, other).'),
  description: z
    .string()
    .min(1)
    .optional()
    .describe('Tool description; treated as untrusted content.'),
});
export type Tool = z.infer<typeof ToolSchema>;

/** ToolCall — an invocation of a tool (SPEC.md §8 identifier: hash of session/message/tool index/identity). */
export const ToolCallSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('ToolCall').describe('An invocation of a tool by an agent.'),
  callId: z.string().min(1).describe('Source-stable call identifier (e.g. MCP request id).'),
  toolName: z.string().min(1).describe('Name of the tool invoked.'),
  toolNamespace: z.string().min(1).optional().describe('Namespace of the tool invoked.'),
  argumentsHash: Sha256HashSchema.describe(
    'sha256: content hash of the serialized call arguments.',
  ),
  requestId: z
    .string()
    .min(1)
    .optional()
    .describe('Protocol request id used to correlate the call with its result (MCP).'),
  sessionId: z.string().min(1).optional().describe('Session that contained the call.'),
  messageId: z.string().min(1).optional().describe('Message that requested the call, when known.'),
  status: z
    .enum(['pending', 'executing', 'succeeded', 'failed', 'denied'])
    .describe('Lifecycle status of the call.'),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** ToolResult — the result returned by a tool call (event family tool_result.observed). */
export const ToolResultSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('ToolResult').describe('The result produced by a tool call.'),
  callId: z.string().min(1).describe('Identifier of the ToolCall this result belongs to.'),
  contentMode: ContentModeSchema.describe('Content handling mode for the result body.'),
  contentHash: Sha256HashSchema.describe('sha256: content hash of the result body.'),
  isError: z.boolean().describe('Whether the tool call failed (error result).'),
  exitCode: z
    .number()
    .int()
    .optional()
    .describe('Process exit code when the tool is a subprocess.'),
  durationMs: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Wall-clock duration of the call in milliseconds.'),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

/** MCPServer — an MCP server endpoint (SPEC.md §8; policy 4 untrusted MCPServer). */
export const MCPServerSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('MCPServer').describe('An MCP server that exposes tools/resources.'),
  serverName: z.string().min(1).describe('Server name (namespace-scoped).'),
  serverNamespace: z
    .string()
    .min(1)
    .optional()
    .describe('Namespace of the server (e.g. org, vendor).'),
  protocolVersion: z.string().min(1).optional().describe('MCP protocol version (e.g. 2025-03-26).'),
  transport: z
    .enum(['stdio', 'sse', 'streamable-http', 'websocket', 'other'])
    .describe('MCP transport used to reach the server.'),
  trustLevel: z
    .enum(['trusted', 'untrusted', 'unknown'])
    .describe(
      'Trust level of the server; restricted/secret data must not traverse SENT_TO into untrusted servers (SPEC.md §13 policy 4).',
    ),
});
export type MCPServer = z.infer<typeof MCPServerSchema>;

// ---------------------------------------------------------------------------
// Asset (4)
// ---------------------------------------------------------------------------

/** Resource — an addressable resource (content-addressed or URI-identified) (SPEC.md §8). */
export const ResourceSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('Resource').describe('An addressable resource read from or written to.'),
  resourceUri: z.string().min(1).describe('URI of the resource (file://, https://, db://, ...).'),
  resourceKind: z
    .enum(['file', 'database', 'api', 'url', 'memory', 'other'])
    .describe('Kind of resource.'),
  contentHash: Sha256HashSchema.optional().describe(
    'sha256: content hash of the resource content, when known.',
  ),
  mimeType: z.string().min(1).optional().describe('MIME type of the resource content.'),
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Size of the resource content in bytes.'),
});
export type Resource = z.infer<typeof ResourceSchema>;

/** DataObject — a classified data object (SPEC.md §8; event family data_object.classified). */
export const DataObjectSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('DataObject').describe('A data object with a classification.'),
  objectId: z
    .string()
    .min(1)
    .optional()
    .describe('Source-stable object identifier, when the source provides one.'),
  classification: SensitivitySchema.describe(
    'Data classification; restricted|secret objects are governed by data-flow policies (SPEC.md §13).',
  ),
  contentHash: Sha256HashSchema.describe('sha256: content hash of the object content.'),
  objectType: z
    .string()
    .min(1)
    .optional()
    .describe('Type of the object (e.g. document, database-row, api-response).'),
  schemaRef: z
    .string()
    .min(1)
    .optional()
    .describe('Reference to the schema of the object content.'),
});
export type DataObject = z.infer<typeof DataObjectSchema>;

/** Credential — a detected credential identified by HMAC fingerprint (SPEC.md §8, §18, §25). */
export const CredentialSchema = UniversalNodeFieldsSchema.extend({
  type: z
    .literal('Credential')
    .describe('A credential identified by fingerprint, never raw secret.'),
  credentialType: z
    .enum(['api_key', 'token', 'password', 'certificate', 'ssh_key', 'session_token', 'other'])
    .describe('Type of credential.'),
  fingerprint: z
    .string()
    .regex(
      /^hmac:[a-f0-9]{64}$/,
      'credential fingerprints must be keyed HMAC-SHA256 (hmac: + 64 hex chars)',
    )
    .describe(
      'Keyed HMAC fingerprint of the credential; raw secrets are disabled by default (SPEC.md §18).',
    ),
  targetService: z.string().min(1).optional().describe('Service the credential is scoped to.'),
  scopes: z
    .array(z.string().min(1))
    .default([])
    .describe('Permission scopes the credential carries.'),
});
export type Credential = z.infer<typeof CredentialSchema>;

/** MemoryEntry — an agent memory entry (SPEC.md §8; event family data_object.classified). */
export const MemoryEntrySchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('MemoryEntry').describe('An agent memory entry.'),
  memoryId: z.string().min(1).optional().describe('Source-stable memory entry identifier.'),
  memoryKind: z
    .enum(['working', 'episodic', 'semantic', 'procedural', 'other'])
    .describe('Kind of memory (working, episodic, semantic, procedural, other).'),
  contentMode: ContentModeSchema.describe('Content handling mode for the memory content.'),
  contentHash: Sha256HashSchema.describe('sha256: content hash of the memory content.'),
  sourceAgentId: z.string().min(1).optional().describe('Agent that wrote the memory entry.'),
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

// ---------------------------------------------------------------------------
// Governance (5)
// ---------------------------------------------------------------------------

/** Policy — a versioned policy document (SPEC.md §8 identifier: namespace + policy id + version). */
export const PolicySchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('Policy').describe('A deterministic security policy.'),
  policyNamespace: z
    .string()
    .min(1)
    .describe('Namespace of the policy (e.g. tenant, org, builtin).'),
  policyId: z.string().min(1).describe('Policy identifier within the namespace.'),
  version: z.string().min(1).describe('Immutable policy version (e.g. 2.0.0).'),
  policyKind: z
    .enum([
      'credential_exfiltration',
      'production_mutation',
      'delegation_attenuation',
      'data_classification',
      'approval_validity',
      'authorization_scope',
      'custom',
    ])
    .describe('Kind of policy; maps to the required policies in SPEC.md §13.'),
  contentHash: Sha256HashSchema.describe('sha256: content hash of the policy document.'),
});
export type Policy = z.infer<typeof PolicySchema>;

/** PolicyDecision — the outcome of evaluating a policy (SPEC.md §13 evaluation algorithm). */
export const PolicyDecisionSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('PolicyDecision').describe('The outcome of a policy evaluation.'),
  decision: z
    .enum(['ALLOW', 'DENY', 'REQUIRE_APPROVAL', 'FLAG', 'INDETERMINATE', 'NOT_APPLICABLE'])
    .describe('Policy verdict (SPEC.md §13 evaluation step 7).'),
  policyId: z.string().min(1).describe('Policy identifier that was evaluated.'),
  policyVersion: z.string().min(1).describe('Immutable version of the evaluated policy.'),
  ruleId: z
    .string()
    .min(1)
    .optional()
    .describe('Specific rule within the policy that matched, when applicable.'),
  reason: z.string().min(1).optional().describe('Human-readable explanation of the decision.'),
  evaluationMethod: z
    .enum(['deterministic', 'semantic', 'hybrid'])
    .optional()
    .describe('Method used to reach the decision.'),
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

/** ApprovalRequest — a request for human approval (event family approval.requested). */
export const ApprovalRequestSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('ApprovalRequest').describe('A request for human approval of an action.'),
  requestId: z.string().min(1).describe('Source-stable request identifier.'),
  requestedBy: z.string().min(1).describe('URN of the agent/run that requested approval.'),
  requestedAction: z.string().min(1).describe('Description of the action requiring approval.'),
  resourceRef: z
    .string()
    .min(1)
    .optional()
    .describe('Reference to the resource the action targets.'),
  justification: z.string().min(1).optional().describe('Justification provided by the requester.'),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

/** ApprovalDecision — the human decision on an approval request (event family approval.decided). */
export const ApprovalDecisionSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('ApprovalDecision').describe('A human decision on an approval request.'),
  requestId: z.string().min(1).describe('Identifier of the approval request being decided.'),
  decision: z
    .enum(['approved', 'denied', 'deferred'])
    .describe('Human decision (approved, denied, deferred).'),
  decidedBy: z.string().min(1).describe('URN of the principal that made the decision.'),
  reason: z.string().min(1).optional().describe('Optional reason recorded with the decision.'),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

/** Delegation — delegation of authority from one agent/principal to another (SPEC.md §13 policy 3). */
export const DelegationSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('Delegation').describe('Delegation of authority between agents/principals.'),
  delegatorId: z.string().min(1).describe('URN of the delegating agent/principal.'),
  delegateeId: z.string().min(1).describe('URN of the agent receiving delegated authority.'),
  authorityScope: z.string().min(1).describe('Scope of delegated authority (e.g. tool:read:repo).'),
  revoked: z.boolean().default(false).describe('Whether the delegation has been revoked.'),
  expiresAt: IsoTimestampSchema.optional().describe('Optional expiry of the delegation.'),
});
export type Delegation = z.infer<typeof DelegationSchema>;

// ---------------------------------------------------------------------------
// Outcome (4)
// ---------------------------------------------------------------------------

/** ExternalEffect — an externally visible side effect (SPEC.md §8; production mutation policy). */
export const ExternalEffectSchema = UniversalNodeFieldsSchema.extend({
  type: z
    .literal('ExternalEffect')
    .describe('An externally visible side effect of agent activity.'),
  effectKind: z
    .enum(['mutation', 'network', 'email', 'purchase', 'filesystem', 'http', 'other'])
    .describe('Kind of external effect.'),
  target: z.string().min(1).describe('External target of the effect (URL, host, path, ...).'),
  mutation: z
    .boolean()
    .describe(
      'Whether the effect mutates external state; mutation=true triggers the production-mutation policy (SPEC.md §13 policy 2).',
    ),
  production: z.boolean().describe('Whether the effect targets a production system.'),
  outcome: z
    .enum(['attempted', 'succeeded', 'failed', 'unknown'])
    .describe('Observed outcome of the effect.'),
});
export type ExternalEffect = z.infer<typeof ExternalEffectSchema>;

/** Verification — a verification activity (event family verification.observed). */
export const VerificationSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('Verification').describe('A verification activity over a claim or artifact.'),
  verificationType: z
    .enum(['manual', 'automated', 'protocol', 'crypto', 'other'])
    .describe('Kind of verification performed.'),
  method: z.string().min(1).describe('Description of the verification method.'),
  result: z
    .enum(['verified', 'contradicted', 'inconclusive'])
    .describe('Outcome of the verification.'),
  verifierId: z.string().min(1).describe('URN of the entity that performed the verification.'),
});
export type Verification = z.infer<typeof VerificationSchema>;

/** Detection — a detector finding (SPEC.md §8 identifier: hash of detector version/evidence/verdict/run). */
export const DetectionSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('Detection').describe('A detector finding (malicious/suspicious judgment).'),
  detectorName: z.string().min(1).describe('Name of the detector that produced the finding.'),
  detectorVersion: z.string().min(1).describe('Version of the detector.'),
  verdict: z
    .enum(['malicious', 'suspicious', 'benign', 'inconclusive'])
    .describe('Detector verdict.'),
  severity: z
    .enum(['info', 'low', 'medium', 'high', 'critical'])
    .describe('Severity assigned to the finding.'),
  evidenceSnapshotHash: Sha256HashSchema.describe(
    'sha256: hash of the evidence snapshot the finding is based on (SPEC.md §8 finding identifier).',
  ),
  score: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Detector confidence score in [0,1], when the detector emits one.'),
});
export type Detection = z.infer<typeof DetectionSchema>;

/** Incident — an investigation incident (SPEC.md §15 POST /incidents). */
export const IncidentSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('Incident').describe('An investigation incident.'),
  incidentId: z.string().min(1).describe('Incident identifier (created via POST /incidents).'),
  status: z
    .enum(['open', 'investigating', 'contained', 'resolved', 'closed'])
    .describe('Lifecycle status of the incident.'),
  severity: z
    .enum(['info', 'low', 'medium', 'high', 'critical'])
    .describe('Severity of the incident.'),
  title: z.string().min(1).optional().describe('Incident title.'),
  assignee: z
    .string()
    .min(1)
    .optional()
    .describe('URN of the investigator assigned to the incident.'),
});
export type Incident = z.infer<typeof IncidentSchema>;

// ---------------------------------------------------------------------------
// Evidence (2)
// ---------------------------------------------------------------------------

/** EvidenceArtifact — content-addressed evidence (SPEC.md §8: urn:catg:sha256:{hash}). */
export const EvidenceArtifactSchema = UniversalNodeFieldsSchema.extend({
  type: z.literal('EvidenceArtifact').describe('A content-addressed evidence artifact.'),
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
  contentHash: Sha256HashSchema.describe(
    'sha256: content hash of the artifact; the id is urn:catg:sha256:{hash}.',
  ),
  contentMode: ContentModeSchema.describe('Content handling mode of the artifact content.'),
  redacted: z.boolean().describe('Whether the artifact content has been redacted.'),
  sourceEventIds: z
    .array(z.string().min(1))
    .default([])
    .describe('Ledger event ids captured in this artifact.'),
});
export type EvidenceArtifact = z.infer<typeof EvidenceArtifactSchema>;

/** InvestigationContainer — an investigation container (SPEC.md §15 POST /incidents). */
export const InvestigationContainerSchema = UniversalNodeFieldsSchema.extend({
  type: z
    .literal('InvestigationContainer')
    .describe('An investigation container holding investigation state.'),
  investigationId: z.string().min(1).describe('Investigation container identifier.'),
  incidentId: z
    .string()
    .min(1)
    .optional()
    .describe('Incident this container is attached to, when linked.'),
  status: z.enum(['open', 'active', 'closed']).describe('Lifecycle status of the investigation.'),
  title: z.string().min(1).optional().describe('Investigation title.'),
  createdBy: z
    .string()
    .min(1)
    .optional()
    .describe('URN of the investigator that created the container.'),
  hypotheses: z
    .array(z.string().min(1))
    .default([])
    .describe('Working hypotheses tracked in the investigation.'),
});
export type InvestigationContainer = z.infer<typeof InvestigationContainerSchema>;
