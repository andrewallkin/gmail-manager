import { useEffect, useMemo, useRef, useState } from "react";
import {
  LabelItem,
  PreviewResult,
  RuleCreate,
  RuleItem,
  createRule,
  deleteRule,
  fetchLabels,
  fetchRules,
  previewRule,
  reorderRules,
  runRule,
  updateRule,
} from "../lib/api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ReorderRulesDialog } from "../components/ReorderRulesDialog";
import { parseUtcDate } from "../lib/format";

const emptyRule: RuleCreate = {
  name: "",
  enabled: true,
  match_from: null,
  match_from_exclude: null,
  match_to: null,
  match_subject: null,
  match_has_words: null,
  match_doesnt_have: null,
  match_label_id: null,
  action_label_id: null,
  action_archive: false,
  action_delete: false,
  action_mark_read: false,
  stop_on_match: false,
  scope: "all_inbox",
};

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const diffMin = Math.floor((Date.now() - parseUtcDate(dateStr).getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function Badge({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "blue" | "green" | "red" | "yellow" | "purple" }) {
  const styles = {
    neutral: "bg-google-bg text-google-text-secondary",
    blue: "bg-google-blue-light text-google-blue",
    green: "bg-google-green-light text-google-green",
    red: "bg-gmail-red-light text-gmail-red",
    yellow: "bg-google-yellow-light text-google-yellow-text",
    purple: "bg-purple-100 text-purple-700",
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[tone]}`}>{text}</span>;
}

export function RulesPage() {
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRuleId, setSelectedRuleId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<RuleCreate>(emptyRule);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmDeleteRule, setConfirmDeleteRule] = useState<RuleItem | null>(null);
  const [deletingRule, setDeletingRule] = useState(false);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const runResultTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userLabels = useMemo(
    () => labels.filter((l) => l.label_type === "user").sort((a, b) => a.name.localeCompare(b.name)),
    [labels]
  );
  const selectedRule = rules.find((rule) => rule.id === selectedRuleId) ?? null;
  const isFormOpen = editingId !== null;

  const load = () => {
    setLoading(true);
    Promise.all([fetchRules(), fetchLabels()])
      .then(([rulesData, labelsData]) => {
        setRules(rulesData);
        setLabels(labelsData);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!runResult) return;
    runResultTimeoutRef.current = setTimeout(() => setRunResult(null), 5000);
    return () => {
      if (runResultTimeoutRef.current) clearTimeout(runResultTimeoutRef.current);
    };
  }, [runResult]);

  useEffect(() => {
    if (!selectedRuleId && rules.length > 0) {
      setSelectedRuleId(rules[0].id);
      return;
    }
    if (selectedRuleId && !rules.some((rule) => rule.id === selectedRuleId)) {
      setSelectedRuleId(rules[0]?.id ?? null);
    }
  }, [rules, selectedRuleId]);

  const labelName = (id: number | null | undefined) => {
    if (!id) return null;
    return labels.find((label) => label.id === id)?.name ?? `#${id}`;
  };

  const summarizeConditions = (rule: RuleItem): string[] => {
    const items: string[] = [];
    if (rule.match_from) items.push(`From: ${rule.match_from}`);
    if (rule.match_from_exclude) items.push(`Excludes: ${rule.match_from_exclude}`);
    if (rule.match_to) items.push(`To: ${rule.match_to}`);
    if (rule.match_subject) items.push(`Subject: ${rule.match_subject}`);
    if (rule.match_label_id) items.push(`Label: ${labelName(rule.match_label_id)}`);
    if (items.length === 0) items.push("No explicit conditions");
    return items.slice(0, 3);
  };

  const summarizeActions = (rule: RuleItem): string[] => {
    const items: string[] = [];
    if (rule.action_label_id) items.push(`Apply ${labelName(rule.action_label_id)}`);
    if (rule.action_archive) items.push("Archive");
    if (rule.action_delete) items.push("Delete");
    if (rule.action_mark_read) items.push("Mark read");
    if (items.length === 0) items.push("No action");
    return items;
  };

  const openCreate = () => {
    setEditingId(-1);
    setForm(emptyRule);
    setPreview(null);
  };

  const openEdit = (rule: RuleItem) => {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      enabled: rule.enabled,
      match_from: rule.match_from,
      match_from_exclude: rule.match_from_exclude,
      match_to: rule.match_to,
      match_subject: rule.match_subject,
      match_has_words: rule.match_has_words,
      match_doesnt_have: rule.match_doesnt_have,
      match_label_id: rule.match_label_id,
      action_label_id: rule.action_label_id,
      action_archive: rule.action_archive,
      action_delete: rule.action_delete,
      action_mark_read: rule.action_mark_read,
      stop_on_match: rule.stop_on_match,
      scope: rule.scope,
      use_ai: rule.use_ai,
      ai_prompt: rule.ai_prompt,
      priority: rule.priority,
    });
    setPreview(null);
  };

  const closeForm = () => {
    setEditingId(null);
    setPreview(null);
  };

  const updateField = <K extends keyof RuleCreate>(key: K, value: RuleCreate[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!form.name?.trim()) return;
    setSaving(true);
    try {
      if (editingId === -1) {
        await createRule(form);
      } else if (editingId) {
        await updateRule(editingId, form);
      }
      closeForm();
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDeleteRule) return;
    setDeletingRule(true);
    try {
      await deleteRule(confirmDeleteRule.id);
      setConfirmDeleteRule(null);
      if (selectedRuleId === confirmDeleteRule.id) {
        setSelectedRuleId(null);
      }
      load();
    } finally {
      setDeletingRule(false);
    }
  };

  const handleRun = async (rule: RuleItem) => {
    setRunningId(rule.id);
    setRunResult(null);
    try {
      const result = await runRule(rule.id);
      const message = `Matched ${result.matched}, processed ${result.processed} messages across ${result.pages_scanned} page${result.pages_scanned === 1 ? "" : "s"}`;
      setRunResult(result.query ? `${message}\nQuery: ${result.query}` : message);
      load();
    } catch {
      setRunResult("Failed to run rule");
    } finally {
      setRunningId(null);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      setPreview(await previewRule(form));
    } catch {
      setPreview({ estimated_count: 0, query: "", sample_subjects: [] });
    } finally {
      setPreviewing(false);
    }
  };

  const persistReorder = async (previousRules: RuleItem[], reordered: RuleItem[]) => {
    setRules(reordered);
    try {
      const result = await reorderRules(reordered.map((rule) => rule.id));
      if (result.rule_ids?.length) {
        const byId = new Map(reordered.map((rule) => [rule.id, rule]));
        setRules(result.rule_ids.map((id) => byId.get(id)).filter(Boolean) as RuleItem[]);
      }
    } catch {
      setRules(previousRules);
      load();
    }
  };

  const handleSaveOrder = async (reordered: RuleItem[]) => {
    setSavingOrder(true);
    try {
      await persistReorder(rules, reordered);
      setReorderOpen(false);
    } finally {
      setSavingOrder(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 rounded-full border-4 border-google-blue border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-google-text">Rules</h1>
          <p className="text-sm text-google-text-secondary">Top priority runs first. Rules continue unless stop-on-match is enabled.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReorderOpen(true)}
            disabled={rules.length < 2}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-google-border text-google-text-secondary hover:bg-google-hover disabled:opacity-50 transition-colors"
          >
            Reorder
          </button>
          <button
            onClick={openCreate}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-google-blue text-white hover:bg-google-blue-hover transition-colors"
          >
            Create Rule
          </button>
        </div>
      </div>

      {runResult && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            runResult.startsWith("Failed")
              ? "bg-gmail-red-light border border-gmail-red-border text-gmail-red"
              : "bg-google-blue-light border border-google-blue-border text-google-blue"
          }`}
        >
          <div>{runResult.split("\n")[0]}</div>
          {runResult.includes("\n") && <div className="text-xs font-mono truncate mt-1">{runResult.split("\n")[1]}</div>}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDeleteRule}
        title="Delete rule"
        message={confirmDeleteRule ? `Delete rule "${confirmDeleteRule.name}"?` : ""}
        variant="danger"
        loading={deletingRule}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteRule(null)}
      />

      <ReorderRulesDialog
        open={reorderOpen}
        rules={rules}
        saving={savingOrder}
        onCancel={() => setReorderOpen(false)}
        onSave={handleSaveOrder}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-2">
          {rules.map((rule, idx) => (
            <button
              key={rule.id}
              type="button"
              onClick={() => setSelectedRuleId(rule.id)}
              className={`w-full text-left bg-white border rounded-xl px-3 py-3 transition-colors ${
                selectedRuleId === rule.id ? "border-google-blue ring-2 ring-google-blue-light" : "border-google-border"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-google-text-secondary">#{idx + 1}</span>
                  <span className={`inline-block w-2 h-2 rounded-full ${rule.enabled ? "bg-google-green" : "bg-google-border"}`} />
                  <span className="font-medium text-google-text truncate">{rule.name}</span>
                  {rule.stop_on_match && <Badge text="Stop on match" tone="purple" />}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {summarizeConditions(rule).map((item) => (
                    <Badge key={item} text={item} />
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {summarizeActions(rule).map((item) => (
                    <Badge key={`${rule.id}-${item}`} text={item} tone="blue" />
                  ))}
                  <Badge text={rule.scope === "all_inbox" ? "All Inbox" : "Primary"} tone="purple" />
                </div>
              </div>
            </button>
          ))}
          {rules.length === 0 && (
            <div className="bg-white rounded-xl border border-google-border p-6 text-center text-google-text-secondary">
              No rules yet. Click "Create Rule" to get started.
            </div>
          )}
        </div>

        <aside className="bg-white border border-google-border rounded-2xl p-4 space-y-4 h-fit xl:sticky xl:top-4">
          {isFormOpen ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-google-text">{editingId === -1 ? "Create Rule" : "Edit Rule"}</h2>
                <button onClick={closeForm} className="text-sm text-google-text-secondary hover:text-google-text">Close</button>
              </div>
              <div>
                <label className="block text-xs font-medium text-google-text-secondary mb-1">Rule Name</label>
                <input
                  type="text"
                  value={form.name ?? ""}
                  onChange={(e) => updateField("name", e.target.value)}
                  className="w-full px-3 py-2 border border-google-border rounded-lg text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-google-text-secondary">
                <input type="checkbox" checked={!!form.enabled} onChange={(e) => updateField("enabled", e.target.checked)} />
                Rule enabled
              </label>
              <div className="grid grid-cols-1 gap-2">
                <input className="px-3 py-2 border border-google-border rounded-lg text-sm" placeholder="From" value={form.match_from ?? ""} onChange={(e) => updateField("match_from", e.target.value || null)} />
                <input className="px-3 py-2 border border-google-border rounded-lg text-sm" placeholder="From excludes" value={form.match_from_exclude ?? ""} onChange={(e) => updateField("match_from_exclude", e.target.value || null)} />
                <input className="px-3 py-2 border border-google-border rounded-lg text-sm" placeholder="To" value={form.match_to ?? ""} onChange={(e) => updateField("match_to", e.target.value || null)} />
                <input className="px-3 py-2 border border-google-border rounded-lg text-sm" placeholder="Subject contains" value={form.match_subject ?? ""} onChange={(e) => updateField("match_subject", e.target.value || null)} />
                <input className="px-3 py-2 border border-google-border rounded-lg text-sm" placeholder="Has words" value={form.match_has_words ?? ""} onChange={(e) => updateField("match_has_words", e.target.value || null)} />
                <input className="px-3 py-2 border border-google-border rounded-lg text-sm" placeholder="Doesn't have words" value={form.match_doesnt_have ?? ""} onChange={(e) => updateField("match_doesnt_have", e.target.value || null)} />
                <select className="px-3 py-2 border border-google-border rounded-lg text-sm" value={form.match_label_id ?? ""} onChange={(e) => updateField("match_label_id", e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Match label: none</option>
                  {userLabels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
                </select>
                <select className="px-3 py-2 border border-google-border rounded-lg text-sm" value={form.action_label_id ?? ""} onChange={(e) => updateField("action_label_id", e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Apply label: none</option>
                  {userLabels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
                </select>
                <div className="flex flex-wrap gap-3 text-sm text-google-text-secondary">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!form.action_archive} onChange={(e) => updateField("action_archive", e.target.checked)} />Archive</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!form.action_delete} onChange={(e) => updateField("action_delete", e.target.checked)} />Delete</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!form.action_mark_read} onChange={(e) => updateField("action_mark_read", e.target.checked)} />Mark read</label>
                </div>
                <label className="flex items-start gap-2 text-sm text-google-text-secondary">
                  <input type="checkbox" className="mt-0.5" checked={!!form.stop_on_match} onChange={(e) => updateField("stop_on_match", e.target.checked)} />
                  <span>Stop processing later rules when this rule matches.</span>
                </label>
                <div className="flex gap-4 text-sm text-google-text-secondary">
                  <label className="flex items-center gap-2"><input type="radio" name="scope" checked={form.scope === "primary"} onChange={() => updateField("scope", "primary")} />Primary</label>
                  <label className="flex items-center gap-2"><input type="radio" name="scope" checked={form.scope === "all_inbox"} onChange={() => updateField("scope", "all_inbox")} />All Inbox</label>
                </div>
              </div>
              {preview && (
                <div className="bg-google-bg border border-google-border rounded-lg p-3 text-sm">
                  <div className="font-medium text-google-text-secondary">
                    {preview.estimated_count} email{preview.estimated_count === 1 ? "" : "s"} match this rule
                  </div>
                  {preview.query && <div className="mt-1 text-xs font-mono text-google-text-tertiary truncate">Query: {preview.query}</div>}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button onClick={handleSave} disabled={saving || !form.name?.trim()} className="px-4 py-2 text-sm rounded-lg bg-google-blue text-white hover:bg-google-blue-hover disabled:opacity-50">
                  {saving ? "Saving..." : editingId === -1 ? "Create" : "Update"}
                </button>
                <button onClick={handlePreview} disabled={previewing} className="px-4 py-2 text-sm rounded-lg border border-google-border text-google-text-secondary hover:bg-google-hover">
                  {previewing ? "Checking..." : "Preview"}
                </button>
                <button onClick={closeForm} className="px-4 py-2 text-sm rounded-lg border border-google-border text-google-text-secondary hover:bg-google-hover">
                  Cancel
                </button>
              </div>
            </div>
          ) : selectedRule ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-google-text truncate">{selectedRule.name}</h2>
              <div className="flex flex-wrap gap-1.5">
                <Badge text={selectedRule.enabled ? "Enabled" : "Disabled"} tone={selectedRule.enabled ? "green" : "neutral"} />
                <Badge text={selectedRule.scope === "all_inbox" ? "All Inbox" : "Primary"} tone="purple" />
                {selectedRule.stop_on_match && <Badge text="Stops evaluation" tone="purple" />}
              </div>
              <div className="text-sm text-google-text-secondary space-y-1">
                {selectedRule.match_from && <div>From: {selectedRule.match_from}</div>}
                {selectedRule.match_from_exclude && <div>From excludes: {selectedRule.match_from_exclude}</div>}
                {selectedRule.match_to && <div>To: {selectedRule.match_to}</div>}
                {selectedRule.match_subject && <div>Subject: {selectedRule.match_subject}</div>}
                {selectedRule.match_has_words && <div>Has words: {selectedRule.match_has_words}</div>}
                {selectedRule.match_doesnt_have && <div>Doesn't have: {selectedRule.match_doesnt_have}</div>}
                {selectedRule.match_label_id && <div>Match label: {labelName(selectedRule.match_label_id)}</div>}
                {selectedRule.action_label_id && <div>Apply label: {labelName(selectedRule.action_label_id)}</div>}
              </div>
              {(selectedRule.total_matched > 0 || selectedRule.last_matched_at) && (
                <div className="text-xs text-google-text-tertiary">
                  {selectedRule.total_matched} matched
                  {selectedRule.last_matched_at && ` · last ${relativeTime(selectedRule.last_matched_at)}`}
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={() => handleRun(selectedRule)} disabled={runningId === selectedRule.id} className="px-3 py-1.5 text-xs rounded-md border border-google-border text-google-text-secondary hover:bg-google-hover">
                  {runningId === selectedRule.id ? "Running..." : "Run"}
                </button>
                <button onClick={() => openEdit(selectedRule)} className="px-3 py-1.5 text-xs rounded-md border border-google-border text-google-text-secondary hover:bg-google-hover">Edit</button>
                <button onClick={() => setConfirmDeleteRule(selectedRule)} className="px-3 py-1.5 text-xs rounded-md border border-gmail-red-border text-gmail-red hover:bg-gmail-red-light">Delete</button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-google-text-secondary">Select a rule to view details, or create a new one.</div>
          )}
        </aside>
      </div>
    </div>
  );
}
