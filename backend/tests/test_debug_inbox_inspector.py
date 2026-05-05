from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base
from app.models import User
from app.routers.debug_gmail import (
    InboxInspectorRequest,
    _build_inbox_inspector_query,
    inbox_inspector,
)
from app.services.gmail_service import GmailService


def _make_db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
    return SessionLocal()


def test_build_inbox_inspector_query_has_inbox_no_category_negation() -> None:
    q = _build_inbox_inspector_query("2026-03-01T12:00:00Z", "2026-04-01")
    assert "in:inbox" in q
    assert "after:2026-03-01" in q
    assert "before:2026-04-01" in q
    assert "-category:" not in q


def test_inbox_inspector_lists_and_fetches_full_messages(monkeypatch) -> None:
    db = _make_db()
    user = User(
        google_id="gid-1",
        email="user@example.com",
        access_token="token",
        refresh_token="refresh",
        token_expiry=datetime.now(timezone.utc),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    seen_list_calls: list[tuple[str, int, str | None]] = []
    seen_get_ids: list[str] = []

    def fake_list_messages(self, user_arg, query="", max_results=100, page_token=None):  # type: ignore[no-untyped-def]
        seen_list_calls.append((query, max_results, page_token))
        if page_token:
            return {"messages": []}
        return {
            "messages": [{"id": "m-1"}, {"id": "m-2"}],
            "nextPageToken": None,
        }

    def fake_get_message(self, user_arg, msg_id, fmt="full"):  # type: ignore[no-untyped-def]
        seen_get_ids.append(msg_id)
        return {"id": msg_id, "labelIds": ["INBOX"], "format": fmt}

    def fake_list_labels(self, user_arg):  # type: ignore[no-untyped-def]
        return [
            {"id": "INBOX", "name": "INBOX"},
            {"id": "CATEGORY_PROMOTIONS", "name": "CATEGORY_PROMOTIONS"},
        ]

    monkeypatch.setattr(GmailService, "list_messages", fake_list_messages)
    monkeypatch.setattr(GmailService, "get_message", fake_get_message)
    monkeypatch.setattr(GmailService, "list_labels", fake_list_labels)

    body = InboxInspectorRequest(
        date_from="2026-01-10",
        date_to="2026-02-10",
        max_messages=2,
    )
    out = inbox_inspector(body=body, db=db, user=user)

    assert seen_list_calls, "expected list_messages"
    first_q = seen_list_calls[0][0]
    assert "in:inbox" in first_q
    assert "-category:" not in first_q
    assert seen_get_ids == ["m-1", "m-2"]
    assert out["fetched_count"] == 2
    assert out["gmail_query"] == first_q
    assert out["label_map"]["INBOX"] == "INBOX"
    assert len(out["messages"]) == 2
    assert out["messages"][0]["id"] == "m-1"


def test_inbox_inspector_paginates_until_max_messages(monkeypatch) -> None:
    db = _make_db()
    user = User(
        google_id="gid-2",
        email="user2@example.com",
        access_token="token",
        refresh_token="refresh",
        token_expiry=datetime.now(timezone.utc),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    def fake_list_messages(self, user_arg, query="", max_results=100, page_token=None):  # type: ignore[no-untyped-def]
        if page_token is None:
            return {
                "messages": [{"id": "a"}, {"id": "b"}, {"id": "c"}],
                "nextPageToken": "next-1",
            }
        return {
            "messages": [{"id": "d"}, {"id": "e"}],
            "nextPageToken": None,
        }

    def fake_get_message(self, user_arg, msg_id, fmt="full"):  # type: ignore[no-untyped-def]
        return {"id": msg_id, "labelIds": []}

    def fake_list_labels(self, user_arg):  # type: ignore[no-untyped-def]
        return []

    monkeypatch.setattr(GmailService, "list_messages", fake_list_messages)
    monkeypatch.setattr(GmailService, "get_message", fake_get_message)
    monkeypatch.setattr(GmailService, "list_labels", fake_list_labels)

    out = inbox_inspector(
        body=InboxInspectorRequest(
            date_from="2026-05-01",
            date_to="2026-05-10",
            max_messages=5,
        ),
        db=db,
        user=user,
    )

    assert out["fetched_count"] == 5
    assert [m["id"] for m in out["messages"]] == ["a", "b", "c", "d", "e"]
