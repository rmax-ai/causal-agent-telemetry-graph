"""Minimal ADR sensor HTTP client (stdlib only).

``fetch_session`` calls ``GET {endpoint}/sessions/{session_id}/events`` with a
Bearer token and returns the parsed list of ADR AgentEvent dicts. The sensor is
expected to respond with either a JSON array of events or an object of the
form ``{"events": [...]}``.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

from . import __version__

__all__ = ["AdrSensorError", "fetch_session", "fetch_from_file", "DEFAULT_TIMEOUT", "MAX_RETRIES"]

DEFAULT_TIMEOUT = 30
MAX_RETRIES = 2  # retries on 5xx responses


class AdrSensorError(Exception):
    """Raised when the ADR sensor cannot be reached or returns bad data."""


def fetch_session(
    endpoint: str,
    api_key: str,
    session_id,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    retries: int = MAX_RETRIES,
    retry_delay: float = 0.5,
) -> list[dict]:
    """Fetch ADR AgentEvent dicts for a session from the sensor endpoint."""
    base = endpoint.rstrip("/")
    url = f"{base}/sessions/{urllib.parse.quote(str(session_id), safe='')}/events"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "User-Agent": f"catg-adr-bridge/{__version__}",
    }
    request = urllib.request.Request(url, headers=headers, method="GET")
    last_error: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
            return _parse_events(body, source=url)
        except urllib.error.HTTPError as exc:
            last_error = exc
            if 500 <= exc.code and attempt < retries:
                time.sleep(retry_delay * (2**attempt))
                continue
            raise AdrSensorError(
                f"ADR sensor HTTP {exc.code} for {url}: {exc.reason}"
            ) from exc
        except urllib.error.URLError as exc:
            reason = exc.reason
            if isinstance(reason, TimeoutError):
                raise AdrSensorError(
                    f"ADR sensor timed out after {timeout}s for {url}"
                ) from exc
            raise AdrSensorError(f"ADR sensor request failed for {url}: {reason}") from exc
    raise AdrSensorError(f"ADR sensor request failed for {url}: {last_error}") from last_error


def fetch_from_file(filepath: str) -> list[dict]:
    """Read ADR AgentEvent dicts from a JSON file.

    The file must contain a JSON array of events or an object of the form
    ``{"events": [...]}``.
    """
    try:
        with open(filepath, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError as exc:
        raise AdrSensorError(f"file not found: {filepath}") from exc
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise AdrSensorError(f"failed to read {filepath}: {exc}") from exc
    events = _extract_events(data)
    if events is None:
        raise AdrSensorError(
            f"unexpected payload in {filepath}: expected a JSON array or an "
            'object with an "events" array'
        )
    return events


def _parse_events(body: bytes, source: str) -> list[dict]:
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise AdrSensorError(f"invalid JSON from {source}: {exc}") from exc
    events = _extract_events(data)
    if events is None:
        raise AdrSensorError(
            f"unexpected payload from {source}: expected a JSON array or an "
            'object with an "events" array'
        )
    return events


def _extract_events(data: Any) -> Optional[list]:
    """Return the event list from a payload (array or ``{"events": [...]}``).

    Element-level validation is deliberately left to the mapper so that a
    single malformed record can be reported per-record (with its
    ``record_index``) instead of aborting the whole batch.
    """
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("events"), list):
        return data["events"]
    return None
