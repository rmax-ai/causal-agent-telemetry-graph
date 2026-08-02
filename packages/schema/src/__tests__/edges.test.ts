import { describe, expect, it } from 'vitest';
import { EDGE_REGISTRY, EdgeType } from '../edge-registry.js';
import {
  CausedSchema,
  confidenceScoreRangeForBasis,
  MayHaveCausedSchema,
  PrecededBySchema,
} from '../edges.js';

const TS = '2026-08-02T10:00:00.000Z';
const sha = (hex: string): string => `sha256:${hex.repeat(64).slice(0, 64)}`;

/** Universal edge fields (SPEC.md §8). Every edge assertion is a ledger event. */
const baseEdge: Record<string, unknown> = {
  tenantId: 'acme',
  schemaVersion: '1.0.0',
  environment: 'test',
  occurredAt: TS,
  observedAt: TS,
  validFrom: TS,
  validTo: null,
  assertedAt: TS,
  confidence: 'observed',
  confidenceScore: 1,
  causalBasis: 'source_identifier',
  evidenceIds: ['evt-1'],
  linkerId: 'direct-identifier-linker',
  linkerVersion: '1.0.0',
  sensitivity: 'internal',
  retention: 'P30D',
  integrityHash: sha('a'),
  labels: {},
  attributes: {},
};

/** Realistic from/to endpoints + type-specific overrides per edge (EDGES.md §2). */
const edgeFixtures: Record<EdgeType, Record<string, unknown>> = {
  [EdgeType.Initiated]: {
    fromId: 'urn:catg:acme:idp:u-1001',
    toId: 'urn:catg:acme:adr:run-7',
    role: 'primary',
  },
  [EdgeType.ActedOnBehalfOf]: {
    fromId: 'urn:catg:acme:adr:agent-1',
    toId: 'urn:catg:acme:idp:u-1001',
    confidence: 'declared',
    confidenceScore: 0.9,
    causalBasis: 'producer_declaration',
    authorityRef: 'urn:catg:acme:adr:delegation-1',
  },
  [EdgeType.DelegatedTo]: {
    fromId: 'urn:catg:acme:adr:agent-1',
    toId: 'urn:catg:acme:adr:agent-2',
    authorityScope: 'tool:read:repo',
    attenuation: true,
  },
  [EdgeType.Contains]: {
    fromId: 'urn:catg:acme:adr:sess-42',
    toId: 'urn:catg:acme:adr:run-7',
    containmentKind: 'session',
  },
  [EdgeType.PrecededBy]: {
    fromId: 'urn:catg:acme:adr:run-6',
    toId: 'urn:catg:acme:adr:run-7',
    confidence: 'reconstructed',
    confidenceScore: 0.85,
    causalBasis: 'deterministic_reconstruction',
    orderingBasis: 'source_sequence',
  },
  [EdgeType.InformedBy]: {
    fromId: 'urn:catg:acme:adr:run-6',
    toId: 'urn:catg:acme:adr:run-7',
    confidence: 'declared',
    confidenceScore: 0.9,
    causalBasis: 'producer_declaration',
    informationType: 'tool_result',
  },
  [EdgeType.Used]: {
    fromId: 'urn:catg:acme:adr:run-7',
    toId: `urn:catg:sha256:${'b'.repeat(64)}`,
  },
  [EdgeType.Generated]: {
    fromId: 'urn:catg:acme:adr:run-7',
    toId: 'urn:catg:acme:adr:obj-5',
  },
  [EdgeType.DerivedFrom]: {
    fromId: 'urn:catg:acme:adr:obj-4',
    toId: 'urn:catg:acme:adr:obj-5',
    confidence: 'declared',
    confidenceScore: 0.9,
    causalBasis: 'producer_declaration',
    derivationKind: 'transformation',
  },
  [EdgeType.ReadFrom]: {
    fromId: 'urn:catg:acme:adr:call-9',
    toId: 'urn:catg:acme:adr:res-3',
  },
  [EdgeType.WroteTo]: {
    fromId: 'urn:catg:acme:adr:call-9',
    toId: 'urn:catg:acme:adr:res-3',
  },
  [EdgeType.Called]: {
    fromId: 'urn:catg:acme:adr:run-7',
    toId: 'urn:catg:acme:adr:call-9',
    callProtocol: 'mcp',
  },
  [EdgeType.Returned]: {
    fromId: 'urn:catg:acme:adr:result-2',
    toId: 'urn:catg:acme:adr:call-9',
  },
  [EdgeType.SentTo]: {
    fromId: 'urn:catg:acme:adr:obj-5',
    toId: 'urn:catg:acme:mcp:github',
    transport: 'mcp',
  },
  [EdgeType.ReceivedFrom]: {
    fromId: 'urn:catg:acme:adr:inst-3',
    toId: 'urn:catg:acme:mcp:github',
    transport: 'mcp',
  },
  [EdgeType.RequestedApproval]: {
    fromId: 'urn:catg:acme:adr:run-7',
    toId: 'urn:catg:acme:adr:apr-1',
  },
  [EdgeType.ApprovedBy]: {
    fromId: 'urn:catg:acme:adr:apr-1',
    toId: 'urn:catg:acme:adr:apd-1',
  },
  [EdgeType.DeniedBy]: {
    fromId: 'urn:catg:acme:adr:apr-2',
    toId: 'urn:catg:acme:adr:apd-2',
  },
  [EdgeType.AuthorizedBy]: {
    fromId: 'urn:catg:acme:adr:call-9',
    toId: 'urn:catg:acme:adr:pdec-1',
    confidence: 'reconstructed',
    confidenceScore: 0.9,
    causalBasis: 'deterministic_reconstruction',
  },
  [EdgeType.EvaluatedAgainst]: {
    fromId: 'urn:catg:acme:adr:pdec-1',
    toId: 'urn:catg:acme:policy:no-credential-exfiltration:2.0.0',
  },
  [EdgeType.Violated]: {
    fromId: 'urn:catg:acme:adr:run-9',
    toId: 'urn:catg:acme:policy:no-credential-exfiltration:2.0.0',
    confidence: 'reconstructed',
    confidenceScore: 0.85,
    causalBasis: 'deterministic_reconstruction',
    ruleId: 'rule-1',
    violationSeverity: 'high',
  },
  [EdgeType.Caused]: {
    fromId: 'urn:catg:acme:adr:run-7',
    toId: 'urn:catg:acme:adr:call-9',
    confidence: 'observed',
    confidenceScore: 0.98,
    causalBasis: 'protocol_semantics',
    evidenceIds: ['evt-3'],
    causationMethod: 'protocol_identifier_match',
  },
  [EdgeType.MayHaveCaused]: {
    fromId: 'urn:catg:acme:adr:call-9',
    toId: 'urn:catg:acme:adr:effect-1',
    confidence: 'inferred',
    confidenceScore: 0.6,
    causalBasis: 'semantic_inference',
  },
  [EdgeType.VerifiedBy]: {
    fromId: 'urn:catg:acme:adr:det-1',
    toId: 'urn:catg:acme:adr:ver-1',
  },
  [EdgeType.ContradictedBy]: {
    fromId: 'urn:catg:acme:adr:det-1',
    toId: `urn:catg:sha256:${'c'.repeat(64)}`,
  },
  [EdgeType.DetectedAs]: {
    fromId: 'urn:catg:acme:adr:run-7',
    toId: 'urn:catg:acme:adr:det-1',
  },
  [EdgeType.PartOfIncident]: {
    fromId: 'urn:catg:acme:adr:det-1',
    toId: 'urn:catg:acme:incident:inc-1',
    confidence: 'declared',
    confidenceScore: 0.9,
    causalBasis: 'producer_declaration',
    incidentRole: 'contributing',
  },
};

describe('edge registry completeness', () => {
  it('implements all 27 edge types (SPEC.md §8)', () => {
    expect(Object.values(EdgeType)).toHaveLength(27);
    expect(Object.values(EDGE_REGISTRY)).toHaveLength(27);
  });
});

describe('all edge types', () => {
  for (const type of Object.values(EdgeType)) {
    const schema = EDGE_REGISTRY[type];
    const fixture: Record<string, unknown> = {
      ...baseEdge,
      id: `urn:catg:acme:linker:edge-${type.toLowerCase()}-1`,
      type,
      ...edgeFixtures[type],
    };

    it(`accepts a valid ${type} edge with realistic endpoints`, () => {
      const parsed = schema.parse(fixture) as {
        type: string;
        fromId: string;
        toId: string;
        confidenceScore: number;
      };
      expect(parsed.type).toBe(type);
      expect(parsed.fromId).toMatch(/^urn:catg:/);
      expect(parsed.toId).toMatch(/^urn:catg:/);
      expect(parsed.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(parsed.confidenceScore).toBeLessThanOrEqual(1);
    });

    it(`rejects an invalid ${type} edge (non-URN fromId)`, () => {
      expect(() => schema.parse({ ...fixture, fromId: 'nope' })).toThrow();
    });

    it(`rejects a ${type} edge whose confidenceScore is outside the documented range for its basis (SPEC.md §10)`, () => {
      const { min, max } = confidenceScoreRangeForBasis(fixture.causalBasis as 'source_identifier');
      const badScore = min === max ? (min === 1 ? 0.5 : min - 0.1) : max + 0.01;
      expect(() => schema.parse({ ...fixture, confidenceScore: badScore })).toThrow();
    });
  }
});

describe('CAUSED strong-evidence requirements (SPEC.md §10)', () => {
  const caused = {
    ...baseEdge,
    id: 'urn:catg:acme:linker:edge-caused-1',
    type: EdgeType.Caused,
    fromId: 'urn:catg:acme:adr:run-7',
    toId: 'urn:catg:acme:adr:call-9',
    confidence: 'observed',
    confidenceScore: 0.98,
    causalBasis: 'protocol_semantics',
    causationMethod: 'protocol_identifier_match',
    evidenceIds: ['evt-3'],
  };

  it('requires at least one evidenceId', () => {
    expect(() => CausedSchema.parse({ ...caused, evidenceIds: [] })).toThrow();
    const { evidenceIds: _omitted, ...without } = caused;
    expect(() => CausedSchema.parse(without)).toThrow();
  });

  it('requires a causation method from the strong-CAUSED set', () => {
    expect(() => CausedSchema.parse({ ...caused, causationMethod: 'maybe' })).toThrow();
  });

  it('accepts a CAUSED edge with evidence and a valid method', () => {
    expect(CausedSchema.parse(caused).type).toBe('CAUSED');
  });
});

describe('PRECEDED_BY ordering-only semantics', () => {
  const preceded = {
    ...baseEdge,
    id: 'urn:catg:acme:linker:edge-preceded-1',
    type: EdgeType.PrecededBy,
    fromId: 'urn:catg:acme:adr:run-6',
    toId: 'urn:catg:acme:adr:run-7',
    confidence: 'speculative',
    causalBasis: 'temporal_proximity',
  };

  it('caps temporal-proximity PRECEDED_BY at confidenceScore 0.35 (SPEC.md §10 rule 9)', () => {
    expect(() => PrecededBySchema.parse({ ...preceded, confidenceScore: 0.4 })).toThrow();
    expect(PrecededBySchema.parse({ ...preceded, confidenceScore: 0.3 }).confidenceScore).toBe(0.3);
  });

  it('accepts observed ordering from source sequence at full score', () => {
    const observed = {
      ...preceded,
      confidence: 'observed',
      causalBasis: 'source_identifier',
      confidenceScore: 1,
    };
    expect(PrecededBySchema.parse(observed).type).toBe('PRECEDED_BY');
  });
});

describe('MAY_HAVE_CAUSED confidence constraints', () => {
  const may = {
    ...baseEdge,
    id: 'urn:catg:acme:linker:edge-may-1',
    type: EdgeType.MayHaveCaused,
    fromId: 'urn:catg:acme:adr:call-9',
    toId: 'urn:catg:acme:adr:effect-1',
    confidence: 'inferred',
    confidenceScore: 0.6,
    causalBasis: 'semantic_inference',
  };

  it('rejects observed confidence for an uncertain causal claim', () => {
    expect(() => MayHaveCausedSchema.parse({ ...may, confidence: 'observed' })).toThrow();
  });

  it('accepts inferred confidence within the semantic-inference range', () => {
    expect(MayHaveCausedSchema.parse(may).type).toBe('MAY_HAVE_CAUSED');
  });
});

describe('inferred/reconstructed edge qualification (AGENTS.md rule 2)', () => {
  const inferred = {
    ...baseEdge,
    id: 'urn:catg:acme:linker:edge-inferred-1',
    type: EdgeType.InformedBy,
    fromId: 'urn:catg:acme:adr:run-6',
    toId: 'urn:catg:acme:adr:run-7',
    confidence: 'inferred',
    confidenceScore: 0.6,
    causalBasis: 'semantic_inference',
  };

  it('requires linkerId, linkerVersion, and evidenceIds for inferred edges', () => {
    expect(() =>
      EDGE_REGISTRY[EdgeType.InformedBy].parse({ ...inferred, linkerId: undefined }),
    ).toThrow();
    expect(() =>
      EDGE_REGISTRY[EdgeType.InformedBy].parse({ ...inferred, linkerVersion: undefined }),
    ).toThrow();
    expect(() =>
      EDGE_REGISTRY[EdgeType.InformedBy].parse({ ...inferred, evidenceIds: [] }),
    ).toThrow();
  });

  it('accepts a fully qualified inferred edge', () => {
    const parsed = EDGE_REGISTRY[EdgeType.InformedBy].parse(inferred) as { type: string };
    expect(parsed.type).toBe('INFORMED_BY');
  });
});

describe('confidence score mapping (SPEC.md §10)', () => {
  it('documents the exact score ranges', () => {
    expect(confidenceScoreRangeForBasis('source_identifier')).toEqual({ min: 1, max: 1 });
    expect(confidenceScoreRangeForBasis('protocol_semantics')).toEqual({ min: 0.98, max: 0.98 });
    expect(confidenceScoreRangeForBasis('producer_declaration')).toEqual({ min: 0.9, max: 0.9 });
    expect(confidenceScoreRangeForBasis('deterministic_reconstruction')).toEqual({
      min: 0.8,
      max: 0.95,
    });
    expect(confidenceScoreRangeForBasis('exact_content_match')).toEqual({ min: 0.75, max: 0.9 });
    expect(confidenceScoreRangeForBasis('semantic_inference')).toEqual({ min: 0.5, max: 0.79 });
    expect(confidenceScoreRangeForBasis('temporal_proximity')).toEqual({ min: 0, max: 0.35 });
  });
});
