import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  LabelItem,
  RetroClassificationJob,
  Status,
  createRetroClassificationJob,
  fetchLabels,
  fetchRetroClassificationJob,
  updateLabel,
  updateSettings,
} from "../lib/api";

type Props = {
  status: Status;
  onStatusChange: (s: Status | null) => void;
};

function isTriageLabel(name: string): boolean {
  return name.startsWith("Action/Triage-");
}

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
  const [retroJobId, setRetroJobId] = useState<number | null>(null);
  const [retroJob, setRetroJob] = useState<RetroClassificationJob | null>(null);
  const [retroError, setRetroError] = useState<string | null>(null);

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
      const triageOnly = userLabels.filter((label) => isTriageLabel(label.name));
      const nextDescriptions: Record<number, string> = {};
      triageOnly.forEach((label) => {
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

  const triageLabels = useMemo(() => labels.filter((l) => isTriageLabel(l.name)), [labels]);

  const dirtyDescriptionIds = useMemo(
    () =>
      triageLabels
        .filter((label) => (label.ai_description ?? "") !== (descriptions[label.id] ?? "").trim())
        .map((label) => label.id),
    [triageLabels, descriptions],
  );

  useEffect(() => {
    if (retroJobId == null) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const job = await fetchRetroClassificationJob(retroJobId);
        if (!cancelled) setRetroJob(job);
      } catch {
        /* ignore transient poll failures */
      }
    };

    void tick();
    const intervalId = window.setInterval(tick, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [retroJobId]);

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
          }),
        ),
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

  const startRetroJob = async () => {
    if (!retroFrom || !retroTo) return;
    setRetroError(null);
    setRetroJob(null);
    setRetroJobId(null);
    try {
      const { job_id } = await createRetroClassificationJob({
        date_from: retroFrom,
        date_to: retroTo,
        use_ai: retroUseAi,
      });
      setRetroJobId(job_id);
      const initial = await fetchRetroClassificationJob(job_id);
      setRetroJob(initial);
    } catch (e: unknown) {
      setRetroError(e instanceof Error ? e.message : "Failed to start job");
    }
  };

  const retroBusy = retroJob?.status === "pending" || retroJob?.status === "running";

  if (!status.ai_enabled) {
    return (
      <div className="space-y-8">
        <h1 className="text-2xl font-bold text-google-text">AI</h1>
        <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6 space-y-3">
          <h2 className="text-lg font-semibold text-google-text">AI is currently disabled</h2>
          <p className="text-sm text-google-text-secondary">
            Enable AI features in Settings before using AI provider configuration, triage labels, and
            historical classification.
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

      {!status.triage_labels_ok && (
        <div
          role="alert"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <strong className="font-medium">Triage labels missing.</strong> Sync labels after creating{" "}
          <code className="text-xs bg-white/60 px-1 rounded">Action/Triage-Trash</code> and{" "}
          <code className="text-xs bg-white/60 px-1 rounded">Action/Triage-Temporary</code> in Gmail (or click
          Sync—the app tries to create them). Without both labels, inbox messages that do not match a rule stay
          in the inbox instead of AI triage.
        </div>
      )}

      <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold text-google-text">Unified inbox AI triage</h2>
        <p className="text-sm text-google-text-secondary">
          Rules run first across all inbox tabs. When no rule applies to a thread that still has the Inbox
          label, the app calls AI to assign exactly one of the two Action/Triage buckets, then removes
          Inbox (mail stays unread under that label unless a rule marks it read).
        </p>
        <p className="text-sm text-google-text-secondary">
          If AI is disabled or no API key is saved, unmatched inbox mail is left untouched so nothing is labeled
          without your consent.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold text-google-text">AI Configuration</h2>
        <p className="text-sm text-google-text-secondary">
          Configure the OpenAI API key used for binary triage (gpt-4o-mini).
        </p>

        <label className="flex items-center gap-2 text-sm text-google-text-secondary">
          <input
            type="checkbox"
            checked={autoRemoveInbox}
            onChange={(e) => setAutoRemoveInbox(e.target.checked)}
            className="rounded border-google-border"
          />
          Optionally remove Inbox when a classified message becomes read (separate sweep; scans all inbox tabs
          for messages with user labels).
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
        <h2 className="text-lg font-semibold text-google-text">Triage label context</h2>
        <p className="text-sm text-google-text-secondary">
          Guidance for <code className="text-xs">Action/Triage-Trash</code> versus{" "}
          <code className="text-xs">Action/Triage-Temporary</code>—only these descriptions are passed into
          AI triage.
        </p>

        {loadingLabels ? (
          <div className="flex justify-center py-6">
            <div className="h-6 w-6 rounded-full border-4 border-google-blue border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {triageLabels.map((label) => (
                <div key={label.id} className="border border-google-border rounded-lg p-3">
                  <div className="text-sm font-medium text-google-text mb-2">{label.name}</div>
                  <textarea
                    value={descriptions[label.id] ?? ""}
                    onChange={(e) =>
                      setDescriptions((prev) => ({ ...prev, [label.id]: e.target.value }))
                    }
                    rows={2}
                    placeholder="Describe what belongs in this triage bucket…"
                    className="w-full px-3 py-2 border border-google-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-google-blue"
                  />
                </div>
              ))}
              {triageLabels.length === 0 && (
                <div className="text-sm text-google-text-secondary">
                  No Action/Triage-* labels synced yet. Create them in Gmail and use Labels → Sync from Gmail.
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveDescriptions}
                disabled={savingDescriptions || dirtyDescriptionIds.length === 0}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-google-blue text-white hover:bg-google-blue-hover disabled:opacity-50 transition-colors"
              >
                {savingDescriptions ? "Saving..." : "Save triage descriptions"}
              </button>
              {descriptionsSaved && <span className="text-sm text-google-green">Saved</span>}
            </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold text-google-text">Historical classification</h2>
        <p className="text-sm text-google-text-secondary">
          Queues a background job using the same rules → optional AI triage flow over everything in inbox in
          the date range (all category tabs). The poller advances the job in batches; refresh this page to
          see progress, or leave it open to poll automatically.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        </div>

        <label className="flex items-center gap-2 text-sm text-google-text-secondary">
          <input
            type="checkbox"
            checked={retroUseAi}
            onChange={(e) => setRetroUseAi(e.target.checked)}
            className="rounded border-google-border"
          />
          Run AI triage for messages that skip rules (same as live poller); otherwise only rules apply.
        </label>

        {retroError && (
          <div className="text-sm text-gmail-red border border-red-200 rounded-lg px-3 py-2 bg-red-50">
            {retroError}
          </div>
        )}

        <button
          type="button"
          onClick={startRetroJob}
          disabled={!retroFrom || !retroTo || retroBusy}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-google-blue text-white hover:bg-google-blue-hover disabled:opacity-50 transition-colors"
        >
          {retroBusy ? "Job running…" : "Queue historical job"}
        </button>

        {retroJob && (
          <div
            className={`rounded-lg px-4 py-3 text-sm space-y-1 border ${
              retroJob.status === "failed"
                ? "bg-red-50 border-red-200 text-gmail-red"
                : retroJob.status === "completed"
                  ? "bg-google-green-light border-google-green/20 text-google-green"
                  : "bg-google-bg border-google-border text-google-text"
            }`}
          >
            <div>Status: {retroJob.status}</div>
            <div>Processed: {retroJob.processed_count}</div>
            <div>Rule matched: {retroJob.rule_matched_count}</div>
            <div>AI triaged: {retroJob.ai_classified_count}</div>
            {retroJob.status === "failed" && retroJob.error_message != null ? (
              <div className="pt-2 text-xs whitespace-pre-wrap">{retroJob.error_message}</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
