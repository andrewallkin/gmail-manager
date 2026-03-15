import { useEffect, useState } from "react";
import {
  CleanupItem, CleanupPreviewResult, PreviewMessageSummary,
  fetchCleanups, startCleanup, previewCleanup,
} from "../lib/api";
import { formatCleanupDateRange } from "../lib/format";

export function CleanupPage() {
  const [cleanups, setCleanups] = useState<CleanupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [labelFilter, setLabelFilter] = useState("");
  const [senderFilter, setSenderFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [action, setAction] = useState("delete");
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [previewMessages, setPreviewMessages] = useState<PreviewMessageSummary[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [successResult, setSuccessResult] = useState<CleanupItem | null>(null);

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
    setPreviewTotal(null);
    setPreviewMessages([]);
    setShowConfirm(false);
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setSuccessResult(null);
    try {
      const result: CleanupPreviewResult = await previewCleanup({
        label_filter: labelFilter || undefined,
        sender_filter: senderFilter || undefined,
        subject_filter: subjectFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setPreviewTotal(result.total_count);
      setPreviewMessages(result.messages);
      setShowConfirm(true);
    } catch {} finally { setPreviewing(false); }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setShowConfirm(false);
    try {
      const result = await startCleanup({
        label_filter: labelFilter || undefined,
        sender_filter: senderFilter || undefined,
        subject_filter: subjectFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        action,
      });
      setSuccessResult(result);
      setLabelFilter("");
      setSenderFilter("");
      setSubjectFilter("");
      setDateFrom("");
      setDateTo("");
      setPreviewTotal(null);
      setPreviewMessages([]);
      load();
    } catch {} finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Cleanup</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Bulk Cleanup</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sender Filter</label>
            <input
              type="text"
              value={senderFilter}
              onChange={(e) => { setSenderFilter(e.target.value); clearSuccessAndPreview(); }}
              placeholder="e.g., newsletter@example.com, noreply@example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">Separate multiple values with commas (OR logic)</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject Filter</label>
            <input
              type="text"
              value={subjectFilter}
              onChange={(e) => { setSubjectFilter(e.target.value); clearSuccessAndPreview(); }}
              placeholder="e.g., Weekly digest, Monthly report"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">Separate multiple values with commas (OR logic)</p>
          </div>
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

        {showConfirm && previewTotal !== null && (
          <div className="space-y-3">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm">
              <span className="font-medium text-yellow-800">
                {previewTotal} message{previewTotal !== 1 ? "s" : ""} match your criteria
              </span>
              {previewTotal > 500 && (
                <span className="text-yellow-700"> (showing first 500)</span>
              )}
              <span className="text-yellow-700">
                . Click "Start Cleanup" to{" "}
                {action === "delete" ? "delete" : action === "archive" ? "archive" : "mark as read"} them.
              </span>
            </div>

            {previewMessages.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-gray-500">Sender</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-500">Subject</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-500">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {previewMessages.map((msg) => (
                        <tr key={msg.message_id} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-gray-700 truncate max-w-[200px]" title={msg.sender}>{msg.sender}</td>
                          <td className="px-4 py-2 text-gray-700 truncate max-w-[300px]" title={msg.subject}>{msg.subject}</td>
                          <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{msg.date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
            {(successResult.label_filter || successResult.sender_filter || successResult.subject_filter || successResult.date_from || successResult.date_to) && (
              <div className="mt-1 text-green-700">
                {successResult.sender_filter && <span>Sender: {successResult.sender_filter}. </span>}
                {successResult.subject_filter && <span>Subject: {successResult.subject_filter}. </span>}
                {successResult.label_filter && <span>Label: {successResult.label_filter}. </span>}
                {(successResult.date_from || successResult.date_to) && (
                  <span>Date range: {formatCleanupDateRange(successResult.date_from, successResult.date_to)}.</span>
                )}
              </div>
            )}
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
                <th className="text-left px-4 py-3 font-medium text-gray-500">Sender</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Subject</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Date Range</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Messages</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cleanups.map((job) => (
                <tr key={job.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900 capitalize">{job.action}</td>
                  <td className="px-4 py-3 text-gray-600">{job.label_filter || "—"}</td>
                  <td className="px-4 py-3 text-gray-600 truncate max-w-[150px]" title={job.sender_filter ?? undefined}>{job.sender_filter || "—"}</td>
                  <td className="px-4 py-3 text-gray-600 truncate max-w-[150px]" title={job.subject_filter ?? undefined}>{job.subject_filter || "—"}</td>
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
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
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
