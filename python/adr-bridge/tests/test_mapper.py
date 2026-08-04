"""Tests for the CATG ADR bridge (stdlib unittest — no pytest dependency).

Run from ``python/adr-bridge`` with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stderr, redirect_stdout
from http.server import BaseHTTPRequestHandler, HTTPServer

# Make ``import adr_bridge`` work regardless of how the tests are launched.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from adr_bridge import __version__  # noqa: E402
from adr_bridge.cli import main  # noqa: E402
from adr_bridge.mapper import (  # noqa: E402
    canonicalize,
    content_hash,
    map_record,
    normalize_timestamp,
    urn,
)
from adr_bridge.sensor import AdrSensorError, fetch_from_file, fetch_session  # noqa: E402

FIXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
SAMPLE_FIXTURE = os.path.join(FIXTURE_DIR, "sample_session.json")
WRAPPED_FIXTURE = os.path.join(FIXTURE_DIR, "wrapped.json")

OBSERVED_AT = "2026-08-04T10:00:00.000Z"


class CanonicalizeTests(unittest.TestCase):
    def test_sorted_keys_compact(self):
        self.assertEqual(
            canonicalize({"b": 1, "a": [2, 1], "c": None}), '{"a":[2,1],"b":1,"c":null}'
        )

    def test_string_escaping(self):
        self.assertEqual(canonicalize('a"b\\c\nd'), '"a\\"b\\\\c\\nd"')

    def test_control_chars_escaped(self):
        self.assertEqual(canonicalize("\x01"), '"\\u0001"')

    def test_float_forms(self):
        self.assertEqual(canonicalize(1.5), "1.5")
        self.assertEqual(canonicalize(-0.0), "-0")
        self.assertEqual(canonicalize(1e21), "1e21")
        self.assertEqual(canonicalize(float("nan")), "null")

    def test_non_json_type_raises(self):
        with self.assertRaises(TypeError):
            canonicalize(object())


class HashAndIdTests(unittest.TestCase):
    def test_content_hash_sha256_prefix(self):
        digest = content_hash("hello")
        self.assertTrue(digest.startswith("sha256:"))
        self.assertEqual(len(digest), len("sha256:") + 64)
        self.assertEqual(digest, "sha256:" + hashlib.sha256(b"hello").hexdigest())

    def test_content_hash_structure(self):
        digest = content_hash({"b": 2, "a": 1})
        self.assertEqual(digest, content_hash({"a": 1, "b": 2}))  # key-order agnostic

    def test_urn_format(self):
        self.assertEqual(urn("acme", "msg:1"), "urn:catg:acme:adr:msg:1")
        self.assertEqual(urn("acme", "session:sess-1"), "urn:catg:acme:adr:session:sess-1")

    def test_version(self):
        self.assertEqual(__version__, "0.1.0")

    def test_normalize_timestamp(self):
        from datetime import datetime, timezone

        epoch_ms = int(datetime(2026, 8, 4, 9, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)
        epoch_s = epoch_ms // 1000
        self.assertEqual(
            normalize_timestamp("2026-08-04T09:00:00Z"), "2026-08-04T09:00:00.000Z"
        )
        self.assertEqual(normalize_timestamp(epoch_ms), "2026-08-04T09:00:00.000Z")
        self.assertEqual(normalize_timestamp(epoch_s), "2026-08-04T09:00:00.000Z")
        self.assertIsNone(normalize_timestamp(None))


class EnvelopeTests(unittest.TestCase):
    def test_event_envelope_shape(self):
        events = map_record(
            {"type": "session", "id": "sess-1", "started_at": "2026-08-04T09:00:00Z"},
            tenant="acme",
            observed_at=OBSERVED_AT,
        )
        ev = events[0]
        self.assertEqual(ev["schemaVersion"], "1.0.0")
        self.assertEqual(ev["occurredAt"], "2026-08-04T09:00:00.000Z")
        self.assertEqual(ev["observedAt"], OBSERVED_AT)
        self.assertEqual(
            ev["producer"]["sourceKind"], "adr"
        )  # AGENTS.md SourceKindSchema
        self.assertEqual(ev["producer"]["adapterName"], "adr-bridge")
        self.assertEqual(ev["subject"]["tenantId"], "acme")
        self.assertRegex(ev["integrityHash"], r"^sha256:[a-f0-9]{64}$")
        # integrity hash must be a hash of the event's canonical serialization
        stripped = {k: v for k, v in ev.items() if k != "integrityHash"}
        self.assertEqual(ev["integrityHash"], content_hash(stripped))


class MapperTests(unittest.TestCase):
    def test_session(self):
        events = map_record(
            {
                "type": "session",
                "id": "sess-1",
                "started_at": "2026-08-04T09:00:00Z",
                "principal_id": "alice",
                "agent_id": "agent-x",
                "title": "Probe",
            },
            tenant="acme",
            observed_at=OBSERVED_AT,
        )
        self.assertEqual(len(events), 1)
        ev = events[0]
        self.assertEqual(ev["eventType"], "session.observed")
        self.assertEqual(ev["eventId"], "urn:catg:acme:adr:session:sess-1")
        self.assertEqual(ev["payload"]["source"], "adr")
        self.assertEqual(ev["payload"]["startedAt"], "2026-08-04T09:00:00.000Z")
        self.assertEqual(ev["payload"]["principalId"], "alice")
        self.assertEqual(ev["payload"]["agentId"], "agent-x")
        self.assertEqual(ev["payload"]["title"], "Probe")
        self.assertEqual(ev["subject"]["principalId"], "alice")
        self.assertEqual(ev["identityContext"]["agentId"], "agent-x")

    def test_run(self):
        events = map_record(
            {
                "type": "run.started",
                "id": "run-1",
                "session_id": "sess-1",
                "objective": "Trace leak",
                "parent_run_id": "run-0",
                "started_at": "2026-08-04T09:00:01Z",
            },
            tenant="acme",
            observed_at=OBSERVED_AT,
        )
        ev = events[0]
        self.assertEqual(ev["eventType"], "run.started")
        self.assertEqual(ev["payload"]["runId"], "run-1")
        self.assertEqual(ev["payload"]["sessionId"], "sess-1")
        self.assertEqual(ev["payload"]["objective"], "Trace leak")
        self.assertEqual(ev["payload"]["parentRunId"], "run-0")
        self.assertEqual(ev["subject"]["runId"], "run-1")

    def test_message(self):
        events = map_record(
            {
                "type": "message",
                "id": "m1",
                "session_id": "s1",
                "role": "user",
                "content": "hi",
                "sequence_id": 3,
                "token_count": 5,
                "timestamp": "2026-08-04T09:00:00Z",
            },
            tenant="acme",
            observed_at=OBSERVED_AT,
        )
        ev = events[0]
        self.assertEqual(ev["eventType"], "message.observed")
        self.assertEqual(ev["payload"]["messageId"], "m1")
        self.assertEqual(ev["payload"]["sessionId"], "s1")
        self.assertEqual(ev["payload"]["role"], "user")
        self.assertEqual(ev["payload"]["contentMode"], "hash_only")
        self.assertEqual(ev["payload"]["contentHash"], content_hash("hi"))
        self.assertEqual(ev["payload"]["sequenceId"], 3)
        self.assertEqual(ev["payload"]["tokenCount"], 5)

    def test_message_default_role_and_content(self):
        ev = map_record(
            {"type": "message", "id": "m2", "session_id": "s1", "timestamp": "2026-08-04T09:00:00Z"},
            tenant="acme",
            observed_at=OBSERVED_AT,
        )[0]
        self.assertEqual(ev["payload"]["role"], "assistant")
        self.assertEqual(ev["payload"]["contentHash"], content_hash(""))

    def test_tool_call_with_embedded_result(self):
        events = map_record(
            {
                "type": "tool_call",
                "id": "c1",
                "tool_name": "grep",
                "arguments": {"p": "x"},
                "status": "success",
                "session_id": "s1",
                "message_id": "m2",
                "output": "found",
                "is_error": False,
                "duration_ms": 5,
                "timestamp": "2026-08-04T09:00:00Z",
            },
            tenant="acme",
            observed_at=OBSERVED_AT,
        )
        self.assertEqual(
            [e["eventType"] for e in events], ["tool_call.observed", "tool_result.observed"]
        )
        call_ev, result_ev = events
        self.assertEqual(call_ev["payload"]["callId"], "c1")
        self.assertEqual(call_ev["payload"]["toolName"], "grep")
        self.assertEqual(call_ev["payload"]["argumentsHash"], content_hash({"p": "x"}))
        self.assertEqual(call_ev["payload"]["status"], "succeeded")  # synonym normalized
        self.assertEqual(call_ev["payload"]["messageId"], "m2")
        self.assertEqual(result_ev["payload"]["callId"], "c1")
        self.assertEqual(result_ev["payload"]["contentHash"], content_hash("found"))
        self.assertFalse(result_ev["payload"]["isError"])
        self.assertEqual(result_ev["payload"]["durationMs"], 5)
        # same session context on both events
        self.assertEqual(result_ev["subject"]["sessionId"], "s1")

    def test_tool_call_embedded_result_dict(self):
        events = map_record(
            {
                "type": "tool_call",
                "id": "c2",
                "tool_name": "ls",
                "status": "failed",
                "result": {"output": "permission denied", "is_error": True, "exit_code": 1},
                "timestamp": "2026-08-04T09:00:00Z",
            },
            tenant="acme",
            observed_at=OBSERVED_AT,
        )
        self.assertEqual(
            [e["eventType"] for e in events], ["tool_call.observed", "tool_result.observed"]
        )
        self.assertEqual(events[0]["payload"]["status"], "failed")
        self.assertTrue(events[1]["payload"]["isError"])
        self.assertEqual(events[1]["payload"]["exitCode"], 1)
        self.assertEqual(events[1]["payload"]["contentHash"], content_hash("permission denied"))

    def test_tool_result_standalone(self):
        ev = map_record(
            {
                "type": "tool_result",
                "id": "res-1",
                "call_id": "call-2",
                "content": "found 3 matches",
                "is_error": False,
                "exit_code": 0,
                "duration_ms": 8,
                "timestamp": "2026-08-04T09:00:04Z",
            },
            tenant="acme",
            observed_at=OBSERVED_AT,
        )[0]
        self.assertEqual(ev["eventType"], "tool_result.observed")
        self.assertEqual(ev["payload"]["resultId"], "res-1")
        self.assertEqual(ev["payload"]["callId"], "call-2")
        self.assertEqual(ev["payload"]["contentHash"], content_hash("found 3 matches"))
        self.assertEqual(ev["payload"]["exitCode"], 0)
        self.assertEqual(ev["payload"]["durationMs"], 8)

    def test_model_invocation_both_phases(self):
        events = map_record(
            {
                "type": "model_invocation",
                "id": "inv1",
                "model_id": "claude-sonnet-4",
                "provider": "anthropic",
                "operation": "chat",
                "input_tokens": 10,
                "output_tokens": 20,
                "finish_reason": "end_turn",
                "latency_ms": 100,
                "started_at": "2026-08-04T09:00:05Z",
                "completed_at": "2026-08-04T09:00:07Z",
            },
            tenant="acme",
            observed_at=OBSERVED_AT,
        )
        self.assertEqual(
            [e["eventType"] for e in events],
            ["model.invocation.started", "model.invocation.completed"],
        )
        started, completed = events
        self.assertEqual(started["payload"]["invocationId"], "inv1")
        self.assertEqual(started["payload"]["modelId"], "claude-sonnet-4")
        self.assertEqual(started["payload"]["operation"], "chat")
        self.assertEqual(started["payload"]["inputTokens"], 10)
        self.assertEqual(started["occurredAt"], "2026-08-04T09:00:05.000Z")
        self.assertEqual(completed["payload"]["outputTokens"], 20)
        self.assertEqual(completed["payload"]["finishReason"], "end_turn")
        self.assertEqual(completed["payload"]["latencyMs"], 100)
        self.assertEqual(completed["occurredAt"], "2026-08-04T09:00:07.000Z")
        # distinct event ids per phase
        self.assertNotEqual(started["eventId"], completed["eventId"])

    def test_model_invocation_start_only(self):
        events = map_record(
            {
                "type": "model_invocation",
                "id": "inv2",
                "model_id": "gpt-5",
                "operation": "generate",
                "input_tokens": 4,
                "started_at": "2026-08-04T09:00:05Z",
            },
            tenant="acme",
            observed_at=OBSERVED_AT,
        )
        self.assertEqual([e["eventType"] for e in events], ["model.invocation.started"])
        self.assertEqual(events[0]["payload"]["operation"], "generate")
        self.assertNotIn("outputTokens", events[0]["payload"])

    def test_camel_case_fields_accepted(self):
        ev = map_record(
            {
                "type": "message",
                "id": "m9",
                "sessionId": "s9",
                "role": "system",
                "content": "sys",
                "sequenceId": 7,
                "timestamp": "2026-08-04T09:00:00Z",
            },
            tenant="acme",
            observed_at=OBSERVED_AT,
        )[0]
        self.assertEqual(ev["payload"]["sessionId"], "s9")
        self.assertEqual(ev["payload"]["sequenceId"], 7)

    def test_unsupported_type_raises(self):
        with self.assertRaises(ValueError):
            map_record({"type": "mystery", "id": "x"}, tenant="acme")

    def test_non_dict_record_raises(self):
        with self.assertRaises(ValueError):
            map_record(["not", "a", "record"], tenant="acme")

    def test_session_missing_id_raises(self):
        with self.assertRaises(ValueError):
            map_record({"type": "session", "started_at": "2026-08-04T09:00:00Z"}, tenant="acme")


class SensorFileTests(unittest.TestCase):
    def test_fetch_from_file_wrapped(self):
        events = fetch_from_file(SAMPLE_FIXTURE)
        self.assertEqual(len(events), 6)
        self.assertTrue(all(isinstance(e, dict) for e in events))

    def test_fetch_from_file_plain_list(self):
        with tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False
        ) as handle:
            json.dump([{"type": "message", "id": "m", "session_id": "s"}], handle)
            path = handle.name
        try:
            events = fetch_from_file(path)
            self.assertEqual(len(events), 1)
        finally:
            os.unlink(path)

    def test_fetch_from_file_missing(self):
        with self.assertRaises(AdrSensorError):
            fetch_from_file("/nonexistent/adr-events.json")

    def test_fetch_from_file_bad_payload(self):
        with tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False
        ) as handle:
            handle.write('{"not": "events"}')
            path = handle.name
        try:
            with self.assertRaises(AdrSensorError):
                fetch_from_file(path)
        finally:
            os.unlink(path)


class _SensorHandler(BaseHTTPRequestHandler):
    """Tiny mock ADR sensor. Records (path, auth) tuples in ``seen``."""

    seen = []

    def do_GET(self):  # noqa: N802 (http.server API)
        type(self).seen.append((self.path, self.headers.get("Authorization")))
        if self.path == "/sessions/fails/events":
            self._reply(500, b"boom")
        elif self.path == "/sessions/flaky/events":
            attempts = sum(1 for p, _ in type(self).seen if p == self.path)
            if attempts < 3:  # first two attempts fail with 5xx
                self._reply(503, b"not ready")
            else:
                self._reply(
                    200,
                    json.dumps(
                        {"events": [{"type": "session", "id": "s1", "started_at": "2026-08-04T09:00:00Z"}]}
                    ).encode(),
                )
        elif self.path == "/sessions/s1/events":
            self._reply(
                200,
                json.dumps(
                    {"events": [{"type": "session", "id": "s1", "started_at": "2026-08-04T09:00:00Z"}]}
                ).encode(),
            )
        else:
            self._reply(404, b"not found")

    def _reply(self, code: int, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):  # noqa: A002 — silence request logging
        pass


class SensorHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), _SensorHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        _SensorHandler.seen = []

    @property
    def endpoint(self):
        return f"http://127.0.0.1:{self.port}"

    def test_fetch_session_success(self):
        events = fetch_session(self.endpoint, "secret-key", "s1", retries=0)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["id"], "s1")
        path, auth = _SensorHandler.seen[0]
        self.assertEqual(path, "/sessions/s1/events")
        self.assertEqual(auth, "Bearer secret-key")

    def test_fetch_session_retries_on_5xx(self):
        events = fetch_session(self.endpoint, "k", "flaky", retries=2, retry_delay=0.01)
        self.assertEqual(len(events), 1)
        self.assertGreaterEqual(len(_SensorHandler.seen), 3)  # 2 failures + success

    def test_fetch_session_retries_exhausted(self):
        with self.assertRaises(AdrSensorError):
            fetch_session(self.endpoint, "k", "fails", retries=2, retry_delay=0.01)
        self.assertEqual(len(_SensorHandler.seen), 3)

    def test_fetch_session_http_error(self):
        with self.assertRaises(AdrSensorError):
            fetch_session(self.endpoint, "k", "missing", retries=0)

    def test_fetch_session_connection_refused(self):
        with self.assertRaises(AdrSensorError):
            fetch_session("http://127.0.0.1:1", "k", "s1", retries=0)


class CliTests(unittest.TestCase):
    def test_fetch_from_file_emits_jsonl(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            rc = main(["fetch", "--from-file", SAMPLE_FIXTURE, "--tenant-id", "acme"])
        self.assertEqual(rc, 0)
        lines = [line for line in out.getvalue().splitlines() if line.strip()]
        events = [json.loads(line) for line in lines]
        # session, run, message, tool_call + embedded result, tool_result, model x2
        self.assertEqual(
            [e["eventType"] for e in events],
            [
                "session.observed",
                "run.started",
                "message.observed",
                "tool_call.observed",
                "tool_result.observed",
                "tool_result.observed",
                "model.invocation.started",
                "model.invocation.completed",
            ],
        )
        self.assertEqual(events[0]["subject"]["tenantId"], "acme")
        self.assertEqual(err.getvalue(), "")

    def test_bad_records_go_to_stderr_stdout_keeps_valid(self):
        with tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False
        ) as handle:
            json.dump(
                [
                    {"type": "message", "id": "ok", "session_id": "s", "timestamp": "2026-08-04T09:00:00Z"},
                    "not-a-dict",
                    {"type": "unknown", "id": "x"},
                    {"type": "message", "id": "m2", "session_id": "s", "timestamp": "2026-08-04T09:00:00Z"},
                ],
                handle,
            )
            path = handle.name
        try:
            out, err = io.StringIO(), io.StringIO()
            with redirect_stdout(out), redirect_stderr(err):
                rc = main(["fetch", "--from-file", path])
        finally:
            os.unlink(path)
        self.assertEqual(rc, 1)
        stdout_events = [json.loads(l) for l in out.getvalue().splitlines()]
        self.assertEqual(len(stdout_events), 2)
        err_objs = [json.loads(l) for l in err.getvalue().splitlines()]
        self.assertEqual(len(err_objs), 2)
        self.assertEqual(err_objs[0]["record_index"], 1)
        self.assertEqual(err_objs[1]["record_index"], 2)

    def test_endpoint_requires_session_id(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            rc = main(["fetch", "--endpoint", "http://x", "--api-key", "k"])
        self.assertEqual(rc, 1)
        self.assertIn("session-id", err.getvalue())
        self.assertEqual(out.getvalue(), "")

    def test_endpoint_requires_api_key(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            rc = main(["fetch", "--endpoint", "http://x", "--session-id", "s1"])
        self.assertEqual(rc, 1)
        self.assertIn("api-key", err.getvalue())

    def test_no_source_errors(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            with self.assertRaises(SystemExit):
                main(["fetch", "--api-key", "k"])
        self.assertIn("required", err.getvalue())
        self.assertIn("--from-file", err.getvalue())


if __name__ == "__main__":
    unittest.main()
