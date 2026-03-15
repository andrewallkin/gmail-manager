# Plan: Multi-value Rule Conditions + Enhanced Cleanup

## Context
Rules currently support only single values per match field (one sender, one subject, etc.). The user needs to match multiple senders or subjects with OR logic within a field, while keeping AND logic between fields. Additionally, the cleanup feature needs sender/subject filters and a full message preview (showing every matching email) before trashing.

---

## Feature 1: Multi-value OR Logic in Rules

No schema/migration needed — fields are already strings.

### Step 1: Shared utility — `backend/app/services/query_utils.py` (new)

Two functions reused by both rule engine and cleanup:
- `split_comma_values(value: str) -> list[str]` — split on commas, strip whitespace, remove empties
- `build_or_term(operator: str, value: str) -> str` — single value: `from:alice@example.com`, multiple: `from:(alice@example.com OR bob@example.com)`

### Step 2: Update `build_rule_query()` — `backend/app/services/rule_engine.py:25-55`

Replace direct `f"from:{rule.match_from}"` (lines 30, 32, 34) with `build_or_term("from", rule.match_from)` for `match_from`, `match_to`, `match_subject`.

### Step 3: Update `message_matches_rule()` — `backend/app/services/rule_engine.py:103-138`

Replace single-value checks (lines 110-112) with multi-value OR:
```python
if rule.match_from:
    values = split_comma_values(rule.match_from)
    if not any(v.lower() in sender for v in values):
        return False
```
Same pattern for `match_subject` (line 112).

### Step 4: Update frontend placeholders — `frontend/src/pages/RulesPage.tsx`

- Update From/To/Subject input placeholders to show comma-separated examples
- Add helper text: `"Separate multiple values with commas (OR logic)"`

---

## Feature 2: Enhanced Cleanup with Sender/Subject Filters + Full Preview

### Step 5: Add model columns — `backend/app/models.py`

Add to `CleanupJob` class:
```python
sender_filter: Mapped[str | None] = mapped_column(String(255), nullable=True)
subject_filter: Mapped[str | None] = mapped_column(String(255), nullable=True)
```

### Step 6: Generate migration

`make migrate-create MSG='add_sender_subject_filter_to_cleanup_jobs'` then `make migrate`.

### Step 7: Add `get_message_metadata()` — `backend/app/services/gmail_service.py`

New method on `GmailService` that fetches message with `format=metadata` and `metadataHeaders` param (From, Subject, Date). Much lighter than full message fetch.

### Step 8: Update cleanup router — `backend/app/routers/cleanup.py`

**8a. Update schemas:**
- `CleanupCreate`: add `sender_filter: str | None = None`, `subject_filter: str | None = None`
- `CleanupOut`: add same two fields
- `PreviewRequest`: add same two fields

**8b. New response schemas:**
```python
class PreviewMessageSummary(BaseModel):
    message_id: str
    sender: str
    subject: str
    date: str

class PreviewResponse(BaseModel):
    total_count: int
    messages: list[PreviewMessageSummary]
```

**8c. Update `_build_cleanup_query()`** (line 56): accept `sender_filter` and `subject_filter` params, use `build_or_term()` from query_utils.

**8d. Rewrite `preview_cleanup` endpoint** (line 67):
1. Build query with all filters
2. Paginate through ALL matching message IDs
3. Fetch metadata (From/Subject/Date headers) for each message, cap at 500 detail fetches
4. Return `PreviewResponse` with `total_count` (true total) and `messages` (up to 500 summaries)

**8e. Update `start_cleanup`** (line 196): pass new fields to `CleanupJob` constructor and `_build_cleanup_query()`.

### Step 9: Update frontend types — `frontend/src/lib/api.ts`

- Add `sender_filter` and `subject_filter` to `CleanupItem` type
- Add `PreviewMessageSummary` and `CleanupPreviewResult` types
- Update `previewCleanup` return type and `startCleanup` body type

### Step 10: Update CleanupPage — `frontend/src/pages/CleanupPage.tsx`

**10a. New state:** `senderFilter`, `subjectFilter`, `previewMessages[]`, `previewTotal`

**10b. New form inputs:** Sender Filter and Subject Filter text fields with comma-separated helper text, placed above the date range inputs.

**10c. Preview display:** Replace the yellow count-only banner with:
- Count header: "X message(s) match your criteria" (+ "Showing first 500" if truncated)
- Scrollable table (`max-h-96 overflow-y-auto`) with columns: Sender, Subject, Date
- Each row shows the message details from the preview response

**10d. Update handlers:** Pass `sender_filter`/`subject_filter` to API calls, reset on success.

**10e. History table:** Add Sender/Subject columns to show filters used in past jobs.

---

## Files to modify

| File | Changes |
|------|---------|
| `backend/app/services/query_utils.py` | **NEW** — shared `split_comma_values`, `build_or_term` |
| `backend/app/services/rule_engine.py` | Use `build_or_term` in `build_rule_query`, multi-value OR in `message_matches_rule` |
| `backend/app/models.py` | Add `sender_filter`, `subject_filter` to `CleanupJob` |
| `backend/app/services/gmail_service.py` | Add `get_message_metadata()` method |
| `backend/app/routers/cleanup.py` | Update schemas, query builder, preview endpoint, start_cleanup |
| `frontend/src/lib/api.ts` | New types, updated function signatures |
| `frontend/src/pages/RulesPage.tsx` | Placeholder/helper text updates |
| `frontend/src/pages/CleanupPage.tsx` | New filter inputs, full message preview table |

---

## Implementation order

1. Step 1 (query_utils) — no dependencies
2. Steps 2-4 (Feature 1) — depends on Step 1
3. Steps 5-6 (model + migration) — independent
4. Step 7 (gmail_service) — independent
5. Steps 8-10 (cleanup backend + frontend) — depends on Steps 1, 5-7

Steps 2-4 and Steps 5-7 can be done in parallel.

---

## Verification

1. **Feature 1 — Rules OR logic:**
   - Create a rule with `match_from = "alice@example.com, bob@example.com"`
   - Preview should show Gmail query: `from:(alice@example.com OR bob@example.com)`
   - Run rule manually — should match emails from either sender
   - Verify poller still applies first-match-wins with the new OR matching

2. **Feature 2 — Enhanced cleanup:**
   - Enter a sender filter (e.g., `noreply@example.com`) and click Preview
   - Verify the preview table shows all matching emails with sender, subject, date
   - Verify the total count is accurate
   - Click Start Cleanup and confirm messages are trashed
   - Check cleanup history shows the sender/subject filters used
   - Test comma-separated sender filter (OR logic)

3. **Run existing tests:** `docker compose run --rm api pytest tests/`
