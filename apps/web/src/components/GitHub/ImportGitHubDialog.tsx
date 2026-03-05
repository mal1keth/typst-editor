import { useState, useEffect } from "react";
import { api, type GithubRepo } from "../../lib/api";

interface Props {
  onClose: () => void;
  onImported: (projectId: string) => void;
}

export function ImportGitHubDialog({ onClose, onImported }: Props) {
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRepo, setSelectedRepo] = useState<GithubRepo | null>(null);
  const [repoCheck, setRepoCheck] = useState<{
    hasTypFiles: boolean;
    typFiles: string[];
    totalFiles: number;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.github
      .repos()
      .then(setRepos)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSelectRepo = async (repo: GithubRepo) => {
    setSelectedRepo(repo);
    setProjectName(repo.name);
    setRepoCheck(null);
    setChecking(true);
    setError(null);
    try {
      const check = await api.github.checkRepo(repo.owner, repo.name);
      setRepoCheck(check);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  };

  const handleImport = async () => {
    if (!selectedRepo) return;
    setImporting(true);
    setError(null);
    try {
      const result = await api.github.import(
        selectedRepo.fullName,
        selectedRepo.defaultBranch,
        projectName
      );
      onImported(result.projectId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  };

  const filteredRepos = repos.filter((r) =>
    r.fullName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-gray-800 bg-gray-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">
            Import from GitHub
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300"
          >
            &times;
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-500/30 bg-red-950/50 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {!selectedRepo ? (
          <>
            <input
              type="text"
              placeholder="Search repositories..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mb-3 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            <div className="flex-1 space-y-1 overflow-auto">
              {loading ? (
                <p className="text-sm text-gray-400">
                  Loading repositories...
                </p>
              ) : filteredRepos.length === 0 ? (
                <p className="text-sm text-gray-500">No repositories found.</p>
              ) : (
                filteredRepos.map((repo) => (
                  <button
                    key={repo.fullName}
                    onClick={() => handleSelectRepo(repo)}
                    className="w-full rounded px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
                  >
                    {repo.fullName}
                    {repo.private && (
                      <span className="ml-2 text-xs text-gray-500">
                        private
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <button
              onClick={() => {
                setSelectedRepo(null);
                setRepoCheck(null);
              }}
              className="text-sm text-gray-400 hover:text-gray-200"
            >
              &larr; Back to repo list
            </button>

            <div className="text-sm font-medium text-gray-200">
              {selectedRepo.fullName}
            </div>

            {checking ? (
              <p className="text-sm text-gray-400">
                Checking repository contents...
              </p>
            ) : repoCheck ? (
              <div className="space-y-2 text-sm">
                <p className="text-gray-400">
                  {repoCheck.totalFiles} files total,{" "}
                  {repoCheck.typFiles.length} .typ files
                </p>
                {!repoCheck.hasTypFiles && (
                  <div className="rounded border border-yellow-500/30 bg-yellow-950/50 p-3 text-yellow-300">
                    This repository has no .typ files. You can still import it,
                    but you will need to create Typst files manually.
                  </div>
                )}
                {repoCheck.hasTypFiles && (
                  <div className="text-xs text-gray-500">
                    Typst files: {repoCheck.typFiles.join(", ")}
                  </div>
                )}
              </div>
            ) : null}

            <div>
              <label className="text-xs text-gray-500">Project name</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <button
              onClick={handleImport}
              disabled={importing || !projectName.trim()}
              className="w-full rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {importing ? "Importing..." : "Import Repository"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
