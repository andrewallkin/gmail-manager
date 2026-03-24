import { useEffect, useState } from "react";
import {
  fetchRestoreManifests,
  previewRestore,
  RestoreManifestItem,
  rollbackRestore,
  runRestore,
} from "../lib/api";

const DEFAULT_QUERY = "in:trash is:read";

export function RestorePage() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [batchSize, setBatchSize] = useState(100);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [loadingManifests, setLoadingManifests] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ estimated_count: number; pages_scanned: number } | null>(null);
  const [result, setResult] = useState<{
    manifest_name: string;
    messages_seen: number;
    messages_restored: number;
    pages_scanned: number;
    errors: number;
  } | null>(null);
  const [rollbackResult, setRollbackResult] = useState<{
    manifest_name: string;
    target_count: number;
    rolled_back_count: number;
    errors: number;
  } | null>(null);
  const [manifests, setManifests] = useState<RestoreManifestItem[]>([]);

  const loadManifests = async () => {
    setLoadingManifests(true);
    try {
      const response = await fetchRestoreManifests();
      setManifests(response.items);
    } catch {
      setError("Failed to load restore manifests.");
    } finally {
      setLoadingManifests(false);
    }
  };

  useEffect(() => {
    loadManifests();
  }, []);

  const onPreview = async () => {
    setPreviewing(true);
    setError(null);
    setResult(null);
    setRollbackResult(null);
    try {
      const response = await previewRestore({ query });
      setPreview({
        estimated_count: response.estimated_count,
        pages_scanned: response.pages_scanned,
      });
    } catch {
      setError("Preview failed. Check your query and try again.");
    } finally {
      setPreviewing(false);
    }
  };

  const onRunRestore = async () => {
    setRunning(true);
    setError(null);
    setRollbackResult(null);
    try {
      const response = await runRestore({
        query,
        batch_size: batchSize,
      });
      setResult({
        manifest_name: response.manifest_name,
        messages_seen: response.messages_seen,
        messages_restored: response.messages_restored,
        pages_scanned: response.pages_scanned,
        errors: response.errors,
      });
      await loadManifests();
    } catch {
      setError("Restore failed. Please retry.");
    } finally {
      setRunning(false);
    }
  };

  const onRollback = async (manifestName: string) => {
    setRollingBack(manifestName);
    setError(null);
    setResult(null);
    try {
      const response = await rollbackRestore({
        manifest_name: manifestName,
        batch_size: batchSize,
      });
      setRollbackResult(response);
      await loadManifests();
    } catch {
      setError("Rollback failed. It may already be rolled back or unavailable.");
    } finally {
      setRollingBack(null);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-google-text">Restore (Temporary)</h1>
        <p className="mt-1 text-sm text-google-text-secondary">
          Moves `in:trash is:read` back to Inbox with full pagination and rollback manifests.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-google-border shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold text-google-text">Run Restore</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-google-text-secondary mb-1">Query</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full px-3 py-2 border border-google-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-google-blue"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-google-text-secondary mb-1">Batch Size</label>
            <input
              type="number"
              min={1}
              max={1000}
              value={batchSize}
              onChange={(e) => setBatchSize(Math.max(1, Math.min(1000, Number(e.target.value) || 100)))}
              className="w-full px-3 py-2 border border-google-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-google-blue"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onPreview}
            disabled={previewing || running}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-google-border text-google-text-secondary hover:bg-google-hover disabled:opacity-50 transition-colors"
          >
            {previewing ? "Previewing..." : "Preview"}
          </button>
          <button
            onClick={onRunRestore}
            disabled={running || previewing}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-google-blue text-white hover:bg-google-blue-hover disabled:opacity-50 transition-colors"
          >
            {running ? "Running..." : "Run Restore"}
          </button>
        </div>

        {preview && (
          <div className="bg-google-yellow-light border border-google-yellow-text/20 rounded-lg px-4 py-3 text-sm text-google-yellow-text">
            Preview found {preview.estimated_count} messages across {preview.pages_scanned} pages.
          </div>
        )}

        {result && (
          <div className="bg-google-green-light border border-google-green/20 rounded-lg px-4 py-3 text-sm text-google-green">
            Restored {result.messages_restored}/{result.messages_seen} messages across {result.pages_scanned} pages.
            Manifest: <span className="font-mono">{result.manifest_name}</span>. Errors: {result.errors}.
          </div>
        )}

        {rollbackResult && (
          <div className="bg-google-blue-light border border-google-blue-border rounded-lg px-4 py-3 text-sm text-google-blue">
            Rolled back {rollbackResult.rolled_back_count}/{rollbackResult.target_count} from{" "}
            <span className="font-mono">{rollbackResult.manifest_name}</span>. Errors: {rollbackResult.errors}.
          </div>
        )}

        {error && (
          <div className="bg-gmail-red-light border border-gmail-red-border rounded-lg px-4 py-3 text-sm text-gmail-red">
            {error}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-google-border shadow-sm overflow-hidden">
        <h2 className="text-lg font-semibold text-google-text px-6 py-4 border-b border-google-border">
          Rollback Manifests
        </h2>
        {loadingManifests ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 rounded-full border-4 border-google-blue border-t-transparent animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-google-bg border-b border-google-border">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-google-text-secondary">Manifest</th>
                <th className="text-right px-4 py-3 font-medium text-google-text-secondary">Seen</th>
                <th className="text-right px-4 py-3 font-medium text-google-text-secondary">Restored</th>
                <th className="text-right px-4 py-3 font-medium text-google-text-secondary">Errors</th>
                <th className="text-right px-4 py-3 font-medium text-google-text-secondary">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-google-border-light">
              {manifests.map((m) => (
                <tr key={m.name} className="hover:bg-google-hover">
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs text-google-text">{m.name}</div>
                    <div className="text-xs text-google-text-tertiary">{m.created_at ?? "-"}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-google-text-secondary">{m.messages_seen}</td>
                  <td className="px-4 py-3 text-right text-google-text-secondary">{m.messages_restored}</td>
                  <td className="px-4 py-3 text-right text-google-text-secondary">{m.errors}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      disabled={m.rolled_back || rollingBack === m.name}
                      onClick={() => onRollback(m.name)}
                      className="px-3 py-1.5 text-xs font-medium rounded-md border border-google-border text-google-text-secondary hover:bg-google-hover disabled:opacity-50 transition-colors"
                    >
                      {m.rolled_back ? "Rolled Back" : rollingBack === m.name ? "Rolling Back..." : "Rollback"}
                    </button>
                  </td>
                </tr>
              ))}
              {manifests.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-google-text-secondary">
                    No restore manifests yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
