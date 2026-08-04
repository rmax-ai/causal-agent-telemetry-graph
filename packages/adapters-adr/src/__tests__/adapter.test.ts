import { describe, expect, it } from 'vitest';
import { adapterAdr } from '../index.js';
import { type AdrAgentEvent, AdrAgentEventSchema, AdrInputSchema } from '../types.js';

const TS = '2026-08-02T10:00:00.000Z';
const TS_END = '2026-08-02T10:05:00.000Z';
const SHA_PATTERN = /^sha256:[a-f0-9]{64}$/;

/** Session record with a chat transcript: user → assistant(tool_calls) → tool → assistant. */
const sessionRecord: AdrAgentEvent = {
  event_id: 'evt-session-1',
  event_type: 'session',
  session_id: 'sess-42',
  agent_id: 'claude-code',
  tenant_id: 'acme',
  timestamp: TS,
  title: 'Fix login bug',
  messages: [
    { message_id: 'msg-1', role: 'user', content: 'Please fix the login bug', sequence_id: 1 },
    {
      message_id: 'msg-2',
      role: 'assistant',
      content: 'I will read the auth file.',
      sequence_id: 2,
      tool_calls: [{ call_id: 'call-1', tool_name: 'read_file', arguments: { path: 'auth.ts' } }],
    },
    {
      message_id: 'msg-3',
      role: 'tool',
      tool_call_id: 'call-1',
      content: 'export function login() {}',
      sequence_id: 3,
    },
    { message_id: 'msg-4', role: 'assistant', content: 'Done.', sequence_id: 4 },
  ],
};

const runStartRecord: AdrAgentEvent = {
  event_id: 'evt-run-1',
  event_type: 'run_start',
  session_id: 'sess-42',
  run_id: 'run-7',
  objective: 'Fix login bug',
  timestamp: TS,
};

const runEndRecord: AdrAgentEvent = {
  event_id: 'evt-run-2',
  event_type: 'run_end',
  session_id: 'sess-42',
  run_id: 'run-7',
  status: 'completed',
  completed_at: TS_END,
  duration_ms: 300_000,
  timestamp: TS_END,
};

/** Standalone tool_call record with an embedded result. */
const toolCallRecord: AdrAgentEvent = {
  event_id: 'evt-tc-1',
  event_type: 'tool_call',
  session_id: 'sess-42',
  run_id: 'run-7',
  timestamp: TS,
  call: {
    call_id: 'call-9',
    tool_name: 'run_shell',
    arguments: { cmd: 'ls' },
    status: 'succeeded',
    result: { content: 'src\n', is_error: false, exit_code: 0, duration_ms: 120 },
  },
};

/** Standalone tool_result record pairing with call-9 via call_id. */
const toolResultRecord: AdrAgentEvent = {
  event_id: 'evt-tr-1',
  event_type: 'tool_result',
  session_id: 'sess-42',
  call_id: 'call-9',
  result_id: 'res-9',
  content: 'src\n',
  is_error: false,
  exit_code: 0,
  timestamp: TS,
};

/** Model invocation started/completed pair sharing invocation_id. */
const modelStartRecord: AdrAgentEvent = {
  event_id: 'evt-mi-1',
  event_type: 'model_invocation',
  session_id: 'sess-42',
  run_id: 'run-7',
  timestamp: TS,
  invocation: {
    invocation_id: 'inv-1',
    phase: 'started',
    model_id: 'claude-sonnet-4',
    provider: 'anthropic',
    operation: 'chat',
    input_tokens: 1200,
    started_at: TS,
  },
};

const modelEndRecord: AdrAgentEvent = {
  event_id: 'evt-mi-2',
  event_type: 'model_invocation',
  session_id: 'sess-42',
  run_id: 'run-7',
  timestamp: TS,
  invocation: {
    invocation_id: 'inv-1',
    phase: 'completed',
    model_id: 'claude-sonnet-4',
    provider: 'anthropic',
    output_tokens: 340,
    finish_reason: 'end_turn',
    latency_ms: 2100,
    completed_at: TS,
  },
};

function byType(events: ReturnType<typeof adapterAdr>['events'], type: string) {
  return events.filter((event) => event.eventType === type);
}

describe('ADR schema validation', () => {
  it('accepts every supported event type as an AdrAgentEvent', () => {
    for (const record of [
      sessionRecord,
      runStartRecord,
      runEndRecord,
      toolCallRecord,
      toolResultRecord,
      modelStartRecord,
      modelEndRecord,
    ]) {
      expect(AdrAgentEventSchema.safeParse(record).success).toBe(true);
    }
  });

  it('accepts single records and arrays as AdrInput', () => {
    expect(AdrInputSchema.safeParse(sessionRecord).success).toBe(true);
    expect(AdrInputSchema.safeParse([sessionRecord, runStartRecord]).success).toBe(true);
  });

  it('rejects records with an unknown event_type', () => {
    const result = AdrAgentEventSchema.safeParse({ ...sessionRecord, event_type: 'bogus' });
    expect(result.success).toBe(false);
  });

  it('rejects records with a malformed timestamp', () => {
    const result = AdrAgentEventSchema.safeParse({ ...sessionRecord, timestamp: 'not-a-date' });
    expect(result.success).toBe(false);
  });
});

describe('adapterAdr — basic session / run / message extraction', () => {
  it('maps a session record to session.observed with envelope metadata', () => {
    const { events, errors } = adapterAdr(sessionRecord);
    expect(errors).toEqual([]);

    const sessionEvents = byType(events, 'session.observed');
    expect(sessionEvents).toHaveLength(1);
    const session = sessionEvents[0];
    if (!session) throw new Error('expected session.observed event');

    expect(session.eventId).toBe('evt-session-1:session.observed');
    expect(session.schemaVersion).toBe('1.0.0');
    expect(session.occurredAt).toBe(TS);
    expect(session.observedAt).toBe(TS);
    expect(session.producer).toMatchObject({
      sourceKind: 'adr',
      sourceId: 'evt-session-1',
      producerName: 'adr-sensor',
      adapterName: 'adr',
      adapterVersion: '0.1.0',
    });
    expect(session.subject).toMatchObject({ tenantId: 'acme', sessionId: 'sess-42' });
    expect(session.identityContext).toMatchObject({ agentId: 'claude-code', sessionId: 'sess-42' });
    expect(session.provenance).toEqual([
      { sourceId: 'evt-session-1', eventId: 'evt-session-1:session.observed', observedAt: TS },
    ]);
    expect(session.integrityHash).toMatch(SHA_PATTERN);
    expect(session.payload).toMatchObject({
      sessionId: 'sess-42',
      source: 'adr',
      startedAt: TS,
      title: 'Fix login bug',
    });
  });

  it('expands every transcript message into message.observed', () => {
    const { events, errors } = adapterAdr(sessionRecord);
    expect(errors).toEqual([]);

    const messages = byType(events, 'message.observed');
    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.payload.messageId)).toEqual(['msg-1', 'msg-2', 'msg-3', 'msg-4']);
    expect(messages.map((m) => m.payload.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(messages.map((m) => m.payload.sequenceId)).toEqual([1, 2, 3, 4]);
    for (const message of messages) {
      expect(message.payload.contentMode).toBe('hash_only');
      expect(message.payload.contentHash).toMatch(SHA_PATTERN);
      expect(message.payload.sessionId).toBe('sess-42');
    }
  });

  it('maps run_start and run_end to run.started / run.completed', () => {
    const { events, errors } = adapterAdr([runStartRecord, runEndRecord]);
    expect(errors).toEqual([]);

    const started = byType(events, 'run.started');
    const completed = byType(events, 'run.completed');
    expect(started).toHaveLength(1);
    expect(completed).toHaveLength(1);

    const startedEvent = started[0];
    if (!startedEvent) throw new Error('expected run.started event');
    expect(startedEvent.payload).toMatchObject({
      runId: 'run-7',
      sessionId: 'sess-42',
      objective: 'Fix login bug',
      startedAt: TS,
    });
    expect(startedEvent.eventId).toBe('evt-run-1:run.started');

    const completedEvent = completed[0];
    if (!completedEvent) throw new Error('expected run.completed event');
    expect(completedEvent.payload).toMatchObject({
      runId: 'run-7',
      status: 'completed',
      completedAt: TS_END,
      durationMs: 300_000,
    });
    expect(completedEvent.eventId).toBe('evt-run-2:run.completed');
  });

  it('is deterministic: same input produces the same event ids and hashes', () => {
    const first = adapterAdr([sessionRecord, runStartRecord, runEndRecord]);
    const second = adapterAdr([sessionRecord, runStartRecord, runEndRecord]);
    expect(first.events.map((e) => e.eventId)).toEqual(second.events.map((e) => e.eventId));
    expect(first.events.map((e) => e.integrityHash)).toEqual(
      second.events.map((e) => e.integrityHash),
    );
  });
});

describe('adapterAdr — tool call + result pairing', () => {
  it('pairs assistant tool_calls with tool-role result messages by call_id', () => {
    const { events, errors } = adapterAdr(sessionRecord);
    expect(errors).toEqual([]);

    const calls = byType(events, 'tool_call.observed');
    const results = byType(events, 'tool_result.observed');
    expect(calls).toHaveLength(1);
    expect(results).toHaveLength(1);

    const call = calls[0];
    const result = results[0];
    if (!call || !result) throw new Error('expected tool call and result events');

    expect(call.payload).toMatchObject({
      callId: 'call-1',
      toolName: 'read_file',
      status: 'executing',
      messageId: 'msg-2',
      sessionId: 'sess-42',
    });
    expect(call.payload.argumentsHash).toMatch(SHA_PATTERN);

    // Pairing: the result references the same call_id.
    expect(result.payload.callId).toBe(call.payload.callId);
    expect(result.payload.resultId).toBe('msg-3');
    expect(result.payload.contentHash).toMatch(SHA_PATTERN);
    expect(result.payload.isError).toBe(false);
  });

  it('emits tool_call.observed + tool_result.observed from an embedded result', () => {
    const { events, errors } = adapterAdr(toolCallRecord);
    expect(errors).toEqual([]);

    const calls = byType(events, 'tool_call.observed');
    const results = byType(events, 'tool_result.observed');
    expect(calls).toHaveLength(1);
    expect(results).toHaveLength(1);

    const call = calls[0];
    const result = results[0];
    if (!call || !result) throw new Error('expected tool call and result events');
    expect(call.payload.status).toBe('succeeded');
    expect(result.payload).toMatchObject({
      callId: 'call-9',
      isError: false,
      exitCode: 0,
      durationMs: 120,
      contentMode: 'hash_only',
    });
    expect(result.eventId).toBe('evt-tc-1:call-9:tool_result.observed');
  });

  it('maps a standalone tool_result record correlated via call_id', () => {
    const { events, errors } = adapterAdr(toolResultRecord);
    expect(errors).toEqual([]);

    const results = byType(events, 'tool_result.observed');
    expect(results).toHaveLength(1);
    const result = results[0];
    if (!result) throw new Error('expected tool_result.observed event');
    expect(result.payload).toMatchObject({
      resultId: 'res-9',
      callId: 'call-9',
      isError: false,
      exitCode: 0,
    });
    expect(result.eventId).toBe('evt-tr-1:call-9:tool_result.observed');
  });
});

describe('adapterAdr — model invocation pairing', () => {
  it('pairs model.invocation.started and model.invocation.completed on invocation_id', () => {
    const { events, errors } = adapterAdr([modelStartRecord, modelEndRecord]);
    expect(errors).toEqual([]);

    const started = byType(events, 'model.invocation.started');
    const completed = byType(events, 'model.invocation.completed');
    expect(started).toHaveLength(1);
    expect(completed).toHaveLength(1);

    const startEvent = started[0];
    const endEvent = completed[0];
    if (!startEvent || !endEvent) throw new Error('expected model invocation events');

    expect(startEvent.payload).toMatchObject({
      invocationId: 'inv-1',
      modelId: 'claude-sonnet-4',
      provider: 'anthropic',
      operation: 'chat',
      inputTokens: 1200,
    });
    expect(startEvent.eventId).toBe('evt-mi-1:inv-1:model.invocation.started');

    expect(endEvent.payload).toMatchObject({
      invocationId: 'inv-1',
      modelId: 'claude-sonnet-4',
      outputTokens: 340,
      finishReason: 'end_turn',
      latencyMs: 2100,
    });
    expect(endEvent.eventId).toBe('evt-mi-2:inv-1:model.invocation.completed');
    expect(endEvent.payload.invocationId).toBe(startEvent.payload.invocationId);
  });

  it('defaults the operation to chat and the timestamp to the record timestamp', () => {
    const { events, errors } = adapterAdr({
      event_id: 'evt-mi-3',
      event_type: 'model_invocation',
      timestamp: TS,
      invocation: { invocation_id: 'inv-2', phase: 'started', model_id: 'gpt-5' },
    });
    expect(errors).toEqual([]);
    const started = byType(events, 'model.invocation.started');
    expect(started).toHaveLength(1);
    const startEvent = started[0];
    if (!startEvent) throw new Error('expected model.invocation.started event');
    expect(startEvent.payload).toMatchObject({ invocationId: 'inv-2', operation: 'chat' });
    expect(startEvent.occurredAt).toBe(TS);
  });
});

describe('adapterAdr — malformed input handling', () => {
  it('rejects non-object input with an error and no events', () => {
    for (const garbage of [42, 'not json {', null, undefined, true]) {
      const { events, errors } = adapterAdr(garbage);
      expect(events).toEqual([]);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('parses a JSON-encoded string input', () => {
    const { events, errors } = adapterAdr(JSON.stringify(sessionRecord));
    expect(errors).toEqual([]);
    expect(byType(events, 'session.observed')).toHaveLength(1);
  });

  it('rejects a record missing required fields', () => {
    const { events, errors } = adapterAdr({ event_type: 'session', timestamp: TS });
    expect(events).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/\[adr record <unknown>\]/);
    expect(errors[0]).toMatch(/event_id/);
  });

  it('rejects a record with an unknown event_type', () => {
    const { events, errors } = adapterAdr({
      event_id: 'evt-bad',
      event_type: 'teleport',
      timestamp: TS,
    });
    expect(events).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/evt-bad/);
  });

  it('quarantines bad records without dropping good ones in a batch', () => {
    const { events, errors } = adapterAdr([
      sessionRecord,
      { event_id: 'evt-bad', event_type: 'bogus', timestamp: TS },
      runStartRecord,
    ]);
    expect(byType(events, 'session.observed')).toHaveLength(1);
    expect(byType(events, 'run.started')).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/evt-bad/);
  });

  it('reports events that fail family validation instead of returning them', () => {
    // A record whose payload cannot produce a valid family event (invalid
    // role) must surface as an error, not as a malformed event.
    const { events, errors } = adapterAdr({
      event_id: 'evt-msg-bad',
      event_type: 'message',
      session_id: 'sess-42',
      timestamp: TS,
      message: { message_id: 'msg-x', role: 'wizard', content: 'hi' },
    });
    expect(byType(events, 'message.observed')).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });
});
