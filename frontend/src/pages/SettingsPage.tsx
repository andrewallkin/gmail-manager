import { useEffect, useState } from "react";
import { Status, updateSettings, disconnectGoogle, fetchRetention, updateRetention, RetentionItem } from "../lib/api";

type Props = {
  status: Status;
  onStatusChange: (s: Status | null) => void;
};

export function SettingsPage({ status, onStatusChange }: Props) {
  const [pollingEnabled, setPollingEnabled] = useState(status.polling_enabled);
  const [pollingInterval, setPollingInterval] = useState(status.polling_interval_minutes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [retention, setRetention] = useState<RetentionItem[]>([]);
  const [retentionLoading, setRetentionLoading] = useState(true);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionSaved, setRetentionSaved] = useState(false);

  useEffect(() => {
    fetchRetention()
      .then(data => setRetention(data.items))
      .catch(() => {})
      .finally(() => setRetentionLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const updated = await updateSettings({
        polling_enabled: pollingEnabled,
        polling_interval_minutes: pollingInterval,
      });
      onStatusChange(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {} finally { setSaving(false); }
  };

  const handleRetentionSave = async () => {
    setRetentionSaving(true);
    setRetentionSaved(false);
    try {
      const result = await updateRetention(retention);
      setRetention(result.items);
      setRetentionSaved(true);
      setTimeout(() => setRetentionSaved(false), 3000);
    } catch {} finally { setRetentionSaving(false); }
  };

  const updateRetentionItem = (category: string, field: "enabled" | "retention_days", value: boolean | number) => {
    setRetention(prev => prev.map(r =>
      r.category === category ? { ...r, [field]: value } : r
    ));
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect your Google account? You will be logged out.")) return;
    try {
      await disconnectGoogle();
      onStatusChange(null);
    } catch {}
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Account</h2>
        <div className="flex items-center gap-4">
          {status.profile_picture_url && (
            <img
              src={status.profile_picture_url}
              alt="Profile"
              className="h-12 w-12 rounded-full object-cover border border-gray-200"
            />
          )}
          <div>
            <div className="font-medium text-gray-900">{status.display_name}</div>
            <div className="text-sm text-gray-500">{status.email}</div>
          </div>
          <span className="ml-auto px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
            Connected
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Polling Settings</h2>
        <p className="text-sm text-gray-500">
          When enabled, the app automatically checks for new emails and runs rules.
        </p>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={pollingEnabled}
            onChange={(e) => setPollingEnabled(e.target.checked)}
            className="rounded border-gray-300"
          />
          Enable automatic polling
        </label>

        {pollingEnabled && (
          <div className="max-w-xs">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Poll interval: {pollingInterval} min
            </label>
            <input
              type="range"
              min={1}
              max={60}
              value={pollingInterval}
              onChange={(e) => setPollingInterval(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>1 min</span>
              <span>60 min</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save Polling Settings"}
          </button>
          {saved && <span className="text-sm text-green-600">Polling settings saved</span>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">System Label Retention</h2>
        <p className="text-sm text-gray-500">
          Automatically trash emails older than the configured retention period for each category.
        </p>

        {retentionLoading ? (
          <div className="flex justify-center py-4">
            <div className="h-6 w-6 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Category</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500">Enabled</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Retention (days)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {retention.map((r) => (
                  <tr key={r.category} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 capitalize">{r.category}</td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => updateRetentionItem(r.category, "enabled", e.target.checked)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={r.retention_days}
                        onChange={(e) => updateRetentionItem(r.category, "retention_days", Math.max(1, Number(e.target.value)))}
                        className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRetentionSave}
                disabled={retentionSaving}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {retentionSaving ? "Saving..." : "Save Retention Settings"}
              </button>
              {retentionSaved && <span className="text-sm text-green-600">Retention saved</span>}
            </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-xl border border-red-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-red-900">Danger Zone</h2>
        <p className="text-sm text-gray-500">
          Disconnect your Google account. This will clear your tokens and log you out.
        </p>
        <button
          onClick={handleDisconnect}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-red-300 text-red-700 hover:bg-red-50 transition-colors"
        >
          Disconnect Google Account
        </button>
      </div>
    </div>
  );
}
