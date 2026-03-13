import { useEffect, useState } from "react";
import { fetchLabels, fetchRules, fetchCleanups, fetchStatus, syncLabels, runRule, LabelItem, RuleItem, CleanupItem, Status } from "../lib/api";
import { formatCleanupDateRange } from "../lib/format";

export function DashboardPage() {
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [cleanups, setCleanups] = useState<CleanupItem[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [runningAll, setRunningAll] = useState(false);

  useEffect(() => {
    Promise.all([fetchLabels(), fetchRules(), fetchCleanups(), fetchStatus()])
      .then(([l, r, c, s]) => {
        setLabels(l);
        setRules(r);
        setCleanups(c);
        setStatus(s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncLabels();
      const l = await fetchLabels();
      setLabels(l);
    } catch {}
    finally { setSyncing(false); }
  };

  const handleRunAll = async () => {
    setRunningAll(true);
    try {
      const enabledRules = rules.filter(r => r.enabled);
      for (const rule of enabledRules) {
        await runRule(rule.id);
      }
    } catch {}
    finally { setRunningAll(false); }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  const recentCleanups = cleanups.slice(0, 5);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="text-sm font-medium text-gray-500">Labels</div>
          <div className="mt-1 text-3xl font-bold text-gray-900">{labels.length}</div>
          <div className="mt-1 text-xs text-gray-400">
            {labels.filter(l => l.label_type === "user").length} user / {labels.filter(l => l.label_type === "system").length} system
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="text-sm font-medium text-gray-500">Rules</div>
          <div className="mt-1 text-3xl font-bold text-gray-900">{rules.length}</div>
          <div className="mt-1 text-xs text-gray-400">
            {rules.filter(r => r.enabled).length} active
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="text-sm font-medium text-gray-500">Cleanup Jobs</div>
          <div className="mt-1 text-3xl font-bold text-gray-900">{cleanups.length}</div>
          <div className="mt-1 text-xs text-gray-400">
            {cleanups.filter(c => c.status === "completed").length} completed
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="text-sm font-medium text-gray-500">Polling</div>
          <div className="mt-1 text-3xl font-bold text-gray-900">
            {status?.polling_enabled ? "On" : "Off"}
          </div>
          <div className="mt-1 text-xs text-gray-400">
            {status?.polling_enabled
              ? `Every ${status.polling_interval_minutes} min`
              : "Disabled"}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            {syncing ? "Syncing..." : "Sync Labels"}
          </button>
          <button
            onClick={handleRunAll}
            disabled={runningAll || rules.filter(r => r.enabled).length === 0}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            {runningAll ? "Running..." : `Run All Rules (${rules.filter(r => r.enabled).length})`}
          </button>
        </div>
      </div>

      {recentCleanups.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Cleanup Jobs</h2>
          <div className="space-y-3">
            {recentCleanups.map((job) => (
              <div key={job.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-medium capitalize text-gray-900">{job.action}</span>
                <span className="text-gray-600">{job.label_filter || "All"}</span>
                <span className="text-gray-600">{formatCleanupDateRange(job.date_from, job.date_to)}</span>
                <span className="text-gray-500">{job.processed_messages} messages</span>
                <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${
                  job.status === "completed" ? "bg-green-100 text-green-700" :
                  job.status === "failed" ? "bg-red-100 text-red-700" :
                  "bg-yellow-100 text-yellow-700"
                }`}>
                  {job.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
