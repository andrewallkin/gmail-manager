import logging
from datetime import datetime
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Label, Rule, User
from app.services.gmail_service import GmailService
from app.services.query_utils import build_negated_or_term, build_or_term, split_comma_values

log = logging.getLogger("rules")

CATEGORY_LABELS = {
    "promotions": "CATEGORY_PROMOTIONS",
    "social": "CATEGORY_SOCIAL",
    "updates": "CATEGORY_UPDATES",
    "forums": "CATEGORY_FORUMS",
}


def _to_gmail_label_term(label_name: str) -> str:
    """Normalize label names for Gmail query terms."""
    return label_name.replace(" ", "-")


def build_rule_query(rule: Rule, db: Session, exclude_action_label: bool = False) -> str:
    """Build Gmail search query from rule criteria + scope."""
    query_parts: list[str] = []

    if rule.match_from:
        query_parts.append(build_or_term("from", rule.match_from))
    if rule.match_from_exclude:
        query_parts.append(build_negated_or_term("from", rule.match_from_exclude))
    if rule.match_to:
        query_parts.append(build_or_term("to", rule.match_to))
    if rule.match_subject:
        query_parts.append(build_or_term("subject", rule.match_subject))
    if rule.match_has_words:
        query_parts.append(rule.match_has_words)
    if rule.match_doesnt_have:
        query_parts.append(f"-{{{rule.match_doesnt_have}}}")
    if rule.match_label_id:
        label = db.scalar(select(Label).where(Label.id == rule.match_label_id).limit(1))
        if label:
            query_parts.append(f"label:{_to_gmail_label_term(label.name)}")

    if exclude_action_label and rule.action_label_id:
        action_label = db.scalar(select(Label).where(Label.id == rule.action_label_id).limit(1))
        if action_label:
            query_parts.append(f"-label:{_to_gmail_label_term(action_label.name)}")

    # Scope filtering
    if rule.scope == "all_inbox":
        query_parts.append("in:inbox")
    else:
        query_parts.append("in:inbox -category:promotions -category:social -category:updates -category:forums")

    return " ".join(query_parts)


def apply_rule_actions(
    rule: Rule,
    msg_ids: list[str],
    gmail: GmailService,
    user: User,
    db: Session,
    message_details_by_id: dict[str, dict] | None = None,
    skip_mark_read: bool = False,
) -> int:
    """Apply label/archive/delete/mark_read actions to messages. Returns count processed."""
    if not msg_ids:
        return 0

    add_labels: list[str] = []
    remove_labels: list[str] = []

    action_label = None
    if rule.action_label_id:
        action_label = db.scalar(select(Label).where(Label.id == rule.action_label_id).limit(1))
        if action_label:
            add_labels.append(action_label.gmail_label_id)

    if rule.action_archive:
        remove_labels.append("INBOX")

    if rule.action_mark_read and not skip_mark_read:
        remove_labels.append("UNREAD")

    if rule.action_delete:
        gmail.batch_trash_messages(user, msg_ids)
    elif add_labels or remove_labels:
        gmail.batch_modify_messages(
            user, msg_ids,
            add_labels=add_labels or None,
            remove_labels=remove_labels or None,
        )

    # Update rule stats
    rule.total_matched += len(msg_ids)
    rule.last_matched_at = datetime.utcnow()
    db.commit()

    return len(msg_ids)


def apply_matching_rules(
    rules: Sequence[Rule],
    msg_id: str,
    details: dict,
    gmail: GmailService,
    user: User,
    db: Session,
) -> list[int]:
    """Apply all matching rules in priority order until a stop_on_match rule is hit."""
    matched_rule_ids: list[int] = []
    skip_mark_read = details.get("is_unread", False)

    for rule in rules:
        if not message_matches_rule(rule, details, db):
            continue

        apply_rule_actions(
            rule,
            [msg_id],
            gmail,
            user,
            db,
            message_details_by_id={msg_id: details},
            skip_mark_read=skip_mark_read and rule.action_mark_read,
        )
        matched_rule_ids.append(rule.id)

        if rule.stop_on_match:
            break

    return matched_rule_ids


def message_matches_rule(rule: Rule, details: dict, db: Session) -> bool:
    """Check if a fetched message matches rule criteria locally (for poller use)."""
    sender = details.get("from", "").lower()
    recipient = details.get("to", "").lower()
    subject = details.get("subject", "").lower()
    body = details.get("body", "").lower()
    label_ids = details.get("label_ids", [])

    if rule.match_from:
        values = split_comma_values(rule.match_from)
        if not any(v.lower() in sender for v in values):
            return False
    if rule.match_from_exclude:
        values = split_comma_values(rule.match_from_exclude)
        if any(v.lower() in sender for v in values):
            return False
    if rule.match_to:
        values = split_comma_values(rule.match_to)
        if not any(v.lower() in recipient for v in values):
            return False
    if rule.match_subject:
        values = split_comma_values(rule.match_subject)
        if not any(v.lower() in subject for v in values):
            return False
    if rule.match_has_words:
        words = rule.match_has_words.lower()
        if words not in subject and words not in body:
            return False
    if rule.match_doesnt_have:
        excluded = rule.match_doesnt_have.lower()
        if excluded in subject or excluded in body:
            return False
    if rule.match_label_id:
        label = db.scalar(select(Label).where(Label.id == rule.match_label_id).limit(1))
        if label and label.gmail_label_id not in label_ids:
            return False

    # Scope check
    if rule.scope == "all_inbox":
        if "INBOX" not in label_ids:
            return False
    else:
        if "INBOX" not in label_ids:
            return False
        category_ids = set(CATEGORY_LABELS.values())
        if any(lid in category_ids for lid in label_ids):
            return False

    return True
