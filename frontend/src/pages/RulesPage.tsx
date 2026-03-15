import { useEffect, useState, useRef } from "react";
import {
  RuleItem, RuleCreate, LabelItem, PreviewResult,
  fetchRules, fetchLabels, createRule, updateRule, deleteRule, runRule,
  reorderRules, previewRule,
} from "../lib/api";
import { ConfirmDialog } from "../components/ConfirmDialog";

const emptyRule: RuleCreate = {
  name: "",
  enabled: true,
  match_from: null,
  match_to: null,
  match_subject: null,
  match_has_words: null,
  match_doesnt_have: null,
  match_label_id: null,
  action_label_id: null,
  action_archive: false,
  action_delete: false,
  action_mark_read: false,
  scope: "all_inbox",
};

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function GripIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
      <circle cx="9" cy="5" r="1.5" />
      <circle cx="15" cy="5" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="15" cy="19" r="1.5" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-lg">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <ChevronIcon open={open} />
        {title}
      </button>
      <div
        className="overflow-hidden transition-all duration-200"
        style={{ maxHeight: open ? "1000px" : "0", opacity: open ? 1 : 0 }}
      >
        <div className="px-4 pb-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

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
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmDeleteRule, setConfirmDeleteRule] = useState<RuleItem | null>(null);
  const [deletingRule, setDeletingRule] = useState(false);
  const dragItem = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const runResultTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([fetchRules(), fetchLabels()])
      .then(([r, l]) => { setRules(r); setLabels(l); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!runResult) return;
    runResultTimeoutRef.current = setTimeout(() => {
      setRunResult(null);
    }, 5000);
    return () => {
      if (runResultTimeoutRef.current) {
        clearTimeout(runResultTimeoutRef.current);
      }
    };
  }, [runResult]);

  useEffect(() => {
    if (!showForm) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeForm();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showForm]);

  const userLabels = labels
    .filter((l) => l.label_type === "user")
    .sort((a, b) => a.name.localeCompare(b.name));

  const labelName = (id: number | null | undefined) => {
    if (!id) return null;
    return labels.find(l => l.id === id)?.name ?? null;
  };

  const openCreate = () => {
    setForm(emptyRule);
    setEditingId(null);
    setPreview(null);
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
      scope: rule.scope,
      use_ai: rule.use_ai,
      ai_prompt: rule.ai_prompt,
    });
    setEditingId(rule.id);
    setPreview(null);
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
      setPreview(null);
      load();
    } catch {} finally { setSaving(false); }
  };

  const handleDeleteClick = (rule: RuleItem) => {
    setConfirmDeleteRule(rule);
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDeleteRule) return;
    setDeletingRule(true);
    try {
      await deleteRule(confirmDeleteRule.id);
      setConfirmDeleteRule(null);
      load();
    } catch {} finally {
      setDeletingRule(false);
    }
  };

  const handleRun = async (rule: RuleItem) => {
    setRunningId(rule.id);
    setRunResult(null);
    try {
      const result = await runRule(rule.id);
      const msg = `Matched ${result.matched}, processed ${result.processed} messages across ${result.pages_scanned} page${result.pages_scanned === 1 ? "" : "s"}`;
      setRunResult(result.query ? `${msg}\nQuery: ${result.query}` : msg);
      load(); // Refresh to show updated stats
    } catch {
      setRunResult("Failed to run rule");
    } finally { setRunningId(null); }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const result = await previewRule(form);
      setPreview(result);
    } catch {
      setPreview({ estimated_count: 0, query: "", sample_subjects: [] });
    } finally { setPreviewing(false); }
  };

  const updateField = <K extends keyof RuleCreate>(key: K, value: RuleCreate[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const getScopeBadges = (rule: RuleItem) => {
    return rule.scope === "all_inbox" ? ["All Inbox"] : ["Primary"];
  };

  // Drag and drop handlers
  const handleDragStart = (idx: number) => {
    dragItem.current = idx;
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOver(idx);
  };

  const handleDragEnd = () => {
    dragItem.current = null;
    setDragOver(null);
  };

  const handleDrop = async () => {
    if (dragItem.current === null || dragOver === null || dragItem.current === dragOver) return;
    const reordered = [...rules];
    const [dragged] = reordered.splice(dragItem.current, 1);
    reordered.splice(dragOver, 0, dragged);
    setRules(reordered);
    dragItem.current = null;
    setDragOver(null);
    try {
      await reorderRules(reordered.map(r => r.id));
    } catch {}
  };

  const handleMoveUp = async (idx: number) => {
    if (idx <= 0) return;
    const reordered = [...rules];
    [reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]];
    setRules(reordered);
    try {
      await reorderRules(reordered.map(r => r.id));
    } catch {}
  };

  const handleMoveDown = async (idx: number) => {
    if (idx >= rules.length - 1) return;
    const reordered = [...rules];
    [reordered[idx], reordered[idx + 1]] = [reordered[idx + 1], reordered[idx]];
    setRules(reordered);
    try {
      await reorderRules(reordered.map(r => r.id));
    } catch {}
  };

  const closeForm = () => {
    setShowForm(false);
    setPreview(null);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  const formModal = showForm && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={closeForm}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-900">
        {editingId ? "Edit Rule" : "Create Rule"}
      </h2>

      {/* Rule Name */}
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

      {/* Conditions Section */}
      <CollapsibleSection title="Conditions">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From (email/domain)</label>
            <input
              type="text"
              value={form.match_from ?? ""}
              onChange={(e) => updateField("match_from", e.target.value || null)}
              placeholder="e.g., newsletter@example.com, alerts@example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">Separate multiple values with commas (OR logic)</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To (recipient)</label>
            <input
              type="text"
              value={form.match_to ?? ""}
              onChange={(e) => updateField("match_to", e.target.value || null)}
              placeholder="e.g., me+alerts@example.com, team@example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">Separate multiple values with commas (OR logic)</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Subject contains</label>
            <input
              type="text"
              value={form.match_subject ?? ""}
              onChange={(e) => updateField("match_subject", e.target.value || null)}
              placeholder="e.g., Weekly digest, Monthly report"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">Separate multiple values with commas (OR logic)</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Has words</label>
            <input
              type="text"
              value={form.match_has_words ?? ""}
              onChange={(e) => updateField("match_has_words", e.target.value || null)}
              placeholder="e.g., unsubscribe promotion"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Doesn't have words</label>
            <input
              type="text"
              value={form.match_doesnt_have ?? ""}
              onChange={(e) => updateField("match_doesnt_have", e.target.value || null)}
              placeholder="e.g., important urgent"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Match label</label>
            <select
              value={form.match_label_id ?? ""}
              onChange={(e) => updateField("match_label_id", e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">None</option>
              {userLabels.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        </div>
      </CollapsibleSection>

      {/* Scope Section */}
      <CollapsibleSection title="Scope">
        <p className="text-xs text-gray-400 mb-2">Choose which inbox messages this rule applies to.</p>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="scope"
              checked={form.scope === "primary"}
              onChange={() => updateField("scope", "primary")}
              className="border-gray-300"
            />
            Primary
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="scope"
              checked={form.scope === "all_inbox"}
              onChange={() => updateField("scope", "all_inbox")}
              className="border-gray-300"
            />
            All Inbox
          </label>
        </div>
      </CollapsibleSection>

      {/* Actions Section */}
      <CollapsibleSection title="Actions">
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
          <label className="block text-xs font-medium text-gray-600 mb-1">Apply label</label>
          <select
            value={form.action_label_id ?? ""}
            onChange={(e) => updateField("action_label_id", e.target.value ? Number(e.target.value) : null)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">None</option>
            {userLabels.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      </CollapsibleSection>

      {/* Preview result */}
      {preview && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm">
          <div className="font-medium text-gray-700">
            {preview.estimated_count} email{preview.estimated_count !== 1 ? "s" : ""} match this rule
          </div>
          {preview.query && (
            <div className="text-xs text-gray-500 font-mono mt-1 truncate" title={preview.query}>
              Query: {preview.query}
            </div>
          )}
          {preview.sample_subjects.length > 0 && (
            <ul className="mt-2 space-y-1">
              {preview.sample_subjects.map((s, i) => (
                <li key={i} className="text-xs text-gray-600 truncate">- {s}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Form actions */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={saving || !form.name.trim()}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : editingId ? "Update" : "Create"}
        </button>
        <button
          onClick={handlePreview}
          disabled={previewing}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition-colors"
        >
          {previewing ? "Checking..." : "Preview"}
        </button>
        <button
          onClick={closeForm}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
        >
          Cancel
        </button>
      </div>
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
        <div
          className={`rounded-lg px-4 py-3 text-sm flex justify-between items-start gap-4 ${
            runResult.startsWith("Failed")
              ? "bg-red-50 border border-red-200 text-red-700"
              : "bg-blue-50 border border-blue-200 text-blue-700"
          }`}
        >
          <div className="min-w-0 flex-1">
            <div>{runResult.split("\n")[0]}</div>
            {runResult.includes("\n") && (
              <div className={`mt-1 text-xs font-mono truncate ${runResult.startsWith("Failed") ? "text-red-600" : "text-blue-600"}`} title={runResult.split("\n").slice(1).join(" ")}>
                {runResult.split("\n").slice(1).join(" ")}
              </div>
            )}
          </div>
          <button onClick={() => setRunResult(null)} className={runResult.startsWith("Failed") ? "text-red-500 hover:text-red-700 flex-shrink-0" : "text-blue-500 hover:text-blue-700 flex-shrink-0"}>&times;</button>
        </div>
      )}

      {formModal}

      <ConfirmDialog
        open={!!confirmDeleteRule}
        title="Delete rule"
        message={confirmDeleteRule ? `Delete rule "${confirmDeleteRule.name}"?` : ""}
        variant="danger"
        loading={deletingRule}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteRule(null)}
      />

      <div className="max-w-4xl space-y-4">
        <div className="mb-2">
          <h2 className="text-lg font-semibold text-gray-900">Rules (priority order)</h2>
          <p className="text-sm text-gray-500">Top rules run first. Drag to reorder.</p>
        </div>
        {rules.map((rule, idx) => (
          <div
            key={rule.id}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            className={`bg-white rounded-xl border border-gray-200 p-6 transition-colors ${
              dragOver === idx ? "ring-2 ring-blue-400 bg-blue-50/50" : ""
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                  <span className="text-xs font-medium text-gray-500">#{idx + 1}</span>
                  <div
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    className="pt-1 cursor-grab active:cursor-grabbing touch-none"
                  >
                    <GripIcon />
                  </div>
                </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${rule.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                      <span className="font-medium text-gray-900 truncate">{rule.name}</span>
                    </div>
                    <div className="mt-2 text-xs text-gray-500 space-y-1">
                      {rule.match_from && <div>From: {rule.match_from}</div>}
                      {rule.match_to && <div>To: {rule.match_to}</div>}
                      {rule.match_subject && <div>Subject: {rule.match_subject}</div>}
                      {rule.match_has_words && <div>Words: {rule.match_has_words}</div>}
                      {rule.match_doesnt_have && <div>Excludes: {rule.match_doesnt_have}</div>}
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
                    {/* Rule stats */}
                    {rule.total_matched > 0 && (
                      <div className="mt-2 text-xs text-gray-400">
                        {rule.total_matched} email{rule.total_matched !== 1 ? "s" : ""} matched
                        {rule.last_matched_at && ` · last ${relativeTime(rule.last_matched_at)}`}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => handleMoveUp(idx)}
                      disabled={idx === 0}
                      className="p-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="Move up"
                    >
                      <ChevronUpIcon />
                    </button>
                    <button
                      onClick={() => handleMoveDown(idx)}
                      disabled={idx === rules.length - 1}
                      className="p-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="Move down"
                    >
                      <ChevronDownIcon />
                    </button>
                  </div>
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
                    onClick={() => handleDeleteClick(rule)}
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
    </div>
  );
}
