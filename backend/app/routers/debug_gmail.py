import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_jwt_user
from app.models import User
from app.services.gmail_service import GmailService

router = APIRouter(prefix="/api/debug", tags=["debug"])
log = logging.getLogger("gmail")


class InboxInspectorRequest(BaseModel):
    date_from: str
    date_to: str
    max_messages: int = Field(default=25, ge=1, le=100)


def _build_inbox_inspector_query(date_from: str, date_to: str) -> str:
    """Gmail search: full inbox (all category tabs), date bounds. `before:` is exclusive."""
    return f"in:inbox after:{date_from[:10]} before:{date_to[:10]}"


@router.post("/inbox")
def inbox_inspector(
    body: InboxInspectorRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> dict:
    gmail = GmailService(db)
    query = _build_inbox_inspector_query(body.date_from, body.date_to)

    ids: list[str] = []
    page_token: str | None = None
    while len(ids) < body.max_messages:
        remaining = body.max_messages - len(ids)
        page_size = min(500, remaining)
        result = gmail.list_messages(user, query=query, max_results=page_size, page_token=page_token)
        batch = result.get("messages") or []
        for ref in batch:
            if len(ids) >= body.max_messages:
                break
            ids.append(ref["id"])
        page_token = result.get("nextPageToken")
        if not page_token or not batch:
            break

    labels = gmail.list_labels(user)
    label_map: dict[str, str] = {entry["id"]: entry.get("name", entry["id"]) for entry in labels}

    messages: list[dict] = []
    for msg_id in ids:
        messages.append(gmail.get_message(user, msg_id, fmt="full"))

    log.info("inbox inspector query=%s fetched=%s", query, len(messages))

    return {
        "gmail_query": query,
        "fetched_count": len(messages),
        "label_map": label_map,
        "messages": messages,
    }
