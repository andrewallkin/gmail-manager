import json
import logging
import time

import httpx

log = logging.getLogger("ai")


def _classification_backoff_seconds(attempt: int) -> float:
    return 0.4 * (2**attempt)


class AIService:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def classify_triage_email(
        self,
        sender: str,
        subject: str,
        body: str,
        triage_label_dicts: list[dict],
        default_label_id: str,
    ) -> str:
        """Binary classifier: picks exactly one of two Gmail label ids; JSON response.

        Each dict must have keys id, name, optional description.
        Always returns either a valid chosen id or `default_label_id` after exhaustive failure.
        """
        if len(triage_label_dicts) != 2:
            raise ValueError("classify_triage_email requires exactly two label dicts")
        valid_ids = {d["id"] for d in triage_label_dicts}
        if default_label_id not in valid_ids:
            raise ValueError("default_label_id must be one of the triage label ids")

        label_lines = []
        for lbl in triage_label_dicts:
            line = f"- {lbl['name']} (ID: {lbl['id']})"
            if lbl.get("description"):
                line += f" — context: {lbl['description']}"
            label_lines.append(line)
        label_list = "\n".join(label_lines)

        system_prompt = (
            "You classify inbox email into exactly ONE of two Gmail labels listed below.\n"
            "You MUST choose exactly one label ID below. Respond with ONLY a JSON object of the "
            'form {"label_id":"<chosen_id>"} with no markdown and no explanation.\n\n'
            f"Allowed label IDs:\n{label_list}"
        )

        user_prompt = f"From: {sender}\nSubject: {subject}\n\nBody:\n{body[:2000]}"

        last_exc: BaseException | None = None
        for attempt in range(3):
            try:
                resp = httpx.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "gpt-4o-mini",
                        "temperature": 0,
                        "max_tokens": 128,
                        "response_format": {"type": "json_object"},
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt},
                        ],
                    },
                    timeout=45,
                )
                resp.raise_for_status()
                result = resp.json()
                raw = result["choices"][0]["message"]["content"].strip()
                data = json.loads(raw)
                lid = data.get("label_id")
                if isinstance(lid, str) and lid in valid_ids:
                    return lid

                log.warning(
                    "AI triage returned invalid label_id attempt=%s value=%s raw=%s",
                    attempt + 1,
                    lid,
                    raw[:500],
                )
            except Exception as exc:
                last_exc = exc
                log.warning("AI triage attempt %s failed: %s", attempt + 1, exc)
            if attempt < 2:
                time.sleep(_classification_backoff_seconds(attempt))

        log.error(
            "AI triage exhausted retries; using default_label_id=%s last_error=%s",
            default_label_id,
            last_exc,
        )
        return default_label_id
