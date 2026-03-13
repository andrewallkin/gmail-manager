import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_jwt_user
from app.models import Rule, User
from app.services.gmail_service import GmailService
from app.services.rule_engine import build_rule_query, apply_rule_actions

router = APIRouter(prefix="/api/rules", tags=["rules"])
log = logging.getLogger("rules")


class RuleCreate(BaseModel):
    name: str
    enabled: bool = True
    match_from: str | None = None
    match_to: str | None = None
    match_subject: str | None = None
    match_has_words: str | None = None
    match_doesnt_have: str | None = None
    match_label_id: int | None = None
    action_label_id: int | None = None
    action_archive: bool = False
    action_delete: bool = False
    action_mark_read: bool = False
    action_delete_after_days: int | None = None
    scope_promotions: bool = False
    scope_social: bool = False
    scope_updates: bool = False
    scope_forums: bool = False
    use_ai: bool = False
    ai_prompt: str | None = None


class RuleUpdate(RuleCreate):
    pass


class RuleOut(BaseModel):
    id: int
    name: str
    enabled: bool
    match_from: str | None
    match_to: str | None
    match_subject: str | None
    match_has_words: str | None
    match_doesnt_have: str | None
    match_label_id: int | None
    action_label_id: int | None
    action_archive: bool
    action_delete: bool
    action_mark_read: bool
    action_delete_after_days: int | None
    scope_promotions: bool
    scope_social: bool
    scope_updates: bool
    scope_forums: bool
    use_ai: bool
    ai_prompt: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


@router.get("")
def list_rules(
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> list[RuleOut]:
    rules = db.scalars(select(Rule).where(Rule.user_id == user.id).order_by(Rule.created_at.desc())).all()
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

    query = build_rule_query(rule, db)
    if not query:
        raise HTTPException(status_code=400, detail="Rule has no match criteria")

    gmail = GmailService(db)
    result = gmail.list_messages(user, query=query, max_results=100)
    messages = result.get("messages", [])

    if not messages:
        return {"matched": 0, "processed": 0}

    msg_ids = [m["id"] for m in messages]
    processed = apply_rule_actions(rule, msg_ids, gmail, user, db)

    log.info("Ran rule '%s': matched=%d processed=%d", rule.name, len(messages), processed)
    return {"matched": len(messages), "processed": processed}
