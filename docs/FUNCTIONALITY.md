# Gmail Manager — Functionality & Technical Reference

## What It Is

A single-user web application for managing a Gmail account through the Gmail API. It provides automated email organization via rules, AI-powered classification, category-based retention policies, per-label retention, bulk cleanup operations, and a restore/rollback safety net — all controlled through a web UI.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Backend** | FastAPI (Python 3.12) | REST API framework |
| **ORM** | SQLAlchemy 2.0 (mapped_column style) | Database models & queries |
| **Database** | PostgreSQL 16 | Persistent storage |
| **Migrations** | Alembic | Schema versioning |
| **Auth** | Google OAuth 2.0 + PyJWT | Authentication & token management |
| **HTTP Client** | httpx | Gmail REST API calls (no google-api-python-client) |
| **Frontend** | React 18 + TypeScript | Single-page application |
| **Styling** | Tailwind CSS 4 | Utility-first CSS |
| **Build** | Vite | Frontend bundler with HMR |
| **Routing** | React Router v6 | Client-side navigation |
| **Deployment** | Docker Compose | Three containers: api + frontend + postgres |
| **Reverse Proxy** | Nginx | Serves frontend, proxies API |

### Why These Choices

- **httpx over google-api-python-client**: Lighter weight, full control over request/response cycle, simpler error handling. The Gmail REST API is straightforward enough that a dedicated SDK adds complexity without proportional value.
- **SQLAlchemy 2.0 mapped_column**: Type-safe column definitions with `Mapped[T]` annotations. Better IDE support and catches schema mismatches at development time.
- **Pydantic BaseSettings**: Environment variables validated and typed at startup. Single source of truth for configuration.
- **Docker-only development**: No host-level Python/Node dependencies. `make dev-build` gets a new developer running in one command.

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌───────────────┐
│   Browser        │────▶│   Nginx (3003)   │────▶│  Vite/React   │
│                  │     │                  │     │  Frontend     │
└─────────────────┘     └────────┬─────────┘     └───────────────┘
                                 │ /api/*
                                 ▼
                        ┌─────────────────┐     ┌───────────────┐
                        │  FastAPI (8000)  │────▶│  PostgreSQL   │
                        │  + Poller Thread │     │  (5432)       │
                        └────────┬─────────┘     └───────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Gmail REST API  │
                        └─────────────────┘
```

### Authentication Flow

1. User clicks "Connect Google" → redirected to Google OAuth consent screen
2. Google redirects back with authorization code → `/api/auth/google/callback`
3. Backend exchanges code for access + refresh tokens, stores them in DB
4. Backend issues a JWT, sets it as an HttpOnly cookie (`gmail_auth`)
5. All subsequent API calls include the cookie; `require_jwt_user` dependency validates it
6. `GOOGLE_ALLOWED_EMAIL` env var restricts access to a single Google account

### Single-User Design

This is intentionally a single-user app. There is no user registration — the app is locked to one Google account via `GOOGLE_ALLOWED_EMAIL`. This simplifies the security model: if the JWT is valid and the user row exists, access is granted.

---

## Database Models

### User
The central entity. Stores Google OAuth tokens, AI settings, polling configuration, and the Gmail History API cursor (`last_history_id`).

### Label
Mirrors Gmail labels (both system and user-created). Synced from Gmail via `/api/labels/sync`. Each label stores message/unread counts, optional color, an AI description for classification context, and an optional `retention_days` for automatic cleanup.

### Rule
Defines an automated email processing rule with match criteria, scope, and actions. Rules have a priority order and track execution statistics.

### SystemLabelRetention
Per-category (Promotions, Social, Updates, Forums) retention policies. Emails in a category older than `retention_days` are automatically trashed — unless they have a user label applied.

### CleanupJob
Records of manual bulk operations (delete, archive, mark read) with progress tracking.

### AuditLog
Tracks significant actions for debugging and accountability.

---

## Features

### 1. Rules Engine

Rules automate email processing. Each rule has:

**Match Criteria** (all optional, combined with AND):
- `match_from` — sender email/domain substring match
- `match_to` — recipient substring match
- `match_subject` — subject substring match
- `match_has_words` — body/subject keyword match
- `match_doesnt_have` — exclusion keywords
- `match_label_id` — require a specific Gmail label

**Scope** (which inbox emails the rule applies to):
- `"primary"` (default) — only Primary inbox (excludes Promotions, Social, Updates, Forums)
- `"all_inbox"` — all emails in the inbox regardless of category

**Actions** (applied when a rule matches):
- Apply a user label
- Archive (remove INBOX label)
- Delete (trash)
- Mark as read (remove UNREAD label)

**How rules execute:**
- **On new mail (poller)**: Rules run in priority order against each new message. First match wins — subsequent rules are skipped.
- **Manual run**: "Run" button on a rule executes it against all current matches via Gmail search API. Paginates through all results.
- **Preview**: Shows estimated match count and sample subjects before committing.
- **Exclude action label**: When building the search query, the rule's own action label is excluded (`-label:X`) to prevent re-processing already-labeled emails.

#### Scope Decision

**Previous design**: 5 boolean checkboxes (`scope_promotions`, `scope_social`, `scope_updates`, `scope_forums`, `scope_all_inbox`). This was confusing — users could create nonsensical combinations, and the "no checkboxes = Primary" convention was non-obvious.

**Current design**: Single `scope` field with two values. This maps directly to the two real use cases:
- "I want this rule to only process Primary inbox emails" → `"primary"`
- "I want this rule to process everything in my inbox" → `"all_inbox"`

The UI uses two radio buttons instead of five checkboxes.

### 2. Background Poller

A daemon thread (`threading.Timer`) that runs every 60 seconds. For each user with `polling_enabled=True`:

1. **Delta sync via History API**: Fetches new messages since `last_history_id`. Paginates through all history pages before processing. Handles expired history IDs (404) by resetting the cursor.
2. **Rule processing**: Applies enabled rules in priority order to each new message.
3. **AI classification**: If no rule matched and AI is enabled, classifies Primary inbox emails using the configured AI provider.
4. **Inbox removal sweep**: If `auto_remove_inbox_labeled_read` is enabled, removes INBOX label from read emails that have any user label. This effectively archives classified emails.
5. **System label retention cleanup**: Trashes category emails older than the configured retention period.
6. **Per-label retention cleanup**: Trashes emails with specific user labels older than that label's retention period.
7. **History cursor update**: Only updates `last_history_id` after all processing succeeds.

**Error handling**: A Gmail 401 automatically disables polling for that user and logs a warning. The user must reconnect Google and re-enable polling.

### 3. Inbox Removal Sweep

Automatically archives (removes INBOX label from) emails that are:
- Read (`is:read`)
- In the inbox (`in:inbox`)
- Have at least one user label applied

**Design decision**: The sweep applies to ALL categories, not just Primary. A labeled email in Promotions that has been read should be archived the same as one in Primary. The previous implementation excluded non-Primary categories, which meant labeled+read emails in Promotions/Social/Updates/Forums were never auto-archived.

### 4. System Label Retention (Category Cleanup)

Each Gmail category (Promotions, Social, Updates, Forums) can have a retention period. Emails in a category older than the cutoff are automatically trashed.

**Key optimization**: The Gmail search query includes `-has:userlabels`, which tells Gmail to only return messages without any user-applied labels. This means:
- A promotional email with a user label (e.g., "Newsletters") is protected from retention cleanup
- No per-message metadata fetch is needed — the previous implementation fetched each message individually to check for user labels, which was an N+1 API call problem

**Previous implementation**: Fetched all messages matching `label:{category} before:{cutoff}`, then for each message, called `get_message(fmt="metadata")` to check if it had user labels. This was O(N) Gmail API calls per retention check.

**Current implementation**: Single query `label:{category} before:{cutoff} -has:userlabels` returns only trashable messages. Direct batch trash, no per-message calls.

### 5. Per-Label Retention (New Feature)

Each user label can optionally have a `retention_days` value:
- `null` (default) — emails with this label are retained forever
- A positive integer — emails with this label older than N days are automatically trashed

This replaces the unused `action_delete_after_days` field that was on the Rule model. The per-label approach is more intuitive: retention is a property of the label, not the rule that applied it.

**Implementation**: `_run_label_retention_cleanup()` queries all user labels with `retention_days IS NOT NULL`, builds a Gmail search for each (`label:{name} before:{cutoff}`), and batch-trashes results.

**UI**: The Labels page shows a "Retention" column. In edit mode, a number input allows setting days (or leaving empty for "Always").

### 6. AI Classification

When a new Primary inbox email doesn't match any rule, and AI is enabled:
1. The email's from/subject/body are sent to the configured AI provider
2. The AI picks the best-matching user label from the available labels (using `ai_description` for context)
3. The label is applied to the email

AI classification only runs on Primary inbox emails to avoid interfering with Gmail's own category classification.

### 7. Bulk Cleanup

Manual one-off operations against a set of emails filtered by label and date range:
- **Delete** — trash matching emails
- **Archive** — remove INBOX label
- **Mark Read** — remove UNREAD label

Jobs are recorded with progress tracking. Preview available before execution.

### 8. Retroactive Classification

Apply current rules (and optionally AI) to historical Primary inbox emails within a date range. Capped at 50 messages per run to prevent API quota exhaustion.

### 9. Restore & Rollback

Safety net for bulk operations:
- **Restore**: Finds emails matching a query (default: `in:trash is:read`) and moves them back to inbox
- **Rollback**: Reverses a specific restore operation using a saved manifest
- **Manifests**: JSON files recording every restore operation — which messages were moved, timestamps, and rollback status. Scoped to the authenticated user.

---

## Frontend Pages

| Page | Route | Purpose |
|------|-------|---------|
| Login | `/` | Google OAuth connection |
| Dashboard | `/dashboard` | Overview and status |
| Labels | `/labels` | View/create/edit/delete Gmail labels, set retention |
| Rules | `/rules` | Create/edit/run/reorder rules |
| Cleanup | `/cleanup` | Manual bulk operations with preview |
| AI | `/ai` | AI classification settings and retroactive runs |
| Restore | `/restore` | Restore trashed emails, rollback operations |
| Settings | `/settings` | Polling, AI provider, inbox sweep toggle, category retention |

### Frontend Patterns

- **Centralized API client** (`lib/api.ts`): All fetch calls go through typed helper functions with `credentials: "include"` for cookie auth. 401 responses redirect to login.
- **Optimistic loading**: Pages load data on mount, show spinners, catch errors silently.
- **Drag-and-drop reordering**: Rules can be reordered by dragging. Priority is persisted via `PUT /api/rules/reorder`.

---

## Key Design Decisions

### Gmail Categories Are Metadata, Not Folders
Categories (Promotions, Social, Updates, Forums) are persistent metadata on a message. "Primary" is the absence of any category — it's not a label you can query for directly. This understanding drives the scope and retention logic:
- Primary scope: `in:inbox -category:promotions -category:social -category:updates -category:forums`
- All inbox scope: `in:inbox`

### Archiving = Removing INBOX Label
Archiving in Gmail means removing the `INBOX` label. The email remains in All Mail and any other labels. This is a non-destructive operation.

### Labels Protect from Retention
If a user has taken the time to label an email, it should be protected from automated category-based retention cleanup. The `-has:userlabels` query operator handles this at the Gmail API level.

### First-Match-Wins Rule Execution
During polling, rules execute in priority order and stop at the first match. This prevents conflicting actions and gives the user clear control over precedence.

### Removed: `action_delete_after_days`
This field existed on the Rule model but was never implemented in the poller. Its intended purpose — "delete emails N days after a rule labels them" — is now better served by per-label retention (`Label.retention_days`). The label-based approach is more intuitive and doesn't require tracking when a rule was applied.

---

## Development

```bash
make dev-build          # Start everything with hot reload
make dev-logs           # Tail all container logs
make dev-shell          # Shell into API container
make migrate            # Apply pending Alembic migrations
make migrate-create MSG='description'  # Generate new migration
```

### Testing

```bash
# Rebuild container (tests aren't volume-mounted)
make dev-build

# Install pytest and run
docker compose -f docker-compose.dev.yml exec api pip install pytest -q
docker compose -f docker-compose.dev.yml exec api python -m pytest tests/ -v
```

Tests use in-memory SQLite and monkeypatch external services. Key test coverage:
- Auth: disconnect clears tokens, exchange reuses existing user by email
- Poller: 401 disables polling, skips disconnected users, history pagination, retention cleanup
- Rules: pagination, action label exclusion, preview counting
- Retention: `-has:userlabels` query filter, per-label retention cleanup

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client secret |
| `GOOGLE_ALLOWED_EMAIL` | Single Google account allowed to authenticate |
| `APP_SECRET_KEY` | Application secret for JWT signing |
| `POSTGRES_*` | Database connection settings |
| `LOG_LEVEL` | Logging verbosity (default: INFO) |
| `BACKEND_PORT` | API port (default: 8003) |
| `FRONTEND_PORT` | Frontend port (default: 3003) |
