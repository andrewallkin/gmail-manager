import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  LabelItem,
  Status,
  fetchLabels,
  retroactiveClassification,
  updateLabel,
  updateSettings,
} from "../lib/api";

type Props = {
  status: Status;
  onStatusChange: (s: Status | null) => void;
};

export function AIPage({ status, onStatusChange }: Props) {
  const [aiProvider, setAiProvider] = useState(status.ai_provider ?? "");
  const [aiApiKey, setAiApiKey] = useState("");
  const [autoRemoveInbox, setAutoRemoveInbox] = useState(status.auto_remove_inbox_labeled_read);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [descriptions, setDescriptions] = useState<Record<number, string>>({});
  const [loadingLabels, setLoadingLabels] = useState(true);
  const [savingDescriptions, setSavingDescriptions] = useState(false);
  const [descriptionsSaved, setDescriptionsSaved] = useState(false);

  const [retroFrom, setRetroFrom] = useState("");
  const [retroTo, setRetroTo] = useState("");
  const [retroUseAi, setRetroUseAi] = useState(false);
  const [retroMaxMessages, setRetroMaxMessages] = useState(50);
  const [retroRunning, setRetroRunning] = useState(false);
  const [retroResult, setRetroResult] = useState<{
    total_processed: number;
    rule_matched: number;
    ai_classified: number;
    max_messages: number;
  } | null>(null);

  useEffect(() => {
    setAiProvider(status.ai_provider ?? "");
    setAutoRemoveInbox(status.auto_remove_inbox_labeled_read);
  }, [status]);

  const loadLabels = useCallback(async () => {
    setLoadingLabels(true);
    try {
      const allLabels = await fetchLabels();
      const userLabels = allLabels.filter((label) => label.label_type === "user");
      setLabels(userLabels);
      const nextDescriptions: Record<number, string> = {};
      userLabels.forEach((label) => {
        nextDescriptions[label.id] = label.ai_description ?? "";
      });
      setDescriptions(nextDescriptions);
    } catch {
      // ignore
    } finally {
      setLoadingLabels(false);
    }
  }, []);

  useEffect(() => {
    if (!status.ai_enabled) {
      setLabels([]);
      setDescriptions({});
      setLoadingLabels(false);
      return;
    }
    loadLabels();
  }, [loadLabels, status.ai_enabled]);

  const dirtyDescriptionIds = useMemo(
    () =>
      labels
        .filter((label) => (label.ai_description ?? "") !== (descriptions[label.id] ?? ""))
        .map((label) => label.id),
    [labels, descriptions]
  );

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSettingsSaved(false);
    try {
      const updated = await updateSettings({
        ai_provider: aiProvider || null,
        ai_api_key: aiApiKey || null,
        auto_remove_inbox_labeled_read: autoRemoveInbox,
      });
      onStatusChange(updated);
      setAiApiKey("");
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch {
      // ignore
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveDescriptions = async () => {
    if (dirtyDescriptionIds.length === 0) return;
    setSavingDescriptions(true);
    setDescriptionsSaved(false);
    try {
      await Promise.all(
        dirtyDescriptionIds.map((id) =>
          updateLabel(id, {
            ai_description: (descriptions[id] ?? "").trim(),
          })
        )
      );
      await loadLabels();
      setDescriptionsSaved(true);
      setTimeout(() => setDescriptionsSaved(false), 3000);
    } catch {
      // ignore
    } finally {
      setSavingDescriptions(false);
    }
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
        max_messages: Math.max(1, Math.min(50, retroMaxMessages)),
      });
      setRetroResult(result);
    } catch {
      // ignore
    } finally {
      setRetroRunning(false);
    }
  };

  if (!status.ai_enabled) {
    return (
      <div className="space-y-8">
        <h1 className="text-2xl font-bold text-google-text">AI</h1>
        <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6 space-y-3">
          <h2 className="text-lg font-semibold text-google-text">AI is currently disabled</h2>
          <p className="text-sm text-google-text-secondary">
            Enable AI features in Settings before using AI provider configuration, label context, and
            historical AI classification.
          </p>
          <Link
            to="/settings"
            className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-google-blue text-white hover:bg-google-blue-hover transition-colors"
          >
            Go to Settings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-google-text">AI</h1>

      <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold text-google-text">AI Configuration</h2>
        <p className="text-sm text-google-text-secondary">
          Configure AI provider credentials and classification behavior.
        </p>

        <label className="flex items-center gap-2 text-sm text-google-text-secondary">
          <input
            type="checkbox"
            checked={autoRemoveInbox}
            onChange={(e) => setAutoRemoveInbox(e.target.checked)}
            className="rounded border-google-border"
          />
          Remove Inbox label automatically when an email is read and classified into any user label except
          &nbsp;"Unclassified" (Primary inbox only)
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div>
            <label className="block text-sm font-medium text-google-text-secondary mb-1">AI Provider</label>
            <select
              value={aiProvider}
              onChange={(e) => setAiProvider(e.target.value)}
              className="w-full px-3 py-2 border border-google-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-google-blue bg-white"
            >
              <option value="">Select provider</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-google-text-secondary mb-1">API Key</label>
            <input
              type="password"
              value={aiApiKey}
              onChange={(e) => setAiApiKey(e.target.value)}
              placeholder="Enter API key"
              className="w-full px-3 py-2 border border-google-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-google-blue"
            />
            <p className="mt-1 text-xs text-google-text-tertiary">Leave blank to keep the existing key</p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSaveSettings}
            disabled={savingSettings}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-google-blue text-white hover:bg-google-blue-hover disabled:opacity-50 transition-colors"
          >
            {savingSettings ? "Saving..." : "Save AI Settings"}
          </button>
          {settingsSaved && <span className="text-sm text-google-green">AI settings saved</span>}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold text-google-text">Label Context for AI</h2>
        <p className="text-sm text-google-text-secondary">
          Add short guidance for each label. These descriptions are passed into the AI classification prompt.
        </p>

        {loadingLabels ? (
          <div className="flex justify-center py-6">
            <div className="h-6 w-6 rounded-full border-4 border-google-blue border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {labels.map((label) => (
                <div key={label.id} className="border border-google-border rounded-lg p-3">
                  <div className="text-sm font-medium text-google-text mb-2">{label.name}</div>
                  <textarea
                    value={descriptions[label.id] ?? ""}
                    onChange={(e) =>
                      setDescriptions((prev) => ({ ...prev, [label.id]: e.target.value }))
                    }
                    rows={2}
                    placeholder="Describe what kinds of emails belong in this label..."
                    className="w-full px-3 py-2 border border-google-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-google-blue"
                  />
                </div>
              ))}
              {labels.length === 0 && (
                <div className="text-sm text-google-text-secondary">No user labels found. Create labels first.</div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveDescriptions}
                disabled={savingDescriptions || dirtyDescriptionIds.length === 0}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-google-blue text-white hover:bg-google-blue-hover disabled:opacity-50 transition-colors"
              >
                {savingDescriptions ? "Saving..." : "Save Label Context"}
              </button>
              {descriptionsSaved && <span className="text-sm text-google-green">Label context saved</span>}
            </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold text-google-text">Historical Classification</h2>
        <p className="text-sm text-google-text-secondary">
          Run rules (and optionally AI fallback) across read and unread emails in Primary inbox only.
          Each run is capped at 50 messages.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-google-text-secondary mb-1">From Date</label>
            <input
              type="date"
              value={retroFrom}
              onChange={(e) => setRetroFrom(e.target.value)}
              className="w-full px-3 py-2 border border-google-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-google-blue"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-google-text-secondary mb-1">To Date</label>
            <input
              type="date"
              value={retroTo}
              onChange={(e) => setRetroTo(e.target.value)}
              className="w-full px-3 py-2 border border-google-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-google-blue"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-google-text-secondary mb-1">Messages per run (1-50)</label>
            <input
              type="number"
              min={1}
              max={50}
              value={retroMaxMessages}
              onChange={(e) => setRetroMaxMessages(Number(e.target.value))}
              className="w-full px-3 py-2 border border-google-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-google-blue"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-google-text-secondary">
          <input
            type="checkbox"
            checked={retroUseAi}
            onChange={(e) => setRetroUseAi(e.target.checked)}
            className="rounded border-google-border"
          />
          Enable AI fallback (requires AI to be configured)
        </label>

        <button
          onClick={handleRetroactive}
          disabled={retroRunning || !retroFrom || !retroTo}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-google-blue text-white hover:bg-google-blue-hover disabled:opacity-50 transition-colors"
        >
          {retroRunning ? "Running..." : "Run Historical Classification"}
        </button>

        {retroResult && (
          <div className="bg-google-green-light border border-google-green/20 rounded-lg px-4 py-3 text-sm text-google-green space-y-1">
            <div>Processed: {retroResult.total_processed} emails</div>
            <div>Rule matched: {retroResult.rule_matched}</div>
            <div>AI classified: {retroResult.ai_classified}</div>
            <div>Run cap: {retroResult.max_messages}</div>
          </div>
        )}
      </div>
    </div>
  );
}
