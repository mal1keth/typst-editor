import { useState } from "react";
import { api, type User } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

interface Props {
  user: User;
  onClose: () => void;
}

export function AccountSettings({ user, onClose }: Props) {
  const { checkAuth } = useAuthStore();
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      await api.auth.setPassword(
        password,
        user.hasPassword ? currentPassword : undefined
      );
      setSuccess("Password updated successfully");
      setPassword("");
      setCurrentPassword("");
      await checkAuth();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-gray-800 bg-gray-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">
            Account Settings
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300"
          >
            &times;
          </button>
        </div>

        <div className="mb-6 space-y-2 text-sm">
          <div>
            <span className="text-gray-500">Name: </span>
            <span className="text-gray-200">{user.displayName}</span>
          </div>
          <div>
            <span className="text-gray-500">Email: </span>
            <span className="text-gray-200">{user.email || "Not set"}</span>
          </div>
          <div>
            <span className="text-gray-500">GitHub: </span>
            {user.hasGithub ? (
              <span className="text-green-400">
                {user.githubLogin} (connected)
              </span>
            ) : (
              <a
                href="/api/auth/connect-github"
                className="text-blue-400 hover:text-blue-300"
              >
                Connect GitHub
              </a>
            )}
          </div>
        </div>

        <form onSubmit={handleSetPassword} className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-300">
            {user.hasPassword ? "Change Password" : "Set Password"}
          </h3>
          {user.hasPassword && (
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          )}
          <input
            type="password"
            placeholder="New password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          {error && <div className="text-sm text-red-400">{error}</div>}
          {success && <div className="text-sm text-green-400">{success}</div>}
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving
              ? "Saving..."
              : user.hasPassword
                ? "Update Password"
                : "Set Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
