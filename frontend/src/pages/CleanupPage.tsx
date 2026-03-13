import { useEffect, useState } from "react";
import { CleanupItem, fetchCleanups, startCleanup, previewCleanup, retroactiveClassification } from "../lib/api";
import { formatCleanupDateRange } from "../lib/format";

export function CleanupPage() {
  const [cleanups, setCleanups] = useState<CleanupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [labelFilter, setLabelFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [action, setAction] = useState("delete");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [successResult, setSuccessResult] = useState<CleanupItem | null>(null);

  // Retroactive state
  const [retroFrom, setRetroFrom] = useState("");
  const [retroTo, setRetroTo] = useState("");
  const [retroUseAi, setRetroUseAi] = useState(false);
  const [retroRunning, setRetroRunning] = useState(false);
  const [retroResult, setRetroResult] = useState<{
    total_processed: number;
    rule_matched: number;
    ai_classified: number;
    skipped_unread: number;
  } | null>(null);

  const load = () => {
    setLoading(true);
    fetchCleanups()
      .then(setCleanups)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const clearSuccessAndPreview = () => {
    setSuccessResult(null);
    setPreviewCount(null);
    setShowConfirm(false);
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setSuccessResult(null);
    try {
      const result = await previewCleanup({
        label_filter: labelFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setPreviewCount(result.estimated_count);
      setShowConfirm(true);
    } catch {} finally { setPreviewing(false); }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setShowConfirm(false);
    try {
      const result = await startCleanup({
        label_filter: labelFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        action,
      });
      setSuccessResult(result);
      setLabelFilter("");
      setDateFrom("");
      setDateTo("");
      setPreviewCount(null);
      load();
    } catch {} finally { setSubmitting(false); }
  };

  const handleRetroactive = async () => {
    if (!retroFrom || !retroTo) return;
    setRetroRunning(true);
    setRetroResult(null);
    try {
      const result = await retroactiveClassification({
        date_from: retroFrom,
        date_to: retroTo,
        use_ai: retroUseAi,
      });
      setRetroResult(result);
    } catch {} finally { setRetroRunning(false); }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Cleanup</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Bulk Cleanup</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Label Filter</label>
            <input
              type="text"
              value={labelFilter}
              onChange={(e) => { setLabelFilter(e.target.value); clearSuccessAndPreview(); }}
              placeholder="e.g., Promotions, Social"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="archive">Archive</option>
              <option value="delete">Delete (Trash)</option>
              <option value="mark_read">Mark as Read</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); clearSuccessAndPreview(); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); clearSuccessAndPreview(); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handlePreview}
            disabled={previewing}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            {previewing ? "Previewing..." : "Preview"}
          </button>
          <button
            onClick={showConfirm ? handleSubmit : handlePreview}
            disabled={submitting || previewing}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Running..." : "Start Cleanup"}
          </button>
        </div>

        {showConfirm && previewCount !== null && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm">
            <span className="font-medium text-yellow-800">
              {action === "delete" ? "Delete" : action === "archive" ? "Archive" : "Mark as read"} {previewCount} messages
            </span>
            {dateFrom && dateTo && (
              <span className="text-yellow-700"> between {dateFrom} and {dateTo}</span>
            )}
            <span className="text-yellow-700">? Click "Start Cleanup" to proceed.</span>
          </div>
        )}

        {successResult && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
            <div className="font-medium">
              Successfully{" "}
              {successResult.action === "delete"
                ? "deleted"
                : successResult.action === "archive"
                  ? "archived"
                  : "marked as read"}{" "}
              {successResult.processed_messages} messages.
            </div>
            {(successResult.label_filter || successResult.date_from || successResult.date_to) && (
              <div className="mt-1 text-green-700">
                {successResult.label_filter && <span>Label: {successResult.label_filter}. </span>}
                {(successResult.date_from || successResult.date_to) && (
                  <span>Date range: {formatCleanupDateRange(successResult.date_from, successResult.date_to)}.</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Retroactive Classification</h2>
        <p className="text-sm text-gray-500">
          Run rules (and optionally AI) on old read emails in a date range. Primary inbox only. Unread emails are always skipped.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
            <input
              type="date"
              value={retroFrom}
              onChange={(e) => setRetroFrom(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
            <input
              type="date"
              value={retroTo}
              onChange={(e) => setRetroTo(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={retroUseAi}
            onChange={(e) => setRetroUseAi(e.target.checked)}
            className="rounded border-gray-300"
          />
          Enable AI fallback (requires AI to be configured in Settings)
        </label>

        <button
          onClick={handleRetroactive}
          disabled={retroRunning || !retroFrom || !retroTo}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {retroRunning ? "Running..." : "Run Retroactive Classification"}
        </button>

        {retroResult && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800 space-y-1">
            <div>Processed: {retroResult.total_processed} emails</div>
            <div>Rule matched: {retroResult.rule_matched}</div>
            <div>AI classified: {retroResult.ai_classified}</div>
            <div>Skipped (unread): {retroResult.skipped_unread}</div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <h2 className="text-lg font-semibold text-gray-900 px-6 py-4 border-b border-gray-200">
          Cleanup History
        </h2>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Action</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Label</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Date Range</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Messages</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cleanups.map((job) => (
                <tr key={job.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900 capitalize">{job.action}</td>
                  <td className="px-4 py-3 text-gray-600">{job.label_filter || "All"}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatCleanupDateRange(job.date_from, job.date_to)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{job.processed_messages}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      job.status === "completed" ? "bg-green-100 text-green-700" :
                      job.status === "failed" ? "bg-red-100 text-red-700" :
                      job.status === "running" ? "bg-blue-100 text-blue-700" :
                      "bg-yellow-100 text-yellow-700"
                    }`}>
                      {job.status}
                    </span>
                  </td>
                </tr>
              ))}
              {cleanups.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No cleanup jobs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
