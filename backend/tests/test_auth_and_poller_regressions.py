from datetime import datetime, timezone

import httpx
import logging
from fastapi import HTTPException, Response
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base
from app.models import Label, Rule, SystemLabelRetention, User
from app.routers.auth import disconnect_google
from app.routers import rules as rules_router
from app.routers import cleanup as cleanup_router
from app.services.google_service import GoogleService
from app.services import poller
from app.services.rule_engine import apply_matching_rules, message_matches_rule


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
    assert returned_user.polling_enabled is True


def test_ensure_fresh_token_refresh_failure_preserves_polling_preference(monkeypatch) -> None:
    db = _make_db()
    user = User(
        google_id="gid-1",
        email="andrewallkin@gmail.com",
        access_token="old",
        refresh_token="bad-refresh",
        token_expiry=datetime(2000, 1, 1, tzinfo=timezone.utc),
        polling_enabled=True,
        google_auth_broken=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    class _Settings:
        google_allowed_email = "andrewallkin@gmail.com"
        public_base_url = "http://localhost:8003"
        google_client_id = "cid"
        google_client_secret = "csecret"
        google_scopes = "openid email profile"

    def _fake_post(*args, **kwargs):  # type: ignore[no-untyped-def]
        return httpx.Response(
            400,
            request=httpx.Request("POST", "https://oauth2.googleapis.com/token"),
            json={"error": "invalid_grant"},
        )

    monkeypatch.setattr("app.services.google_service.get_settings", lambda: _Settings())
    monkeypatch.setattr("app.services.google_service.httpx.post", _fake_post)

    service = GoogleService()
    try:
        service.ensure_fresh_token(db, user)
    except HTTPException as exc:
        assert exc.status_code == 401
    else:
        raise AssertionError("expected HTTPException")

    db.refresh(user)
    assert user.google_auth_broken is True
    assert user.polling_enabled is True


def test_poller_marks_auth_broken_on_gmail_401_preserves_polling_preference(monkeypatch) -> None:
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
    assert refreshed_user.polling_enabled is True
    assert refreshed_user.google_auth_broken is True
    assert user_id not in poller._last_poll_per_user


def test_poll_cycle_logs_when_no_eligible_users(monkeypatch, caplog) -> None:
    db = _make_db()

    def _fake_session_local() -> Session:
        return db

    monkeypatch.setattr(poller, "SessionLocal", _fake_session_local)
    poller._last_poll_per_user.clear()
    caplog.clear()
    caplog.set_level(logging.INFO, logger="poller")

    poller._run_poll_cycle()

    messages = [record.getMessage() for record in caplog.records if record.name == "poller"]
    assert any("event=poll_cycle_no_eligible_users" in msg for msg in messages)
    assert any(
        "event=poll_cycle_finished" in msg and "eligible_users=0" in msg and "processed_users=0" in msg
        for msg in messages
    )


def test_poll_cycle_logs_user_skipped_by_interval(monkeypatch, caplog) -> None:
    db = _make_db()
    user = User(
        google_id="gid-1",
        email="andrewallkin@gmail.com",
        access_token="token",
        refresh_token="refresh",
        polling_enabled=True,
        polling_interval_minutes=5,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    def _fake_session_local() -> Session:
        return db

    monkeypatch.setattr(poller, "SessionLocal", _fake_session_local)
    poller._last_poll_per_user.clear()
    poller._last_poll_per_user[user.id] = datetime.now(timezone.utc)
    caplog.clear()
    caplog.set_level(logging.INFO, logger="poller")

    poller._run_poll_cycle()

    messages = [record.getMessage() for record in caplog.records if record.name == "poller"]
    assert any("event=poll_user_skipped_interval" in msg for msg in messages)
    assert any(
        "event=poll_cycle_finished" in msg and "skipped_interval_users=1" in msg and "processed_users=0" in msg
        for msg in messages
    )


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


def test_poller_skips_google_auth_broken_users(monkeypatch) -> None:
    db = _make_db()
    broken = User(
        google_id="gid-broken",
        email="broken@example.com",
        access_token="token",
        refresh_token="refresh",
        polling_enabled=True,
        google_auth_broken=True,
        polling_interval_minutes=1,
    )
    ok = User(
        google_id="gid-ok",
        email="ok@example.com",
        access_token="token",
        refresh_token="refresh",
        polling_enabled=True,
        google_auth_broken=False,
        polling_interval_minutes=1,
    )
    db.add_all([broken, ok])
    db.commit()
    db.refresh(broken)
    db.refresh(ok)

    called_user_ids: list[int] = []

    def _fake_session_local() -> Session:
        return db

    def _capture_user(polled_user: User, *args, **kwargs):  # type: ignore[no-untyped-def]
        called_user_ids.append(polled_user.id)

    monkeypatch.setattr(poller, "SessionLocal", _fake_session_local)
    monkeypatch.setattr(poller, "_poll_user", _capture_user)
    poller._last_poll_per_user.clear()

    poller._run_poll_cycle()

    assert called_user_ids == [ok.id]


def test_poll_user_logs_noop_history_and_messages(monkeypatch, caplog) -> None:
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
            assert page_token is None
            assert max_results is None
            return {"historyId": "101", "history": []}

    monkeypatch.setattr(poller, "GmailService", _FakeGmailService)
    caplog.clear()
    caplog.set_level(logging.INFO, logger="poller")

    poller._poll_user(user, db, cycle_id="test-cycle")

    messages = [record.getMessage() for record in caplog.records if record.name == "poller"]
    assert any("event=poll_user_no_history_records" in msg for msg in messages)
    assert any("event=poll_user_no_new_messages" in msg for msg in messages)
    assert any("event=poll_user_finished" in msg and "new_messages=0" in msg for msg in messages)


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


def test_run_rule_excludes_action_label_from_query(monkeypatch) -> None:
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

    label = Label(
        user_id=user.id,
        gmail_label_id="Label_42",
        name="Daily Maverick",
        label_type="user",
    )
    db.add(label)
    db.commit()
    db.refresh(label)

    rule = Rule(
        user_id=user.id,
        name="Label historical newsletters",
        match_from="news@dailymaverick.co.za",
        action_label_id=label.id,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)

    seen_queries: list[str] = []
    modified_add_labels: list[list[str] | None] = []

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
            assert max_results == 100
            assert page_token is None
            seen_queries.append(query)
            return {"messages": [{"id": "m-1"}]}

        def batch_modify_messages(
            self,
            _user: User,
            msg_ids: list[str],
            add_labels: list[str] | None = None,
            remove_labels: list[str] | None = None,
        ) -> None:
            assert msg_ids == ["m-1"]
            assert remove_labels is None
            modified_add_labels.append(add_labels)

    monkeypatch.setattr(rules_router, "GmailService", _FakeGmailService)
    result = rules_router.run_rule(rule.id, db=db, user=user)

    assert len(seen_queries) == 1
    assert "from:news@dailymaverick.co.za" in seen_queries[0]
    assert "-label:Daily-Maverick" in seen_queries[0]
    assert modified_add_labels == [["Label_42"]]
    assert result["matched"] == 1
    assert result["processed"] == 1


def test_run_rule_includes_excluded_sender_query_terms(monkeypatch) -> None:
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

    rule = Rule(
        user_id=user.id,
        name="Exclude noisy senders",
        match_from="news@dailymaverick.co.za",
        match_from_exclude="noreply@dailymaverick.co.za, digest@dailymaverick.co.za",
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)

    seen_queries: list[str] = []

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
            assert max_results == 100
            assert page_token is None
            seen_queries.append(query)
            return {"messages": []}

    monkeypatch.setattr(rules_router, "GmailService", _FakeGmailService)
    result = rules_router.run_rule(rule.id, db=db, user=user)

    assert len(seen_queries) == 1
    assert "from:news@dailymaverick.co.za" in seen_queries[0]
    assert "-from:(noreply@dailymaverick.co.za OR digest@dailymaverick.co.za)" in seen_queries[0]
    assert result["matched"] == 0
    assert result["processed"] == 0


def test_message_matches_rule_excludes_sender_substring() -> None:
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

    rule = Rule(
        user_id=user.id,
        name="Exclude sender substring",
        match_from="example.com",
        match_from_exclude="noreply",
        scope="all_inbox",
    )
    db.add(rule)
    db.commit()

    excluded_details = {
        "from": "NoReply <noreply@example.com>",
        "subject": "Newsletter",
        "body": "Body",
        "label_ids": ["INBOX"],
    }
    allowed_details = {
        "from": "Team <team@example.com>",
        "subject": "Newsletter",
        "body": "Body",
        "label_ids": ["INBOX"],
    }

    assert message_matches_rule(rule, excluded_details, db) is False
    assert message_matches_rule(rule, allowed_details, db) is True


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
            self.seen_queries: list[str] = []

        def list_messages(
            self,
            _user: User,
            query: str = "",
            max_results: int = 100,
            page_token: str | None = None,
        ) -> dict:
            assert "label:promotions" in query
            assert "-has:userlabels" in query
            assert max_results == 100
            self.list_calls.append(page_token)
            self.seen_queries.append(query)
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


def test_retention_cleanup_logs_zero_work(caplog) -> None:
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
        def list_messages(
            self,
            _user: User,
            query: str = "",
            max_results: int = 100,
            page_token: str | None = None,
        ) -> dict:
            assert "label:promotions" in query
            return {"messages": []}

        def batch_trash_messages(self, _user: User, msg_ids: list[str]) -> None:
            raise AssertionError(f"should not trash messages, got {msg_ids}")

    caplog.clear()
    caplog.set_level(logging.INFO, logger="poller")
    poller._run_retention_cleanup(user, _FakeGmailService(), db, cycle_id="test-cycle")

    messages = [record.getMessage() for record in caplog.records if record.name == "poller"]
    assert any("event=retention_cleanup_completed" in msg and "messages_changed=0" in msg for msg in messages)


def test_inbox_sweep_logs_skip_when_no_user_labels(caplog) -> None:
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

    class _FakeGmailService:
        pass

    caplog.clear()
    caplog.set_level(logging.INFO, logger="poller")
    stats = poller._run_inbox_removal_sweep(user, _FakeGmailService(), db, cycle_id="test-cycle")

    messages = [record.getMessage() for record in caplog.records if record.name == "poller"]
    assert stats["messages_changed"] == 0
    assert any("event=inbox_removal_sweep_skipped" in msg and "reason=no_user_labels" in msg for msg in messages)


def test_retention_cleanup_uses_userlabels_filter() -> None:
    """Retention cleanup query includes -has:userlabels so no per-message fetch is needed."""
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

    retention = SystemLabelRetention(
        user_id=user.id,
        category="promotions",
        retention_days=30,
        enabled=True,
    )
    db.add(retention)
    db.commit()

    class _FakeGmailService:
        def __init__(self) -> None:
            self.trashed_batches: list[list[str]] = []
            self.seen_queries: list[str] = []

        def list_messages(
            self,
            _user: User,
            query: str = "",
            max_results: int = 100,
            page_token: str | None = None,
        ) -> dict:
            self.seen_queries.append(query)
            return {"messages": [{"id": "m-1"}, {"id": "m-2"}, {"id": "m-3"}]}

        def batch_trash_messages(self, _user: User, msg_ids: list[str]) -> None:
            self.trashed_batches.append(msg_ids)

    gmail = _FakeGmailService()
    poller._run_retention_cleanup(user, gmail, db)

    assert len(gmail.seen_queries) == 1
    assert "-has:userlabels" in gmail.seen_queries[0]
    assert gmail.trashed_batches == [["m-1", "m-2", "m-3"]]


def test_label_retention_cleanup() -> None:
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

    label = Label(
        user_id=user.id,
        gmail_label_id="Label_42",
        name="Newsletters",
        label_type="user",
        retention_days=14,
    )
    db.add(label)
    db.commit()

    class _FakeGmailService:
        def __init__(self) -> None:
            self.trashed_batches: list[list[str]] = []
            self.seen_queries: list[str] = []

        def list_messages(
            self,
            _user: User,
            query: str = "",
            max_results: int = 100,
            page_token: str | None = None,
        ) -> dict:
            self.seen_queries.append(query)
            return {"messages": [{"id": "m-1"}, {"id": "m-2"}]}

        def batch_trash_messages(self, _user: User, msg_ids: list[str]) -> None:
            self.trashed_batches.append(msg_ids)

    gmail = _FakeGmailService()
    poller._run_label_retention_cleanup(user, gmail, db)

    assert len(gmail.seen_queries) == 1
    assert "label:Newsletters" in gmail.seen_queries[0]
    assert "before:" in gmail.seen_queries[0]
    assert gmail.trashed_batches == [["m-1", "m-2"]]


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


def test_message_matches_rule_includes_to_header() -> None:
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

    rule = Rule(
        user_id=user.id,
        name="Match to header",
        match_to="alerts@example.com,team@example.com",
        scope="all_inbox",
    )
    db.add(rule)
    db.commit()

    matching_details = {
        "from": "sender@example.com",
        "to": "Team <team@example.com>",
        "subject": "Update",
        "body": "Body",
        "label_ids": ["INBOX"],
    }
    non_matching_details = {
        "from": "sender@example.com",
        "to": "other@example.com",
        "subject": "Update",
        "body": "Body",
        "label_ids": ["INBOX"],
    }

    assert message_matches_rule(rule, matching_details, db) is True
    assert message_matches_rule(rule, non_matching_details, db) is False


def test_apply_matching_rules_continues_until_stop_on_match() -> None:
    db = _make_db()
    user = User(
        google_id="gid-1",
        email="andrewallkin@gmail.com",
        access_token="token",
        refresh_token="refresh",
        polling_enabled=True,
        polling_interval_minutes=1,
    )
    first_label = Label(user_id=1, gmail_label_id="Label_1", name="First")
    second_label = Label(user_id=1, gmail_label_id="Label_2", name="Second")
    db.add_all([user])
    db.commit()
    first_label.user_id = user.id
    second_label.user_id = user.id
    db.add_all([first_label, second_label])
    db.commit()
    db.refresh(first_label)
    db.refresh(second_label)

    first_rule = Rule(
        user_id=user.id,
        name="First",
        match_from="example.com",
        action_label_id=first_label.id,
        stop_on_match=False,
        scope="all_inbox",
    )
    second_rule = Rule(
        user_id=user.id,
        name="Second",
        match_from="example.com",
        action_label_id=second_label.id,
        stop_on_match=True,
        scope="all_inbox",
    )
    db.add_all([first_rule, second_rule])
    db.commit()

    class _FakeGmailService:
        def __init__(self) -> None:
            self.modified_calls: list[dict] = []

        def batch_modify_messages(
            self,
            _user: User,
            msg_ids: list[str],
            add_labels: list[str] | None = None,
            remove_labels: list[str] | None = None,
        ) -> None:
            self.modified_calls.append({
                "msg_ids": msg_ids,
                "add_labels": add_labels,
                "remove_labels": remove_labels,
            })

        def batch_trash_messages(self, _user: User, _msg_ids: list[str]) -> None:
            raise AssertionError("trash not expected")

    gmail = _FakeGmailService()
    matched_rule_ids = apply_matching_rules(
        [first_rule, second_rule],
        "msg-1",
        {
            "from": "alerts@example.com",
            "to": "me@example.com",
            "subject": "newsletter",
            "body": "hello",
            "label_ids": ["INBOX"],
            "is_unread": False,
        },
        gmail,  # type: ignore[arg-type]
        user,
        db,
    )

    assert matched_rule_ids == [first_rule.id, second_rule.id]
    assert len(gmail.modified_calls) == 2
    assert gmail.modified_calls[0]["add_labels"] == ["Label_1"]
    assert gmail.modified_calls[1]["add_labels"] == ["Label_2"]


def test_apply_matching_rules_stops_after_first_stop_on_match_rule() -> None:
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

    first_rule = Rule(
        user_id=user.id,
        name="First",
        match_from="example.com",
        action_archive=True,
        stop_on_match=True,
        scope="all_inbox",
    )
    second_rule = Rule(
        user_id=user.id,
        name="Second",
        match_from="example.com",
        action_delete=True,
        stop_on_match=False,
        scope="all_inbox",
    )
    db.add_all([first_rule, second_rule])
    db.commit()

    class _FakeGmailService:
        def __init__(self) -> None:
            self.modified_calls: list[dict] = []
            self.trashed_calls = 0

        def batch_modify_messages(
            self,
            _user: User,
            msg_ids: list[str],
            add_labels: list[str] | None = None,
            remove_labels: list[str] | None = None,
        ) -> None:
            self.modified_calls.append({
                "msg_ids": msg_ids,
                "add_labels": add_labels,
                "remove_labels": remove_labels,
            })

        def batch_trash_messages(self, _user: User, _msg_ids: list[str]) -> None:
            self.trashed_calls += 1

    gmail = _FakeGmailService()
    matched_rule_ids = apply_matching_rules(
        [first_rule, second_rule],
        "msg-1",
        {
            "from": "alerts@example.com",
            "to": "me@example.com",
            "subject": "newsletter",
            "body": "hello",
            "label_ids": ["INBOX"],
            "is_unread": False,
        },
        gmail,  # type: ignore[arg-type]
        user,
        db,
    )

    assert matched_rule_ids == [first_rule.id]
    assert len(gmail.modified_calls) == 1
    assert gmail.trashed_calls == 0


def test_reorder_rules_normalizes_all_priorities() -> None:
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

    first = Rule(user_id=user.id, name="First", priority=10)
    second = Rule(user_id=user.id, name="Second", priority=20)
    third = Rule(user_id=user.id, name="Third", priority=30)
    db.add_all([first, second, third])
    db.commit()

    result = rules_router.reorder_rules(
        rules_router.ReorderRequest(rule_ids=[third.id]),
        db=db,
        user=user,
    )

    db.refresh(first)
    db.refresh(second)
    db.refresh(third)

    assert result["reordered"] is True
    assert result["rule_ids"] == [third.id, first.id, second.id]
    assert third.priority == 0
    assert first.priority == 1
    assert second.priority == 2


def test_reorder_rules_rejects_invalid_ids() -> None:
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

    db.add(Rule(user_id=user.id, name="Rule 1", priority=0))
    db.commit()

    try:
        rules_router.reorder_rules(
            rules_router.ReorderRequest(rule_ids=[99999]),
            db=db,
            user=user,
        )
    except HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("expected HTTPException")


def test_retroactive_classification_loads_rules_in_priority_order(monkeypatch) -> None:
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

    lower_priority = Rule(user_id=user.id, name="Later", priority=5, enabled=True, scope="all_inbox")
    higher_priority = Rule(user_id=user.id, name="First", priority=1, enabled=True, scope="all_inbox")
    db.add_all([lower_priority, higher_priority])
    db.commit()

    captured_rule_order: list[int] = []

    class _FakeGmailService:
        def __init__(self, _db: Session) -> None:
            self.seen = False

        def list_messages(
            self,
            _user: User,
            query: str = "",
            max_results: int = 100,
            page_token: str | None = None,
        ) -> dict:
            assert query
            if self.seen:
                return {"messages": []}
            self.seen = True
            return {"messages": [{"id": "msg-1"}]}

        def get_message(self, _user: User, _msg_id: str) -> dict:
            return {
                "labelIds": ["INBOX"],
                "payload": {
                    "headers": [
                        {"name": "From", "value": "alerts@example.com"},
                        {"name": "To", "value": "me@example.com"},
                        {"name": "Subject", "value": "hello"},
                    ],
                    "body": {},
                },
            }

        def modify_message(self, _user: User, _msg_id: str, add_labels: list[str] | None = None) -> None:
            assert add_labels is None

    def _capture_order(rules, *args, **kwargs):  # type: ignore[no-untyped-def]
        captured_rule_order[:] = [rule.id for rule in rules]
        return []

    monkeypatch.setattr(cleanup_router, "GmailService", _FakeGmailService)
    monkeypatch.setattr(cleanup_router, "apply_matching_rules", _capture_order)

    cleanup_router.retroactive_classification(
        cleanup_router.RetroactiveRequest(
            date_from="2026-01-01T00:00:00Z",
            date_to="2026-01-31T00:00:00Z",
            max_messages=1,
        ),
        db=db,
        user=user,
    )

    assert captured_rule_order == [higher_priority.id, lower_priority.id]
