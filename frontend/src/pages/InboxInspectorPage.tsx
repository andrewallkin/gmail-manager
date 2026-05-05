import { useState, type FormEvent } from "react";
import { fetchInboxInspector, InboxInspectorResult } from "../lib/api";

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function weekAgoISODate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

export function InboxInspectorPage() {
  const [dateFrom, setDateFrom] = useState(weekAgoISODate);
  const [dateTo, setDateTo] = useState(todayISODate);
  const [maxMessages, setMaxMessages] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InboxInspectorResult | null>(null);

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
        <strong className="font-semibold">Temporary debug tool.</strong> Fetches full Gmail API payloads
        for messages matching <code className="rounded bg-amber-100 px-1">in:inbox</code> plus your date
        range, with no category exclusions. Remove this page when you are done inspecting.
      </div>

      <div>
        <h1 className="text-xl font-semibold text-google-text">Inbox inspector</h1>
        <p className="mt-1 text-sm text-google-text-secondary">
          Gmail&apos;s <code className="rounded bg-gray-100 px-1 text-google-text">before:</code> date is
          exclusive (same as Cleanup preview).
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4 rounded-lg border border-google-border bg-white p-4 shadow-sm">
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
          <span className="font-medium text-google-text">To (exclusive)</span>
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
              const msg = raw as { id?: string; labelIds?: string[] };
              const id = msg.id ?? `row-${idx}`;
              const labelIds = msg.labelIds ?? [];
              const hasInbox = labelIds.includes("INBOX");
              const resolved = labelIds.map((lid) => `${lid} (${result.label_map[lid] ?? "?"})`);
              return (
                <li key={id} className="rounded-lg border border-google-border bg-white shadow-sm">
                  <details className="group">
                    <summary className="cursor-pointer list-none px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-mono text-google-text">{id}</span>
                        <span
                          className={
                            hasInbox
                              ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                              : "rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700"
                          }
                        >
                          INBOX: {hasInbox ? "yes" : "no"}
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
