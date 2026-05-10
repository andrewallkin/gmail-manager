import { useEffect, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LabelItem, fetchLabels, syncLabels, createLabel, updateLabel, deleteLabel } from "../lib/api";

function isTriageLabel(name: string): boolean {
  return name.startsWith("Action/Triage-");
}

function retentionScopeShort(scope: LabelItem["retention_scope"]) {
  if (scope === "read_only") return "Read only";
  if (scope === "unread_only") return "Unread only";
  return "";
}

const GMAIL_LABEL_COLORS = [
  { bg: "#000000", text: "#ffffff" },
  { bg: "#434343", text: "#ffffff" },
  { bg: "#666666", text: "#ffffff" },
  { bg: "#999999", text: "#ffffff" },
  { bg: "#cccccc", text: "#000000" },
  { bg: "#efefef", text: "#000000" },
  { bg: "#fb4c2f", text: "#ffffff" },
  { bg: "#ffad47", text: "#ffffff" },
  { bg: "#fad165", text: "#000000" },
  { bg: "#16a766", text: "#ffffff" },
  { bg: "#43d692", text: "#000000" },
  { bg: "#4a86e8", text: "#ffffff" },
  { bg: "#a479e2", text: "#ffffff" },
  { bg: "#f691b3", text: "#000000" },
  { bg: "#f6c5be", text: "#000000" },
  { bg: "#ffe6c7", text: "#000000" },
  { bg: "#b9e4d0", text: "#000000" },
  { bg: "#c6f3de", text: "#000000" },
  { bg: "#c9daf8", text: "#000000" },
  { bg: "#e4d7f5", text: "#000000" },
  { bg: "#fcdee8", text: "#000000" },
  { bg: "#fbe983", text: "#000000" },
  { bg: "#b3efd3", text: "#000000" },
  { bg: "#a0eac9", text: "#000000" },
];

export function LabelsPage() {
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBg, setNewBg] = useState("");
  const [newText, setNewText] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editBg, setEditBg] = useState("");
  const [editText, setEditText] = useState("");
  const [editRetention, setEditRetention] = useState<string>("");
  const [editRetentionScope, setEditRetentionScope] = useState<LabelItem["retention_scope"]>("all");
  const [savingEdit, setSavingEdit] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | "user" | "system">("user");
  const [typeSortDirection, setTypeSortDirection] = useState<"asc" | "desc" | null>(null);
  const [confirmDeleteLabel, setConfirmDeleteLabel] = useState<LabelItem | null>(null);
  const [deletingLabel, setDeletingLabel] = useState(false);

  const load = () => {
    setLoading(true);
    fetchLabels()
      .then(setLabels)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncLabels();
      load();
    } catch {} finally { setSyncing(false); }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createLabel(newName.trim(), newBg || undefined, newText || undefined);
      setNewName("");
      setNewBg("");
      setNewText("");
      setShowCreate(false);
      load();
    } catch {} finally { setCreating(false); }
  };

  const handleDeleteClick = (label: LabelItem) => {
    setConfirmDeleteLabel(label);
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDeleteLabel) return;
    setDeletingLabel(true);
    try {
      await deleteLabel(confirmDeleteLabel.id);
      setConfirmDeleteLabel(null);
      load();
    } catch {} finally {
      setDeletingLabel(false);
    }
  };

  const startEdit = (label: LabelItem) => {
    setEditingId(label.id);
    setEditName(label.name);
    setEditBg(label.color_bg ?? "");
    setEditText(label.color_text ?? "");
    setEditRetention(label.retention_days != null ? String(label.retention_days) : "");
    setEditRetentionScope(label.retention_scope ?? "all");
  };

  const handleSaveEdit = async () => {
    if (editingId === null) return;
    setSavingEdit(true);
    try {
      await updateLabel(editingId, {
        name: editName,
        bg_color: editBg || undefined,
        text_color: editText || undefined,
        retention_days: editRetention ? Number(editRetention) : null,
        ...(isTriageLabel(editName.trim()) ? { retention_scope: editRetentionScope } : {}),
      });
      setEditingId(null);
      load();
    } catch {} finally { setSavingEdit(false); }
  };

  const ColorPicker = ({ selectedBg, onSelect }: { selectedBg: string; onSelect: (bg: string, text: string) => void }) => (
    <div className="flex flex-wrap gap-1.5">
      {GMAIL_LABEL_COLORS.map((c) => (
        <button
          key={c.bg}
          type="button"
          onClick={() => onSelect(c.bg, c.text)}
          className={`w-6 h-6 rounded-full border-2 transition-all ${
            selectedBg === c.bg ? "border-google-blue scale-110" : "border-google-border hover:border-google-text-tertiary"
          }`}
          style={{ backgroundColor: c.bg }}
        />
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 rounded-full border-4 border-google-blue border-t-transparent animate-spin" />
      </div>
    );
  }

  const filtered = labels.filter((l) => typeFilter === "all" || l.label_type === typeFilter);
  const displayed = typeSortDirection
    ? [...filtered].sort((a, b) => {
        const cmp = a.label_type.localeCompare(b.label_type);
        if (cmp !== 0) return typeSortDirection === "asc" ? cmp : -cmp;
        return a.name.localeCompare(b.name);
      })
    : filtered;

  const editingLabel = editingId !== null ? displayed.find((l) => l.id === editingId) : undefined;

  const cycleTypeSort = () => {
    setTypeSortDirection((d) => (d === null ? "asc" : d === "asc" ? "desc" : null));
  };

  const emptyMessage =
    typeFilter === "all"
      ? "No labels found. Click \"Sync from Gmail\" to import your labels."
      : typeFilter === "user"
        ? "No user labels found."
        : "No system labels found.";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-google-text">Labels</h1>
        <div className="flex items-center gap-4">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "all" | "user" | "system")}
            className="px-3 py-2 border border-google-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-google-blue bg-white"
          >
            <option value="all">All labels</option>
            <option value="user">User labels</option>
            <option value="system">System labels</option>
          </select>
          <div className="flex gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-google-border text-google-text-secondary hover:bg-google-hover disabled:opacity-50 transition-colors"
          >
            {syncing ? "Syncing..." : "Sync from Gmail"}
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-google-blue text-white hover:bg-google-blue-hover transition-colors"
          >
            Create Label
          </button>
          </div>
        </div>
      </div>

      {showCreate && (
        <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6 space-y-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-google-text-secondary mb-1">Label Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Enter label name"
                className="w-full px-3 py-2 border border-google-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-google-blue"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-google-blue text-white hover:bg-google-blue-hover disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewName(""); setNewBg(""); setNewText(""); }}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-google-border text-google-text-secondary hover:bg-google-hover transition-colors"
            >
              Cancel
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium text-google-text-secondary mb-2">Color</label>
            <ColorPicker selectedBg={newBg} onSelect={(bg, text) => { setNewBg(bg); setNewText(text); }} />
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-google-border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-google-bg border-b border-google-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-google-text-secondary">Name</th>
              <th className="text-left px-4 py-3 font-medium text-google-text-secondary">
                <button
                  type="button"
                  onClick={cycleTypeSort}
                  className="flex items-center gap-1 hover:text-google-text cursor-pointer"
                >
                  Type
                  {typeSortDirection === "asc" && <span className="text-xs">↑</span>}
                  {typeSortDirection === "desc" && <span className="text-xs">↓</span>}
                </button>
              </th>
              <th className="text-right px-4 py-3 font-medium text-google-text-secondary">Messages</th>
              <th className="text-right px-4 py-3 font-medium text-google-text-secondary">Unread</th>
              <th className="text-right px-4 py-3 font-medium text-google-text-secondary">Retention</th>
              <th className="text-right px-4 py-3 font-medium text-google-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-google-border-light">
            {displayed.map((label) => (
              <tr key={label.id} className="hover:bg-google-hover">
                <td className="px-4 py-3">
                  {editingId === label.id ? (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-2 py-1 border border-google-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-google-blue"
                      />
                      <ColorPicker selectedBg={editBg} onSelect={(bg, text) => { setEditBg(bg); setEditText(text); }} />
                      <div>
                        <label className="block text-xs font-medium text-google-text-secondary mb-1">Retention (days)</label>
                        <input
                          type="number"
                          min={1}
                          value={editRetention}
                          onChange={(e) => setEditRetention(e.target.value)}
                          placeholder="Always"
                          className="w-32 px-2 py-1 border border-google-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-google-blue"
                        />
                        {editingLabel != null && isTriageLabel(editingLabel.name) ? (
                          <div className="mt-2">
                            <label className="block text-xs font-medium text-google-text-secondary mb-1">
                              Apply retention to
                            </label>
                            <select
                              value={editRetentionScope}
                              onChange={(e) =>
                                setEditRetentionScope(e.target.value as LabelItem["retention_scope"])
                              }
                              className="w-full max-w-xs px-2 py-1 border border-google-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-google-blue bg-white"
                            >
                              <option value="all">All messages under label</option>
                              <option value="read_only">Read only</option>
                              <option value="unread_only">Unread only</option>
                            </select>
                          </div>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveEdit}
                          disabled={savingEdit}
                          className="px-3 py-1 text-xs font-medium rounded-md bg-google-blue text-white hover:bg-google-blue-hover disabled:opacity-50"
                        >
                          {savingEdit ? "Saving..." : "Save"}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1 text-xs font-medium rounded-md border border-google-border text-google-text-secondary hover:bg-google-hover"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 font-medium text-google-text">
                      {label.color_bg && (
                        <span
                          className="inline-block w-3 h-3 rounded-full"
                          style={{ backgroundColor: label.color_bg }}
                        />
                      )}
                      {label.name}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    label.label_type === "system" ? "bg-google-hover text-google-text-secondary" : "bg-google-blue-light text-google-blue"
                  }`}>
                    {label.label_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-google-text-secondary">{label.message_count}</td>
                <td className="px-4 py-3 text-right text-google-text-secondary">{label.unread_count}</td>
                <td className="px-4 py-3 text-right text-google-text-secondary">
                  {label.label_type === "user" ? (
                    label.retention_days != null ? (
                      <span>
                        {label.retention_days} days
                        {isTriageLabel(label.name) &&
                        label.retention_scope &&
                        label.retention_scope !== "all" ? (
                          <span className="block text-xs text-google-text-tertiary mt-0.5">
                            {retentionScopeShort(label.retention_scope)}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      "Always"
                    )
                  ) : (
                    ""
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {label.label_type === "user" && editingId !== label.id && (
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => startEdit(label)}
                        className="text-google-blue hover:text-google-blue-hover text-xs font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteClick(label)}
                        className="text-gmail-red hover:text-gmail-red-hover text-xs font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {displayed.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-google-text-secondary">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!confirmDeleteLabel}
        title="Delete label"
        message={
          confirmDeleteLabel
            ? `Delete label "${confirmDeleteLabel.name}"? This will also remove it from Gmail.`
            : ""
        }
        variant="danger"
        loading={deletingLabel}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteLabel(null)}
      />
    </div>
  );
}
