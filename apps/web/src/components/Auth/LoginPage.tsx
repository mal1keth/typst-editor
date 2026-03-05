import { useState } from "react";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { checkAuth } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "register") {
        await api.auth.register(email, password, displayName);
      } else {
        await api.auth.login(email, password);
      }
      await checkAuth();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm px-4">
        <h1 className="mb-2 text-center text-4xl font-bold text-gray-100">
          Typst Editor
        </h1>
        <p className="mb-8 text-center text-gray-400">
          Collaborative Typst editing with GitHub integration
        </p>

        <form onSubmit={handleSubmit} className="mb-4 space-y-3">
          {mode === "register" && (
            <input
              type="text"
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />

          {error && (
            <div className="rounded border border-red-500/30 bg-red-950/50 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-3 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {loading
              ? "..."
              : mode === "register"
                ? "Create Account"
                : "Sign In"}
          </button>
        </form>

        {mode === "login" && (
          <div className="mb-4 text-center">
            <button
              onClick={() =>
                alert(
                  "Please contact the administrator to reset your password."
                )
              }
              className="text-sm text-gray-500 hover:text-gray-300"
            >
              Forgot password?
            </button>
          </div>
        )}

        <div className="mb-6 text-center text-sm text-gray-500">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                onClick={() => {
                  setMode("register");
                  setError(null);
                }}
                className="text-blue-400 hover:text-blue-300"
              >
                Register
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
                className="text-blue-400 hover:text-blue-300"
              >
                Sign in
              </button>
            </>
          )}
        </div>

        <div className="mb-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-800" />
          <span className="text-xs text-gray-500">OR</span>
          <div className="h-px flex-1 bg-gray-800" />
        </div>

        <div className="flex flex-col gap-3">
          <a
            href="/api/auth/github"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-800 px-6 py-3 text-lg font-medium text-gray-100 transition hover:bg-gray-700"
          >
            <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Sign in with GitHub
          </a>
        </div>

        <div className="mt-4 text-center">
          <a
            href="/api/auth/dev-login"
            className="text-sm text-gray-500 transition hover:text-gray-300"
          >
            Dev login (no OAuth)
          </a>
        </div>
      </div>
    </div>
  );
}
