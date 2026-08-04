/**
 * @catg/graph-projection — Kuzu graph schema (DDL) derived from the CATG
 * domain ontology (28 node types, 27 edge types).
 *
 * Every node/edge exists in the ledger first (AGENTS.md). Kuzu is a
 * rebuildable projection — never a source of truth.
 */

const NODE_TABLE_DDL = `
CREATE NODE TABLE IF NOT EXISTS Identity(
  id STRING, type STRING, tenantId STRING, observedAt TIMESTAMP, confidence STRING,
  labels STRING, properties STRING, PRIMARY KEY (id)
);
CREATE NODE TABLE IF NOT EXISTS Execution(
  id STRING, type STRING, tenantId STRING, observedAt TIMESTAMP, confidence STRING,
  labels STRING, properties STRING, PRIMARY KEY (id)
);
CREATE NODE TABLE IF NOT EXISTS Communication(
  id STRING, type STRING, tenantId STRING, observedAt TIMESTAMP, confidence STRING,
  labels STRING, properties STRING, PRIMARY KEY (id)
);
CREATE NODE TABLE IF NOT EXISTS Tooling(
  id STRING, type STRING, tenantId STRING, observedAt TIMESTAMP, confidence STRING,
  labels STRING, properties STRING, PRIMARY KEY (id)
);
CREATE NODE TABLE IF NOT EXISTS Asset(
  id STRING, type STRING, tenantId STRING, observedAt TIMESTAMP, confidence STRING,
  labels STRING, properties STRING, PRIMARY KEY (id)
);
CREATE NODE TABLE IF NOT EXISTS Governance(
  id STRING, type STRING, tenantId STRING, observedAt TIMESTAMP, confidence STRING,
  labels STRING, properties STRING, PRIMARY KEY (id)
);
CREATE NODE TABLE IF NOT EXISTS Outcome(
  id STRING, type STRING, tenantId STRING, observedAt TIMESTAMP, confidence STRING,
  labels STRING, properties STRING, PRIMARY KEY (id)
);
CREATE NODE TABLE IF NOT EXISTS Evidence(
  id STRING, type STRING, tenantId STRING, observedAt TIMESTAMP, confidence STRING,
  labels STRING, properties STRING, PRIMARY KEY (id)
);
`;

/**
 * Node type → category mapping (from graph-model NODE_CATEGORY_MAP).
 * All 28 types assigned to their Kuzu node table.
 */
export const NODE_TYPE_TO_TABLE: Record<string, string> = {
  HumanPrincipal: 'Identity',
  ServicePrincipal: 'Identity',
  Agent: 'Identity',
  AgentSession: 'Identity',
  AgentRun: 'Execution',
  ModelInvocation: 'Execution',
  PlanStep: 'Execution',
  Prompt: 'Communication',
  Message: 'Communication',
  Instruction: 'Communication',
  Tool: 'Tooling',
  ToolCall: 'Tooling',
  ToolResult: 'Tooling',
  MCPServer: 'Tooling',
  Resource: 'Asset',
  DataObject: 'Asset',
  Credential: 'Asset',
  MemoryEntry: 'Asset',
  Policy: 'Governance',
  PolicyDecision: 'Governance',
  ApprovalRequest: 'Governance',
  ApprovalDecision: 'Governance',
  Delegation: 'Governance',
  ExternalEffect: 'Outcome',
  Verification: 'Outcome',
  Detection: 'Outcome',
  Incident: 'Outcome',
  EvidenceArtifact: 'Evidence',
  InvestigationContainer: 'Evidence',
};

/**
 * All edge type DDL. Each creates a REL TABLE GROUP with FROM/TO endpoints
 * targeting the appropriate node tables.
 *
 * The edge property schema captures: assertedAt TIMESTAMP, confidence STRING,
 * evidenceIds STRING (JSON array stored as string — Kuzu doesn't support lists).
 */
export function edgeTableDdl(edgeType: string, fromTable: string, toTable: string): string {
  return `
CREATE REL TABLE GROUP IF NOT EXISTS ${edgeType}(
  FROM ${fromTable} TO ${toTable},
  assertedAt TIMESTAMP, confidence STRING, evidenceIds STRING, linkerId STRING
);
`;
}

/**
 * All 27 edge types with their FROM/TO table mappings. For edges where the
 * spec defines a single predominant direction, we use that. Callers can
 * create additional rel tables if bidirectional access is needed.
 */
export const EDGE_TABLE_MAPPINGS: Array<{
  edgeType: string;
  fromTable: string;
  toTable: string;
}> = [
  { edgeType: 'INITIATED', fromTable: 'Identity', toTable: 'Execution' },
  { edgeType: 'ACTED_ON_BEHALF_OF', fromTable: 'Identity', toTable: 'Identity' },
  { edgeType: 'DELEGATED_TO', fromTable: 'Identity', toTable: 'Identity' },
  { edgeType: 'CONTAINS', fromTable: 'Identity', toTable: 'Execution' },
  { edgeType: 'PRECEDED_BY', fromTable: 'Execution', toTable: 'Execution' },
  { edgeType: 'INFORMED_BY', fromTable: 'Communication', toTable: 'Communication' },
  { edgeType: 'USED', fromTable: 'Execution', toTable: 'Tooling' },
  { edgeType: 'GENERATED', fromTable: 'Execution', toTable: 'Communication' },
  { edgeType: 'DERIVED_FROM', fromTable: 'Communication', toTable: 'Communication' },
  { edgeType: 'READ_FROM', fromTable: 'Execution', toTable: 'Asset' },
  { edgeType: 'WROTE_TO', fromTable: 'Execution', toTable: 'Asset' },
  { edgeType: 'CALLED', fromTable: 'Execution', toTable: 'Tooling' },
  { edgeType: 'RETURNED', fromTable: 'Tooling', toTable: 'Communication' },
  { edgeType: 'SENT_TO', fromTable: 'Communication', toTable: 'Tooling' },
  { edgeType: 'RECEIVED_FROM', fromTable: 'Tooling', toTable: 'Communication' },
  { edgeType: 'REQUESTED_APPROVAL', fromTable: 'Execution', toTable: 'Governance' },
  { edgeType: 'APPROVED_BY', fromTable: 'Governance', toTable: 'Identity' },
  { edgeType: 'DENIED_BY', fromTable: 'Governance', toTable: 'Identity' },
  { edgeType: 'AUTHORIZED_BY', fromTable: 'Identity', toTable: 'Governance' },
  { edgeType: 'EVALUATED_AGAINST', fromTable: 'Execution', toTable: 'Governance' },
  { edgeType: 'VIOLATED', fromTable: 'Execution', toTable: 'Governance' },
  { edgeType: 'CAUSED', fromTable: 'Execution', toTable: 'Outcome' },
  { edgeType: 'MAY_HAVE_CAUSED', fromTable: 'Execution', toTable: 'Outcome' },
  { edgeType: 'VERIFIED_BY', fromTable: 'Outcome', toTable: 'Identity' },
  { edgeType: 'CONTRADICTED_BY', fromTable: 'Outcome', toTable: 'Identity' },
  { edgeType: 'DETECTED_AS', fromTable: 'Outcome', toTable: 'Evidence' },
  { edgeType: 'PART_OF_INCIDENT', fromTable: 'Outcome', toTable: 'Evidence' },
];

/** Generate full DDL: all node tables + all edge tables. */
export function fullDdl(): string {
  let ddl = NODE_TABLE_DDL;
  for (const m of EDGE_TABLE_MAPPINGS) {
    ddl += edgeTableDdl(m.edgeType, m.fromTable, m.toTable);
  }
  return ddl;
}
