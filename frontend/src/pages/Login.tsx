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
    <div className="min-h-screen bg-google-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-lg border border-google-border p-8 text-center space-y-6">
          <div className="flex flex-col items-center gap-3">
            <div className="h-16 w-16 flex items-center justify-center">
              <svg viewBox="0 0 48 48" className="h-14 w-14">
                <path d="M6 12L24 26L42 12" stroke="#d93025" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                <rect x="4" y="8" width="40" height="32" rx="4" stroke="#5f6368" strokeWidth="2" fill="none"/>
                <path d="M4 12l20 14 20-14" fill="#ea4335" opacity="0.12"/>
                <path d="M6 12L24 26" stroke="#4285f4" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M42 12L24 26" stroke="#34a853" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M4 38l14-14" stroke="#fbbc04" strokeWidth="2" strokeLinecap="round"/>
                <path d="M44 38L30 24" stroke="#ea4335" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-google-text">
                Gmail <span className="text-google-blue">Manager</span>
              </h1>
              <p className="mt-1 text-sm text-google-text-tertiary">
                Manage labels, rules, and cleanup your inbox
              </p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg px-4 py-3 text-sm bg-gmail-red-light text-gmail-red border border-gmail-red-border text-left"
            >
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleSignIn}
            disabled={loading}
            className="flex items-center justify-center gap-3 w-full px-6 py-3 bg-google-blue hover:bg-google-blue-hover active:bg-google-blue-hover disabled:opacity-70 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors shadow-sm"
          >
            {loading ? (
              <span className="h-5 w-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  );
}
