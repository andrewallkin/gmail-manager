import logging

import httpx

log = logging.getLogger("ai")


class AIService:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def classify_email(
        self,
        sender: str,
        subject: str,
        body: str,
        available_labels: list[dict],
    ) -> str | None:
        """Classify an email into one of the available labels using OpenAI gpt-4o-mini.

        available_labels: list of {"id": gmail_label_id, "name": label_name}
        Returns gmail_label_id or None if no match.
        """
        label_list = "\n".join(f"- {l['name']} (ID: {l['id']})" for l in available_labels)
        valid_ids = {l["id"] for l in available_labels}

        system_prompt = (
            "You are an email classifier. Given an email's sender, subject, and body, "
            "determine which label best fits this email.\n\n"
            f"Available labels:\n{label_list}\n\n"
            "Respond with ONLY the label ID (e.g., Label_123) or NONE if no label fits. "
            "Do not include any other text."
        )

        user_prompt = f"From: {sender}\nSubject: {subject}\n\nBody:\n{body[:2000]}"

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
                    "max_tokens": 50,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                },
                timeout=30,
            )
            resp.raise_for_status()
            result = resp.json()
            answer = result["choices"][0]["message"]["content"].strip()

            if answer.upper() == "NONE":
                return None
            if answer in valid_ids:
                return answer

            log.warning("AI returned invalid label ID: %s", answer)
            return None

        except Exception as exc:
            log.error("AI classification failed: %s", exc)
            return None
