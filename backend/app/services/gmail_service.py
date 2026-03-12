import base64
import logging

import httpx
from sqlalchemy.orm import Session

from app.models import User
from app.services.google_service import GoogleService

log = logging.getLogger("gmail")

GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"


def parse_message_details(msg: dict) -> dict:
    """Extract from/subject/body/label_ids/is_unread from a raw Gmail message."""
    headers = {}
    payload = msg.get("payload", {})
    for h in payload.get("headers", []):
        headers[h["name"].lower()] = h["value"]

    # Decode body from payload parts
    body = ""
    parts = payload.get("parts", [])
    if parts:
        for part in parts:
            if part.get("mimeType") == "text/plain":
                data = part.get("body", {}).get("data", "")
                if data:
                    body = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                    break
        if not body:
            for part in parts:
                if part.get("mimeType") == "text/html":
                    data = part.get("body", {}).get("data", "")
                    if data:
                        body = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                        break
    else:
        data = payload.get("body", {}).get("data", "")
        if data:
            body = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")

    label_ids = msg.get("labelIds", [])
    return {
        "from": headers.get("from", ""),
        "subject": headers.get("subject", ""),
        "body": body[:4000],
        "label_ids": label_ids,
        "is_unread": "UNREAD" in label_ids,
    }


class GmailService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.google_service = GoogleService()

    def _headers(self, user: User) -> dict[str, str]:
        user = self.google_service.ensure_fresh_token(self.db, user)
        return {"Authorization": f"Bearer {user.access_token}"}

    def list_labels(self, user: User) -> list[dict]:
        resp = httpx.get(
            f"{GMAIL_API_BASE}/labels",
            headers=self._headers(user),
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json().get("labels", [])

    def get_label(self, user: User, label_id: str) -> dict:
        resp = httpx.get(
            f"{GMAIL_API_BASE}/labels/{label_id}",
            headers=self._headers(user),
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json()

    def create_label(self, user: User, name: str, bg_color: str | None = None, text_color: str | None = None) -> dict:
        body: dict = {
            "name": name,
            "labelListVisibility": "labelShow",
            "messageListVisibility": "show",
        }
        if bg_color and text_color:
            body["color"] = {"backgroundColor": bg_color, "textColor": text_color}
        resp = httpx.post(
            f"{GMAIL_API_BASE}/labels",
            headers=self._headers(user),
            json=body,
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json()

    def update_label(
        self, user: User, label_id: str, name: str | None = None,
        bg_color: str | None = None, text_color: str | None = None,
    ) -> dict:
        body: dict = {}
        if name is not None:
            body["name"] = name
        if bg_color and text_color:
            body["color"] = {"backgroundColor": bg_color, "textColor": text_color}
        resp = httpx.patch(
            f"{GMAIL_API_BASE}/labels/{label_id}",
            headers=self._headers(user),
            json=body,
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json()

    def delete_label(self, user: User, label_id: str) -> None:
        resp = httpx.delete(
            f"{GMAIL_API_BASE}/labels/{label_id}",
            headers=self._headers(user),
            timeout=20,
        )
        resp.raise_for_status()

    def list_messages(
        self, user: User, query: str = "", max_results: int = 100, page_token: str | None = None
    ) -> dict:
        params: dict = {"maxResults": max_results}
        if query:
            params["q"] = query
        if page_token:
            params["pageToken"] = page_token
        resp = httpx.get(
            f"{GMAIL_API_BASE}/messages",
            headers=self._headers(user),
            params=params,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()

    def modify_message(
        self,
        user: User,
        msg_id: str,
        add_labels: list[str] | None = None,
        remove_labels: list[str] | None = None,
    ) -> dict:
        body: dict = {}
        if add_labels:
            body["addLabelIds"] = add_labels
        if remove_labels:
            body["removeLabelIds"] = remove_labels
        resp = httpx.post(
            f"{GMAIL_API_BASE}/messages/{msg_id}/modify",
            headers=self._headers(user),
            json=body,
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json()

    def trash_message(self, user: User, msg_id: str) -> dict:
        resp = httpx.post(
            f"{GMAIL_API_BASE}/messages/{msg_id}/trash",
            headers=self._headers(user),
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json()

    def batch_modify_messages(
        self,
        user: User,
        msg_ids: list[str],
        add_labels: list[str] | None = None,
        remove_labels: list[str] | None = None,
    ) -> None:
        body: dict = {"ids": msg_ids}
        if add_labels:
            body["addLabelIds"] = add_labels
        if remove_labels:
            body["removeLabelIds"] = remove_labels
        resp = httpx.post(
            f"{GMAIL_API_BASE}/messages/batchModify",
            headers=self._headers(user),
            json=body,
            timeout=30,
        )
        resp.raise_for_status()

    def batch_trash_messages(self, user: User, msg_ids: list[str]) -> None:
        # Gmail API doesn't have a batch trash endpoint, so we batch modify to TRASH
        for msg_id in msg_ids:
            self.trash_message(user, msg_id)

    def get_message(self, user: User, msg_id: str, fmt: str = "full") -> dict:
        resp = httpx.get(
            f"{GMAIL_API_BASE}/messages/{msg_id}",
            headers=self._headers(user),
            params={"format": fmt},
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json()

    def get_profile(self, user: User) -> dict:
        resp = httpx.get(
            f"{GMAIL_API_BASE}/profile",
            headers=self._headers(user),
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json()

    def history_list(self, user: User, start_history_id: str) -> dict:
        resp = httpx.get(
            f"{GMAIL_API_BASE}/history",
            headers=self._headers(user),
            params={
                "startHistoryId": start_history_id,
                "historyTypes": "messageAdded",
            },
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()
