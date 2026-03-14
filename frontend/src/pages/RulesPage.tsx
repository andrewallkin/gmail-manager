import { useEffect, useState } from "react";
import { RuleItem, RuleCreate, LabelItem, fetchRules, fetchLabels, createRule, updateRule, deleteRule, runRule } from "../lib/api";

const emptyRule: RuleCreate = {
  name: "",
  enabled: true,
  match_from: null,
  match_subject: null,
  match_has_words: null,
  action_label_id: null,
  action_archive: false,
  action_delete: false,
  action_mark_read: false,
  scope_promotions: false,
  scope_social: false,
  scope_updates: false,
  scope_forums: false,
  scope_all_inbox: false,
};

const SCOPE_OPTIONS = [
  { key: "scope_all_inbox" as const, label: "All inbox" },
  { key: "scope_promotions" as const, label: "Promotions" },
  { key: "scope_social" as const, label: "Social" },
  { key: "scope_updates" as const, label: "Updates" },
  { key: "scope_forums" as const, label: "Forums" },
];

export function RulesPage() {
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<RuleCreate>(emptyRule);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([fetchRules(), fetchLabels()])
      .then(([r, l]) => { setRules(r); setLabels(l); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const labelName = (id: number | null | undefined) => {
    if (!id) return null;
    return labels.find(l => l.id === id)?.name ?? null;
  };

  const openCreate = () => {
    setForm(emptyRule);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (rule: RuleItem) => {
    setForm({
      name: rule.name,
      enabled: rule.enabled,
      match_from: rule.match_from,
      match_to: rule.match_to,
      match_subject: rule.match_subject,
      match_has_words: rule.match_has_words,
      match_doesnt_have: rule.match_doesnt_have,
      match_label_id: rule.match_label_id,
      action_label_id: rule.action_label_id,
      action_archive: rule.action_archive,
      action_delete: rule.action_delete,
      action_mark_read: rule.action_mark_read,
      action_delete_after_days: rule.action_delete_after_days,
      scope_promotions: rule.scope_promotions,
      scope_social: rule.scope_social,
      scope_updates: rule.scope_updates,
      scope_forums: rule.scope_forums,
      scope_all_inbox: rule.scope_all_inbox ?? false,
      use_ai: rule.use_ai,
      ai_prompt: rule.ai_prompt,
    });
    setEditingId(rule.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateRule(editingId, form);
      } else {
        await createRule(form);
      }
      setShowForm(false);
      load();
    } catch {} finally { setSaving(false); }
  };

  const handleDelete = async (rule: RuleItem) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    try {
      await deleteRule(rule.id);
      load();
    } catch {}
  };

  const handleRun = async (rule: RuleItem) => {
    setRunningId(rule.id);
    setRunResult(null);
    try {
      const result = await runRule(rule.id);
      const msg = `Matched ${result.matched}, processed ${result.processed} messages`;
      setRunResult(result.query ? `${msg}\nQuery: ${result.query}` : msg);
    } catch {
      setRunResult("Failed to run rule");
    } finally { setRunningId(null); }
  };

  const updateField = <K extends keyof RuleCreate>(key: K, value: RuleCreate[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const getScopeBadges = (rule: RuleItem) => {
    if (rule.scope_all_inbox ?? false) return ["All inbox"];
    const scopes: string[] = [];
    if (rule.scope_promotions) scopes.push("Promotions");
    if (rule.scope_social) scopes.push("Social");
    if (rule.scope_updates) scopes.push("Updates");
    if (rule.scope_forums) scopes.push("Forums");
    return scopes.length > 0 ? scopes : ["Primary"];
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  const formPanel = showForm && (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">
        {editingId ? "Edit Rule" : "Create Rule"}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Rule Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="e.g., Archive newsletters"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">From (email/domain)</label>
          <input
            type="text"
            value={form.match_from ?? ""}
            onChange={(e) => updateField("match_from", e.target.value || null)}
            placeholder="e.g., newsletter@example.com"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subject contains</label>
          <input
            type="text"
            value={form.match_subject ?? ""}
            onChange={(e) => updateField("match_subject", e.target.value || null)}
            placeholder="e.g., Weekly digest"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Has words</label>
          <input
            type="text"
            value={form.match_has_words ?? ""}
            onChange={(e) => updateField("match_has_words", e.target.value || null)}
            placeholder="e.g., unsubscribe promotion"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Scope</label>
        <p className="text-xs text-gray-400 mb-2">Select categories to target. No categories = Primary inbox only.</p>
        {(form.match_from ?? "").toLowerCase().includes("receipt") && !form.scope_all_inbox && !form.scope_updates && (
          <p className="text-xs text-amber-600 mb-2">Tip: Receipt emails often land in Updates. Consider checking Updates or All inbox.</p>
        )}
        <div className="flex flex-wrap gap-4">
          {SCOPE_OPTIONS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form[key] ?? false}
                onChange={(e) => updateField(key, e.target.checked)}
                className="rounded border-gray-300"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Actions</label>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.action_archive}
              onChange={(e) => updateField("action_archive", e.target.checked)}
              className="rounded border-gray-300"
            />
            Archive
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.action_delete}
              onChange={(e) => updateField("action_delete", e.target.checked)}
              className="rounded border-gray-300"
            />
            Delete
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.action_mark_read}
              onChange={(e) => updateField("action_mark_read", e.target.checked)}
              className="rounded border-gray-300"
            />
            Mark as Read
          </label>
        </div>
        <div className="mt-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">Apply label</label>
          <select
            value={form.action_label_id ?? ""}
            onChange={(e) => updateField("action_label_id", e.target.value ? Number(e.target.value) : null)}
            className="w-full sm:w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">None</option>
            {labels
              .filter((l) => l.label_type === "user")
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={saving || !form.name.trim()}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : editingId ? "Update" : "Create"}
        </button>
        <button
          onClick={() => setShowForm(false)}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Rules</h1>
        <button
          onClick={openCreate}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
        >
          Create Rule
        </button>
      </div>

      {runResult && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700 flex justify-between items-start gap-4">
          <div className="min-w-0 flex-1">
            <div>{runResult.split("\n")[0]}</div>
            {runResult.includes("\n") && (
              <div className="mt-1 text-xs text-blue-600 font-mono truncate" title={runResult.split("\n").slice(1).join(" ")}>
                {runResult.split("\n").slice(1).join(" ")}
              </div>
            )}
          </div>
          <button onClick={() => setRunResult(null)} className="text-blue-500 hover:text-blue-700 flex-shrink-0">&times;</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          {rules.map((rule) => (
            <div key={rule.id} className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${rule.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                    <span className="font-medium text-gray-900 truncate">{rule.name}</span>
                  </div>
                  <div className="mt-2 text-xs text-gray-500 space-y-1">
                    {rule.match_from && <div>From: {rule.match_from}</div>}
                    {rule.match_subject && <div>Subject: {rule.match_subject}</div>}
                    {rule.match_has_words && <div>Words: {rule.match_has_words}</div>}
                    {rule.match_label_id && <div>Match label: {labelName(rule.match_label_id) ?? `#${rule.match_label_id}`}</div>}
                    {rule.action_label_id && <div>Apply label: {labelName(rule.action_label_id) ?? `#${rule.action_label_id}`}</div>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {getScopeBadges(rule).map(s => (
                      <span key={s} className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">{s}</span>
                    ))}
                    {rule.action_label_id && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        Label: {labelName(rule.action_label_id) ?? `#${rule.action_label_id}`}
                      </span>
                    )}
                    {rule.action_archive && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Archive</span>}
                    {rule.action_delete && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Delete</span>}
                    {rule.action_mark_read && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Mark Read</span>}
                  </div>
                </div>
                <div className="flex gap-2 ml-4 flex-shrink-0">
                  <button
                    onClick={() => handleRun(rule)}
                    disabled={runningId === rule.id}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition-colors"
                  >
                    {runningId === rule.id ? "Running..." : "Run"}
                  </button>
                  <button
                    onClick={() => openEdit(rule)}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(rule)}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-red-300 text-red-700 hover:bg-red-50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
          {rules.length === 0 && !showForm && (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
              No rules yet. Click "Create Rule" to get started.
            </div>
          )}
        </div>

        <div>
          {formPanel}
        </div>
      </div>
    </div>
  );
}
