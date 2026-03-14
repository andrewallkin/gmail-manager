from datetime import datetime, timezone

import httpx
from fastapi import Response
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base
from app.models import User
from app.routers.auth import disconnect_google
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
