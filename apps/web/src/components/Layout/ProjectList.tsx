import { useEffect, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { useAuthStore } from "@/stores/authStore";
import { AccountSettings } from "@/components/Auth/AccountSettings";
import { ImportGitHubDialog } from "@/components/GitHub/ImportGitHubDialog";

interface Props {
  onOpenProject: (id: string) => void;
}

export function ProjectList({ onOpenProject }: Props) {
  const { user, logout } = useAuthStore();
  const {
    ownedProjects,
    collabProjects,
    loadingList,
    loadProjects,
    createProject,
    deleteProject,
  } = useProjectStore();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const project = await createProject(newName.trim());
      setNewName("");
      onOpenProject(project.id);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 p-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-100">Projects</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">{user?.displayName}</span>
            {user?.avatarUrl && (
              <img
                src={user.avatarUrl}
                alt=""
                className="h-8 w-8 rounded-full"
              />
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="rounded px-3 py-1 text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            >
              Settings
            </button>
            <button
              onClick={logout}
              className="rounded px-3 py-1 text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            >
              Logout
            </button>
          </div>
        </div>

        <form onSubmit={handleCreate} className="mb-8 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New project name..."
            className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Create
          </button>
          {user?.hasGithub && (
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800"
            >
              Import from GitHub
            </button>
          )}
        </form>

        {loadingList ? (
          <p className="text-gray-400">Loading...</p>
        ) : (
          <>
            {ownedProjects.length === 0 && collabProjects.length === 0 && (
              <p className="text-gray-500">No projects yet. Create one above.</p>
            )}

            {ownedProjects.length > 0 && (
              <div className="mb-8">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
                  Your Projects
                </h2>
                <div className="space-y-2">
                  {ownedProjects.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 p-4 transition hover:border-gray-700"
                    >
                      <button
                        onClick={() => onOpenProject(p.id)}
                        className="flex-1 text-left"
                      >
                        <span className="font-medium text-gray-100">
                          {p.name}
                        </span>
                        {p.githubRepoFullName && (
                          <span className="ml-2 text-xs text-gray-500">
                            {p.githubRepoFullName}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${p.name}"?`)) deleteProject(p.id);
                        }}
                        className="ml-4 text-sm text-gray-500 hover:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {collabProjects.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
                  Shared with you
                </h2>
                <div className="space-y-2">
                  {collabProjects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => onOpenProject(p.id)}
                      className="w-full rounded-lg border border-gray-800 bg-gray-900 p-4 text-left transition hover:border-gray-700"
                    >
                      <span className="font-medium text-gray-100">
                        {p.name}
                      </span>
                      <span className="ml-2 rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                        {p.role}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showSettings && user && (
        <AccountSettings
          user={user}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showImport && (
        <ImportGitHubDialog
          onClose={() => setShowImport(false)}
          onImported={(projectId) => {
            setShowImport(false);
            loadProjects();
            onOpenProject(projectId);
          }}
        />
      )}
    </div>
  );
}
