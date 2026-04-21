import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_jwt_user
from app.models import Rule, User
from app.services.gmail_service import GmailService, parse_message_details
from app.services.rule_engine import build_rule_query, apply_rule_actions

router = APIRouter(prefix="/api/rules", tags=["rules"])
log = logging.getLogger("rules")


class RuleCreate(BaseModel):
    name: str
    enabled: bool = True
    match_from: str | None = None
    match_from_exclude: str | None = None
    match_to: str | None = None
    match_subject: str | None = None
    match_has_words: str | None = None
    match_doesnt_have: str | None = None
    match_label_id: int | None = None
    action_label_id: int | None = None
    action_archive: bool = False
    action_delete: bool = False
    action_mark_read: bool = False
    scope: str = "primary"
    use_ai: bool = False
    ai_prompt: str | None = None
    priority: int = 0


class RuleUpdate(RuleCreate):
    pass


class RuleOut(BaseModel):
    id: int
    name: str
    enabled: bool
    match_from: str | None
    match_from_exclude: str | None
    match_to: str | None
    match_subject: str | None
    match_has_words: str | None
    match_doesnt_have: str | None
    match_label_id: int | None
    action_label_id: int | None
    action_archive: bool
    action_delete: bool
    action_mark_read: bool
    scope: str
    use_ai: bool
    ai_prompt: str | None
    priority: int
    total_matched: int
    last_matched_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ReorderRequest(BaseModel):
    rule_ids: list[int]


class PreviewOut(BaseModel):
    estimated_count: int
    query: str
    sample_subjects: list[str]


@router.get("")
def list_rules(
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> list[RuleOut]:
    rules = db.scalars(
        select(Rule)
        .where(Rule.user_id == user.id)
        .order_by(Rule.priority.asc(), Rule.created_at.asc())
    ).all()
    return [RuleOut.model_validate(r) for r in rules]


@router.post("")
def create_rule(
    body: RuleCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> RuleOut:
    rule = Rule(user_id=user.id, **body.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    log.info("Created rule '%s' for user=%s", body.name, user.email)
    return RuleOut.model_validate(rule)


@router.put("/reorder")
def reorder_rules(
    body: ReorderRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> dict:
    rules = db.scalars(select(Rule).where(Rule.user_id == user.id)).all()
    rule_map = {r.id: r for r in rules}
    for idx, rule_id in enumerate(body.rule_ids):
        if rule_id in rule_map:
            rule_map[rule_id].priority = idx
    db.commit()
    return {"reordered": True}


@router.post("/preview")
def preview_rule(
    body: RuleCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> PreviewOut:
    # Create a temporary Rule-like object for build_rule_query
    temp_rule = Rule(user_id=user.id, **body.model_dump())
    query = build_rule_query(temp_rule, db, exclude_action_label=True)
    if not query:
        return PreviewOut(estimated_count=0, query="", sample_subjects=[])

    gmail = GmailService(db)
    result = gmail.list_messages(user, query=query, max_results=100)
    messages = result.get("messages", [])
    estimated_count = len(messages)
    page_token = result.get("nextPageToken")

    while page_token:
        result = gmail.list_messages(user, query=query, max_results=500, page_token=page_token)
        page_messages = result.get("messages", [])
        estimated_count += len(page_messages)
        page_token = result.get("nextPageToken")

    # Fetch subjects of first 5 matches
    sample_subjects: list[str] = []
    for msg in messages[:5]:
        try:
            raw = gmail.get_message(user, msg["id"])
            details = parse_message_details(raw)
            sample_subjects.append(details.get("subject", "(no subject)"))
        except Exception:
            pass

    return PreviewOut(
        estimated_count=estimated_count,
        query=query,
        sample_subjects=sample_subjects,
    )


@router.put("/{rule_id}")
def update_rule(
    rule_id: int,
    body: RuleUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> RuleOut:
    rule = db.scalar(select(Rule).where(Rule.id == rule_id, Rule.user_id == user.id).limit(1))
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    for key, value in body.model_dump().items():
        setattr(rule, key, value)
    db.commit()
    db.refresh(rule)
    log.info("Updated rule '%s' for user=%s", rule.name, user.email)
    return RuleOut.model_validate(rule)


@router.delete("/{rule_id}")
def delete_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> dict:
    rule = db.scalar(select(Rule).where(Rule.id == rule_id, Rule.user_id == user.id).limit(1))
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()
    log.info("Deleted rule '%s' for user=%s", rule.name, user.email)
    return {"deleted": True}


@router.post("/{rule_id}/run")
def run_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> dict:
    rule = db.scalar(select(Rule).where(Rule.id == rule_id, Rule.user_id == user.id).limit(1))
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    query = build_rule_query(rule, db, exclude_action_label=True)
    if not query:
        raise HTTPException(status_code=400, detail="Rule has no match criteria")

    gmail = GmailService(db)
    matched = 0
    processed = 0
    pages_scanned = 0
    page_token = None

    while True:
        result = gmail.list_messages(user, query=query, max_results=100, page_token=page_token)
        pages_scanned += 1
        messages = result.get("messages", [])
        if not messages:
            break

        msg_ids = [m["id"] for m in messages]
        matched += len(messages)
        processed += apply_rule_actions(rule, msg_ids, gmail, user, db)

        page_token = result.get("nextPageToken")
        if not page_token:
            break

    log.info(
        "Ran rule '%s': matched=%d processed=%d pages=%d",
        rule.name,
        matched,
        processed,
        pages_scanned,
    )
    return {
        "matched": matched,
        "processed": processed,
        "query": query,
        "pages_scanned": pages_scanned,
    }
