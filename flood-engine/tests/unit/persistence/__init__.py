"""Unit tests for flood_engine.persistence, one test module per persistence module.

No PostgreSQL dependency in this package -- pure Python, filesystem
(``tmp_path``), and error-class/pure-function tests only. Real,
DB-backed behavior (claiming, concurrency, transactions, rollback,
worker end-to-end) is covered separately in
``tests/integration/test_postgres_job_repository.py``, matching this
project's existing convention of keeping I/O-dependent tests out of
``tests/unit/``.
"""
