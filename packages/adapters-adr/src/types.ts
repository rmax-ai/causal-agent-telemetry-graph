/**
 * ADR (Agent Data Representation) input types — Zod schemas + inferred types
 * for the AgentEvent records emitted by the ADR Sensor bridge (SPEC.md §12).
 *
 * An ADR AgentEvent is a JSON record keyed on `event_type` (discriminated
 * union). The supported event types and their canonical CATG mappings:
 *
 * | event_type        | CATG canonical events                                  |
 * |-------------------|--------------------------------------------------------|
 * | session           | session.observed (+ message.observed, tool_call.observed,
 *                     tool_result.observed from embedded transcript) |
 * | run_start         | run.started                                            |
 * | run_end           | run.completed                                          |
 * | message           | message.observed (+ embedded tool call/result events)  |
 * | tool_call         | tool_call.observed (+ tool_result.observed when a result is embedded) |
 * | tool_result       | tool_result.observed                                   |
 * | model_invocation  | model.invocation.started | model.invocation.completed |
 */

import { IsoTimestampSchema } from '@catg/schema';
import { z } from 'zod';

/** Adapter identity reported on every produced event (SPEC.md §12). */
export const ADAPTER_NAME = 'adr';
/** Adapter version reported on every produced event. */
export const ADAPTER_VERSION = '0.1.0';
/** Canonical event schema version stamped on every envelope (SPEC.md §9). */
export const CANONICAL_SCHEMA_VERSION = '1.0.0';
/** Tenant used when a record does not declare `tenant_id`. */
export const DEFAULT_TENANT_ID = 'default';

/**
 * Message body content: a plain string, an array of content parts
 * (OpenAI-style `[{type, text}, ...]`), or a structured object.
 */
export const AdrContentSchema = z.union([
  z.string(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);
export type AdrContent = z.infer<typeof AdrContentSchema>;

/** Tool-call arguments: serialized string, object, or structured value. */
export const AdrToolArgumentsSchema = z.unknown();
export type AdrToolArguments = z.infer<typeof AdrToolArgumentsSchema>;

/** Optional per-call result embedded in a tool call record. */
export const AdrToolResultSchema = z.object({
  content: AdrContentSchema.optional().describe('Tool result body content.'),
  is_error: z.boolean().optional().describe('Whether the call failed.'),
  exit_code: z.number().int().optional().describe('Process exit code for subprocess tools.'),
  duration_ms: z.number().int().nonnegative().optional().describe('Call duration in ms.'),
});
export type AdrToolResult = z.infer<typeof AdrToolResultSchema>;

/** A tool invocation (OpenAI-style `tool_calls[]` entry). */
export const AdrToolCallSchema = z.object({
  call_id: z.string().min(1).describe('Stable call identifier (correlates with results).'),
  tool_name: z.string().min(1).describe('Name of the tool invoked.'),
  arguments: AdrToolArgumentsSchema.optional().describe('Tool arguments (object or string).'),
  status: z
    .enum(['pending', 'executing', 'succeeded', 'failed', 'denied'])
    .optional()
    .describe('Call status; defaults to executing (or succeeded/failed from result).'),
  result: AdrToolResultSchema.optional().describe('Result embedded in the call, when available.'),
  timestamp: IsoTimestampSchema.optional().describe('When the call was made, when known.'),
});
export type AdrToolCall = z.infer<typeof AdrToolCallSchema>;

/** A chat-history message inside a session record or standalone message event. */
export const AdrMessageSchema = z.object({
  message_id: z.string().min(1).describe('Stable message identifier.'),
  role: z
    .enum(['user', 'assistant', 'system', 'tool', 'function', 'developer'])
    .describe('Message role (mirrors CATG MessageObservedPayload.role).'),
  content: AdrContentSchema.optional().describe('Message body (never stored raw; hashed).'),
  tool_calls: z
    .array(AdrToolCallSchema)
    .optional()
    .describe('Tool calls requested by an assistant message.'),
  tool_call_id: z
    .string()
    .min(1)
    .optional()
    .describe('Call id referenced by a tool-role result message.'),
  sequence_id: z.number().int().nonnegative().optional().describe('Ordering within the session.'),
  token_count: z.number().int().nonnegative().optional().describe('Token count of the message.'),
  timestamp: IsoTimestampSchema.optional().describe('When the message was emitted, when known.'),
});
export type AdrMessage = z.infer<typeof AdrMessageSchema>;

/** A model invocation record (phase-paired on `invocation_id`). */
export const AdrModelInvocationSchema = z.object({
  invocation_id: z
    .string()
    .min(1)
    .describe('Stable invocation identifier (pairs started/completed).'),
  phase: z.enum(['started', 'completed']).describe('Invocation phase.'),
  model_id: z.string().min(1).describe('Model identifier.'),
  provider: z.string().min(1).optional().describe('Model provider.'),
  operation: z
    .enum(['generate', 'chat', 'embed', 'tool_use', 'other'])
    .optional()
    .describe('Model operation; defaults to chat.'),
  input_tokens: z.number().int().nonnegative().optional().describe('Input token count.'),
  output_tokens: z.number().int().nonnegative().optional().describe('Output token count.'),
  finish_reason: z.string().min(1).optional().describe('Provider-reported finish reason.'),
  latency_ms: z.number().int().nonnegative().optional().describe('Invocation latency in ms.'),
  trace_id: z.string().min(1).optional().describe('Provider trace id (carried in payload).'),
  span_id: z.string().min(1).optional().describe('Provider span id (carried in payload).'),
  started_at: IsoTimestampSchema.optional().describe('When the invocation started.'),
  completed_at: IsoTimestampSchema.optional().describe('When the invocation completed.'),
});
export type AdrModelInvocation = z.infer<typeof AdrModelInvocationSchema>;

/**
 * Fields shared by every ADR AgentEvent record. `messages`/`tool_calls` are
 * attached to session records (the ADR chat-history transcript shape).
 */
export const AdrEventBaseSchema = z.object({
  event_id: z.string().min(1).describe('Source-stable record identifier (ADR uuid).'),
  event_type: z.string().min(1).describe('Record discriminator (narrowed per event type).'),
  tenant_id: z.string().min(1).optional().describe('Tenant override; defaults to "default".'),
  agent_id: z.string().min(1).optional().describe('Agent identifier (e.g. claude-code).'),
  session_id: z.string().min(1).optional().describe('Session the record belongs to.'),
  run_id: z.string().min(1).optional().describe('Run the record belongs to.'),
  timestamp: IsoTimestampSchema.describe('When the activity occurred (occurredAt).'),
  observed_at: IsoTimestampSchema.optional().describe('When CATG observed the record.'),
  producer_version: z.string().min(1).optional().describe('Version of the producing sensor.'),
});
export type AdrEventBase = z.infer<typeof AdrEventBaseSchema>;

/** ADR session observation record (optionally carrying the chat transcript). */
export const AdrSessionEventSchema = AdrEventBaseSchema.safeExtend({
  event_type: z.literal('session'),
  started_at: IsoTimestampSchema.optional().describe(
    'When the session started; defaults to timestamp.',
  ),
  title: z.string().min(1).optional().describe('Optional session title.'),
  principal_id: z.string().min(1).optional().describe('Principal that initiated the session.'),
  messages: z
    .array(AdrMessageSchema)
    .optional()
    .describe('Chat-history transcript of the session.'),
  tool_calls: z
    .array(AdrToolCallSchema)
    .optional()
    .describe('Standalone tool calls observed in the session.'),
});
export type AdrSessionEvent = z.infer<typeof AdrSessionEventSchema>;

/** ADR run-start record. */
export const AdrRunStartEventSchema = AdrEventBaseSchema.safeExtend({
  event_type: z.literal('run_start'),
  run_id: z.string().min(1).describe('Run identifier.'),
  objective: z.string().min(1).optional().describe('Declared run objective.'),
  parent_run_id: z.string().min(1).optional().describe('Parent run id for nested runs.'),
});
export type AdrRunStartEvent = z.infer<typeof AdrRunStartEventSchema>;

/** ADR run-end record. */
export const AdrRunEndEventSchema = AdrEventBaseSchema.safeExtend({
  event_type: z.literal('run_end'),
  run_id: z.string().min(1).describe('Run identifier.'),
  status: z
    .enum(['completed', 'failed', 'cancelled'])
    .optional()
    .describe('Final run status; defaults to completed.'),
  completed_at: IsoTimestampSchema.optional().describe(
    'When the run completed; defaults to timestamp.',
  ),
  duration_ms: z.number().int().nonnegative().optional().describe('Run duration in ms.'),
  exit_reason: z
    .string()
    .min(1)
    .optional()
    .describe('Termination reason for non-normal completion.'),
});
export type AdrRunEndEvent = z.infer<typeof AdrRunEndEventSchema>;

/** ADR standalone message record. */
export const AdrMessageEventSchema = AdrEventBaseSchema.safeExtend({
  event_type: z.literal('message'),
  session_id: z.string().min(1).describe('Session the message belongs to.'),
  message: AdrMessageSchema.describe('The message payload.'),
});
export type AdrMessageEvent = z.infer<typeof AdrMessageEventSchema>;

/** ADR standalone tool-call record. */
export const AdrToolCallEventSchema = AdrEventBaseSchema.safeExtend({
  event_type: z.literal('tool_call'),
  call: AdrToolCallSchema.describe('The tool call payload.'),
  message_id: z.string().min(1).optional().describe('Message that requested the call.'),
});
export type AdrToolCallEvent = z.infer<typeof AdrToolCallEventSchema>;

/** ADR standalone tool-result record (pairs with a tool call via `call_id`). */
export const AdrToolResultEventSchema = AdrEventBaseSchema.safeExtend({
  event_type: z.literal('tool_result'),
  result_id: z.string().min(1).optional().describe('Source-stable result identifier.'),
  call_id: z.string().min(1).describe('Call identifier the result belongs to.'),
  content: AdrContentSchema.optional().describe('Result body (never stored raw; hashed).'),
  is_error: z.boolean().optional().describe('Whether the call failed.'),
  exit_code: z.number().int().optional().describe('Process exit code for subprocess tools.'),
  duration_ms: z.number().int().nonnegative().optional().describe('Call duration in ms.'),
});
export type AdrToolResultEvent = z.infer<typeof AdrToolResultEventSchema>;

/** ADR model-invocation record. */
export const AdrModelInvocationEventSchema = AdrEventBaseSchema.safeExtend({
  event_type: z.literal('model_invocation'),
  invocation: AdrModelInvocationSchema.describe('The model invocation payload.'),
});
export type AdrModelInvocationEvent = z.infer<typeof AdrModelInvocationEventSchema>;

/**
 * ADR AgentEvent record — discriminated union on `event_type`.
 */
export const AdrAgentEventSchema = z.discriminatedUnion('event_type', [
  AdrSessionEventSchema,
  AdrRunStartEventSchema,
  AdrRunEndEventSchema,
  AdrMessageEventSchema,
  AdrToolCallEventSchema,
  AdrToolResultEventSchema,
  AdrModelInvocationEventSchema,
]);
export type AdrAgentEvent = z.infer<typeof AdrAgentEventSchema>;

/**
 * Adapter input: a single AgentEvent record, an array of records (JSONL batch),
 * or a JSON-encoded string of either (parsed by `adapterAdr`).
 */
export const AdrInputSchema = z.union([AdrAgentEventSchema, z.array(AdrAgentEventSchema)]);
export type AdrInput = z.infer<typeof AdrInputSchema>;
