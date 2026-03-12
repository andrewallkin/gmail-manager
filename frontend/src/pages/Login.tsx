import { useState } from "react";
import { login } from "../lib/api";

export function Login() {
  const [loading, setLoading] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const error = params.get("google") === "error"
    ? (params.get("message") ?? "Authentication failed. Please try again.")
    : null;

  async function handleSignIn() {
    setLoading(true);
    try {
      const ok = await login();
      if (ok) {
        window.location.href = "/";
        return;
      }
      window.location.href = "/api/auth/google/connect";
    } catch {
      window.location.href = "/api/auth/google/connect";
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 text-center space-y-6">
          <div className="flex flex-col items-center gap-3">
            <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center">
              <svg className="h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Gmail <span className="text-blue-500">Manager</span>
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Manage labels, rules, and cleanup your inbox
              </p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200 text-left"
            >
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleSignIn}
            disabled={loading}
            className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 disabled:opacity-70 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors shadow-sm"
          >
            {loading && (
              <span className="h-5 w-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
            )}
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  );
}
