import { useState, type FormEvent } from "react";
import {
  fetchInboxInspector,
  GmailCategoryTab,
  InboxInspectorResult,
} from "../lib/api";

const CATEGORY_OPTIONS: { value: GmailCategoryTab; label: string }[] = [
  { value: "promotions", label: "Promotions" },
  { value: "social", label: "Social" },
  { value: "updates", label: "Updates" },
  { value: "forums", label: "Forums" },
];

type GmailFullMessage = {
  id?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: { headers?: { name: string; value: string }[] };
};

function headerValue(msg: GmailFullMessage, headerName: string): string {
  const headers = msg.payload?.headers;
  if (!headers?.length) return "";
  const want = headerName.toLowerCase();
  const row = headers.find((h) => h.name.toLowerCase() === want);
  return (row?.value ?? "").trim();
}

/** Local calendar date for `<input type="date">` (avoid UTC drift from toISOString). */
function localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayISODate(): string {
  return localISODate(new Date());
}

function weekAgoISODate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return localISODate(d);
}

export function InboxInspectorPage() {
  const [dateFrom, setDateFrom] = useState(weekAgoISODate);
  const [dateTo, setDateTo] = useState(todayISODate);
  const [maxMessages, setMaxMessages] = useState(25);
  const [primaryOnly, setPrimaryOnly] = useState(false);
  const [importantOnly, setImportantOnly] = useState(false);
  const [includeCategories, setIncludeCategories] = useState<GmailCategoryTab[]>([]);
  const [excludeCategories, setExcludeCategories] = useState<GmailCategoryTab[]>([]);
  const [customGmailQ, setCustomGmailQ] = useState("");
  const [mergeDatesWithCustom, setMergeDatesWithCustom] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InboxInspectorResult | null>(null);

  const toggleInclude = (value: GmailCategoryTab) => {
    setIncludeCategories((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    );
  };

  const toggleExclude = (value: GmailCategoryTab) => {
    setExcludeCategories((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    );
  };

  const usingCustomQuery = customGmailQ.trim().length > 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchInboxInspector({
        date_from: dateFrom,
        date_to: dateTo,
        max_messages: maxMessages,
        ...(usingCustomQuery
          ? {
              custom_gmail_q: customGmailQ.trim(),
              merge_date_range_with_custom: mergeDatesWithCustom,
            }
          : {
              primary_only: primaryOnly,
              important_only: importantOnly,
              include_categories: includeCategories.length ? includeCategories : undefined,
              exclude_categories: excludeCategories.length ? excludeCategories : undefined,
            }),
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong className="font-semibold">Temporary debug tool.</strong> Fetches full Gmail API payloads using
        either the built-in filters or a <strong>custom Gmail search</strong> string. Default mode uses{" "}
        <code className="rounded bg-amber-100 px-1">in:inbox</code> plus your date range. Leave category filters
        off to search the full inbox (all tabs). <strong>Important only</strong> adds{" "}
        <code className="rounded bg-amber-100 px-1">is:important</code> (inbox + Priority Inbox important). Each
        row shows whether the thread has the <code className="rounded bg-amber-100 px-1">IMPORTANT</code> system
        label. <strong>Primary only</strong> applies the same{" "}
        <code className="rounded bg-amber-100 px-1">-category:</code> rules as the Rules &quot;primary&quot;
        scope. Include = must be in at least one selected tab (OR). Exclude = must not be in that tab.
      </div>

      <div>
        <h1 className="text-xl font-semibold text-google-text">Inbox inspector</h1>
        <p className="mt-1 text-sm text-google-text-secondary">
          Dates use your <strong>local</strong> calendar. &quot;Through&quot; includes that full day; the API
          translates to Gmail&apos;s <code className="rounded bg-gray-100 px-1 text-google-text">after:</code> /{" "}
          <code className="rounded bg-gray-100 px-1 text-google-text">before:</code> using{" "}
          <code className="rounded bg-gray-100 px-1 text-google-text">yyyy/mm/dd</code> as Gmail expects.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-lg border border-google-border bg-white p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-google-text">From (inclusive)</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(ev) => setDateFrom(ev.target.value)}
              className="rounded-md border border-google-border px-3 py-2 text-google-text"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-google-text">Through (inclusive)</span>
            <input
              type="date"
              value={dateTo}
              onChange={(ev) => setDateTo(ev.target.value)}
              className="rounded-md border border-google-border px-3 py-2 text-google-text"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-google-text">Max messages</span>
            <input
              type="number"
              min={1}
              max={100}
              value={maxMessages}
              onChange={(ev) => setMaxMessages(Number(ev.target.value) || 1)}
              className="w-28 rounded-md border border-google-border px-3 py-2 text-google-text"
              required
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-google-blue px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Fetch"}
          </button>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-google-text">Custom Gmail search (optional)</label>
          <textarea
            value={customGmailQ}
            onChange={(ev) => setCustomGmailQ(ev.target.value)}
            rows={3}
            placeholder={`e.g. label:INBOX -category:{promotions social updates}`}
            className="w-full rounded-md border border-google-border px-3 py-2 font-mono text-sm text-google-text placeholder:text-google-text-tertiary"
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-google-text">
            <input
              type="checkbox"
              checked={mergeDatesWithCustom}
              onChange={(ev) => setMergeDatesWithCustom(ev.target.checked)}
              disabled={!usingCustomQuery}
              className="rounded border-google-border disabled:opacity-50"
            />
            <span>
              Append <strong>From</strong> / <strong>Through</strong> dates to the custom query (
              <code className="rounded bg-gray-100 px-1 text-xs">after:</code> /{" "}
              <code className="rounded bg-gray-100 px-1 text-xs">before:</code> in{" "}
              <code className="rounded bg-gray-100 px-1 text-xs">yyyy/mm/dd</code>)
            </span>
          </label>
          <p className="text-xs text-google-text-secondary">
            When this box has text, it is sent verbatim to Gmail as <code className="rounded bg-gray-100 px-1">q</code>.
            Uncheck &quot;Append dates&quot; if your query already includes{" "}
            <code className="rounded bg-gray-100 px-1">after:</code>/
            <code className="rounded bg-gray-100 px-1">before:</code>.
          </p>
        </div>

        {usingCustomQuery && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Custom search is active — primary, important, and category filters below are ignored.
          </p>
        )}

        <div
          className={`space-y-4 ${usingCustomQuery ? "pointer-events-none opacity-45" : ""}`}
          aria-disabled={usingCustomQuery}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-google-text">
              <input
                type="checkbox"
                checked={primaryOnly}
                onChange={(ev) => setPrimaryOnly(ev.target.checked)}
                className="rounded border-google-border"
              />
              <span className="font-medium">Primary only</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-google-text">
              <input
                type="checkbox"
                checked={importantOnly}
                onChange={(ev) => setImportantOnly(ev.target.checked)}
                className="rounded border-google-border"
              />
              <span className="font-medium">Important only</span>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="rounded-md border border-google-border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-google-text-secondary">
              Include categories (OR)
            </legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {CATEGORY_OPTIONS.map(({ value, label }) => (
                <label key={`inc-${value}`} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeCategories.includes(value)}
                    onChange={() => toggleInclude(value)}
                    className="rounded border-google-border"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="rounded-md border border-google-border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-google-text-secondary">
              Exclude categories
            </legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {CATEGORY_OPTIONS.map(({ value, label }) => (
                <label key={`exc-${value}`} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={excludeCategories.includes(value)}
                    onChange={() => toggleExclude(value)}
                    className="rounded border-google-border"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        </div>
      </form>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="rounded-lg border border-google-border bg-white p-4 text-sm shadow-sm">
            <p className="font-medium text-google-text">Query</p>
            <pre className="mt-2 overflow-x-auto rounded bg-gray-50 p-3 text-google-text-secondary">{result.gmail_query}</pre>
            <p className="mt-3 text-google-text-secondary">
              Fetched <strong className="text-google-text">{result.fetched_count}</strong> message(s).
            </p>
          </div>

          <ul className="space-y-3">
            {result.messages.map((raw, idx) => {
              const msg = raw as GmailFullMessage;
              const id = msg.id ?? `row-${idx}`;
              const labelIds = msg.labelIds ?? [];
              const hasInbox = labelIds.includes("INBOX");
              const hasImportant = labelIds.includes("IMPORTANT");
              const resolved = labelIds.map((lid) => `${lid} (${result.label_map[lid] ?? "?"})`);
              const from = headerValue(msg, "From") || "(unknown sender)";
              const subject = headerValue(msg, "Subject") || "(no subject)";
              return (
                <li key={id} className="rounded-lg border border-google-border bg-white shadow-sm">
                  <details className="group">
                    <summary className="cursor-pointer list-none px-4 py-3">
                      <p className="text-base font-medium leading-snug text-google-text line-clamp-2">{subject}</p>
                      <p className="mt-1 text-sm text-google-text-secondary line-clamp-2" title={from}>
                        <span className="font-medium text-google-text-tertiary">From</span> {from}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        <span className="truncate font-mono text-xs text-google-text-secondary" title={id}>
                          {id}
                        </span>
                        <span
                          className={
                            hasInbox
                              ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                              : "rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700"
                          }
                        >
                          INBOX: {hasInbox ? "yes" : "no"}
                        </span>
                        <span
                          className={
                            hasImportant
                              ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
                              : "rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700"
                          }
                        >
                          IMPORTANT: {hasImportant ? "yes" : "no"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-google-text-secondary">{resolved.join(", ") || "No labels"}</p>
                    </summary>
                    <div className="border-t border-google-border p-3">
                      <pre className="max-h-[32rem] overflow-auto rounded bg-gray-50 p-3 text-xs text-google-text-secondary">
                        {JSON.stringify(msg, null, 2)}
                      </pre>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
