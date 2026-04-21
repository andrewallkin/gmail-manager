def split_comma_values(value: str) -> list[str]:
    """Split on commas, strip whitespace, remove empties."""
    return [v.strip() for v in value.split(",") if v.strip()]


def build_or_term(operator: str, value: str) -> str:
    """Build a Gmail search term with OR logic for comma-separated values.

    Single value: from:alice@example.com
    Multiple: from:(alice@example.com OR bob@example.com)
    """
    values = split_comma_values(value)
    if not values:
        return ""
    if len(values) == 1:
        return f"{operator}:{values[0]}"
    joined = " OR ".join(values)
    return f"{operator}:({joined})"


def build_negated_or_term(operator: str, value: str) -> str:
    """Build a negated Gmail search term with OR logic for comma-separated values.

    Single value: -from:alice@example.com
    Multiple: -from:(alice@example.com OR bob@example.com)
    """
    values = split_comma_values(value)
    if not values:
        return ""
    if len(values) == 1:
        return f"-{operator}:{values[0]}"
    joined = " OR ".join(values)
    return f"-{operator}:({joined})"
