# Plan: OAuth re-consent tracking & proactive reminder email

## Context

- With the Google OAuth app in **Testing** mode, refresh tokens for test users **stop working after 7 days** unless the user completes a new consent flow.
- **Access-token refresh** (`grant_type=refresh_token` in `GoogleService.ensure_fresh_token`) only swaps short-lived access tokens; it does **not** reset Google’s 7-day testing window. The clock you care about is tied to **when the user last completed full OAuth** (authorization code exchange on `/api/auth/google/callback`), not to each hourly refresh.

This plan describes DB fields, how to “monitor” them (including manual checks), a scheduled reminder, and which OAuth scopes apply—including how that relates to “send mail.”

---

## 1. What to store in the database

| Column (proposed) | Type | Purpose |
|-------------------|------|--------|
| `google_oauth_consent_at` | `timestamp with time zone`, nullable | Set **only** when `exchange_code_for_token` succeeds (full OAuth callback). This is the anchor for the 7-day testing deadline. |
| `google_oauth_reminder_sent_at` | `timestamp with time zone`, nullable | Last time a **proactive** “reconnect soon” email was sent for the current consent cycle. Reset to `NULL` when `google_oauth_consent_at` updates (new consent). |

Optional but useful:

| Column (optional) | Purpose |
|-------------------|--------|
| `google_oauth_reminder_due_after` | Generated in app code as `google_oauth_consent_at + 7 days` (no need to persist if you always derive). Persist only if you want raw SQL reports without app logic. |

**Manual monitoring in DB**

- **“When did the user last redo OAuth?”** → `SELECT google_oauth_consent_at, email FROM users;`
- **“Are we inside the 7-day window?”** → compare `google_oauth_consent_at + interval '7 days'` to `now()` (UTC).
- **“Did we already nag them this cycle?”** → `google_oauth_reminder_sent_at IS NOT NULL AND google_oauth_reminder_sent_at >= google_oauth_consent_at`.

Do **not** use `token_expiry` for the 7-day rule: that field reflects **access token** lifetime (~1 hour), updated on refresh—see `backend/app/services/google_service.py`.

**Implementation touchpoints**

- Set `google_oauth_consent_at = now(UTC)` in `GoogleService.exchange_code_for_token` after a successful commit (same place you clear `google_auth_broken`).
- Clear or update `google_oauth_reminder_sent_at` when consent changes (e.g. set to `NULL` whenever `google_oauth_consent_at` advances).

---

## 2. Reminder policy (email before expiry)

**Goal:** Send **one** reminder email when the user is ~**1 day** before the end of the 7-day testing period (i.e. when `now` is about **6 days** after `google_oauth_consent_at`), even though the current access token may still work.

Suggested rule (UTC):

- Let `due = google_oauth_consent_at + 7 days`.
- Send when: `due - now` is between **24h and 48h** (tune the window to your job cadence: e.g. daily cron uses a 24h–36h band so each user matches once).

**Deduping**

- After sending, set `google_oauth_reminder_sent_at = now()`.
- Skip if `google_oauth_reminder_sent_at` is already `>= google_oauth_consent_at` (already reminded this cycle).
- Skip if `google_auth_broken` is already true (optional: send a different “broken” template instead—out of scope here).

**Link in the email**

- Prefer a **stable URL on your app** (e.g. `{frontend_base_url}/` or a dedicated `/settings` route) that surfaces a **Reconnect Google** button pointing at `GET /api/auth/google/connect` (see `backend/app/routers/auth.py` + `GoogleService.auth_url()`).
- Avoid embedding the raw Google URL in email if a shorter first-party URL is available (reduces phishing concerns and broken long links).

---

## 3. How to send the email (and “sendmail” / Gmail scopes)

**Recommended:** Use a **transactional provider** (SMTP, SendGrid, Resend, SES, Postmark, etc.) with an API key or SMTP credentials **not** tied to the user’s Gmail OAuth. Reminder emails are **system mail**, not “send on behalf of user via Gmail API.”

**If you instead send the reminder through the Gmail API as the user**, you would need an appropriate Gmail scope. Today the app defaults in `backend/app/config.py` are:

| Scope | Role in this app |
|-------|------------------|
| `openid` | OpenID Connect |
| `email` | User email in tokens/profile |
| `profile` | Basic profile |
| `https://www.googleapis.com/auth/gmail.modify` | Read, modify labels, trash, etc.; per Google’s scope list, includes compose/send flows tied to mailbox operations the app performs |
| `https://www.googleapis.com/auth/gmail.labels` | Manage labels |

**Narrow “send only” scope (if you add Gmail API send later):**

- `https://www.googleapis.com/auth/gmail.send` — send email only (often combined with verification if marked sensitive/restricted).

**Practical note:** `gmail.modify` is already broad. For **notification** emails, external transactional email avoids coupling reminders to the user’s OAuth health (if the refresh is about to die, Gmail API send might fail too). Document in the reminder email **which scopes the app requests** so the user knows what the reconnect screen will ask for—mirror whatever is in `GOOGLE_SCOPES` / `Settings.google_scopes`.

---

## 4. Scheduler / worker

- Add a periodic job (cron, Celery, `APScheduler`, or a loop in an existing worker) running at least **daily**, ideally **hourly** for tighter windows.
- Pseudocode:

```text
for each user where google_oauth_consent_at is not null and refresh_token is not null:
  due = google_oauth_consent_at + 7 days
  if now in [due - 2d, due - 1d] (tune window) and reminder not sent this cycle:
    send email with reconnect link + scope summary
    set google_oauth_reminder_sent_at = now()
```

- Log failures; retry with backoff; do not block OAuth paths on email delivery.

---

## 5. Testing checklist

- New consent updates `google_oauth_consent_at` and clears the reminder flag for the new cycle.
- Reminder fires once per cycle when simulated clock crosses the window.
- No reminder if consent was just done (edge cases near boundaries).
- Email contains correct `public_base_url` / `frontend_base_url` and matches deployed routes.

---

## 6. Future: production OAuth app

Publishing the OAuth app to **Production** (and completing verification if required) removes the forced **7-day** refresh-token limitation for typical users. Until then, this DB-backed reminder remains aligned with Google Testing behavior.
