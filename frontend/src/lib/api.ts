const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

const FETCH_OPTS: RequestInit = { credentials: "include" };

function handle401(response: Response, redirectOn401: boolean): void {
  if (response.status === 401) {
    if (redirectOn401) {
      window.location.href = "/";
    }
    throw new Error("Unauthorized");
  }
}

// --- Types ---

export type Status = {
  connected: boolean;
  email: string | null;
  display_name: string | null;
  profile_picture_url: string | null;
  ai_enabled: boolean;
  ai_provider: string | null;
  auto_remove_inbox_labeled_read: boolean;
  polling_enabled: boolean;
  polling_interval_minutes: number;
  google_auth_broken: boolean;
  triage_labels_ok: boolean;
};

export type LabelItem = {
  id: number;
  gmail_label_id: string;
  name: string;
  label_type: string;
  color_bg: string | null;
  color_text: string | null;
  ai_description: string | null;
  retention_days: number | null;
  retention_scope: "all" | "read_only" | "unread_only";
  message_count: number;
  unread_count: number;
  synced_at: string | null;
};

export type RuleItem = {
  id: number;
  name: string;
  enabled: boolean;
  match_from: string | null;
  match_from_exclude: string | null;
  match_to: string | null;
  match_subject: string | null;
  match_has_words: string | null;
  match_doesnt_have: string | null;
  match_label_id: number | null;
  action_label_id: number | null;
  action_archive: boolean;
  action_delete: boolean;
  action_mark_read: boolean;
  stop_on_match: boolean;
  scope: "primary" | "all_inbox";
  use_ai: boolean;
  ai_prompt: string | null;
  priority: number;
  total_matched: number;
  last_matched_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RuleCreate = {
  name: string;
  enabled?: boolean;
  match_from?: string | null;
  match_from_exclude?: string | null;
  match_to?: string | null;
  match_subject?: string | null;
  match_has_words?: string | null;
  match_doesnt_have?: string | null;
  match_label_id?: number | null;
  action_label_id?: number | null;
  action_archive?: boolean;
  action_delete?: boolean;
  action_mark_read?: boolean;
  stop_on_match?: boolean;
  scope?: "primary" | "all_inbox";
  use_ai?: boolean;
  ai_prompt?: string | null;
  priority?: number;
};

export type CleanupItem = {
  id: number;
  label_filter: string | null;
  sender_filter: string | null;
  subject_filter: string | null;
  date_from: string | null;
  date_to: string | null;
  action: string;
  status: string;
  total_messages: number;
  processed_messages: number;
  created_at: string;
  completed_at: string | null;
};

export type PreviewMessageSummary = {
  message_id: string;
  sender: string;
  subject: string;
  date: string;
};

export type CleanupPreviewResult = {
  total_count: number;
  messages: PreviewMessageSummary[];
};

export type SettingsUpdate = {
  ai_enabled?: boolean;
  ai_provider?: string | null;
  ai_api_key?: string | null;
  auto_remove_inbox_labeled_read?: boolean;
  polling_enabled?: boolean;
  polling_interval_minutes?: number;
};

export type RetentionItem = {
  category: string;
  retention_days: number;
  enabled: boolean;
};

export type RetentionData = {
  items: RetentionItem[];
};

export type RestoreManifestItem = {
  name: string;
  created_at: string | null;
  query: string | null;
  messages_seen: number;
  messages_restored: number;
  errors: number;
  rolled_back: boolean;
};

// --- Helpers ---

async function getJson<T>(path: string, redirectOn401 = true): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, FETCH_OPTS);
  handle401(response, redirectOn401);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body?: unknown, redirectOn401 = true): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...FETCH_OPTS,
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  handle401(response, redirectOn401);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return (await response.json()) as T;
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...FETCH_OPTS,
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  handle401(response, true);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return (await response.json()) as T;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...FETCH_OPTS,
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  handle401(response, true);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return (await response.json()) as T;
}

async function deleteReq(path: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...FETCH_OPTS,
    method: "DELETE",
  });
  handle401(response, true);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
}

// --- Auth ---

export async function fetchStatus(): Promise<Status | null> {
  const response = await fetch(`${API_BASE}/settings`, FETCH_OPTS);
  if (response.status === 401) return null;
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return (await response.json()) as Status;
}

export async function login(): Promise<boolean> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    ...FETCH_OPTS,
    method: "POST",
  });
  if (response.ok) return true;
  if (response.status === 401 || response.status === 404) return false;
  throw new Error(`Login failed: ${response.status}`);
}

export async function logout(): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/logout`, {
    ...FETCH_OPTS,
    method: "POST",
  });
  handle401(response, true);
  if (!response.ok) throw new Error(`Logout failed: ${response.status}`);
}

export async function disconnectGoogle(): Promise<void> {
  await deleteReq("/auth/google/disconnect");
}

// --- Labels ---

export async function fetchLabels(): Promise<LabelItem[]> {
  return getJson<LabelItem[]>("/labels");
}

export async function syncLabels(): Promise<{ synced: number }> {
  return postJson("/labels/sync");
}

export async function createLabel(name: string, bg_color?: string, text_color?: string): Promise<LabelItem> {
  return postJson("/labels", { name, bg_color, text_color });
}

export async function updateLabel(
  id: number,
  body: {
    name?: string;
    bg_color?: string;
    text_color?: string;
    ai_description?: string;
    retention_days?: number | null;
    retention_scope?: "all" | "read_only" | "unread_only";
  }
): Promise<LabelItem> {
  return patchJson(`/labels/${id}`, body);
}

export async function deleteLabel(id: number): Promise<void> {
  await deleteReq(`/labels/${id}`);
}

// --- Rules ---

export async function fetchRules(): Promise<RuleItem[]> {
  return getJson<RuleItem[]>("/rules");
}

export async function createRule(rule: RuleCreate): Promise<RuleItem> {
  return postJson("/rules", rule);
}

export async function updateRule(id: number, rule: RuleCreate): Promise<RuleItem> {
  return putJson(`/rules/${id}`, rule);
}

export async function deleteRule(id: number): Promise<void> {
  await deleteReq(`/rules/${id}`);
}

export async function runRule(
  id: number
): Promise<{ matched: number; processed: number; query: string; pages_scanned: number }> {
  return postJson(`/rules/${id}/run`);
}

export async function reorderRules(ruleIds: number[]): Promise<{ reordered: boolean; rule_ids: number[] }> {
  return putJson("/rules/reorder", { rule_ids: ruleIds });
}

export type PreviewResult = {
  estimated_count: number;
  query: string;
  sample_subjects: string[];
};

export async function previewRule(rule: RuleCreate): Promise<PreviewResult> {
  return postJson("/rules/preview", rule);
}

// --- Cleanup ---

export async function startCleanup(body: {
  label_filter?: string;
  sender_filter?: string;
  subject_filter?: string;
  date_from?: string;
  date_to?: string;
  action: string;
}): Promise<CleanupItem> {
  return postJson("/cleanup", body);
}

export async function fetchCleanups(): Promise<CleanupItem[]> {
  return getJson<CleanupItem[]>("/cleanup");
}

export async function previewCleanup(body: {
  label_filter?: string;
  sender_filter?: string;
  subject_filter?: string;
  date_from?: string;
  date_to?: string;
}): Promise<CleanupPreviewResult> {
  return postJson("/cleanup/preview", body);
}

export type RetroClassificationJob = {
  id: number;
  date_from: string;
  date_to: string;
  use_ai: boolean;
  status: string;
  page_token: string | null;
  processed_count: number;
  rule_matched_count: number;
  ai_classified_count: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

export async function createRetroClassificationJob(body: {
  date_from: string;
  date_to: string;
  use_ai?: boolean;
}): Promise<{ job_id: number }> {
  const response = await fetch(`${API_BASE}/cleanup/retroactive`, {
    ...FETCH_OPTS,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  handle401(response, true);
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const data = await response.clone().json();
      if (data && typeof data.detail === "string") {
        message = data.detail;
      }
    } catch {
      message = await response.text();
      if (!message.trim()) message = `Request failed: ${response.status}`;
    }
    throw new Error(message);
  }
  return (await response.json()) as { job_id: number };
}

export async function fetchRetroClassificationJob(jobId: number): Promise<RetroClassificationJob> {
  return getJson<RetroClassificationJob>(`/cleanup/retroactive/${jobId}`);
}

export type GmailCategoryTab = "promotions" | "social" | "updates" | "forums";

export type InboxInspectorResult = {
  gmail_query: string;
  fetched_count: number;
  label_map: Record<string, string>;
  messages: unknown[];
};

export async function fetchInboxInspector(body: {
  date_from: string;
  date_to: string;
  max_messages: number;
  primary_only?: boolean;
  important_only?: boolean;
  include_categories?: GmailCategoryTab[];
  exclude_categories?: GmailCategoryTab[];
  custom_gmail_q?: string;
  merge_date_range_with_custom?: boolean;
}): Promise<InboxInspectorResult> {
  return postJson("/debug/inbox", body);
}

// --- Restore (temporary) ---

export async function previewRestore(body: {
  query?: string;
}): Promise<{ query: string; estimated_count: number; pages_scanned: number }> {
  return postJson("/restore/preview", body);
}

export async function runRestore(body: {
  query?: string;
  batch_size?: number;
}): Promise<{
  manifest_name: string;
  query: string;
  pages_scanned: number;
  messages_seen: number;
  messages_restored: number;
  errors: number;
}> {
  return postJson("/restore/run", body);
}

export async function rollbackRestore(body: {
  manifest_name: string;
  batch_size?: number;
}): Promise<{
  manifest_name: string;
  target_count: number;
  rolled_back_count: number;
  errors: number;
}> {
  return postJson("/restore/rollback", body);
}

export async function fetchRestoreManifests(): Promise<{ items: RestoreManifestItem[] }> {
  return getJson("/restore/manifests");
}

// --- Settings ---

export async function updateSettings(settings: SettingsUpdate): Promise<Status> {
  return patchJson("/settings", settings);
}

export async function fetchRetention(): Promise<RetentionData> {
  return getJson<RetentionData>("/settings/retention");
}

export async function updateRetention(items: RetentionItem[]): Promise<RetentionData> {
  return putJson("/settings/retention", { items });
}
