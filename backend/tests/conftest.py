"""
Unit-test conftest for Universal Privacy Layer backend.

Patches the motor DB with an in-memory dict-backed fake so tests
run without any live MongoDB instance. Uses FastAPI's TestClient.
"""

import os
import sys
import time as _time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# ── Set required env vars BEFORE importing server ──────────────────────────
os.environ.setdefault("MONGO_URL", "mongodb://fake:27017")
os.environ.setdefault("DB_NAME", "upl_test_database")
os.environ.setdefault("ACCESS_CODE", "test-access-code-123")
os.environ.setdefault("PAYOUT_WALLET", "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B")

# Make backend importable
backend_dir = os.path.join(os.path.dirname(__file__), "..")
if backend_dir not in sys.path:
    sys.path.insert(0, os.path.abspath(backend_dir))


# ── Fake motor collection (dict-backed) ────────────────────────────────────

class FakeCollection:
    """In-memory stand-in for a motor AsyncIOMotorCollection."""

    def __init__(self):
        self._docs: list[dict] = []
        self._counter = 0

    async def insert_one(self, doc: dict):
        self._counter += 1
        doc = dict(doc)
        doc.setdefault("_id", self._counter)
        self._docs.append(doc)
        # Return something with inserted_id like motor does
        result = MagicMock()
        result.inserted_id = doc["_id"]
        return result

    async def find_one(self, query: dict, projection: dict | None = None):
        for doc in self._docs:
            if self._match(doc, query):
                out = dict(doc)
                if projection and "_id" in projection and projection["_id"] == 0:
                    out.pop("_id", None)
                return out
        return None

    async def find(self, query: dict = None, projection: dict | None = None):
        results = [dict(d) for d in self._docs if self._match(d, query or {})]
        # Return async iterable cursor-like object
        return _FakeCursor(results, projection)

    async def delete_one(self, query: dict):
        before = len(self._docs)
        self._docs = [d for d in self._docs if not self._match(d, query)]
        result = MagicMock()
        result.deleted_count = before - len(self._docs)
        return result

    async def create_index(self, *args, **kwargs):
        pass  # no-op for tests

    @staticmethod
    def _match(doc: dict, query: dict) -> bool:
        """Minimal MongoDB query matcher — handles $gt and equality."""
        for key, val in query.items():
            doc_val = doc.get(key)
            if isinstance(val, dict):
                for op, v in val.items():
                    if op == "$gt" and not (doc_val is not None and doc_val > v):
                        return False
                    if op == "$lt" and not (doc_val is not None and doc_val < v):
                        return False
            else:
                if doc_val != val:
                    return False
        return True


class _FakeCursor:
    """Minimal async cursor for find() results."""

    def __init__(self, docs: list[dict], projection: dict | None = None):
        self._docs = docs
        self._projection = projection

    def sort(self, *args, **kwargs):
        return self

    def limit(self, n: int):
        self._docs = self._docs[:n]
        return self

    def skip(self, n: int):
        self._docs = self._docs[n:]
        return self

    async def to_list(self, length: int | None = None):
        if length is None:
            return self._docs
        return self._docs[:length]

    def __aiter__(self):
        self._iter_idx = 0
        return self

    async def __anext__(self):
        if self._iter_idx >= len(self._docs):
            raise StopAsyncIteration
        doc = self._docs[self._iter_idx]
        self._iter_idx += 1
        return doc


class FakeDatabase:
    """Dict-backed fake for motor database — returns FakeCollection per name."""

    def __init__(self):
        self._collections: dict[str, FakeCollection] = {}

    def __getitem__(self, name: str) -> FakeCollection:
        if name not in self._collections:
            self._collections[name] = FakeCollection()
        return self._collections[name]

    def __getattr__(self, name: str) -> FakeCollection:
        return self[name]


# ── Fixtures ───────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _fake_db():
    """Patch the global `db` object in server.py with a FakeDatabase."""
    # Import server after env vars are set
    import server as server_module

    fake_db = FakeDatabase()
    with patch.object(server_module, "db", fake_db):
        # Also patch the motor client to avoid any real connections
        with patch.object(server_module, "client", MagicMock()):
            yield fake_db


@pytest.fixture()
def client(_fake_db):
    """FastAPI TestClient wired to the app with a fake DB."""
    import server as server_module

    # Clear in-memory rate-limiter and session fallback between tests
    server_module._rate_store.clear()
    server_module._sessions_fallback.clear()

    with TestClient(server_module.app) as c:
        yield c


@pytest.fixture()
def auth_token(client):
    """Authenticate with the test access code and return a valid bearer token."""
    resp = client.post(
        "/api/auth/verify-access",
        json={"code": "test-access-code-123"},
    )
    assert resp.status_code == 200, f"Auth failed in fixture: {resp.text}"
    return resp.json()["token"]
