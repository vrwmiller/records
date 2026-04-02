"""
Tests for app/db.py — engine singleton and session dependency behavior.

Exercises get_engine() caching and get_db() generator contract without
requiring a live database connection.
"""

import inspect

import app.db as db_module
from app.db import get_db


class TestGetEngine:
    def test_engine_cached_when_set(self) -> None:
        """get_engine() returns the cached engine without calling create_engine again."""
        sentinel = object()
        original = db_module._engine
        db_module._engine = sentinel
        try:
            assert db_module.get_engine() is sentinel
        finally:
            db_module._engine = original

    def test_engine_created_on_first_call(self, monkeypatch) -> None:
        """get_engine() calls create_engine exactly once when _engine is None."""
        fake_engine = object()
        call_count = []

        def fake_create(url: str, **kwargs: object) -> object:
            call_count.append(url)
            return fake_engine

        original = db_module._engine
        monkeypatch.setattr(db_module, "_engine", None)
        monkeypatch.setattr(db_module, "create_engine", fake_create)
        # settings is already constructed via conftest; patch the url attribute directly
        import app.config as cfg
        monkeypatch.setattr(cfg.settings, "database_url", "postgresql+psycopg://u:p@h/db")
        try:
            result = db_module.get_engine()
            assert result is fake_engine
            assert len(call_count) == 1

            # Second call must reuse the cache, not call create_engine again.
            result2 = db_module.get_engine()
            assert result2 is fake_engine
            assert len(call_count) == 1
        finally:
            db_module._engine = original


class TestGetDb:
    def test_get_db_is_generator_function(self) -> None:
        """get_db() must be a generator so FastAPI manages session lifecycle."""
        assert inspect.isgeneratorfunction(get_db)
