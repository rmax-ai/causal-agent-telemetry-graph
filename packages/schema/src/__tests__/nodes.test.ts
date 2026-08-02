import { describe, expect, it } from 'vitest';
import { ConfidenceSchema, NodeIdSchema, Sha256HashSchema } from '../common.js';
import { NODE_CATEGORY, NODE_REGISTRY, NodeCategory, NodeType } from '../node-registry.js';
import {
  CredentialSchema,
  DataObjectSchema,
  ModelInvocationSchema,
  ToolCallSchema,
} from '../nodes.js';

const TS = '2026-08-02T10:00:00.000Z';
const sha = (hex: string): string => `sha256:${hex.repeat(64 / hex.length).slice(0, 64)}`;
const INTEGRITY = sha('a');
const HASH_A = sha('b');
const HASH_B = sha('c');

/**
 * NOTE (NODES.md §4): SPEC.md §8 labels the registry "Node-Type Registry
 * (28 types)" but enumerates 29 node names (4 + 3 + 3 + 4 + 4 + 5 + 4 + 2).
 * All 29 enumerated types are implemented and tested here; the count
 * discrepancy is documented for resolution in packages/graph-model.
 */
const baseNode = {
  tenantId: 'acme',
  schemaVersion: '1.0.0',
  environment: 'test',
  occurredAt: TS,
  observedAt: TS,
  validFrom: TS,
  validTo: null,
  confidence: 'observed',
  sensitivity: 'internal',
  retention: 'P30D',
  integrityHash: INTEGRITY,
  labels: { source: 'adr' },
  attributes: { ingested: true },
} as const;

/** Type-specific fields per node type (SPEC.md §8 semantics). */
const nodeFixtures: Record<NodeType, Record<string, unknown>> = {
  // Identity (4)
  [NodeType.HumanPrincipal]: {
    issuer: 'acme-idp',
    subject: 'u-1001',
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
    roles: ['engineer'],
  },
  [NodeType.ServicePrincipal]: {
    issuer: 'acme-idp',
    subject: 'svc-ci',
    serviceName: 'ci-runner',
    purpose: 'Runs CI pipelines',
    roles: ['ci'],
  },
  [NodeType.Agent]: {
    provider: 'anthropic',
    modelName: 'claude-sonnet-4',
    agentKind: 'coding',
    instructionsRef: 'urn:catg:acme:policy:agent-instructions:v1',
  },
  [NodeType.AgentSession]: {
    sessionId: 'sess-42',
    source: 'adr',
    title: 'Fix login bug',
  },
  // Execution (3)
  [NodeType.AgentRun]: {
    runId: 'run-7',
    sessionId: 'sess-42',
    status: 'completed',
    objective: 'Fix login bug',
  },
  [NodeType.ModelInvocation]: {
    traceId: '0a1b2c3d4e5f60718293a4b5c6d7e8f9',
    spanId: '1020304050607080',
    provider: 'anthropic',
    modelId: 'claude-sonnet-4',
    operation: 'chat',
    inputTokens: 1200,
    outputTokens: 340,
    finishReason: 'end_turn',
  },
  [NodeType.PlanStep]: {
    stepId: 'step-3',
    planId: 'plan-1',
    stepIndex: 2,
    description: 'Edit auth flow',
    status: 'completed',
  },
  // Communication (3)
  [NodeType.Prompt]: {
    contentMode: 'hash_only',
    contentHash: HASH_A,
    templateId: 'prompt-template-1',
    tokenCount: 900,
  },
  [NodeType.Message]: {
    messageId: 'msg-12',
    sessionId: 'sess-42',
    role: 'user',
    contentMode: 'redacted',
    contentHash: HASH_A,
    sequenceId: 12,
  },
  [NodeType.Instruction]: {
    instructionType: 'goal',
    origin: 'user',
    contentMode: 'hash_only',
    contentHash: HASH_B,
  },
  // Tooling (4)
  [NodeType.Tool]: {
    toolName: 'read_file',
    namespace: 'filesystem',
    version: '1.2.0',
    toolKind: 'function',
    description: 'Read a file from the workspace',
  },
  [NodeType.ToolCall]: {
    callId: 'call-9',
    toolName: 'read_file',
    toolNamespace: 'filesystem',
    argumentsHash: HASH_A,
    requestId: 'req-9',
    sessionId: 'sess-42',
    messageId: 'msg-12',
    status: 'succeeded',
  },
  [NodeType.ToolResult]: {
    callId: 'call-9',
    contentMode: 'excerpt',
    contentHash: HASH_B,
    isError: false,
    exitCode: 0,
    durationMs: 45,
  },
  [NodeType.MCPServer]: {
    serverName: 'github',
    serverNamespace: 'acme',
    protocolVersion: '2025-03-26',
    transport: 'streamable-http',
    trustLevel: 'untrusted',
  },
  // Asset (4)
  [NodeType.Resource]: {
    resourceUri: 'file:///repo/src/auth.ts',
    resourceKind: 'file',
    contentHash: HASH_A,
    mimeType: 'text/typescript',
    sizeBytes: 2048,
  },
  [NodeType.DataObject]: {
    objectId: 'obj-5',
    classification: 'restricted',
    contentHash: HASH_B,
    objectType: 'document',
    schemaRef: 'schema:report:v1',
  },
  [NodeType.Credential]: {
    credentialType: 'api_key',
    fingerprint: `hmac:${'c'.repeat(64)}`,
    targetService: 'github',
    scopes: ['repo:read'],
  },
  [NodeType.MemoryEntry]: {
    memoryId: 'mem-2',
    memoryKind: 'semantic',
    contentMode: 'hash_only',
    contentHash: HASH_A,
    sourceAgentId: 'urn:catg:acme:adr:agent-1',
  },
  // Governance (5)
  [NodeType.Policy]: {
    policyNamespace: 'acme',
    policyId: 'no-credential-exfiltration',
    version: '2.0.0',
    policyKind: 'credential_exfiltration',
    contentHash: HASH_B,
  },
  [NodeType.PolicyDecision]: {
    decision: 'DENY',
    policyId: 'no-credential-exfiltration',
    policyVersion: '2.0.0',
    ruleId: 'rule-1',
    reason: 'Credential would traverse SENT_TO to an untrusted destination',
    evaluationMethod: 'deterministic',
  },
  [NodeType.ApprovalRequest]: {
    requestId: 'apr-1',
    requestedBy: 'urn:catg:acme:adr:run-7',
    requestedAction: 'SENT_TO github:production-deploy',
    resourceRef: 'https://api.github.com/repos/acme/app/deployments',
    justification: 'Release v1.2.0',
  },
  [NodeType.ApprovalDecision]: {
    requestId: 'apr-1',
    decision: 'approved',
    decidedBy: 'urn:catg:acme:idp:u-1001',
    reason: 'Release approved by on-call engineer',
  },
  [NodeType.Delegation]: {
    delegatorId: 'urn:catg:acme:adr:agent-1',
    delegateeId: 'urn:catg:acme:adr:agent-2',
    authorityScope: 'tool:read:repo',
    revoked: false,
    expiresAt: '2026-09-01T00:00:00.000Z',
  },
  // Outcome (4)
  [NodeType.ExternalEffect]: {
    effectKind: 'mutation',
    target: 'https://api.github.com/repos/acme/app/deployments',
    mutation: true,
    production: true,
    outcome: 'succeeded',
  },
  [NodeType.Verification]: {
    verificationType: 'manual',
    method: 'Reviewed deployment logs',
    result: 'verified',
    verifierId: 'urn:catg:acme:idp:u-1001',
  },
  [NodeType.Detection]: {
    detectorName: 'credential-exfil-graph',
    detectorVersion: '1.0.0',
    verdict: 'suspicious',
    severity: 'high',
    evidenceSnapshotHash: HASH_A,
    score: 0.82,
  },
  [NodeType.Incident]: {
    incidentId: 'inc-1',
    status: 'investigating',
    severity: 'high',
    title: 'Suspected credential exfiltration',
    assignee: 'urn:catg:acme:idp:u-1001',
  },
  // Evidence (2)
  [NodeType.EvidenceArtifact]: {
    artifactKind: 'event_bundle',
    contentHash: HASH_B,
    contentMode: 'redacted',
    redacted: true,
    sourceEventIds: ['evt-1', 'evt-2'],
  },
  [NodeType.InvestigationContainer]: {
    investigationId: 'inv-1',
    incidentId: 'inc-1',
    status: 'active',
    title: 'Credential flow',
    createdBy: 'urn:catg:acme:idp:u-1001',
    hypotheses: ['Credential leaked via untrusted MCP server'],
  },
};

describe('node registry completeness', () => {
  it('implements all 29 enumerated node types (SPEC.md §8; NODES.md §4 flags the 28-vs-29 label discrepancy)', () => {
    expect(Object.values(NodeType)).toHaveLength(29);
    expect(Object.values(NODE_REGISTRY)).toHaveLength(29);
  });

  it('maps every node type to a category (SPEC.md §8 grouping)', () => {
    for (const type of Object.values(NodeType)) {
      expect(NodeCategory[NODE_CATEGORY[type]]).toBeDefined();
    }
  });
});

describe('all node types', () => {
  for (const type of Object.values(NodeType)) {
    const schema = NODE_REGISTRY[type];
    const fixture: Record<string, unknown> = {
      ...baseNode,
      id: `urn:catg:acme:adr:${type.toLowerCase()}-1`,
      type,
      ...nodeFixtures[type],
    };

    it(`accepts a valid ${type} node with realistic data`, () => {
      const parsed = schema.parse(fixture) as {
        type: string;
        tenantId: string;
        integrityHash: string;
      };
      expect(parsed.type).toBe(type);
      expect(parsed.tenantId).toBe('acme');
      expect(parsed.integrityHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it(`rejects an invalid ${type} node (non-URN id)`, () => {
      expect(() => schema.parse({ ...fixture, id: 'not-a-urn' })).toThrow();
    });

    it(`rejects a ${type} node missing a required type-specific field`, () => {
      // Some type-specific fields are optional, so delete keys one at a time
      // until the schema rejects — proves each type has meaningful required fields.
      let rejected = false;
      for (const key of Object.keys(nodeFixtures[type])) {
        const without = { ...fixture };
        delete without[key];
        try {
          schema.parse(without);
        } catch {
          rejected = true;
          break;
        }
      }
      expect(rejected).toBe(true);
    });
  }
});

describe('universal field validators', () => {
  it('accepts a valid strict URN', () => {
    expect(NodeIdSchema.parse('urn:catg:acme:adr:sess-42')).toBe('urn:catg:acme:adr:sess-42');
  });

  it('accepts a content-addressed URN', () => {
    expect(NodeIdSchema.parse(`urn:catg:sha256:${'d'.repeat(64)}`)).toMatch(/^urn:catg:sha256:/);
  });

  it('rejects malformed URNs', () => {
    for (const bad of [
      'urn:catg:acme:adr',
      'catg:acme:adr:x',
      'urn:acme:adr:x',
      'urn:catg::adr:x',
      '',
    ]) {
      expect(() => NodeIdSchema.parse(bad)).toThrow();
    }
  });

  it('rejects integrity hashes without the sha256: prefix', () => {
    expect(() => Sha256HashSchema.parse(`${'a'.repeat(64)}`)).toThrow();
    expect(() => Sha256HashSchema.parse(`sha-256:${'a'.repeat(64)}`)).toThrow();
  });

  it('rejects invalid confidence values', () => {
    expect(() => ConfidenceSchema.parse('deterministic')).toThrow();
    expect(() => ConfidenceSchema.parse('')).toThrow();
  });

  it('rejects invalid ISO timestamps', () => {
    const bad = {
      ...baseNode,
      type: NodeType.AgentRun,
      id: 'urn:catg:acme:adr:run-1',
      runId: 'run-1',
      status: 'completed',
      occurredAt: 'yesterday',
    };
    expect(() => NODE_REGISTRY[NodeType.AgentRun].parse(bad)).toThrow();
  });

  it('accepts a null validTo (open-ended validity)', () => {
    const fixture: Record<string, unknown> = {
      ...baseNode,
      id: 'urn:catg:acme:adr:run-1',
      type: NodeType.AgentRun,
      runId: 'run-1',
      status: 'started',
    };
    const parsed = NODE_REGISTRY[NodeType.AgentRun].parse(fixture) as { validTo: string | null };
    expect(parsed.validTo).toBeNull();
  });
});

describe('type-specific validators', () => {
  const base = { ...baseNode, id: 'urn:catg:acme:otel:x', type: NodeType.ModelInvocation };

  it('rejects a malformed OpenTelemetry traceId', () => {
    expect(() =>
      ModelInvocationSchema.parse({
        ...base,
        traceId: 'zz',
        spanId: '1020304050607080',
        modelId: 'm',
        operation: 'chat',
      }),
    ).toThrow();
  });

  it('rejects a non-HMAC credential fingerprint', () => {
    const fixture = {
      ...baseNode,
      id: 'urn:catg:acme:adr:cred-1',
      type: NodeType.Credential,
      credentialType: 'api_key',
      fingerprint: 'raw-secret-value',
    };
    expect(() => CredentialSchema.parse(fixture)).toThrow();
  });

  it('rejects an unknown data classification', () => {
    const fixture = {
      ...baseNode,
      id: 'urn:catg:acme:adr:obj-1',
      type: NodeType.DataObject,
      classification: 'topsecret',
      contentHash: sha('e'),
    };
    expect(() => DataObjectSchema.parse(fixture)).toThrow();
  });

  it('rejects an invalid tool call status', () => {
    const fixture = {
      ...baseNode,
      id: 'urn:catg:acme:adr:call-1',
      type: NodeType.ToolCall,
      callId: 'call-1',
      toolName: 'read_file',
      argumentsHash: sha('f'),
      status: 'maybe',
    };
    expect(() => ToolCallSchema.parse(fixture)).toThrow();
  });
});
