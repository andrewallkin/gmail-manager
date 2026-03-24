import { useEffect, useState } from "react";
import { Status, updateSettings, disconnectGoogle, fetchRetention, updateRetention, RetentionItem } from "../lib/api";
import { ConfirmDialog } from "../components/ConfirmDialog";

type Props = {
  status: Status;
  onStatusChange: (s: Status | null) => void;
};

export function SettingsPage({ status, onStatusChange }: Props) {
  const [aiEnabled, setAiEnabled] = useState(status.ai_enabled);
  const [pollingEnabled, setPollingEnabled] = useState(status.polling_enabled);
  const [pollingInterval, setPollingInterval] = useState(status.polling_interval_minutes);
  const [autoRemoveInboxLabeledRead, setAutoRemoveInboxLabeledRead] = useState(
    status.auto_remove_inbox_labeled_read
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [retention, setRetention] = useState<RetentionItem[]>([]);
  const [retentionLoading, setRetentionLoading] = useState(true);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionSaved, setRetentionSaved] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    fetchRetention()
      .then(data => setRetention(data.items))
      .catch(() => {})
      .finally(() => setRetentionLoading(false));
  }, []);

  useEffect(() => {
    setAiEnabled(status.ai_enabled);
    setPollingEnabled(status.polling_enabled);
    setPollingInterval(status.polling_interval_minutes);
    setAutoRemoveInboxLabeledRead(status.auto_remove_inbox_labeled_read);
  }, [status]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const updated = await updateSettings({
        ai_enabled: aiEnabled,
        polling_enabled: pollingEnabled,
        polling_interval_minutes: pollingInterval,
        auto_remove_inbox_labeled_read: autoRemoveInboxLabeledRead,
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

  const handleDisconnectClick = () => {
    setShowDisconnectConfirm(true);
  };

  const handleDisconnectConfirm = async () => {
    setDisconnecting(true);
    try {
      await disconnectGoogle();
      setShowDisconnectConfirm(false);
      onStatusChange(null);
    } catch {} finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-google-text">Settings</h1>

      <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold text-google-text">Account</h2>
        <div className="flex items-center gap-4">
          {status.profile_picture_url && (
            <img
              src={status.profile_picture_url}
              alt="Profile"
              className="h-12 w-12 rounded-full object-cover border border-google-border"
            />
          )}
          <div>
            <div className="font-medium text-google-text">{status.display_name}</div>
            <div className="text-sm text-google-text-secondary">{status.email}</div>
          </div>
          <span className="ml-auto px-3 py-1 rounded-full text-xs font-medium bg-google-green-light text-google-green">
            Connected
          </span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold text-google-text">App Settings</h2>
        <p className="text-sm text-google-text-secondary">
          Manage AI availability and automated inbox processing behavior.
        </p>

        <label className="flex items-center gap-2 text-sm text-google-text-secondary">
          <input
            type="checkbox"
            checked={aiEnabled}
            onChange={(e) => setAiEnabled(e.target.checked)}
            className="rounded border-google-border"
          />
          Enable AI features
        </label>

        <p className="text-sm text-google-text-secondary">
          When polling is enabled, the app automatically checks for new emails and runs rules.
        </p>

        <label className="flex items-center gap-2 text-sm text-google-text-secondary">
          <input
            type="checkbox"
            checked={pollingEnabled}
            onChange={(e) => setPollingEnabled(e.target.checked)}
            className="rounded border-google-border"
          />
          Enable automatic polling
        </label>

        <label className="flex items-center gap-2 text-sm text-google-text-secondary">
          <input
            type="checkbox"
            checked={autoRemoveInboxLabeledRead}
            onChange={(e) => setAutoRemoveInboxLabeledRead(e.target.checked)}
            className="rounded border-google-border"
          />
          Auto-remove Inbox label when classified emails are read in Primary inbox
        </label>

        {pollingEnabled && (
          <div className="max-w-xs">
            <label className="block text-sm font-medium text-google-text-secondary mb-1">
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
            <div className="flex justify-between text-xs text-google-text-tertiary">
              <span>1 min</span>
              <span>60 min</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-google-blue text-white hover:bg-google-blue-hover disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save App Settings"}
          </button>
          {saved && <span className="text-sm text-google-green">App settings saved</span>}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold text-google-text">System Label Retention</h2>
        <p className="text-sm text-google-text-secondary">
          Automatically trash emails older than the configured retention period for each category.
        </p>

        {retentionLoading ? (
          <div className="flex justify-center py-4">
            <div className="h-6 w-6 rounded-full border-4 border-google-blue border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-google-bg border-b border-google-border">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-google-text-secondary">Category</th>
                  <th className="text-center px-4 py-3 font-medium text-google-text-secondary">Enabled</th>
                  <th className="text-right px-4 py-3 font-medium text-google-text-secondary">Retention (days)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-google-border-light">
                {retention.map((r) => (
                  <tr key={r.category} className="hover:bg-google-hover">
                    <td className="px-4 py-3 font-medium text-google-text capitalize">{r.category}</td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => updateRetentionItem(r.category, "enabled", e.target.checked)}
                        className="rounded border-google-border"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={r.retention_days}
                        onChange={(e) => updateRetentionItem(r.category, "retention_days", Math.max(1, Number(e.target.value)))}
                        className="w-20 px-2 py-1 border border-google-border rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-google-blue"
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
                className="px-4 py-2 text-sm font-medium rounded-lg bg-google-blue text-white hover:bg-google-blue-hover disabled:opacity-50 transition-colors"
              >
                {retentionSaving ? "Saving..." : "Save Retention Settings"}
              </button>
              {retentionSaved && <span className="text-sm text-google-green">Retention saved</span>}
            </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gmail-red-border p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gmail-red">Danger Zone</h2>
        <p className="text-sm text-google-text-secondary">
          Disconnect your Google account. This will clear your tokens and log you out.
        </p>
        <button
          onClick={handleDisconnectClick}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-gmail-red-border text-gmail-red hover:bg-gmail-red-light transition-colors"
        >
          Disconnect Google Account
        </button>
      </div>

      <ConfirmDialog
        open={showDisconnectConfirm}
        title="Disconnect account"
        message="Disconnect your Google account? You will be logged out."
        confirmLabel="Disconnect"
        variant="danger"
        loading={disconnecting}
        onConfirm={handleDisconnectConfirm}
        onCancel={() => setShowDisconnectConfirm(false)}
      />
    </div>
  );
}
