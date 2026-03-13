import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Label, Rule, User
from app.services.gmail_service import GmailService
from app.services.gmail_service import parse_message_details
from app.services.inbox_rules import should_auto_remove_inbox

log = logging.getLogger("rules")

CATEGORY_LABELS = {
    "promotions": "CATEGORY_PROMOTIONS",
    "social": "CATEGORY_SOCIAL",
    "updates": "CATEGORY_UPDATES",
    "forums": "CATEGORY_FORUMS",
}


def build_rule_query(rule: Rule, db: Session) -> str:
    """Build Gmail search query from rule criteria + scope."""
    query_parts: list[str] = []

    if rule.match_from:
        query_parts.append(f"from:{rule.match_from}")
    if rule.match_to:
        query_parts.append(f"to:{rule.match_to}")
    if rule.match_subject:
        query_parts.append(f"subject:{rule.match_subject}")
    if rule.match_has_words:
        query_parts.append(rule.match_has_words)
    if rule.match_doesnt_have:
        query_parts.append(f"-{{{rule.match_doesnt_have}}}")
    if rule.match_label_id:
        label = db.scalar(select(Label).where(Label.id == rule.match_label_id).limit(1))
        if label:
            query_parts.append(f"label:{label.name.replace(' ', '-')}")

    # Scope filtering
    scopes = []
    if rule.scope_promotions:
        scopes.append("category:promotions")
    if rule.scope_social:
        scopes.append("category:social")
    if rule.scope_updates:
        scopes.append("category:updates")
    if rule.scope_forums:
        scopes.append("category:forums")

    if scopes:
        # Match any of the selected categories
        scope_query = " OR ".join(scopes)
        query_parts.append(f"({scope_query})")
    else:
        # No scope = Primary inbox only
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
        should_apply_conditional_inbox_rule = bool(
            action_label
            and user.auto_remove_inbox_labeled_read
            and action_label.name.strip().lower() != "unclassified"
        )
        if should_apply_conditional_inbox_rule:
            for msg_id in msg_ids:
                details = (message_details_by_id or {}).get(msg_id)
                if details is None:
                    details = parse_message_details(gmail.get_message(user, msg_id))
                remove_for_msg = list(remove_labels)
                if should_auto_remove_inbox(
                    user=user,
                    label_name=action_label.name if action_label else None,
                    label_ids=details.get("label_ids", []),
                    is_unread=details.get("is_unread", False),
                ) and "INBOX" not in remove_for_msg:
                    remove_for_msg.append("INBOX")
                gmail.modify_message(
                    user,
                    msg_id,
                    add_labels=add_labels or None,
                    remove_labels=remove_for_msg or None,
                )
            return len(msg_ids)
        gmail.batch_modify_messages(
            user, msg_ids,
            add_labels=add_labels or None,
            remove_labels=remove_labels or None,
        )

    return len(msg_ids)


def message_matches_rule(rule: Rule, details: dict, db: Session) -> bool:
    """Check if a fetched message matches rule criteria locally (for poller use)."""
    sender = details.get("from", "").lower()
    subject = details.get("subject", "").lower()
    body = details.get("body", "").lower()
    label_ids = details.get("label_ids", [])

    if rule.match_from and rule.match_from.lower() not in sender:
        return False
    if rule.match_subject and rule.match_subject.lower() not in subject:
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
    scopes = []
    if rule.scope_promotions:
        scopes.append("CATEGORY_PROMOTIONS")
    if rule.scope_social:
        scopes.append("CATEGORY_SOCIAL")
    if rule.scope_updates:
        scopes.append("CATEGORY_UPDATES")
    if rule.scope_forums:
        scopes.append("CATEGORY_FORUMS")

    if scopes:
        if not any(s in label_ids for s in scopes):
            return False
    else:
        # Primary only: reject if message has any category label
        category_ids = set(CATEGORY_LABELS.values())
        if any(lid in category_ids for lid in label_ids):
            return False

    return True
