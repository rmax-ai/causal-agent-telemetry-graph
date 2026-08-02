import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CanonicalEventEnvelopeSchema,
  canonicalPayloadHash,
  computeDedupeKey,
  EVENT_FAMILY_SCHEMAS,
  EventFamily,
  sha256Hex,
  stableStringify,
} from '../events.js';

const TS = '2026-08-02T10:00:00.000Z';
const sha = (hex: string): string => `sha256:${hex.repeat(64).slice(0, 64)}`;
const TRACE_ID = '0a1b2c3d4e5f60718293a4b5c6d7e8f9';
const SPAN_ID = '1020304050607080';

/** Canonical event envelope fields (SPEC.md §9). */
const baseEnvelope: Record<string, unknown> = {
  eventId: 'evt-1',
  schemaVersion: '1.0.0',
  occurredAt: TS,
  observedAt: TS,
  producer: {
    sourceKind: 'adr',
    sourceId: 'sess-42:msg-12',
    producerName: 'adr-sensor',
    producerVersion: '1.0.0',
    adapterName: 'adr',
    adapterVersion: '0.1.0',
  },
  subject: { tenantId: 'acme', sessionId: 'sess-42', runId: 'run-7' },
  traceContext: { traceId: TRACE_ID, spanId: SPAN_ID },
  identityContext: { principalId: 'urn:catg:acme:idp:u-1001', sessionId: 'sess-42' },
  provenance: [{ sourceId: 'sess-42:msg-12', eventId: 'evt-0', observedAt: TS }],
  securityClassification: {
    classification: 'internal',
    handling: ['pseudonymize'],
    redactionProfile: 'default',
  },
  integrityHash: sha('a'),
  extensions: { otel: { kind: 'span' } },
};

/** Realistic payload per event family (SPEC.md §9). */
const payloadFixtures: Record<EventFamily, Record<string, unknown>> = {
  [EventFamily.SourceRecordImported]: {
    sourceKind: 'adr',
    sourceRecordId: 'sess-42',
    recordCount: 120,
    firstObservedAt: TS,
    adapterName: 'adr',
    adapterVersion: '0.1.0',
  },
  [EventFamily.SessionObserved]: {
    sessionId: 'sess-42',
    source: 'adr',
    startedAt: TS,
    principalId: 'urn:catg:acme:idp:u-1001',
    title: 'Fix login bug',
  },
  [EventFamily.RunStarted]: {
    runId: 'run-7',
    sessionId: 'sess-42',
    objective: 'Fix login bug',
    startedAt: TS,
  },
  [EventFamily.RunCompleted]: {
    runId: 'run-7',
    sessionId: 'sess-42',
    status: 'completed',
    completedAt: TS,
    durationMs: 42_000,
  },
  [EventFamily.MessageObserved]: {
    messageId: 'msg-12',
    sessionId: 'sess-42',
    role: 'user',
    contentMode: 'redacted',
    contentHash: sha('b'),
    sequenceId: 12,
    tokenCount: 85,
  },
  [EventFamily.InstructionExtracted]: {
    instructionType: 'goal',
    source: 'user',
    contentMode: 'hash_only',
    contentHash: sha('c'),
    trustLevel: 'trusted',
  },
  [EventFamily.ModelInvocationStarted]: {
    invocationId: 'inv-1',
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    provider: 'anthropic',
    modelId: 'claude-sonnet-4',
    operation: 'chat',
    inputTokens: 1200,
  },
  [EventFamily.ModelInvocationCompleted]: {
    invocationId: 'inv-1',
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    provider: 'anthropic',
    modelId: 'claude-sonnet-4',
    outputTokens: 340,
    finishReason: 'end_turn',
    latencyMs: 2100,
  },
  [EventFamily.ToolDefinitionObserved]: {
    toolName: 'read_file',
    namespace: 'filesystem',
    version: '1.2.0',
    toolKind: 'function',
    serverName: 'fs',
    protocolVersion: '2025-03-26',
  },
  [EventFamily.ToolCallObserved]: {
    callId: 'call-9',
    toolName: 'read_file',
    argumentsHash: sha('b'),
    status: 'succeeded',
    requestId: 'req-9',
    messageId: 'msg-12',
    sessionId: 'sess-42',
  },
  [EventFamily.ToolResultObserved]: {
    callId: 'call-9',
    contentMode: 'excerpt',
    contentHash: sha('c'),
    isError: false,
    exitCode: 0,
    durationMs: 45,
  },
  [EventFamily.ResourceAccessed]: {
    resourceUri: 'file:///repo/src/auth.ts',
    resourceKind: 'file',
    accessType: 'read',
    callerId: 'urn:catg:acme:adr:call-9',
    contentHash: sha('b'),
  },
  [EventFamily.DataObjectClassified]: {
    objectId: 'obj-5',
    contentHash: sha('c'),
    classification: 'restricted',
    classifier: 'rules/classification-v1',
    reason: 'contains PII',
  },
  [EventFamily.CredentialDetected]: {
    fingerprint: `hmac:${'d'.repeat(64)}`,
    credentialType: 'api_key',
    targetService: 'github',
    detectionMethod: 'hmac_match',
    severity: 'high',
  },
  [EventFamily.ApprovalRequested]: {
    requestId: 'apr-1',
    requestedBy: 'urn:catg:acme:adr:run-7',
    requestedAction: 'SENT_TO github:production-deploy',
    resourceRef: 'https://api.github.com/repos/acme/app/deployments',
    justification: 'Release v1.2.0',
    expiresAt: '2026-08-02T12:00:00.000Z',
  },
  [EventFamily.ApprovalDecided]: {
    requestId: 'apr-1',
    decision: 'approved',
    decidedBy: 'urn:catg:acme:idp:u-1001',
    reason: 'Release approved',
  },
  [EventFamily.DelegationObserved]: {
    delegatorId: 'urn:catg:acme:adr:agent-1',
    delegateeId: 'urn:catg:acme:adr:agent-2',
    authorityScope: 'tool:read:repo',
    expiresAt: '2026-09-01T00:00:00.000Z',
  },
  [EventFamily.ExternalEffectObserved]: {
    effectKind: 'mutation',
    target: 'https://api.github.com/repos/acme/app/deployments',
    mutation: true,
    production: true,
    outcome: 'succeeded',
  },
  [EventFamily.VerificationObserved]: {
    verificationType: 'manual',
    method: 'Reviewed deployment logs',
    result: 'verified',
    verifierId: 'urn:catg:acme:idp:u-1001',
    targetRef: 'urn:catg:acme:adr:effect-1',
  },
  [EventFamily.EdgeAsserted]: {
    edgeId: 'urn:catg:acme:linker:edge-1',
    edgeType: 'CAUSED',
    fromId: 'urn:catg:acme:adr:run-7',
    toId: 'urn:catg:acme:adr:call-9',
    confidence: 'observed',
    confidenceScore: 0.98,
    causalBasis: 'protocol_semantics',
    evidenceIds: ['evt-3'],
    linkerId: 'protocol-linker',
    linkerVersion: '1.0.0',
  },
  [EventFamily.PolicyEvaluated]: {
    policyId: 'no-credential-exfiltration',
    policyVersion: '2.0.0',
    decision: 'DENY',
    subjectRef: 'urn:catg:acme:adr:run-9',
    ruleId: 'rule-1',
    reason: 'Credential would reach an untrusted destination',
  },
  [EventFamily.DetectorExecuted]: {
    runId: 'det-run-1',
    detectorName: 'credential-exfil-graph',
    detectorVersion: '1.0.0',
    verdict: 'suspicious',
    severity: 'high',
    evidenceSnapshotHash: sha('b'),
    score: 0.82,
  },
  [EventFamily.IncidentUpdated]: {
    incidentId: 'inc-1',
    status: 'investigating',
    severity: 'high',
    title: 'Suspected credential exfiltration',
    updateType: 'evidence_added',
    summary: 'Added evidence artifact evt-9',
  },
  [EventFamily.EvidenceCreated]: {
    artifactKind: 'event_bundle',
    contentHash: sha('c'),
    contentMode: 'redacted',
    redacted: true,
    sourceEventIds: ['evt-1', 'evt-2'],
    description: 'Bundle of tool_call + tool_result events',
  },
  [EventFamily.ProjectionCheckpointed]: {
    projectionVersion: '1.0.0',
    checkpointId: 'chk-1',
    nodeCount: 120,
    edgeCount: 340,
    eventCount: 1024,
    projectedAt: TS,
  },
};

describe('event family registry completeness', () => {
  it('covers every family name listed in SPEC.md §9 (25 names under a "24 types" header)', () => {
    expect(Object.values(EventFamily)).toHaveLength(25);
    expect(Object.keys(EVENT_FAMILY_SCHEMAS)).toHaveLength(25);
  });

  it('keys each schema by its eventType literal', () => {
    for (const family of Object.values(EventFamily)) {
      const schema = EVENT_FAMILY_SCHEMAS[family];
      const parsed = schema.parse({
        ...baseEnvelope,
        eventType: family,
        payload: payloadFixtures[family],
      }) as { eventType: string };
      expect(parsed.eventType).toBe(family);
    }
  });
});

describe('all event families', () => {
  for (const family of Object.values(EventFamily)) {
    const schema = EVENT_FAMILY_SCHEMAS[family];
    const fixture: Record<string, unknown> = {
      ...baseEnvelope,
      eventId: `evt-${family}`,
      eventType: family,
      payload: payloadFixtures[family],
    };

    it(`accepts a valid ${family} envelope with realistic payload`, () => {
      const parsed = schema.parse(fixture) as { eventType: string; integrityHash: string };
      expect(parsed.eventType).toBe(family);
      expect(parsed.integrityHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it(`rejects a ${family} envelope with a mismatched eventType`, () => {
      expect(() => schema.parse({ ...fixture, eventType: 'wrong.type' })).toThrow();
    });

    it(`rejects a ${family} envelope with an invalid payload`, () => {
      expect(() => schema.parse({ ...fixture, payload: { bad: true } })).toThrow();
    });

    it(`rejects a ${family} envelope with a corrupted integrity hash`, () => {
      expect(() => schema.parse({ ...fixture, integrityHash: 'md5:abc' })).toThrow();
    });
  }
});

describe('envelope validation', () => {
  it('rejects a malformed eventType', () => {
    expect(() =>
      CanonicalEventEnvelopeSchema.parse({
        ...baseEnvelope,
        eventType: 'Run.Started!',
        payload: payloadFixtures[EventFamily.RunStarted],
      }),
    ).toThrow();
  });

  it('rejects unbounded extensions (ADR-006)', () => {
    const extensions: Record<string, unknown> = {};
    for (let i = 0; i < 65; i += 1) {
      extensions[`k${i}`] = i;
    }
    expect(() =>
      CanonicalEventEnvelopeSchema.parse({
        ...baseEnvelope,
        eventType: EventFamily.RunStarted,
        payload: payloadFixtures[EventFamily.RunStarted],
        extensions,
      }),
    ).toThrow();
  });

  it('rejects a traceContext with a malformed traceId', () => {
    expect(() =>
      CanonicalEventEnvelopeSchema.parse({
        ...baseEnvelope,
        eventType: EventFamily.RunStarted,
        payload: payloadFixtures[EventFamily.RunStarted],
        traceContext: { traceId: 'nope', spanId: SPAN_ID },
      }),
    ).toThrow();
  });
});

describe('dedupe_key computation (SPEC.md §9 idempotency)', () => {
  const input = {
    tenantId: 'acme',
    sourceKind: 'adr',
    sourceRecordId: 'sess-42:msg-12',
    eventType: 'run.started',
    occurredAt: TS,
    canonicalPayloadHash: sha('b'),
  };

  it('is deterministic for identical inputs', () => {
    expect(computeDedupeKey(input)).toBe(computeDedupeKey({ ...input }));
    expect(computeDedupeKey(input)).toBe(
      computeDedupeKey({ ...input, canonicalPayloadHash: sha('b') }),
    );
  });

  it('matches a manually computed SHA-256 of the concatenated components', () => {
    const raw = ['acme', 'adr', 'sess-42:msg-12', 'run.started', TS, sha('b')].join('||');
    const expected = createHash('sha256').update(raw, 'utf8').digest('hex');
    expect(computeDedupeKey(input)).toBe(expected);
  });

  it('changes when any component changes', () => {
    const base = computeDedupeKey(input);
    expect(computeDedupeKey({ ...input, tenantId: 'other' })).not.toBe(base);
    expect(computeDedupeKey({ ...input, sourceKind: 'mcp' })).not.toBe(base);
    expect(computeDedupeKey({ ...input, sourceRecordId: 'other' })).not.toBe(base);
    expect(computeDedupeKey({ ...input, canonicalPayloadHash: sha('c') })).not.toBe(base);
  });

  it('normalizes eventType case and whitespace', () => {
    expect(computeDedupeKey({ ...input, eventType: 'Run.Started' })).toBe(computeDedupeKey(input));
    expect(computeDedupeKey({ ...input, eventType: '  run.started  ' })).toBe(
      computeDedupeKey(input),
    );
  });

  it('normalizes occurredAt to the same UTC instant across timezone offsets', () => {
    expect(computeDedupeKey({ ...input, occurredAt: '2026-08-02T12:00:00.000+02:00' })).toBe(
      computeDedupeKey(input),
    );
  });

  it('produces the same key from an envelope as from its fields', () => {
    const envelope = {
      ...baseEnvelope,
      eventType: EventFamily.RunStarted,
      payload: payloadFixtures[EventFamily.RunStarted],
    } as {
      subject: { tenantId: string };
      producer: { sourceKind: string; sourceId: string };
      eventType: string;
      occurredAt: string;
      payload: unknown;
    };
    const fromEnvelope = computeDedupeKey({
      tenantId: envelope.subject.tenantId,
      sourceKind: envelope.producer.sourceKind,
      sourceRecordId: envelope.producer.sourceId,
      eventType: envelope.eventType,
      occurredAt: envelope.occurredAt,
      canonicalPayloadHash: canonicalPayloadHash(envelope.payload),
    });
    const direct = computeDedupeKey({
      tenantId: 'acme',
      sourceKind: 'adr',
      sourceRecordId: 'sess-42:msg-12',
      eventType: EventFamily.RunStarted,
      occurredAt: TS,
      canonicalPayloadHash: canonicalPayloadHash(payloadFixtures[EventFamily.RunStarted]),
    });
    expect(fromEnvelope).toBe(direct);
  });
});

describe('canonical payload hashing', () => {
  it('is stable under key ordering', () => {
    const a = { runId: 'run-7', sessionId: 'sess-42', startedAt: TS };
    const b = { startedAt: TS, runId: 'run-7', sessionId: 'sess-42' };
    expect(canonicalPayloadHash(a)).toBe(canonicalPayloadHash(b));
    expect(canonicalPayloadHash(a)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('equals sha256Hex of the stable stringify', () => {
    const payload = { runId: 'run-7', nested: { a: 1, b: [1, 2, 3] } };
    expect(canonicalPayloadHash(payload)).toBe(`sha256:${sha256Hex(stableStringify(payload))}`);
  });

  it('changes when payload content changes', () => {
    expect(canonicalPayloadHash({ runId: 'run-7' })).not.toBe(
      canonicalPayloadHash({ runId: 'run-8' }),
    );
  });
});
