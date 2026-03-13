from app.models import User

CATEGORY_LABEL_IDS = {
    "CATEGORY_PROMOTIONS",
    "CATEGORY_SOCIAL",
    "CATEGORY_UPDATES",
    "CATEGORY_FORUMS",
}


def is_primary_inbox_message(label_ids: list[str]) -> bool:
    if "INBOX" not in label_ids:
        return False
    return not any(label_id in CATEGORY_LABEL_IDS for label_id in label_ids)


def should_auto_remove_inbox(
    user: User,
    label_name: str | None,
    label_ids: list[str],
    is_unread: bool,
) -> bool:
    if not user.auto_remove_inbox_labeled_read:
        return False
    if is_unread:
        return False
    if not is_primary_inbox_message(label_ids):
        return False
    if not label_name:
        return False
    return label_name.strip().lower() != "unclassified"
