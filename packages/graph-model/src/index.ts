/// <reference types="vitest/importMeta" />

/**
 * CATG Graph Model — Ontology Type Registry
 *
 * Maps the domain ontology (28 node types, 27 edge types) to:
 * - Type categories (Identity, Execution, Communication, Tooling, Asset, Governance, Outcome, Evidence)
 * - PROV-DM specializations
 * - Confidence semantics
 * - Identifier strategies
 *
 * This package does NOT depend on Kuzu or any graph database. It is a pure type registry.
 */

// ─── Node Type Registry ────────────────────────────────────────────────

export const NodeCategory = {
  IDENTITY: 'identity',
  EXECUTION: 'execution',
  COMMUNICATION: 'communication',
  TOOLING: 'tooling',
  ASSET: 'asset',
  GOVERNANCE: 'governance',
  OUTCOME: 'outcome',
  EVIDENCE: 'evidence',
} as const;

export type NodeCategory = (typeof NodeCategory)[keyof typeof NodeCategory];

export const NODE_TYPES = [
  // Identity
  'HumanPrincipal',
  'ServicePrincipal',
  'Agent',
  'AgentSession',
  // Execution
  'AgentRun',
  'ModelInvocation',
  'PlanStep',
  // Communication
  'Prompt',
  'Message',
  'Instruction',
  // Tooling
  'Tool',
  'ToolCall',
  'ToolResult',
  'MCPServer',
  // Asset
  'Resource',
  'DataObject',
  'Credential',
  'MemoryEntry',
  // Governance
  'Policy',
  'PolicyDecision',
  'ApprovalRequest',
  'ApprovalDecision',
  'Delegation',
  // Outcome
  'ExternalEffect',
  'Verification',
  'Detection',
  'Incident',
  // Evidence
  'EvidenceArtifact',
  'InvestigationContainer',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

/** Maps each node type to its category */
export const NODE_CATEGORY_MAP: Record<NodeType, NodeCategory> = {
  HumanPrincipal: 'identity',
  ServicePrincipal: 'identity',
  Agent: 'identity',
  AgentSession: 'identity',
  AgentRun: 'execution',
  ModelInvocation: 'execution',
  PlanStep: 'execution',
  Prompt: 'communication',
  Message: 'communication',
  Instruction: 'communication',
  Tool: 'tooling',
  ToolCall: 'tooling',
  ToolResult: 'tooling',
  MCPServer: 'tooling',
  Resource: 'asset',
  DataObject: 'asset',
  Credential: 'asset',
  MemoryEntry: 'asset',
  Policy: 'governance',
  PolicyDecision: 'governance',
  ApprovalRequest: 'governance',
  ApprovalDecision: 'governance',
  Delegation: 'governance',
  ExternalEffect: 'outcome',
  Verification: 'outcome',
  Detection: 'outcome',
  Incident: 'outcome',
  EvidenceArtifact: 'evidence',
  InvestigationContainer: 'evidence',
};

/** PROV-DM specializations for each node type */
export const NODE_PROV_MAP: Record<NodeType, string> = {
  HumanPrincipal: 'Agent',
  ServicePrincipal: 'Agent',
  Agent: 'Agent',
  AgentSession: 'Activity',
  AgentRun: 'Activity',
  ModelInvocation: 'Activity',
  PlanStep: 'Activity',
  Prompt: 'Entity',
  Message: 'Entity',
  Instruction: 'Entity',
  Tool: 'Entity',
  ToolCall: 'Activity',
  ToolResult: 'Entity',
  MCPServer: 'Entity',
  Resource: 'Entity',
  DataObject: 'Entity',
  Credential: 'Entity',
  MemoryEntry: 'Entity',
  Policy: 'Entity',
  PolicyDecision: 'Entity',
  ApprovalRequest: 'Entity',
  ApprovalDecision: 'Entity',
  Delegation: 'Entity',
  ExternalEffect: 'Entity',
  Verification: 'Activity',
  Detection: 'Entity',
  Incident: 'Entity',
  EvidenceArtifact: 'Entity',
  InvestigationContainer: 'Entity',
};

// ─── Edge Type Registry ─────────────────────────────────────────────────

export const EDGE_TYPES = [
  'INITIATED',
  'ACTED_ON_BEHALF_OF',
  'DELEGATED_TO',
  'CONTAINS',
  'PRECEDED_BY',
  'INFORMED_BY',
  'USED',
  'GENERATED',
  'DERIVED_FROM',
  'READ_FROM',
  'WROTE_TO',
  'CALLED',
  'RETURNED',
  'SENT_TO',
  'RECEIVED_FROM',
  'REQUESTED_APPROVAL',
  'APPROVED_BY',
  'DENIED_BY',
  'AUTHORIZED_BY',
  'EVALUATED_AGAINST',
  'VIOLATED',
  'CAUSED',
  'MAY_HAVE_CAUSED',
  'VERIFIED_BY',
  'CONTRADICTED_BY',
  'DETECTED_AS',
  'PART_OF_INCIDENT',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

export const EDGE_TYPE_COUNT = EDGE_TYPES.length;

/** Default confidence for each edge type */
export const EDGE_DEFAULT_CONFIDENCE: Record<EdgeType, string> = {
  INITIATED: 'observed',
  ACTED_ON_BEHALF_OF: 'declared',
  DELEGATED_TO: 'observed',
  CONTAINS: 'observed',
  PRECEDED_BY: 'observed',
  INFORMED_BY: 'declared',
  USED: 'observed',
  GENERATED: 'observed',
  DERIVED_FROM: 'declared',
  READ_FROM: 'observed',
  WROTE_TO: 'observed',
  CALLED: 'observed',
  RETURNED: 'observed',
  SENT_TO: 'observed',
  RECEIVED_FROM: 'observed',
  REQUESTED_APPROVAL: 'observed',
  APPROVED_BY: 'observed',
  DENIED_BY: 'observed',
  AUTHORIZED_BY: 'reconstructed',
  EVALUATED_AGAINST: 'observed',
  VIOLATED: 'deterministic',
  CAUSED: 'observed',
  MAY_HAVE_CAUSED: 'inferred',
  VERIFIED_BY: 'observed',
  CONTRADICTED_BY: 'observed',
  DETECTED_AS: 'observed',
  PART_OF_INCIDENT: 'declared',
};

/** PROV-DM specializations for each edge type */
export const EDGE_PROV_MAP: Record<EdgeType, string> = {
  INITIATED: 'wasAssociatedWith',
  ACTED_ON_BEHALF_OF: 'actedOnBehalfOf',
  DELEGATED_TO: 'actedOnBehalfOf',
  CONTAINS: 'wasInformedBy',
  PRECEDED_BY: 'wasInformedBy',
  INFORMED_BY: 'wasInformedBy',
  USED: 'used',
  GENERATED: 'wasGeneratedBy',
  DERIVED_FROM: 'wasDerivedFrom',
  READ_FROM: 'used',
  WROTE_TO: 'wasGeneratedBy',
  CALLED: 'used',
  RETURNED: 'wasGeneratedBy',
  SENT_TO: 'used',
  RECEIVED_FROM: 'wasGeneratedBy',
  REQUESTED_APPROVAL: 'wasAssociatedWith',
  APPROVED_BY: 'wasAssociatedWith',
  DENIED_BY: 'wasAssociatedWith',
  AUTHORIZED_BY: 'wasAssociatedWith',
  EVALUATED_AGAINST: 'used',
  VIOLATED: 'wasAssociatedWith',
  CAUSED: 'wasInformedBy',
  MAY_HAVE_CAUSED: 'wasInformedBy',
  VERIFIED_BY: 'wasAssociatedWith',
  CONTRADICTED_BY: 'wasAssociatedWith',
  DETECTED_AS: 'wasGeneratedBy',
  PART_OF_INCIDENT: 'wasAssociatedWith',
};

// ─── Confidence Semantics ───────────────────────────────────────────────

export const CONFIDENCE_VALUES = [
  'observed',
  'declared',
  'reconstructed',
  'inferred',
  'speculative',
] as const;

export type Confidence = (typeof CONFIDENCE_VALUES)[number];

/** Confidence scores for each level */
export const CONFIDENCE_SCORES: Record<Confidence, number> = {
  observed: 1.0,
  declared: 0.9,
  reconstructed: 0.85,
  inferred: 0.65,
  speculative: 0.35,
};

/** Confidence ordering: higher is more reliable */
export const CONFIDENCE_ORDER: Record<Confidence, number> = {
  observed: 5,
  declared: 4,
  reconstructed: 3,
  inferred: 2,
  speculative: 1,
};

export function isHigherConfidence(a: Confidence, b: Confidence): boolean {
  return CONFIDENCE_ORDER[a] > CONFIDENCE_ORDER[b];
}

// ─── Identifier Strategy ────────────────────────────────────────────────

/** URN format: urn:catg:{tenant}:{source}:{id} */
export const URN_PREFIX = 'urn:catg';

export function isValidUrn(urn: string): boolean {
  return /^urn:catg:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/.test(urn);
}

export function buildUrn(tenant: string, source: string, id: string): string {
  return `${URN_PREFIX}:${tenant}:${source}:${id}`;
}

export function parseUrn(urn: string): { tenant: string; source: string; id: string } | null {
  const match = urn.match(/^urn:catg:([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)$/);
  if (!match) return null;
  return { tenant: match[1] ?? '', source: match[2] ?? '', id: match[3] ?? '' };
}

// ─── Verification ───────────────────────────────────────────────────────

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  it('has all 28 node types', () => {
    expect(NODE_TYPES.length).toBe(28);
    expect(Object.keys(NODE_CATEGORY_MAP).length).toBe(28);
  });
  it('has all 27 edge types', () => {
    expect(EDGE_TYPE_COUNT).toBe(27);
    expect(EDGE_TYPES.length).toBe(27);
  });
}
