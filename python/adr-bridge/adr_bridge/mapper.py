"""Map ADR AgentEvent records to CATG canonical events.

The mapping mirrors the (planned) TypeScript ``adapters-adr`` normalization:
ADR sessions, run starts, messages, tool calls/results, and model invocations
become ``session.observed``, ``run.started``, ``message.observed``,
``tool_call.observed`` + ``tool_result.observed``, and
``model.invocation.started``/``model.invocation.completed`` canonical events
(packages/schema/src/events.ts).

Conventions (AGENTS.md "Code Style"):
    * content hashes use the ``sha256:`` prefix followed by 64 lowercase hex
      chars (never ``sha-256:``)
    * URNs use ``urn:catg:{tenant}:{source}:{id}`` with ``source = adr``; the
      opaque id segment may itself contain ``:``
    * canonical events are immutable once appended to the ledger
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Optional

from . import __version__

__all__ = [
    "SCHEMA_VERSION",
    "ADAPTER_NAME",
    "ADAPTER_VERSION",
    "SOURCE_KIND",
    "DEFAULT_TENANT",
    "DEFAULT_CONTENT_MODE",
    "canonicalize",
    "content_hash",
    "urn",
    "utc_now_iso",
    "normalize_timestamp",
    "map_record",
    "map_records",
]

SCHEMA_VERSION = "1.0.0"
ADAPTER_NAME = "adr-bridge"
ADAPTER_VERSION = __version__
PRODUCER_NAME = "adr-sensor"
PRODUCER_VERSION = "0.1.0"
SOURCE_KIND = "adr"
DEFAULT_TENANT = "default"
DEFAULT_CONTENT_MODE = "hash_only"
DEFAULT_CLASSIFICATION = "internal"

# ---------------------------------------------------------------------------
# Canonical JSON serialization (RFC 8785 style, mirrors packages/canonical-json)
# ---------------------------------------------------------------------------


def canonicalize(value) -> str:
    """Serialize ``value`` to canonical JSON: sorted object keys, no whitespace.

    Used for content hashing of structured payloads (tool arguments, ...) and
    for the event integrity hash chain.
    """
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return _serialize_float(value)
    if isinstance(value, str):
        return _serialize_string(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonicalize(item) for item in value) + "]"
    if isinstance(value, dict):
        return (
            "{"
            + ",".join(
                _serialize_string(key) + ":" + canonicalize(value[key])
                for key in sorted(value)
            )
            + "}"
        )
    raise TypeError(f"cannot canonicalize value of type {type(value).__name__}")


def _serialize_float(value: float) -> str:
    # RFC 8785: non-finite numbers serialize as null.
    if value != value or value in (float("inf"), float("-inf")):
        return "null"
    if value == 0:
        return "-0" if str(value).startswith("-") else "0"
    text = repr(value)  # shortest round-trip digits, like JS Number.toString
    match = re.fullmatch(r"(-?\d+(?:\.\d+)?)[eE]([+-]?\d+)", text)
    if match:
        mantissa, exponent = match.groups()
        if "." in mantissa:
            mantissa = mantissa.rstrip("0").rstrip(".")
        if mantissa in ("", "-0"):
            mantissa = "0"
        return f"{mantissa}e{int(exponent)}"
    return text


def _serialize_string(value: str) -> str:
    chunks = ['"']
    for char in value:
        code = ord(char)
        if char == "\\":
            chunks.append("\\\\")
        elif char == '"':
            chunks.append('\\"')
        elif char == "\n":
            chunks.append("\\n")
        elif char == "\r":
            chunks.append("\\r")
        elif char == "\t":
            chunks.append("\\t")
        elif char == "\f":
            chunks.append("\\f")
        elif code < 0x20:  # RFC 8785: remaining control chars as \\uXXXX
            chunks.append("\\u%04x" % code)
        else:
            chunks.append(char)
    chunks.append('"')
    return "".join(chunks)


# ---------------------------------------------------------------------------
# Hashing / identifiers
# ---------------------------------------------------------------------------


def content_hash(value) -> str:
    """Return ``sha256:{hex}`` for a string body or canonicalized structure."""
    if isinstance(value, str):
        data = value.encode("utf-8")
    else:
        data = canonicalize(value).encode("utf-8")
    return "sha256:" + hashlib.sha256(data).hexdigest()


def urn(tenant: str, record_id: str) -> str:
    """Build ``urn:catg:{tenant}:adr:{id}`` (id segment may contain ``:``)."""
    return f"urn:catg:{tenant}:adr:{record_id}"


def utc_now_iso() -> str:
    """Current UTC time as an ISO-8601 timestamp with millisecond precision."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


_EPOCH_RE = re.compile(r"^-?\d+(?:\.\d+)?$")


def normalize_timestamp(value):
    """Normalize ISO-8601 or epoch (s/ms) timestamps to ISO-8601 UTC (Z)."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        epoch_ms = value * 1000 if abs(value) < 1e12 else value
        return datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%S.%f"
        )[:-3] + "Z"
    if isinstance(value, str):
        text = value.strip()
        if _EPOCH_RE.fullmatch(text):
            return normalize_timestamp(float(text))
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return text  # already ISO-ish; pass through untouched
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    return None


# ---------------------------------------------------------------------------
# Field helpers (accept snake_case and camelCase so the bridge tolerates the
# external sensor's exact field naming)
# ---------------------------------------------------------------------------


def _get(record: dict, *names):
    """First non-None value among the candidate keys."""
    for name in names:
        if name in record and record[name] is not None:
            return record[name]
    return None


def _as_int(value):
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_bool(value, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in ("1", "true", "yes", "y", "error", "failed", "failure")


# ---------------------------------------------------------------------------
# Canonical event envelope
# ---------------------------------------------------------------------------


def build_event(
    *,
    event_id: str,
    event_type: str,
    occurred_at: str,
    observed_at: str,
    payload: dict,
    tenant: str,
    source_id: str,
    session_id=None,
    run_id=None,
    principal_id=None,
    agent_id=None,
    trace_id=None,
    span_id=None,
    extensions=None,
) -> dict:
    """Build a canonical event envelope (packages/schema/src/events.ts §envelope)."""
    subject = {"tenantId": tenant}
    if session_id is not None:
        subject["sessionId"] = str(session_id)
    if run_id is not None:
        subject["runId"] = str(run_id)
    if principal_id is not None:
        subject["principalId"] = str(principal_id)

    identity_context = {}
    if principal_id is not None:
        identity_context["principalId"] = str(principal_id)
    if agent_id is not None:
        identity_context["agentId"] = str(agent_id)
    if session_id is not None:
        identity_context["sessionId"] = str(session_id)

    trace_context = {}
    if trace_id is not None:
        trace_context["traceId"] = str(trace_id)
    if span_id is not None:
        trace_context["spanId"] = str(span_id)

    event = {
        "eventId": event_id,
        "schemaVersion": SCHEMA_VERSION,
        "eventType": event_type,
        "occurredAt": occurred_at,
        "observedAt": observed_at,
        "producer": {
            "sourceKind": SOURCE_KIND,
            "sourceId": source_id,
            "producerName": PRODUCER_NAME,
            "producerVersion": PRODUCER_VERSION,
            "adapterName": ADAPTER_NAME,
            "adapterVersion": ADAPTER_VERSION,
        },
        "subject": subject,
        "traceContext": trace_context,
        "identityContext": identity_context,
        "payload": payload,
        "provenance": [
            {"sourceId": source_id, "eventId": event_id, "observedAt": observed_at}
        ],
        "securityClassification": {
            "classification": DEFAULT_CLASSIFICATION,
            "handling": [],
        },
        "extensions": extensions if extensions is not None else {},
    }
    # sha256: content hash of the canonical serialization of the event itself
    # (integrity hash chain, SPEC.md §9).
    event["integrityHash"] = content_hash(
        {key: value for key, value in event.items() if key != "integrityHash"}
    )
    return event


# ---------------------------------------------------------------------------
# Per-family mappers
# ---------------------------------------------------------------------------

_MESSAGE_ROLES = {"user", "assistant", "system", "tool", "function", "developer"}

_TOOL_STATUSES = {"pending", "executing", "succeeded", "failed", "denied"}
_TOOL_STATUS_SYNONYMS = {
    "success": "succeeded",
    "successful": "succeeded",
    "completed": "succeeded",
    "complete": "succeeded",
    "ok": "succeeded",
    "error": "failed",
    "failure": "failed",
    "fail": "failed",
    "blocked": "denied",
    "rejected": "denied",
    "running": "executing",
    "in_progress": "executing",
    "in-progress": "executing",
    "started": "executing",
}

_OPERATIONS = {"generate", "chat", "embed", "tool_use", "other"}
_OPERATION_SYNONYMS = {
    "generation": "generate",
    "completion": "generate",
    "complete": "generate",
    "chat_completion": "chat",
    "chat-completion": "chat",
    "embedding": "embed",
    "embeddings": "embed",
    "function_call": "tool_use",
    "function-call": "tool_use",
    "tool-use": "tool_use",
}


def _normalize_tool_status(value) -> str:
    if value is None:
        return "pending"
    text = str(value).strip().lower()
    text = _TOOL_STATUS_SYNONYMS.get(text, text)
    return text if text in _TOOL_STATUSES else "pending"


def _normalize_operation(value) -> str:
    if value is None:
        return "generate"
    text = str(value).strip().lower().replace(" ", "_")
    text = _OPERATION_SYNONYMS.get(text, text)
    return text if text in _OPERATIONS else "other"


def _map_session(record: dict, *, tenant: str, observed_at: str, content_mode: str) -> list[dict]:
    session_id = str(_get(record, "id", "session_id", "sessionId") or "").strip()
    if not session_id:
        raise ValueError("session record missing 'id'")
    started_at = normalize_timestamp(
        _get(record, "started_at", "startedAt", "timestamp", "ts", "occurred_at", "occurredAt")
    ) or observed_at
    principal_id = _get(record, "principal_id", "principalId", "user_id", "userId")
    agent_id = _get(record, "agent_id", "agentId")
    title = _get(record, "title", "name")
    payload = {"sessionId": session_id, "source": SOURCE_KIND, "startedAt": started_at}
    if principal_id is not None:
        payload["principalId"] = str(principal_id)
    if agent_id is not None:
        payload["agentId"] = str(agent_id)
    if title is not None:
        payload["title"] = str(title)
    event_id = urn(tenant, f"session:{session_id}")
    return [
        build_event(
            event_id=event_id,
            event_type="session.observed",
            occurred_at=started_at,
            observed_at=observed_at,
            payload=payload,
            tenant=tenant,
            source_id=session_id,
            session_id=session_id,
            principal_id=principal_id,
            agent_id=agent_id,
        )
    ]


def _map_run(record: dict, *, tenant: str, observed_at: str, content_mode: str) -> list[dict]:
    run_id = str(_get(record, "id", "run_id", "runId") or "").strip()
    if not run_id:
        raise ValueError("run record missing 'id'")
    session_id = _get(record, "session_id", "sessionId")
    started_at = normalize_timestamp(
        _get(record, "started_at", "startedAt", "timestamp", "ts", "occurred_at", "occurredAt")
    ) or observed_at
    objective = _get(record, "objective", "goal", "task")
    parent_run_id = _get(record, "parent_run_id", "parentRunId")
    payload = {"runId": run_id, "startedAt": started_at}
    if session_id is not None:
        payload["sessionId"] = str(session_id)
    if objective is not None:
        payload["objective"] = str(objective)
    if parent_run_id is not None:
        payload["parentRunId"] = str(parent_run_id)
    event_id = urn(tenant, f"run:{run_id}")
    return [
        build_event(
            event_id=event_id,
            event_type="run.started",
            occurred_at=started_at,
            observed_at=observed_at,
            payload=payload,
            tenant=tenant,
            source_id=run_id,
            session_id=session_id,
            run_id=run_id,
        )
    ]


def _map_message(record: dict, *, tenant: str, observed_at: str, content_mode: str) -> list[dict]:
    message_id = str(_get(record, "id", "message_id", "messageId") or "").strip()
    if not message_id:
        raise ValueError("message record missing 'id'")
    session_id = _get(record, "session_id", "sessionId")
    if session_id is None:
        raise ValueError(f"message {message_id} missing 'session_id'")
    role = str(_get(record, "role") or "assistant").strip().lower()
    if role not in _MESSAGE_ROLES:
        role = "assistant"
    content = _get(record, "content", "text", "body", "message") or ""
    payload: dict = {
        "messageId": message_id,
        "sessionId": str(session_id),
        "role": role,
        "contentMode": content_mode,
        "contentHash": content_hash(content),
    }
    sequence_id = _as_int(_get(record, "sequence_id", "sequenceId", "seq"))
    if sequence_id is not None:
        payload["sequenceId"] = sequence_id
    token_count = _as_int(_get(record, "token_count", "tokenCount", "tokens"))
    if token_count is not None:
        payload["tokenCount"] = token_count
    occurred_at = normalize_timestamp(
        _get(record, "timestamp", "ts", "occurred_at", "occurredAt", "sent_at", "sentAt")
    ) or observed_at
    event_id = urn(tenant, f"message:{message_id}")
    return [
        build_event(
            event_id=event_id,
            event_type="message.observed",
            occurred_at=occurred_at,
            observed_at=observed_at,
            payload=payload,
            tenant=tenant,
            source_id=message_id,
            session_id=session_id,
        )
    ]


def _embedded_result(record: dict):
    """Extract an embedded tool result from a tool_call record, if present."""
    result = record.get("result")
    fields = {}
    if isinstance(result, dict):
        fields.update(result)
    elif result is not None:
        fields["content"] = result
    for key in (
        "output",
        "content",
        "is_error",
        "isError",
        "error",
        "exit_code",
        "exitCode",
        "duration_ms",
        "durationMs",
        "duration",
    ):
        if key in record and key not in fields:
            fields[key] = record[key]
    return fields if fields else None


def _build_tool_result_event(
    record: dict,
    *,
    call_id: str,
    session_id,
    tenant: str,
    observed_at: str,
    content_mode: str,
    occurred_at=None,
) -> dict:
    result_id = _get(record, "result_id", "resultId", "id")
    content = _get(record, "content", "output", "text", "body", "result", "stdout") or ""
    payload = {
        "callId": call_id,
        "contentMode": content_mode,
        "contentHash": content_hash(content),
        "isError": _as_bool(_get(record, "is_error", "isError", "error"), default=False),
    }
    if result_id is not None:
        payload["resultId"] = str(result_id)
    exit_code = _as_int(_get(record, "exit_code", "exitCode"))
    if exit_code is not None:
        payload["exitCode"] = exit_code
    duration_ms = _as_int(_get(record, "duration_ms", "durationMs", "duration"))
    if duration_ms is not None:
        payload["durationMs"] = duration_ms
    occurred_at = (
        occurred_at
        or normalize_timestamp(_get(record, "timestamp", "ts", "occurred_at", "occurredAt"))
        or observed_at
    )
    event_id = urn(tenant, f"tool_result:{result_id or call_id}")
    return build_event(
        event_id=event_id,
        event_type="tool_result.observed",
        occurred_at=occurred_at,
        observed_at=observed_at,
        payload=payload,
        tenant=tenant,
        source_id=str(result_id or call_id),
        session_id=session_id,
    )


def _map_tool_call(record: dict, *, tenant: str, observed_at: str, content_mode: str) -> list[dict]:
    call_id = str(
        _get(record, "id", "call_id", "callId", "tool_call_id", "toolCallId") or ""
    ).strip()
    if not call_id:
        raise ValueError("tool_call record missing 'id'")
    tool_name = str(_get(record, "tool_name", "toolName", "name", "tool") or "").strip()
    if not tool_name:
        raise ValueError(f"tool_call {call_id} missing 'tool_name'")
    session_id = _get(record, "session_id", "sessionId")
    message_id = _get(record, "message_id", "messageId")
    request_id = _get(record, "request_id", "requestId")
    arguments = _get(record, "arguments", "args", "input") or {}
    payload = {
        "callId": call_id,
        "toolName": tool_name,
        "argumentsHash": content_hash(arguments),
        "status": _normalize_tool_status(_get(record, "status")),
    }
    if request_id is not None:
        payload["requestId"] = str(request_id)
    if message_id is not None:
        payload["messageId"] = str(message_id)
    if session_id is not None:
        payload["sessionId"] = str(session_id)
    occurred_at = normalize_timestamp(
        _get(record, "timestamp", "ts", "occurred_at", "occurredAt", "started_at", "startedAt")
    ) or observed_at
    event_id = urn(tenant, f"tool_call:{call_id}")
    events = [
        build_event(
            event_id=event_id,
            event_type="tool_call.observed",
            occurred_at=occurred_at,
            observed_at=observed_at,
            payload=payload,
            tenant=tenant,
            source_id=call_id,
            session_id=session_id,
        )
    ]
    embedded = _embedded_result(record)
    if embedded is not None:
        events.append(
            _build_tool_result_event(
                embedded,
                call_id=call_id,
                session_id=session_id,
                tenant=tenant,
                observed_at=observed_at,
                content_mode=content_mode,
                occurred_at=occurred_at,
            )
        )
    return events


def _map_tool_result(record: dict, *, tenant: str, observed_at: str, content_mode: str) -> list[dict]:
    call_id = str(
        _get(record, "call_id", "callId", "tool_call_id", "toolCallId", "id") or ""
    ).strip()
    if not call_id:
        raise ValueError("tool_result record missing 'call_id'")
    session_id = _get(record, "session_id", "sessionId")
    return [
        _build_tool_result_event(
            record,
            call_id=call_id,
            session_id=session_id,
            tenant=tenant,
            observed_at=observed_at,
            content_mode=content_mode,
        )
    ]


def _map_model_invocation(
    record: dict, *, tenant: str, observed_at: str, content_mode: str
) -> list[dict]:
    invocation_id = str(
        _get(record, "id", "invocation_id", "invocationId", "call_id", "callId") or ""
    ).strip()
    if not invocation_id:
        raise ValueError("model_invocation record missing 'id'")
    model_id = _get(record, "model_id", "modelId", "model", "model_name", "modelName")
    if model_id is None:
        raise ValueError(f"model_invocation {invocation_id} missing 'model_id'")
    provider = _get(record, "provider", "vendor", "service")
    operation = _normalize_operation(_get(record, "operation", "op", "type"))
    trace_id = _get(record, "trace_id", "traceId")
    span_id = _get(record, "span_id", "spanId")
    session_id = _get(record, "session_id", "sessionId")
    run_id = _get(record, "run_id", "runId")
    started_at = normalize_timestamp(
        _get(record, "started_at", "startedAt", "timestamp", "ts")
    )
    completed_at = normalize_timestamp(
        _get(record, "completed_at", "completedAt", "finished_at", "finishedAt", "end_time", "endTime")
    )
    input_tokens = _as_int(_get(record, "input_tokens", "inputTokens", "prompt_tokens", "promptTokens"))
    output_tokens = _as_int(
        _get(record, "output_tokens", "outputTokens", "completion_tokens", "completionTokens")
    )
    finish_reason = _get(record, "finish_reason", "finishReason", "stop_reason", "stopReason")
    latency_ms = _as_int(_get(record, "latency_ms", "latencyMs", "duration_ms", "durationMs", "duration"))

    events = []

    if started_at is not None or completed_at is None:
        payload: dict = {
            "invocationId": invocation_id,
            "modelId": str(model_id),
            "operation": operation,
        }
        if provider is not None:
            payload["provider"] = str(provider)
        if trace_id is not None:
            payload["traceId"] = str(trace_id)
        if span_id is not None:
            payload["spanId"] = str(span_id)
        if input_tokens is not None:
            payload["inputTokens"] = input_tokens
        occurred_at = started_at or completed_at or observed_at
        events.append(
            build_event(
                event_id=urn(tenant, f"model_invocation:{invocation_id}:started"),
                event_type="model.invocation.started",
                occurred_at=occurred_at,
                observed_at=observed_at,
                payload=payload,
                tenant=tenant,
                source_id=invocation_id,
                session_id=session_id,
                run_id=run_id,
                trace_id=trace_id,
                span_id=span_id,
            )
        )

    if completed_at is not None:
        payload: dict = {"invocationId": invocation_id, "modelId": str(model_id)}
        if provider is not None:
            payload["provider"] = str(provider)
        if trace_id is not None:
            payload["traceId"] = str(trace_id)
        if span_id is not None:
            payload["spanId"] = str(span_id)
        if output_tokens is not None:
            payload["outputTokens"] = output_tokens
        if finish_reason is not None:
            payload["finishReason"] = str(finish_reason)
        if latency_ms is not None:
            payload["latencyMs"] = latency_ms
        events.append(
            build_event(
                event_id=urn(tenant, f"model_invocation:{invocation_id}:completed"),
                event_type="model.invocation.completed",
                occurred_at=completed_at,
                observed_at=observed_at,
                payload=payload,
                tenant=tenant,
                source_id=invocation_id,
                session_id=session_id,
                run_id=run_id,
                trace_id=trace_id,
                span_id=span_id,
            )
        )

    return events


# ---------------------------------------------------------------------------
# Record dispatch
# ---------------------------------------------------------------------------

_SESSION_TYPES = {"session", "session.started", "session.observed", "session.start"}
_RUN_TYPES = {"run", "run.started", "run.start", "run_start"}
_MESSAGE_TYPES = {
    "message",
    "message.observed",
    "message.sent",
    "message.received",
    "chat.message",
    "user.message",
    "assistant.message",
    "system.message",
}
_TOOL_CALL_TYPES = {"tool_call", "tool_call.observed", "tool_call.started", "tool.use", "tool_call.start"}
_TOOL_RESULT_TYPES = {
    "tool_result",
    "tool_result.observed",
    "tool.result",
    "tool_call.completed",
    "tool_call.finished",
    "tool_call.result",
}
_MODEL_TYPES = {
    "model_invocation",
    "model.invocation",
    "model_invocation.started",
    "model_invocation.completed",
    "model.invocation.started",
    "model.invocation.completed",
    "llm.call",
    "llm",
    "model.call",
}


def map_record(
    record,
    *,
    tenant: str = DEFAULT_TENANT,
    content_mode: str = DEFAULT_CONTENT_MODE,
    observed_at: Optional[str] = None,
) -> list[dict]:
    """Map one ADR AgentEvent dict to a list of canonical CATG event dicts.

    Raises ``ValueError`` for malformed records or unsupported record types.
    """
    if not isinstance(record, dict):
        raise ValueError(f"ADR record must be a JSON object, got {type(record).__name__}")
    rtype = str(record.get("type") or record.get("kind") or "").strip().lower()
    observed_at = observed_at or utc_now_iso()
    if rtype in _SESSION_TYPES:
        return _map_session(record, tenant=tenant, observed_at=observed_at, content_mode=content_mode)
    if rtype in _RUN_TYPES:
        return _map_run(record, tenant=tenant, observed_at=observed_at, content_mode=content_mode)
    if rtype in _MESSAGE_TYPES:
        return _map_message(record, tenant=tenant, observed_at=observed_at, content_mode=content_mode)
    if rtype in _TOOL_CALL_TYPES:
        return _map_tool_call(record, tenant=tenant, observed_at=observed_at, content_mode=content_mode)
    if rtype in _TOOL_RESULT_TYPES:
        return _map_tool_result(record, tenant=tenant, observed_at=observed_at, content_mode=content_mode)
    if rtype in _MODEL_TYPES:
        return _map_model_invocation(
            record, tenant=tenant, observed_at=observed_at, content_mode=content_mode
        )
    raise ValueError(f"unsupported ADR record type: {rtype or '<missing>'}")


def map_records(
    records,
    *,
    tenant: str = DEFAULT_TENANT,
    content_mode: str = DEFAULT_CONTENT_MODE,
    observed_at: Optional[str] = None,
):
    """Map an iterable of ADR records, yielding canonical events.

    A malformed record raises ``ValueError`` mid-iteration; callers that need
    per-record error isolation should loop over :func:`map_record` themselves.
    """
    observed_at = observed_at or utc_now_iso()
    for record in records:
        yield from map_record(
            record, tenant=tenant, content_mode=content_mode, observed_at=observed_at
        )
