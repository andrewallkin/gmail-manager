import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { RuleItem } from "../lib/api";

type ReorderRulesDialogProps = {
  open: boolean;
  rules: RuleItem[];
  saving?: boolean;
  onCancel: () => void;
  onSave: (reordered: RuleItem[]) => void | Promise<void>;
};

const COACH_MARK_KEY = "rules-reorder-coach-seen";

export function ReorderRulesDialog({ open, rules, saving = false, onCancel, onSave }: ReorderRulesDialogProps) {
  const [staged, setStaged] = useState<RuleItem[]>(rules);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [showCoach, setShowCoach] = useState(false);
  const rowRefs = useRef<Map<number, HTMLLIElement>>(new Map());
  const pendingScrollId = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setStaged(rules);
      setActiveId(null);
      setAnnouncement("");
      try {
        if (!localStorage.getItem(COACH_MARK_KEY)) setShowCoach(true);
      } catch {
        /* ignore */
      }
    }
  }, [open, rules]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onCancel]);

  useEffect(() => {
    if (pendingScrollId.current === null) return;
    const node = rowRefs.current.get(pendingScrollId.current);
    pendingScrollId.current = null;
    if (node) node.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [staged]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const changedCount = useMemo(() => {
    let count = 0;
    for (let i = 0; i < staged.length; i++) {
      if (rules[i]?.id !== staged[i]?.id) count += 1;
    }
    return count;
  }, [rules, staged]);

  const activeRule = activeId === null ? null : staged.find((r) => r.id === activeId) ?? null;

  if (!open) return null;

  const dismissCoach = () => {
    setShowCoach(false);
    try {
      localStorage.setItem(COACH_MARK_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = Number(event.active.id);
    setActiveId(id);
    const idx = staged.findIndex((r) => r.id === id);
    const rule = staged[idx];
    if (rule) setAnnouncement(`Picked up "${rule.name}" at position ${idx + 1} of ${staged.length}.`);
    dismissCoach();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) {
      setAnnouncement("Cancelled.");
      return;
    }
    const oldIndex = staged.findIndex((r) => r.id === Number(active.id));
    const newIndex = staged.findIndex((r) => r.id === Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(staged, oldIndex, newIndex);
    pendingScrollId.current = Number(active.id);
    setStaged(next);
    const rule = staged[oldIndex];
    if (rule) {
      setAnnouncement(`Moved "${rule.name}" from position ${oldIndex + 1} to position ${newIndex + 1}.`);
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setAnnouncement("Cancelled.");
  };

  const handleSave = async () => {
    if (changedCount === 0) {
      onCancel();
      return;
    }
    await onSave(staged);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reorder-dialog-title"
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 pb-3 space-y-1">
          <h2 id="reorder-dialog-title" className="text-lg font-semibold text-google-text">
            Reorder rules
          </h2>
          <p className="text-sm text-google-text-secondary">
            Top rule runs first. Rules continue unless "Stop on match" is enabled.
          </p>
        </div>

        {showCoach && (
          <div className="mx-6 mb-3 flex items-start justify-between gap-3 rounded-lg bg-google-blue-light border border-google-blue-border px-3 py-2 text-xs text-google-blue">
            <span>Drag any row to reorder. Or focus a row and press Space, then use the arrow keys.</span>
            <button
              type="button"
              onClick={dismissCoach}
              className="shrink-0 text-google-blue hover:underline"
              aria-label="Dismiss tip"
            >
              Got it
            </button>
          </div>
        )}

        <div
          role="status"
          aria-live="polite"
          className="sr-only"
        >
          {announcement}
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-3">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={staged.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {staged.map((rule, idx) => (
                  <SortableRow
                    key={rule.id}
                    rule={rule}
                    index={idx}
                    registerRef={(node) => {
                      if (node) rowRefs.current.set(rule.id, node);
                      else rowRefs.current.delete(rule.id);
                    }}
                  />
                ))}
              </ul>
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeRule ? <RowContent rule={activeRule} index={staged.findIndex((r) => r.id === activeRule.id)} elevated /> : null}
            </DragOverlay>
          </DndContext>
        </div>

        <div className="border-t border-google-border px-6 py-4 flex items-center justify-between gap-3">
          <span className="text-xs text-google-text-secondary">
            {changedCount === 0
              ? "No position changes"
              : `${changedCount} rule${changedCount === 1 ? "" : "s"} will change position`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-google-border text-google-text-secondary hover:bg-google-hover disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || changedCount === 0}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-google-blue text-white hover:bg-google-blue-hover disabled:opacity-50 transition-colors"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Saving
                </span>
              ) : (
                "Save order"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type SortableRowProps = {
  rule: RuleItem;
  index: number;
  registerRef: (node: HTMLLIElement | null) => void;
};

function SortableRow({ rule, index, registerRef }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: rule.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? "transform 150ms ease",
  };

  return (
    <li
      ref={(node) => {
        setNodeRef(node);
        registerRef(node);
      }}
      style={style}
      {...attributes}
      {...listeners}
      className={`relative ${isDragging ? "opacity-40" : ""}`}
    >
      {isOver && !isDragging && (
        <span className="pointer-events-none absolute -top-1 left-0 right-0 h-0.5 rounded-full bg-google-blue" />
      )}
      <RowContent rule={rule} index={index} />
    </li>
  );
}

function RowContent({ rule, index, elevated = false }: { rule: RuleItem; index: number; elevated?: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 bg-white border rounded-lg px-3 py-2.5 select-none cursor-grab active:cursor-grabbing ${
        elevated ? "border-google-blue shadow-lg scale-[1.02]" : "border-google-border hover:border-google-blue/60"
      }`}
    >
      <span className="text-xs font-medium text-google-text-secondary w-6 tabular-nums">#{index + 1}</span>
      <span
        className={`inline-block w-2 h-2 rounded-full ${rule.enabled ? "bg-google-green" : "bg-google-border"}`}
        aria-hidden="true"
      />
      <span className="flex-1 min-w-0 font-medium text-google-text truncate">{rule.name}</span>
      <span className="text-xs text-google-text-tertiary shrink-0">
        {rule.scope === "all_inbox" ? "All Inbox" : "Primary"}
        {rule.stop_on_match ? " · Stop" : ""}
      </span>
      <svg className="w-4 h-4 text-google-text-tertiary shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="5" r="1.5" />
        <circle cx="15" cy="5" r="1.5" />
        <circle cx="9" cy="12" r="1.5" />
        <circle cx="15" cy="12" r="1.5" />
        <circle cx="9" cy="19" r="1.5" />
        <circle cx="15" cy="19" r="1.5" />
      </svg>
    </div>
  );
}
