import { useState, useEffect } from "react";
import { api, type GithubRepo, type GithubStatus } from "@/lib/api";

interface Props {
  projectId: string;
  onClose: () => void;
  onPullComplete: () => void;
}

export function GitHubPanel({ projectId, onClose, onPullComplete }: Props) {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const syncing = pulling || pushing;

  useEffect(() => {
    loadStatus();
  }, [projectId]);

  async function loadStatus() {
    setLoading(true);
    try {
      const s = await api.github.status(projectId);
      setStatus(s);
      if (!s.linked) {
        const r = await api.github.repos();
        setRepos(r);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLink() {
    if (!selectedRepo) return;
    setPulling(true);
    setError(null);
    try {
      await api.github.link(projectId, selectedRepo);
      await api.github.pull(projectId);
      await loadStatus();
      onPullComplete();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPulling(false);
    }
  }

  async function handlePull() {
    setPulling(true);
    setError(null);
    try {
      await api.github.pull(projectId);
      await loadStatus();
      onPullComplete();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPulling(false);
    }
  }

  async function handlePush() {
    if (!commitMsg.trim()) return;
    setPushing(true);
    setError(null);
    try {
      await api.github.push(projectId, commitMsg.trim());
      setCommitMsg("");
      await loadStatus();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPushing(false);
    }
  }

  async function handleUnlink() {
    if (!confirm("Unlink from GitHub? Local files will be kept.")) return;
    try {
      await api.github.unlink(projectId);
      await loadStatus();
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (loading) {
    return (
      <div className="p-4 text-gray-400">Loading GitHub status...</div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          GitHub
        </span>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
          x
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {error && (
          <div className="rounded border border-red-500/30 bg-red-950/50 p-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {status && !status.linked ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-400">Link to a GitHub repository</p>
            <select
              value={selectedRepo}
              onChange={(e) => setSelectedRepo(e.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-200"
            >
              <option value="">Select a repo...</option>
              {repos.map((r) => (
                <option key={r.fullName} value={r.fullName}>
                  {r.fullName}
                </option>
              ))}
            </select>
            <button
              onClick={handleLink}
              disabled={!selectedRepo || syncing}
              className="w-full rounded bg-blue-600 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {syncing ? "Linking..." : "Link & Pull"}
            </button>
          </div>
        ) : status ? (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-gray-500">Repo: </span>
              <span className="text-gray-200">{status.repoFullName}</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-500">Branch: </span>
              <span className="text-gray-200">{status.branch}</span>
            </div>

            {status.error ? (
              <>
                <div className="rounded border border-yellow-500/30 bg-yellow-950/30 p-2 text-sm text-yellow-300">
                  {status.error}
                </div>
                <button
                  onClick={() => { setError(null); loadStatus(); }}
                  disabled={loading}
                  className="w-full rounded bg-gray-800 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                >
                  {loading ? "Checking..." : "Retry"}
                </button>
              </>
            ) : (
              <>
                <div className="text-sm">
                  <span className="text-gray-500">Status: </span>
                  <span
                    className={status.inSync ? "text-green-400" : "text-yellow-400"}
                  >
                    {status.inSync ? "In sync" : "Out of sync"}
                  </span>
                </div>

                <div className="space-y-2">
                  <button
                    onClick={handlePull}
                    disabled={syncing}
                    className="w-full rounded bg-gray-800 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                  >
                    {pulling ? "Pulling..." : "Pull"}
                  </button>

                  <div className="space-y-2">
                    <input
                      type="text"
                      value={commitMsg}
                      onChange={(e) => setCommitMsg(e.target.value)}
                      placeholder="Commit message..."
                      className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                      onKeyDown={(e) => e.key === "Enter" && handlePush()}
                    />
                    <button
                      onClick={handlePush}
                      disabled={syncing || !commitMsg.trim()}
                      className="w-full rounded bg-green-700 py-1.5 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-50"
                    >
                      {pushing ? "Pushing..." : "Push"}
                    </button>
                  </div>
                </div>
              </>
            )}

            <button
              onClick={handleUnlink}
              className="w-full text-xs text-gray-500 hover:text-red-400"
            >
              Unlink from GitHub
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
