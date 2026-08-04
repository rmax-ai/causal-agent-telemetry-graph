"""Command-line entry point for the CATG ADR bridge.

Usage:
    catg-adr fetch --endpoint URL --api-key KEY [--session-id ID] [--tenant-id ID]
    catg-adr fetch --from-file FILE

Canonical events are written to stdout as JSONL (one JSON object per line).
Errors are written to stderr as JSONL error objects of the form
``{"error": "...", "record_index": N}``.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from . import __version__
from .mapper import DEFAULT_CONTENT_MODE, DEFAULT_TENANT, map_record, utc_now_iso
from .sensor import AdrSensorError, fetch_from_file, fetch_session

__all__ = ["build_parser", "main"]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="catg-adr",
        description="Invoke the ADR sensor and emit CATG canonical events as JSONL.",
    )
    parser.add_argument(
        "--version", action="version", version=f"catg-adr {__version__}"
    )
    subparsers = parser.add_subparsers(
        dest="command", required=True, metavar="COMMAND"
    )
    fetch = subparsers.add_parser(
        "fetch", help="fetch ADR telemetry and emit canonical events as JSONL"
    )
    source = fetch.add_mutually_exclusive_group(required=True)
    source.add_argument(
        "--endpoint",
        metavar="URL",
        help="ADR sensor base URL (e.g. https://adr.example.com)",
    )
    source.add_argument(
        "--from-file",
        dest="from_file",
        metavar="FILE",
        help="read ADR events from a JSON file instead of the sensor",
    )
    fetch.add_argument(
        "--api-key",
        metavar="KEY",
        help="ADR sensor API key (sent as a Bearer token)",
    )
    fetch.add_argument(
        "--session-id",
        dest="session_id",
        metavar="ID",
        help="session id to fetch from the sensor",
    )
    fetch.add_argument(
        "--tenant-id",
        dest="tenant_id",
        metavar="ID",
        default=DEFAULT_TENANT,
        help=f"CATG tenant namespace used in URNs (default: {DEFAULT_TENANT})",
    )
    fetch.add_argument(
        "--content-mode",
        dest="content_mode",
        metavar="MODE",
        choices=("raw", "redacted", "excerpt", "hash_only", "reference"),
        default=DEFAULT_CONTENT_MODE,
        help=f"content handling mode for hashed payloads (default: {DEFAULT_CONTENT_MODE})",
    )
    return parser


def emit_error(obj: dict) -> None:
    """Write one JSONL error object to stderr."""
    json.dump(obj, sys.stderr, sort_keys=True, separators=(",", ":"))
    sys.stderr.write("\n")
    sys.stderr.flush()


def emit_events(records, *, tenant: str, content_mode: str) -> int:
    """Map records to canonical events; stdout carries events, stderr errors."""
    errors = 0
    observed_at = utc_now_iso()
    for index, record in enumerate(records):
        try:
            events = map_record(
                record, tenant=tenant, content_mode=content_mode, observed_at=observed_at
            )
        except Exception as exc:  # per-record mapping failure -> stderr, keep going
            errors += 1
            emit_error({"error": str(exc), "record_index": index})
            continue
        for event in events:
            json.dump(event, sys.stdout, sort_keys=True, separators=(",", ":"))
            sys.stdout.write("\n")
            sys.stdout.flush()
    return 1 if errors else 0


def run_fetch(args) -> int:
    if args.from_file:
        records = fetch_from_file(args.from_file)
    else:
        if not args.api_key:
            raise AdrSensorError("--api-key is required when fetching from an endpoint")
        if not args.session_id:
            raise AdrSensorError("--session-id is required when fetching from an endpoint")
        records = fetch_session(args.endpoint, args.api_key, args.session_id)
    return emit_events(records, tenant=args.tenant_id, content_mode=args.content_mode)


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "fetch":
            return run_fetch(args)
        parser.error(f"unknown command: {args.command}")  # pragma: no cover
        return 2
    except AdrSensorError as exc:
        emit_error({"error": str(exc)})
        return 1
    except KeyboardInterrupt:
        emit_error({"error": "interrupted"})
        return 130
    except BrokenPipeError:
        # Downstream consumer (head/jq/TS pipeline) closed stdout early.
        # Redirect stdout to devnull so the interpreter's final flush is quiet.
        try:
            devnull = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull, sys.stdout.fileno())
        except OSError:
            pass
        return 1


if __name__ == "__main__":
    sys.exit(main())
