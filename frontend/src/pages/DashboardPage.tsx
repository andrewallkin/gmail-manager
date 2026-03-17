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
        <div className="h-8 w-8 rounded-full border-4 border-google-blue border-t-transparent animate-spin" />
      </div>
    );
  }

  const recentCleanups = cleanups.slice(0, 5);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-google-text">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6">
          <div className="text-sm font-medium text-google-text-secondary">Labels</div>
          <div className="mt-1 text-3xl font-bold text-google-text">{labels.length}</div>
          <div className="mt-1 text-xs text-google-text-tertiary">
            {labels.filter(l => l.label_type === "user").length} user / {labels.filter(l => l.label_type === "system").length} system
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6">
          <div className="text-sm font-medium text-google-text-secondary">Rules</div>
          <div className="mt-1 text-3xl font-bold text-google-text">{rules.length}</div>
          <div className="mt-1 text-xs text-google-text-tertiary">
            {rules.filter(r => r.enabled).length} active
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6">
          <div className="text-sm font-medium text-google-text-secondary">Cleanup Jobs</div>
          <div className="mt-1 text-3xl font-bold text-google-text">{cleanups.length}</div>
          <div className="mt-1 text-xs text-google-text-tertiary">
            {cleanups.filter(c => c.status === "completed").length} completed
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6">
          <div className="text-sm font-medium text-google-text-secondary">Polling</div>
          <div className="mt-1 text-3xl font-bold text-google-text">
            {status?.polling_enabled ? "On" : "Off"}
          </div>
          <div className="mt-1 text-xs text-google-text-tertiary">
            {status?.polling_enabled
              ? `Every ${status.polling_interval_minutes} min`
              : "Disabled"}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6">
        <h2 className="text-lg font-semibold text-google-text mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-google-border text-google-text-secondary hover:bg-google-hover disabled:opacity-50 transition-colors"
          >
            {syncing ? "Syncing..." : "Sync Labels"}
          </button>
          <button
            onClick={handleRunAll}
            disabled={runningAll || rules.filter(r => r.enabled).length === 0}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-google-border text-google-text-secondary hover:bg-google-hover disabled:opacity-50 transition-colors"
          >
            {runningAll ? "Running..." : `Run All Rules (${rules.filter(r => r.enabled).length})`}
          </button>
        </div>
      </div>

      {recentCleanups.length > 0 && (
        <div className="bg-white rounded-2xl border border-google-border shadow-sm overflow-hidden">
          <h2 className="text-lg font-semibold text-google-text px-6 py-4 border-b border-google-border">Recent Cleanup Jobs</h2>
          <table className="w-full text-sm">
            <thead className="bg-google-bg border-b border-google-border">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-google-text-secondary">Action</th>
                <th className="text-left px-4 py-3 font-medium text-google-text-secondary">Filters</th>
                <th className="text-left px-4 py-3 font-medium text-google-text-secondary">Date Range</th>
                <th className="text-right px-4 py-3 font-medium text-google-text-secondary">Messages</th>
                <th className="text-right px-4 py-3 font-medium text-google-text-secondary">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-google-border-light">
              {recentCleanups.map((job) => (
                <tr key={job.id} className="hover:bg-google-hover">
                  <td className="px-4 py-3 font-medium text-google-text capitalize">{job.action}</td>
                  <td className="px-4 py-3 text-google-text-secondary">
                    {(() => {
                      const filters: string[] = [];
                      if (job.label_filter) filters.push(`Label: ${job.label_filter}`);
                      if (job.sender_filter) filters.push(`From: ${job.sender_filter}`);
                      if (job.subject_filter) filters.push(`Subject: ${job.subject_filter}`);
                      return filters.length > 0 ? filters.join(", ") : "None";
                    })()}
                  </td>
                  <td className="px-4 py-3 text-google-text-secondary">
                    {formatCleanupDateRange(job.date_from, job.date_to)}
                  </td>
                  <td className="px-4 py-3 text-right text-google-text-secondary">{job.processed_messages}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      job.status === "completed" ? "bg-google-green-light text-google-green" :
                      job.status === "failed" ? "bg-gmail-red-light text-gmail-red" :
                      job.status === "running" ? "bg-google-blue-light text-google-blue" :
                      "bg-google-yellow-light text-google-yellow-text"
                    }`}>
                      {job.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
