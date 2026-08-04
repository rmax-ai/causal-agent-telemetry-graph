/**
 * ADR → CATG mapping — turns validated ADR AgentEvent records into canonical
 * CATG event envelopes (SPEC.md §9, §12).
 *
 * Mapping rules:
 * - session  → session.observed (+ message.observed / tool_call.observed /
 *   tool_result.observed for the embedded transcript; tool-role messages pair
 *   with the assistant message's tool call by `call_id`)
 * - run_start → run.started
 * - run_end  → run.completed
 * - message  → message.observed (+ embedded tool call/result events)
 * - tool_call → tool_call.observed (+ tool_result.observed when a result is
 *   embedded in the call)
 * - tool_result → tool_result.observed (correlated via `call_id`)
 * - model_invocation → model.invocation.started / model.invocation.completed
 *   (paired on `invocation_id`)
 *
 * Content security: raw message/tool content is never stored — only its
 * sha256 canonical hash (contentMode: hash_only, AGENTS.md "Content Security").
 */
import { hashCanonical } from '@catg/canonical-json';
import {
  type CanonicalEventEnvelope,
  type ContentMode,
  EVENT_FAMILY_SCHEMAS,
  EventFamily,
  type MessageObservedPayload,
  type ModelInvocationCompletedPayload,
  type ModelInvocationStartedPayload,
  type RunCompletedPayload,
  type RunStartedPayload,
  type SessionObservedPayload,
  type ToolCallObservedPayload,
  type ToolResultObservedPayload,
} from '@catg/schema';
import {
  ADAPTER_NAME,
  ADAPTER_VERSION,
  type AdrAgentEvent,
  type AdrMessage,
  type AdrToolCall,
  CANONICAL_SCHEMA_VERSION,
  DEFAULT_TENANT_ID,
} from './types.js';

/** Per-record mapping options. */
export interface MappingContext {
  /** Tenant namespace stamped on `subject.tenantId` of every produced event. */
  tenantId: string;
  /** Content handling mode for hashed payload content (hash_only by default). */
  contentMode: ContentMode;
}

/**
 * Build the mapping context for a record: tenant from the record (if
 * declared) or the default, content mode locked to hash_only (raw secrets are
 * disabled by default per AGENTS.md).
 */
export function mappingContextFor(record: AdrAgentEvent): MappingContext {
  return {
    tenantId: record.tenant_id ?? DEFAULT_TENANT_ID,
    contentMode: 'hash_only',
  };
}

/** Shared source-record fields needed to stamp every derived envelope. */
interface SourceRecordContext {
  event_id: string;
  session_id?: string;
  run_id?: string;
  agent_id?: string;
  observed_at?: string;
  timestamp: string;
  producer_version?: string;
}

/** Extract the shared source-record context from any ADR event record. */
function recordContextOf(record: AdrAgentEvent): SourceRecordContext {
  return {
    event_id: record.event_id,
    session_id: record.session_id,
    run_id: record.run_id,
    agent_id: record.agent_id,
    observed_at: record.observed_at,
    timestamp: record.timestamp,
    producer_version: record.producer_version,
  };
}

/** Seed fields for `buildEnvelope`; everything not listed is defaulted. */
export interface EnvelopeSeed {
  /** Source-stable canonical event id (SPEC.md §9 idempotency). */
  eventId: string;
  /** Canonical event family name (e.g. `run.started`). */
  eventType: string;
  /** When the underlying activity occurred. */
  occurredAt: string;
  /** When CATG observed the record (falls back to the record timestamp). */
  observedAt: string;
  /** Stable id of the source ADR record. */
  sourceId: string;
  sessionId?: string;
  runId?: string;
  agentId?: string;
  principalId?: string;
  producerVersion?: string;
  /** Family-specific payload. */
  payload: Record<string, unknown>;
  /** Bounded non-authoritative extensions (ADR-006). */
  extensions?: Record<string, unknown>;
}

/**
 * Build a canonical event envelope from a seed, stamping producer identity,
 * subject/identity context, provenance, security classification, and the
 * integrity hash (sha256 of the canonical serialization of the envelope minus
 * the hash field itself; deterministic per SPEC.md §9).
 */
export function buildEnvelope(seed: EnvelopeSeed, context: MappingContext): CanonicalEventEnvelope {
  const body: Omit<CanonicalEventEnvelope, 'integrityHash'> = {
    eventId: seed.eventId,
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventType: seed.eventType,
    occurredAt: seed.occurredAt,
    observedAt: seed.observedAt,
    producer: {
      sourceKind: 'adr',
      sourceId: seed.sourceId,
      producerName: 'adr-sensor',
      ...(seed.producerVersion !== undefined ? { producerVersion: seed.producerVersion } : {}),
      adapterName: ADAPTER_NAME,
      adapterVersion: ADAPTER_VERSION,
    },
    subject: {
      tenantId: context.tenantId,
      ...(seed.sessionId !== undefined ? { sessionId: seed.sessionId } : {}),
      ...(seed.runId !== undefined ? { runId: seed.runId } : {}),
      ...(seed.principalId !== undefined ? { principalId: seed.principalId } : {}),
    },
    traceContext: {},
    identityContext: {
      ...(seed.agentId !== undefined ? { agentId: seed.agentId } : {}),
      ...(seed.sessionId !== undefined ? { sessionId: seed.sessionId } : {}),
    },
    payload: seed.payload,
    provenance: [{ sourceId: seed.sourceId, eventId: seed.eventId, observedAt: seed.observedAt }],
    securityClassification: {
      classification: 'internal',
      handling: [],
      redactionProfile: 'adr-default',
    },
    extensions: seed.extensions ?? {},
  };
  return { ...body, integrityHash: hashCanonical(body) };
}

/** SHA-256 canonical content hash of a value, guarding against undefined. */
function contentHashOf(value: unknown): string {
  return hashCanonical(value ?? '');
}

/**
 * Map an ADR tool call to tool_call.observed (+ tool_result.observed when the
 * call embeds a result). The call is recorded in `pendingCalls` so a later
 * tool-role message or tool_result record can pair with it by `call_id`.
 */
function mapToolCall(
  call: AdrToolCall,
  source: SourceRecordContext,
  context: MappingContext,
  pendingCalls: Map<string, AdrToolCall>,
  messageId?: string,
): CanonicalEventEnvelope[] {
  const occurredAt = call.timestamp ?? source.timestamp;
  const sessionId = source.session_id;
  const status =
    call.status ??
    (call.result !== undefined
      ? call.result.is_error === true
        ? 'failed'
        : 'succeeded'
      : 'executing');

  const callPayload: ToolCallObservedPayload = {
    callId: call.call_id,
    toolName: call.tool_name,
    argumentsHash: contentHashOf(call.arguments),
    status,
    ...(messageId !== undefined ? { messageId } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
  };

  const events: CanonicalEventEnvelope[] = [
    buildEnvelope(
      {
        eventId: `${source.event_id}:${call.call_id}:tool_call.observed`,
        eventType: EventFamily.ToolCallObserved,
        occurredAt,
        observedAt: source.observed_at ?? source.timestamp,
        sourceId: source.event_id,
        sessionId,
        runId: source.run_id,
        agentId: source.agent_id,
        producerVersion: source.producer_version,
        payload: callPayload,
      },
      context,
    ),
  ];

  if (call.result !== undefined) {
    const result = call.result;
    const resultPayload: ToolResultObservedPayload = {
      callId: call.call_id,
      contentMode: context.contentMode,
      contentHash: contentHashOf(result.content),
      isError: result.is_error ?? status === 'failed',
      ...(result.exit_code !== undefined ? { exitCode: result.exit_code } : {}),
      ...(result.duration_ms !== undefined ? { durationMs: result.duration_ms } : {}),
    };
    events.push(
      buildEnvelope(
        {
          eventId: `${source.event_id}:${call.call_id}:tool_result.observed`,
          eventType: EventFamily.ToolResultObserved,
          occurredAt,
          observedAt: source.observed_at ?? source.timestamp,
          sourceId: source.event_id,
          sessionId,
          runId: source.run_id,
          agentId: source.agent_id,
          producerVersion: source.producer_version,
          payload: resultPayload,
        },
        context,
      ),
    );
  }

  pendingCalls.set(call.call_id, call);
  return events;
}

/**
 * Map a transcript message to message.observed, expanding assistant tool
 * calls (tool_call.observed) and pairing tool-role result messages
 * (tool_result.observed) via `call_id`.
 */
function mapMessage(
  message: AdrMessage,
  index: number,
  source: SourceRecordContext,
  context: MappingContext,
  pendingCalls: Map<string, AdrToolCall>,
): CanonicalEventEnvelope[] {
  const occurredAt = message.timestamp ?? source.timestamp;
  const sessionId = source.session_id ?? source.event_id;
  const events: CanonicalEventEnvelope[] = [];

  const messagePayload: MessageObservedPayload = {
    messageId: message.message_id,
    sessionId,
    role: message.role,
    contentMode: context.contentMode,
    contentHash: contentHashOf(message.content),
    sequenceId: message.sequence_id ?? index + 1,
    ...(message.token_count !== undefined ? { tokenCount: message.token_count } : {}),
  };
  events.push(
    buildEnvelope(
      {
        eventId: `${source.event_id}:${message.message_id}:message.observed`,
        eventType: EventFamily.MessageObserved,
        occurredAt,
        observedAt: source.observed_at ?? source.timestamp,
        sourceId: source.event_id,
        sessionId,
        runId: source.run_id,
        agentId: source.agent_id,
        producerVersion: source.producer_version,
        payload: messagePayload,
      },
      context,
    ),
  );

  for (const call of message.tool_calls ?? []) {
    events.push(...mapToolCall(call, source, context, pendingCalls, message.message_id));
  }

  if (message.tool_call_id !== undefined) {
    const pairedCall = pendingCalls.get(message.tool_call_id);
    const resultPayload: ToolResultObservedPayload = {
      resultId: message.message_id,
      callId: message.tool_call_id,
      contentMode: context.contentMode,
      contentHash: contentHashOf(message.content),
      isError: pairedCall?.status === 'failed',
    };
    events.push(
      buildEnvelope(
        {
          eventId: `${source.event_id}:${message.message_id}:tool_result.observed`,
          eventType: EventFamily.ToolResultObserved,
          occurredAt,
          observedAt: source.observed_at ?? source.timestamp,
          sourceId: source.event_id,
          sessionId,
          runId: source.run_id,
          agentId: source.agent_id,
          producerVersion: source.producer_version,
          payload: resultPayload,
        },
        context,
      ),
    );
  }

  return events;
}

/** Map a session record to session.observed plus expanded transcript events. */
function mapSessionEvent(
  record: Extract<AdrAgentEvent, { event_type: 'session' }>,
  source: SourceRecordContext,
  context: MappingContext,
): CanonicalEventEnvelope[] {
  const occurredAt = record.started_at ?? source.timestamp;
  const sessionId = record.session_id ?? source.event_id;
  const sessionPayload: SessionObservedPayload = {
    sessionId,
    source: 'adr',
    startedAt: occurredAt,
    ...(record.principal_id !== undefined ? { principalId: record.principal_id } : {}),
    ...(record.agent_id !== undefined ? { agentId: record.agent_id } : {}),
    ...(record.title !== undefined ? { title: record.title } : {}),
  };

  const events: CanonicalEventEnvelope[] = [
    buildEnvelope(
      {
        eventId: `${source.event_id}:session.observed`,
        eventType: EventFamily.SessionObserved,
        occurredAt,
        observedAt: source.observed_at ?? source.timestamp,
        sourceId: source.event_id,
        sessionId,
        runId: source.run_id,
        agentId: record.agent_id,
        principalId: record.principal_id,
        producerVersion: source.producer_version,
        payload: sessionPayload,
      },
      context,
    ),
  ];

  const pendingCalls = new Map<string, AdrToolCall>();
  for (const [index, message] of (record.messages ?? []).entries()) {
    events.push(...mapMessage(message, index, source, context, pendingCalls));
  }
  for (const call of record.tool_calls ?? []) {
    events.push(...mapToolCall(call, source, context, pendingCalls));
  }
  return events;
}

/** Map an ADR AgentEvent record to one or more canonical CATG events. */
export function mapAdrEvent(
  record: AdrAgentEvent,
  context: MappingContext,
): CanonicalEventEnvelope[] {
  const source = recordContextOf(record);
  const pendingCalls = new Map<string, AdrToolCall>();

  switch (record.event_type) {
    case 'session':
      return mapSessionEvent(record, source, context);
    case 'run_start': {
      const runPayload: RunStartedPayload = {
        runId: record.run_id,
        ...(record.session_id !== undefined ? { sessionId: record.session_id } : {}),
        ...(record.objective !== undefined ? { objective: record.objective } : {}),
        ...(record.parent_run_id !== undefined ? { parentRunId: record.parent_run_id } : {}),
        startedAt: source.timestamp,
      };
      return [
        buildEnvelope(
          {
            eventId: `${source.event_id}:run.started`,
            eventType: EventFamily.RunStarted,
            occurredAt: source.timestamp,
            observedAt: source.observed_at ?? source.timestamp,
            sourceId: source.event_id,
            sessionId: record.session_id,
            runId: record.run_id,
            agentId: record.agent_id,
            producerVersion: source.producer_version,
            payload: runPayload,
          },
          context,
        ),
      ];
    }
    case 'run_end': {
      const status = record.status ?? 'completed';
      const completedAt = record.completed_at ?? source.timestamp;
      const runPayload: RunCompletedPayload = {
        runId: record.run_id,
        ...(record.session_id !== undefined ? { sessionId: record.session_id } : {}),
        status,
        completedAt,
        ...(record.duration_ms !== undefined ? { durationMs: record.duration_ms } : {}),
        ...(record.exit_reason !== undefined ? { exitReason: record.exit_reason } : {}),
      };
      return [
        buildEnvelope(
          {
            eventId: `${source.event_id}:run.completed`,
            eventType: EventFamily.RunCompleted,
            occurredAt: completedAt,
            observedAt: source.observed_at ?? source.timestamp,
            sourceId: source.event_id,
            sessionId: record.session_id,
            runId: record.run_id,
            agentId: record.agent_id,
            producerVersion: source.producer_version,
            payload: runPayload,
          },
          context,
        ),
      ];
    }
    case 'message':
      return mapMessage(record.message, 0, source, context, pendingCalls);
    case 'tool_call':
      return mapToolCall(record.call, source, context, pendingCalls, record.message_id);
    case 'tool_result': {
      const resultPayload: ToolResultObservedPayload = {
        ...(record.result_id !== undefined ? { resultId: record.result_id } : {}),
        callId: record.call_id,
        contentMode: context.contentMode,
        contentHash: contentHashOf(record.content),
        isError: record.is_error ?? false,
        ...(record.exit_code !== undefined ? { exitCode: record.exit_code } : {}),
        ...(record.duration_ms !== undefined ? { durationMs: record.duration_ms } : {}),
      };
      return [
        buildEnvelope(
          {
            eventId: `${source.event_id}:${record.call_id}:tool_result.observed`,
            eventType: EventFamily.ToolResultObserved,
            occurredAt: source.timestamp,
            observedAt: source.observed_at ?? source.timestamp,
            sourceId: source.event_id,
            sessionId: source.session_id,
            runId: source.run_id,
            agentId: source.agent_id,
            producerVersion: source.producer_version,
            payload: resultPayload,
          },
          context,
        ),
      ];
    }
    case 'model_invocation': {
      const invocation = record.invocation;
      const operation = invocation.operation ?? 'chat';
      if (invocation.phase === 'started') {
        const startPayload: ModelInvocationStartedPayload = {
          invocationId: invocation.invocation_id,
          ...(invocation.trace_id !== undefined ? { traceId: invocation.trace_id } : {}),
          ...(invocation.span_id !== undefined ? { spanId: invocation.span_id } : {}),
          ...(invocation.provider !== undefined ? { provider: invocation.provider } : {}),
          modelId: invocation.model_id,
          operation,
          ...(invocation.input_tokens !== undefined
            ? { inputTokens: invocation.input_tokens }
            : {}),
        };
        return [
          buildEnvelope(
            {
              eventId: `${source.event_id}:${invocation.invocation_id}:model.invocation.started`,
              eventType: EventFamily.ModelInvocationStarted,
              occurredAt: invocation.started_at ?? source.timestamp,
              observedAt: source.observed_at ?? source.timestamp,
              sourceId: source.event_id,
              sessionId: source.session_id,
              runId: source.run_id,
              agentId: source.agent_id,
              producerVersion: source.producer_version,
              payload: startPayload,
            },
            context,
          ),
        ];
      }
      const completePayload: ModelInvocationCompletedPayload = {
        invocationId: invocation.invocation_id,
        ...(invocation.trace_id !== undefined ? { traceId: invocation.trace_id } : {}),
        ...(invocation.span_id !== undefined ? { spanId: invocation.span_id } : {}),
        ...(invocation.provider !== undefined ? { provider: invocation.provider } : {}),
        modelId: invocation.model_id,
        ...(invocation.output_tokens !== undefined
          ? { outputTokens: invocation.output_tokens }
          : {}),
        ...(invocation.finish_reason !== undefined
          ? { finishReason: invocation.finish_reason }
          : {}),
        ...(invocation.latency_ms !== undefined ? { latencyMs: invocation.latency_ms } : {}),
      };
      return [
        buildEnvelope(
          {
            eventId: `${source.event_id}:${invocation.invocation_id}:model.invocation.completed`,
            eventType: EventFamily.ModelInvocationCompleted,
            occurredAt: invocation.completed_at ?? source.timestamp,
            observedAt: source.observed_at ?? source.timestamp,
            sourceId: source.event_id,
            sessionId: source.session_id,
            runId: source.run_id,
            agentId: source.agent_id,
            producerVersion: source.producer_version,
            payload: completePayload,
          },
          context,
        ),
      ];
    }
  }
}

/**
 * Validate a produced envelope against its family schema (SPEC.md §9).
 * Returns a human-readable error string, or undefined when valid.
 */
export function validateEnvelope(event: CanonicalEventEnvelope): string | undefined {
  const family = EVENT_FAMILY_SCHEMAS[event.eventType as keyof typeof EVENT_FAMILY_SCHEMAS];
  if (family === undefined) {
    return `unknown event family ${event.eventType}`;
  }
  const parsed = family.safeParse(event);
  if (parsed.success) {
    return undefined;
  }
  return parsed.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
