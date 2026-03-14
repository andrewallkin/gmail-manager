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
        <h1 className="text-2xl font-bold text-gray-900">Restore (Temporary)</h1>
        <p className="mt-1 text-sm text-gray-600">
          Moves `in:trash is:read` back to Inbox with full pagination and rollback manifests.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Run Restore</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Query</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Batch Size</label>
            <input
              type="number"
              min={1}
              max={1000}
              value={batchSize}
              onChange={(e) => setBatchSize(Math.max(1, Math.min(1000, Number(e.target.value) || 100)))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onPreview}
            disabled={previewing || running}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            {previewing ? "Previewing..." : "Preview"}
          </button>
          <button
            onClick={onRunRestore}
            disabled={running || previewing}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {running ? "Running..." : "Run Restore"}
          </button>
        </div>

        {preview && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-800">
            Preview found {preview.estimated_count} messages across {preview.pages_scanned} pages.
          </div>
        )}

        {result && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
            Restored {result.messages_restored}/{result.messages_seen} messages across {result.pages_scanned} pages.
            Manifest: <span className="font-mono">{result.manifest_name}</span>. Errors: {result.errors}.
          </div>
        )}

        {rollbackResult && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
            Rolled back {rollbackResult.rolled_back_count}/{rollbackResult.target_count} from{" "}
            <span className="font-mono">{rollbackResult.manifest_name}</span>. Errors: {rollbackResult.errors}.
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <h2 className="text-lg font-semibold text-gray-900 px-6 py-4 border-b border-gray-200">
          Rollback Manifests
        </h2>
        {loadingManifests ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Manifest</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Seen</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Restored</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Errors</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {manifests.map((m) => (
                <tr key={m.name} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs text-gray-900">{m.name}</div>
                    <div className="text-xs text-gray-500">{m.created_at ?? "-"}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{m.messages_seen}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{m.messages_restored}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{m.errors}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      disabled={m.rolled_back || rollingBack === m.name}
                      onClick={() => onRollback(m.name)}
                      className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition-colors"
                    >
                      {m.rolled_back ? "Rolled Back" : rollingBack === m.name ? "Rolling Back..." : "Rollback"}
                    </button>
                  </td>
                </tr>
              ))}
              {manifests.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
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
