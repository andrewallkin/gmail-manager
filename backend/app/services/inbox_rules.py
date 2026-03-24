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
