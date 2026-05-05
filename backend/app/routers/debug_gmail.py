import logging
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_jwt_user
from app.models import User
from app.services.gmail_service import GmailService

router = APIRouter(prefix="/api/debug", tags=["debug"])
log = logging.getLogger("gmail")

GmailCategoryTab = Literal["promotions", "social", "updates", "forums"]
_PRIMARY_TAB_EXCLUDES: tuple[GmailCategoryTab, ...] = ("promotions", "social", "updates", "forums")


class InboxInspectorRequest(BaseModel):
    date_from: str
    date_to: str
    max_messages: int = Field(default=25, ge=1, le=100)
    primary_only: bool = Field(
        default=False,
        description='Match Primary tab only (same -category negations as rule scope "primary").',
    )
    include_categories: list[GmailCategoryTab] = Field(
        default_factory=list,
        description="Require at least one of these tabs (OR via grouped category: terms).",
    )
    exclude_categories: list[GmailCategoryTab] = Field(
        default_factory=list,
        description="Exclude these category tabs (-category:...).",
    )


def _dedupe_preserve(items: list[GmailCategoryTab]) -> list[GmailCategoryTab]:
    return list(dict.fromkeys(items))


def _parse_calendar_date(value: str) -> date:
    return date.fromisoformat(value[:10])


def _format_gmail_date(d: date) -> str:
    """Gmail search expects yyyy/mm/dd (slashes, not ISO hyphens)."""
    return f"{d.year}/{d.month:02d}/{d.day:02d}"


def _build_inbox_inspector_query(
    date_from: str,
    date_to: str,
    *,
    primary_only: bool = False,
    include_categories: list[GmailCategoryTab] | None = None,
    exclude_categories: list[GmailCategoryTab] | None = None,
) -> str:
    """Inbox + date range. Start/end are calendar dates from the UI; end is inclusive through that day.

    Gmail `before:` excludes its date, so we pass the day *after* the user's end date.
    """
    d_start = _parse_calendar_date(date_from)
    d_end_inclusive = _parse_calendar_date(date_to)
    d_before_exclusive = d_end_inclusive + timedelta(days=1)
    parts: list[str] = [
        "in:inbox",
        f"after:{_format_gmail_date(d_start)}",
        f"before:{_format_gmail_date(d_before_exclusive)}",
    ]
    inc = _dedupe_preserve(list(include_categories or []))
    exc = _dedupe_preserve(list(exclude_categories or []))

    if primary_only:
        for c in _PRIMARY_TAB_EXCLUDES:
            parts.append(f"-category:{c}")
    if inc:
        if len(inc) == 1:
            parts.append(f"category:{inc[0]}")
        else:
            inner = " ".join(f"category:{c}" for c in inc)
            parts.append(f"{{{inner}}}")
    for c in exc:
        parts.append(f"-category:{c}")
    return " ".join(parts)


@router.post("/inbox")
def inbox_inspector(
    body: InboxInspectorRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> dict:
    gmail = GmailService(db)
    query = _build_inbox_inspector_query(
        body.date_from,
        body.date_to,
        primary_only=body.primary_only,
        include_categories=body.include_categories,
        exclude_categories=body.exclude_categories,
    )

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
