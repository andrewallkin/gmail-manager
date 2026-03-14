from datetime import datetime, timezone

import httpx
from fastapi import Response
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base
from app.models import Rule, SystemLabelRetention, User
from app.routers.auth import disconnect_google
from app.routers import rules as rules_router
from app.services.google_service import GoogleService
from app.services import poller


def _make_db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
    return SessionLocal()


def test_disconnect_disables_polling_and_clears_history() -> None:
    db = _make_db()
    user = User(
        google_id="gid-1",
        email="andrewallkin@gmail.com",
        access_token="token",
        refresh_token="refresh",
        token_expiry=datetime.now(timezone.utc),
        polling_enabled=True,
        last_history_id="5023525",
        polling_interval_minutes=5,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    disconnect_google(response=Response(), db=db, user=user)
    db.refresh(user)

    assert user.google_id is None
    assert user.access_token is None
    assert user.refresh_token is None
    assert user.token_expiry is None
    assert user.polling_enabled is False
    assert user.last_history_id is None


def test_exchange_code_reuses_existing_user_by_email(monkeypatch) -> None:
    db = _make_db()
    existing_user = User(
        google_id=None,
        email="andrewallkin@gmail.com",
        polling_enabled=True,
        polling_interval_minutes=5,
    )
    db.add(existing_user)
    db.commit()
    db.refresh(existing_user)

    class _Settings:
        google_allowed_email = "andrewallkin@gmail.com"
        public_base_url = "http://localhost:8003"
        google_client_id = "cid"
        google_client_secret = "csecret"
        google_scopes = "openid email profile"

    token_response = {
        "access_token": "new-access-token",
        "refresh_token": "new-refresh-token",
        "expires_in": 3600,
    }
    userinfo_response = {
        "id": "google-user-id",
        "email": "andrewallkin@gmail.com",
        "name": "Andrew Allkin",
        "picture": "https://example.com/avatar.png",
    }

    def _fake_post(*args, **kwargs):  # type: ignore[no-untyped-def]
        return httpx.Response(
            200,
            request=httpx.Request("POST", "https://oauth2.googleapis.com/token"),
            json=token_response,
        )

    def _fake_get(*args, **kwargs):  # type: ignore[no-untyped-def]
        return httpx.Response(
            200,
            request=httpx.Request("GET", "https://www.googleapis.com/oauth2/v2/userinfo"),
            json=userinfo_response,
        )

    monkeypatch.setattr("app.services.google_service.get_settings", lambda: _Settings())
    monkeypatch.setattr("app.services.google_service.httpx.post", _fake_post)
    monkeypatch.setattr("app.services.google_service.httpx.get", _fake_get)

    service = GoogleService()
    returned_user = service.exchange_code_for_token(db, "fake-code")

    users = db.scalars(select(User)).all()
    assert len(users) == 1
    assert returned_user.id == existing_user.id
    assert returned_user.google_id == "google-user-id"
    assert returned_user.access_token == "new-access-token"
    assert returned_user.refresh_token == "new-refresh-token"


def test_poller_disables_polling_on_gmail_401(monkeypatch) -> None:
    db = _make_db()
    user = User(
        google_id="gid-1",
        email="andrewallkin@gmail.com",
        access_token="token",
        refresh_token="refresh",
        polling_enabled=True,
        polling_interval_minutes=1,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    request = httpx.Request("GET", "https://gmail.googleapis.com/gmail/v1/users/me/history")
    response = httpx.Response(401, request=request)
    auth_error = httpx.HTTPStatusError("401 Unauthorized", request=request, response=response)

    def _fake_session_local() -> Session:
        return db

    def _raise_401(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise auth_error

    monkeypatch.setattr(poller, "SessionLocal", _fake_session_local)
    monkeypatch.setattr(poller, "_poll_user", _raise_401)
    poller._last_poll_per_user.clear()

    user_id = user.id
    poller._run_poll_cycle()
    refreshed_user = db.scalar(select(User).where(User.id == user_id).limit(1))

    assert refreshed_user is not None
    assert refreshed_user.polling_enabled is False
    assert user_id not in poller._last_poll_per_user


def test_poller_skips_disconnected_user_rows(monkeypatch) -> None:
    db = _make_db()
    disconnected = User(
        google_id=None,
        email="andrewallkin@gmail.com",
        access_token=None,
        refresh_token=None,
        polling_enabled=True,
        polling_interval_minutes=1,
    )
    connected = User(
        google_id="gid-2",
        email="connected@example.com",
        access_token="token",
        refresh_token="refresh",
        polling_enabled=True,
        polling_interval_minutes=1,
    )
    db.add_all([disconnected, connected])
    db.commit()
    db.refresh(disconnected)
    db.refresh(connected)

    called_user_ids: list[int] = []

    def _fake_session_local() -> Session:
        return db

    def _capture_user(polled_user: User, *args, **kwargs):  # type: ignore[no-untyped-def]
        called_user_ids.append(polled_user.id)

    monkeypatch.setattr(poller, "SessionLocal", _fake_session_local)
    monkeypatch.setattr(poller, "_poll_user", _capture_user)
    poller._last_poll_per_user.clear()

    poller._run_poll_cycle()

    assert called_user_ids == [connected.id]


def test_poller_history_paginates_before_cursor_update(monkeypatch) -> None:
    db = _make_db()
    user = User(
        google_id="gid-1",
        email="andrewallkin@gmail.com",
        access_token="token",
        refresh_token="refresh",
        polling_enabled=True,
        polling_interval_minutes=1,
        last_history_id="100",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    history_calls: list[str | None] = []
    fetched_messages: list[str] = []

    class _FakeGmailService:
        def __init__(self, _db: Session) -> None:
            pass

        def history_list(
            self,
            _user: User,
            start_history_id: str,
            page_token: str | None = None,
            max_results: int | None = None,
        ) -> dict:
            assert start_history_id == "100"
            assert max_results is None
            history_calls.append(page_token)
            if page_token is None:
                return {
                    "historyId": "200",
                    "history": [{"messagesAdded": [{"message": {"id": "m-1"}}]}],
                    "nextPageToken": "page-2",
                }
            assert page_token == "page-2"
            return {
                "historyId": "201",
                "history": [{"messagesAdded": [{"message": {"id": "m-2"}}]}],
            }

        def get_message(self, _user: User, msg_id: str, fmt: str = "full") -> dict:
            assert fmt == "full"
            fetched_messages.append(msg_id)
            return {}

    monkeypatch.setattr(poller, "GmailService", _FakeGmailService)
    poller._poll_user(user, db)
    db.refresh(user)

    assert history_calls == [None, "page-2"]
    assert set(fetched_messages) == {"m-1", "m-2"}
    assert user.last_history_id == "201"


def test_run_rule_paginates_all_message_pages(monkeypatch) -> None:
    db = _make_db()
    user = User(
        google_id="gid-1",
        email="andrewallkin@gmail.com",
        access_token="token",
        refresh_token="refresh",
        polling_enabled=True,
        polling_interval_minutes=1,
    )
    rule = Rule(user_id=1, name="Process all pages")
    db.add(user)
    db.commit()
    rule.user_id = user.id
    db.add(rule)
    db.commit()
    db.refresh(rule)

    page_tokens_seen: list[str | None] = []

    class _FakeGmailService:
        def __init__(self, _db: Session) -> None:
            pass

        def list_messages(
            self,
            _user: User,
            query: str = "",
            max_results: int = 100,
            page_token: str | None = None,
        ) -> dict:
            assert query
            assert max_results == 100
            page_tokens_seen.append(page_token)
            if page_token is None:
                return {
                    "messages": [{"id": "m-1"}, {"id": "m-2"}],
                    "nextPageToken": "page-2",
                }
            assert page_token == "page-2"
            return {
                "messages": [{"id": "m-3"}],
            }

    monkeypatch.setattr(rules_router, "GmailService", _FakeGmailService)
    result = rules_router.run_rule(rule.id, db=db, user=user)
    db.refresh(rule)

    assert page_tokens_seen == [None, "page-2"]
    assert result["matched"] == 3
    assert result["processed"] == 3
    assert result["pages_scanned"] == 2
    assert rule.total_matched == 3


def test_retention_cleanup_paginates_all_pages() -> None:
    db = _make_db()
    user = User(
        google_id="gid-1",
        email="andrewallkin@gmail.com",
        access_token="token",
        refresh_token="refresh",
        polling_enabled=True,
        polling_interval_minutes=1,
    )
    retention = SystemLabelRetention(
        user_id=1,
        category="promotions",
        retention_days=7,
        enabled=True,
    )
    db.add(user)
    db.commit()
    retention.user_id = user.id
    db.add(retention)
    db.commit()

    class _FakeGmailService:
        def __init__(self) -> None:
            self.list_calls: list[str | None] = []
            self.trashed_batches: list[list[str]] = []

        def list_messages(
            self,
            _user: User,
            query: str = "",
            max_results: int = 100,
            page_token: str | None = None,
        ) -> dict:
            assert "label:promotions" in query
            assert max_results == 100
            self.list_calls.append(page_token)
            if page_token is None:
                return {
                    "messages": [{"id": "m-1"}, {"id": "m-2"}],
                    "nextPageToken": "page-2",
                }
            assert page_token == "page-2"
            return {
                "messages": [{"id": "m-3"}],
            }

        def batch_trash_messages(self, _user: User, msg_ids: list[str]) -> None:
            self.trashed_batches.append(msg_ids)

    gmail = _FakeGmailService()
    poller._run_retention_cleanup(user, gmail, db)

    assert gmail.list_calls == [None, "page-2"]
    assert gmail.trashed_batches == [["m-1", "m-2"], ["m-3"]]


def test_preview_rule_counts_all_pages(monkeypatch) -> None:
    db = _make_db()
    user = User(
        google_id="gid-1",
        email="andrewallkin@gmail.com",
        access_token="token",
        refresh_token="refresh",
        polling_enabled=True,
        polling_interval_minutes=1,
    )
    db.add(user)
    db.commit()

    page_tokens_seen: list[str | None] = []

    class _FakeGmailService:
        def __init__(self, _db: Session) -> None:
            pass

        def list_messages(
            self,
            _user: User,
            query: str = "",
            max_results: int = 100,
            page_token: str | None = None,
        ) -> dict:
            assert query
            page_tokens_seen.append(page_token)
            if page_token is None:
                assert max_results == 100
                return {
                    "messages": [{"id": "m-1"}, {"id": "m-2"}],
                    "nextPageToken": "page-2",
                }
            assert max_results == 500
            return {
                "messages": [{"id": "m-3"}],
            }

        def get_message(self, _user: User, msg_id: str, fmt: str = "full") -> dict:
            assert fmt == "full"
            return {
                "payload": {
                    "headers": [{"name": "Subject", "value": f"subject-{msg_id}"}],
                    "body": {},
                },
            }

    monkeypatch.setattr(rules_router, "GmailService", _FakeGmailService)
    result = rules_router.preview_rule(
        rules_router.RuleCreate(name="preview all pages"),
        db=db,
        user=user,
    )

    assert page_tokens_seen == [None, "page-2"]
    assert result.estimated_count == 3
    assert result.sample_subjects == ["subject-m-1", "subject-m-2"]
