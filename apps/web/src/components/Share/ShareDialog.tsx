import { useState, useEffect } from "react";
import { api, type ShareLink } from "@/lib/api";

interface Props {
  projectId: string;
  onClose: () => void;
}

export function ShareDialog({ projectId, onClose }: Props) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [permission, setPermission] = useState<"read" | "write">("read");
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadLinks();
  }, [projectId]);

  async function loadLinks() {
    try {
      const data = await api.shares.list(projectId);
      setLinks(data.filter((l) => l.isActive));
    } catch {
      // Not admin, can't list
    }
  }

  async function handleCreate() {
    setCreating(true);
    try {
      await api.shares.create(projectId, permission);
      await loadLinks();
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(shareId: string) {
    await api.shares.revoke(projectId, shareId);
    await loadLinks();
  }

  function copyLink(token: string, id: string) {
    const url = `${window.location.origin}/s/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">Share Project</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200"
          >
            x
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          <select
            value={permission}
            onChange={(e) =>
              setPermission(e.target.value as "read" | "write")
            }
            className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200"
          >
            <option value="read">Read only</option>
            <option value="write">Read & Write</option>
          </select>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Generate Link
          </button>
        </div>

        {links.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Active Links
            </h3>
            {links.map((link) => (
              <div
                key={link.id}
                className="flex items-center justify-between rounded border border-gray-800 p-2"
              >
                <div className="flex-1 min-w-0">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      link.permission === "write"
                        ? "bg-yellow-900/50 text-yellow-300"
                        : "bg-gray-800 text-gray-400"
                    }`}
                  >
                    {link.permission}
                  </span>
                  <span className="ml-2 text-xs text-gray-500">
                    Used {link.useCount}x
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => copyLink(link.token, link.id)}
                    className="rounded px-2 py-1 text-xs text-blue-400 hover:bg-gray-800"
                  >
                    {copiedId === link.id ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={() => handleRevoke(link.id)}
                    className="rounded px-2 py-1 text-xs text-red-400 hover:bg-gray-800"
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
