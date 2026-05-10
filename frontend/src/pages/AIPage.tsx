import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  LabelItem,
  RetroClassificationJob,
  Status,
  createRetroClassificationJob,
  fetchLabels,
  fetchRetroClassificationJob,
  fetchRetroClassificationJobs,
  updateLabel,
  updateSettings,
} from "../lib/api";

type Props = {
  status: Status;
  onStatusChange: (s: Status | null) => void;
};

type TriageRetentionDraft = {
  days: string;
  scope: LabelItem["retention_scope"];
};

function isTriageLabel(name: string): boolean {
  return name.startsWith("Action/Triage-");
}

function formatShortDate(isoDate: string): string {
  const d = new Date(isoDate.includes("T") ? isoDate : `${isoDate}T12:00:00`);
  return Number.isNaN(d.getTime()) ? isoDate : d.toLocaleDateString();
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
  const [retroRuns, setRetroRuns] = useState<RetroClassificationJob[]>([]);
  const [retroRunsLoading, setRetroRunsLoading] = useState(false);

  const [triageRetention, setTriageRetention] = useState<Record<number, TriageRetentionDraft>>({});
  const [savingRetention, setSavingRetention] = useState(false);
  const [retentionSaved, setRetentionSaved] = useState(false);

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
      const nextRetention: Record<number, TriageRetentionDraft> = {};
      triageOnly.forEach((label) => {
        nextDescriptions[label.id] = label.ai_description ?? "";
        nextRetention[label.id] = {
          days: label.retention_days != null ? String(label.retention_days) : "",
          scope: label.retention_scope ?? "all",
        };
      });
      setDescriptions(nextDescriptions);
      setTriageRetention(nextRetention);
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
      setTriageRetention({});
      setRetroRuns([]);
      setLoadingLabels(false);
      return;
    }
    loadLabels();
  }, [loadLabels, status.ai_enabled]);

  const loadRetroRuns = useCallback(async () => {
    setRetroRunsLoading(true);
    try {
      const list = await fetchRetroClassificationJobs(100);
      setRetroRuns(list);
    } catch {
      // ignore
    } finally {
      setRetroRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!status.ai_enabled) return;
    void loadRetroRuns();
  }, [status.ai_enabled, loadRetroRuns]);

  const triageLabels = useMemo(() => labels.filter((l) => isTriageLabel(l.name)), [labels]);

  const dirtyDescriptionIds = useMemo(
    () =>
      triageLabels
        .filter((label) => (label.ai_description ?? "") !== (descriptions[label.id] ?? "").trim())
        .map((label) => label.id),
    [triageLabels, descriptions],
  );

  const dirtyRetentionIds = useMemo(
    () =>
      triageLabels
        .filter((label) => {
          const draft = triageRetention[label.id];
          if (!draft) return false;
          let daysNum: number | null = null;
          if (draft.days.trim() !== "") {
            const n = Number(draft.days);
            if (Number.isNaN(n)) return true;
            daysNum = n;
          }
          return (
            (label.retention_days ?? null) !== daysNum ||
            (label.retention_scope ?? "all") !== draft.scope
          );
        })
        .map((label) => label.id),
    [triageLabels, triageRetention],
  );

  const hasInvalidRetentionDays = useMemo(
    () =>
      triageLabels.some((label) => {
        const raw = triageRetention[label.id]?.days ?? "";
        if (raw.trim() === "") return false;
        return Number.isNaN(Number(raw));
      }),
    [triageLabels, triageRetention],
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

  useEffect(() => {
    if (retroJob == null) return;
    setRetroRuns((prev) => {
      const i = prev.findIndex((j) => j.id === retroJob.id);
      if (i < 0) {
        const merged = [retroJob, ...prev];
        merged.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
        return merged;
      }
      const copy = [...prev];
      copy[i] = retroJob;
      return copy;
    });
  }, [retroJob]);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSettingsSaved(false);
    try {
      const payload: Parameters<typeof updateSettings>[0] = {
        ai_provider: aiProvider || null,
        auto_remove_inbox_labeled_read: autoRemoveInbox,
      };
      const trimmedKey = aiApiKey.trim();
      if (trimmedKey) payload.ai_api_key = trimmedKey;
      const updated = await updateSettings(payload);
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

  const handleSaveRetention = async () => {
    if (dirtyRetentionIds.length === 0) return;
    setSavingRetention(true);
    setRetentionSaved(false);
    try {
      await Promise.all(
        dirtyRetentionIds.map(async (id) => {
          const draft = triageRetention[id];
          if (!draft) return;
          const trimmed = draft.days.trim();
          const parsed = trimmed === "" ? null : Number(trimmed);
          if (trimmed !== "" && (parsed == null || Number.isNaN(parsed))) {
            throw new Error("Retention days must be a number.");
          }
          await updateLabel(id, {
            retention_days: parsed,
            retention_scope: draft.scope,
          });
        }),
      );
      await loadLabels();
      setRetentionSaved(true);
      setTimeout(() => setRetentionSaved(false), 3000);
    } catch {
      // ignore
    } finally {
      setSavingRetention(false);
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
      void loadRetroRuns();
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
            <label className="block text-sm font-medium text-google-text-secondary mb-1 flex items-center gap-2 flex-wrap">
              API Key
              {status.ai_api_key_configured && (
                <span className="text-xs font-normal text-google-green px-2 py-0.5 rounded-full bg-google-green-light border border-google-green/20">
                  Saved on server
                </span>
              )}
            </label>
            <input
              type="password"
              value={aiApiKey}
              onChange={(e) => setAiApiKey(e.target.value)}
              placeholder={status.ai_api_key_configured ? "Enter new key to replace…" : "Enter API key"}
              autoComplete="off"
              className="w-full px-3 py-2 border border-google-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-google-blue"
            />
            <p className="mt-1 text-xs text-google-text-tertiary">
              Leave blank to keep your current key; type only when changing it.
            </p>
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
                type="button"
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
        <h2 className="text-lg font-semibold text-google-text">Triage retention</h2>
        <p className="text-sm text-google-text-secondary">
          The polling service can trash messages under each triage label after they reach the retention age,
          respecting read vs unread filters (same behavior as optional retention on{" "}
          <Link className="text-google-blue underline" to="/labels">
            Labels
          </Link>
          ).
        </p>

        {loadingLabels ? (
          <div className="flex justify-center py-6">
            <div className="h-6 w-6 rounded-full border-4 border-google-blue border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {triageLabels.map((label) => {
                const draft = triageRetention[label.id] ?? {
                  days: "",
                  scope: label.retention_scope ?? "all",
                };
                return (
                  <div key={label.id} className="border border-google-border rounded-lg p-3 space-y-3">
                    <div className="text-sm font-medium text-google-text">{label.name}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-google-text-secondary mb-1">
                          Retention days
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={draft.days}
                          onChange={(e) =>
                            setTriageRetention((prev) => ({
                              ...prev,
                              [label.id]: { ...draft, days: e.target.value },
                            }))
                          }
                          placeholder="Blank = disabled"
                          className="w-full px-3 py-2 border border-google-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-google-blue"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-google-text-secondary mb-1">
                          Apply retention to
                        </label>
                        <select
                          value={draft.scope}
                          onChange={(e) =>
                            setTriageRetention((prev) => ({
                              ...prev,
                              [label.id]: {
                                ...draft,
                                scope: e.target.value as LabelItem["retention_scope"],
                              },
                            }))
                          }
                          className="w-full px-3 py-2 border border-google-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-google-blue bg-white"
                        >
                          <option value="all">All messages</option>
                          <option value="read_only">Read only</option>
                          <option value="unread_only">Unread only</option>
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
              {triageLabels.length === 0 && (
                <div className="text-sm text-google-text-secondary">
                  No triage labels synced yet. Retention applies after both Action/Triage-* labels exist.
                </div>
              )}
            </div>

            {hasInvalidRetentionDays && (
              <p className="text-sm text-gmail-red">Enter a valid number of days, or leave blank to disable.</p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSaveRetention}
                disabled={
                  savingRetention ||
                  dirtyRetentionIds.length === 0 ||
                  hasInvalidRetentionDays
                }
                className="px-4 py-2 text-sm font-medium rounded-lg bg-google-blue text-white hover:bg-google-blue-hover disabled:opacity-50 transition-colors"
              >
                {savingRetention ? "Saving..." : "Save triage retention"}
              </button>
              {retentionSaved && <span className="text-sm text-google-green">Saved</span>}
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
            <div>AI triaged (total): {retroJob.ai_classified_count}</div>
            <div>AI → Triage–Trash: {retroJob.ai_trash_count}</div>
            <div>AI → Triage–Temporary: {retroJob.ai_temporary_count}</div>
            {retroJob.status === "failed" && retroJob.error_message != null ? (
              <div className="pt-2 text-xs whitespace-pre-wrap">{retroJob.error_message}</div>
            ) : null}
          </div>
        )}

        <div className="pt-6 border-t border-google-border space-y-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h3 className="text-base font-semibold text-google-text">Past runs</h3>
            <button
              type="button"
              onClick={() => void loadRetroRuns()}
              disabled={retroRunsLoading}
              className="text-sm px-3 py-1.5 rounded-lg border border-google-border text-google-text-secondary hover:bg-google-bg disabled:opacity-50"
            >
              {retroRunsLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {retroRunsLoading && retroRuns.length === 0 ? (
            <div className="flex justify-center py-6">
              <div className="h-6 w-6 rounded-full border-4 border-google-blue border-t-transparent animate-spin" />
            </div>
          ) : retroRuns.length === 0 ? (
            <p className="text-sm text-google-text-secondary">No historical classification jobs yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-google-border">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-google-bg border-b border-google-border">
                  <tr className="text-left text-google-text-secondary">
                    <th className="px-3 py-2 font-medium sticky left-0 bg-google-bg">Date range</th>
                    <th className="px-3 py-2 font-medium text-center">AI</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium text-right">Proc.</th>
                    <th className="px-3 py-2 font-medium text-right">Rules</th>
                    <th className="px-3 py-2 font-medium text-right">AIΣ</th>
                    <th className="px-3 py-2 font-medium text-right">Trash</th>
                    <th className="px-3 py-2 font-medium text-right">Tmp</th>
                  </tr>
                </thead>
                <tbody>
                  {retroRuns.map((j) => (
                    <tr
                      key={j.id}
                      className={`border-t border-google-border ${
                        j.id === retroJobId && (j.status === "pending" || j.status === "running")
                          ? "bg-blue-50/80"
                          : ""
                      }`}
                    >
                      <td className="px-3 py-2 sticky left-0 bg-white text-google-text whitespace-normal min-w-[9rem]">
                        {formatShortDate(j.date_from)} – {formatShortDate(j.date_to)}
                      </td>
                      <td className="px-3 py-2 text-center text-google-text">{j.use_ai ? "Yes" : "No"}</td>
                      <td className="px-3 py-2 text-google-text">{j.status}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{j.processed_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{j.rule_matched_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{j.ai_classified_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{j.ai_trash_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{j.ai_temporary_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-2 text-xs text-google-text-tertiary bg-google-bg border-t border-google-border whitespace-normal">
                Proc. = messages processed · Rules = rule matches · AIΣ / Trash / Tmp = AI triage totals and split
                by bucket · Column headers abbreviated on small screens; scroll horizontally.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
