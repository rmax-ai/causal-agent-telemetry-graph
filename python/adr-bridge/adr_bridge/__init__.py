"""CATG ADR Bridge — Python subprocess invoking the ADR sensor, emitting JSONL.

The TypeScript ingestion pipeline invokes this bridge as a subprocess and
consumes canonical CATG events from stdout:

    catg-adr fetch --endpoint URL --api-key KEY [--session-id ID] [--tenant-id ID]
    catg-adr fetch --from-file FILE

Contract:
    * stdout carries exactly one canonical event (JSON object) per line
    * stderr carries JSONL error objects: {"error": "...", "record_index": N}
    * exit code 0 on success, 1 when any request or record failed

Pure Python 3.12 standard library — no third-party dependencies.
"""

__version__ = "0.1.0"
