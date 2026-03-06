const BASE = "/api";

// Encode file path for URL: encode each segment separately to preserve slashes
function encodeFilePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

// Auth
export const api = {
  auth: {
    me: () => request<User>("/auth/me"),
    logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
    register: (email: string, password: string, displayName: string) =>
      request<{ ok: boolean; userId: string }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, displayName }),
      }),
    login: (email: string, password: string) =>
      request<{ ok: boolean }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    setPassword: (password: string, currentPassword?: string) =>
      request<{ ok: boolean }>("/auth/set-password", {
        method: "POST",
        body: JSON.stringify({ password, currentPassword }),
      }),
  },
  projects: {
    list: () =>
      request<{ owned: ProjectWithRole[]; collaborated: ProjectWithRole[] }>(
        "/projects"
      ),
    create: (name: string) =>
      request<Project>("/projects", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    get: (id: string) => request<ProjectWithFiles>(`/projects/${id}`),
    update: (id: string, data: { name?: string; mainFile?: string }) =>
      request<Project>(`/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),
  },
  files: {
    get: (projectId: string, path: string) =>
      request<{ path: string; content: string }>(
        `/projects/${projectId}/files/${encodeFilePath(path)}`
      ),
    put: (projectId: string, path: string, content: string) =>
      request<{ ok: boolean }>(`/projects/${projectId}/files/${encodeFilePath(path)}`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      }),
    create: (
      projectId: string,
      path: string,
      content?: string,
      isDirectory?: boolean
    ) =>
      request<{ ok: boolean }>(`/projects/${projectId}/files`, {
        method: "POST",
        body: JSON.stringify({ path, content, isDirectory }),
      }),
    delete: (projectId: string, path: string) =>
      request<{ ok: boolean }>(`/projects/${projectId}/files/${encodeFilePath(path)}`, {
        method: "DELETE",
      }),
  },
  github: {
    repos: () => request<GithubRepo[]>("/github/repos"),
    link: (projectId: string, repoFullName: string, branch?: string) =>
      request<{ ok: boolean }>(`/github/projects/${projectId}/github/link`, {
        method: "POST",
        body: JSON.stringify({ repoFullName, branch }),
      }),
    unlink: (projectId: string) =>
      request<{ ok: boolean }>(`/github/projects/${projectId}/github/unlink`, {
        method: "POST",
      }),
    pull: (projectId: string) =>
      request<{ ok: boolean; commitSha: string; fileCount: number }>(
        `/github/projects/${projectId}/github/pull`,
        { method: "POST" }
      ),
    push: (projectId: string, commitMessage: string) =>
      request<{ ok: boolean; commitSha: string }>(
        `/github/projects/${projectId}/github/push`,
        { method: "POST", body: JSON.stringify({ commitMessage }) }
      ),
    status: (projectId: string) =>
      request<GithubStatus>(`/github/projects/${projectId}/github/status`),
    autoPull: (projectId: string) =>
      request<{ pulled: boolean; reason?: string; commitSha?: string; fileCount?: number }>(
        `/github/projects/${projectId}/github/auto-pull`,
        { method: "POST" }
      ),
    checkRepo: (owner: string, repo: string) =>
      request<{
        hasTypFiles: boolean;
        typFiles: string[];
        defaultBranch: string;
        totalFiles: number;
      }>(`/github/repos/${owner}/${repo}/check`),
    import: (repoFullName: string, branch?: string, projectName?: string) =>
      request<{
        ok: boolean;
        projectId: string;
        projectName: string;
        fileCount: number;
        typFileCount: number;
        mainFile: string;
      }>("/github/import", {
        method: "POST",
        body: JSON.stringify({ repoFullName, branch, projectName }),
      }),
  },
  shares: {
    create: (
      projectId: string,
      permission: "read" | "write",
      expiresAt?: string
    ) =>
      request<ShareLink>(`/projects/${projectId}/shares`, {
        method: "POST",
        body: JSON.stringify({ permission, expiresAt }),
      }),
    list: (projectId: string) =>
      request<ShareLink[]>(`/projects/${projectId}/shares`),
    revoke: (projectId: string, shareId: string) =>
      request<{ ok: boolean }>(`/projects/${projectId}/shares/${shareId}`, {
        method: "DELETE",
      }),
    resolve: (token: string) =>
      request<{ projectId: string; projectName: string; permission: string }>(
        `/shares/${token}`
      ),
    join: (token: string) =>
      request<{ projectId: string; permission: string }>(
        `/shares/${token}/join`,
        { method: "POST" }
      ),
  },
  history: {
    list: (projectId: string, limit = 50, offset = 0) =>
      request<HistoryGroup[]>(
        `/projects/${projectId}/history?limit=${limit}&offset=${offset}`
      ),
    group: (projectId: string, groupId: string) =>
      request<HistoryGroupDetail>(
        `/projects/${projectId}/history/group/${groupId}`
      ),
    forFile: (projectId: string, filePath: string, limit = 20) =>
      request<HistoryFileEntry[]>(
        `/projects/${projectId}/history/file/${encodeFilePath(filePath)}?limit=${limit}`
      ),
  },
  // Anonymous access via share token (no auth required)
  shared: {
    project: (token: string) =>
      request<ProjectWithFiles & { permission: string }>(
        `/shared/${token}/project`
      ),
    filesAll: (token: string) =>
      request<{ files: Array<{ path: string; content: string; binary: boolean }> }>(
        `/shared/${token}/files-all`
      ),
    fileGet: (token: string, path: string) =>
      request<{ path: string; content: string }>(
        `/shared/${token}/files/${encodeFilePath(path)}`
      ),
  },
};

// Types
export interface User {
  id: string;
  authProvider: string;
  email: string | null;
  githubLogin: string | null;
  githubId: number | null;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  hasPassword: boolean;
  hasGithub: boolean;
}

export interface Project {
  id: string;
  name: string;
  ownerId: string;
  mainFile: string;
  githubRepoFullName: string | null;
  githubBranch: string | null;
  githubLastSyncSha: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWithRole extends Project {
  role: "owner" | "read" | "write" | "admin";
}

export interface FileEntry {
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
}

export interface ProjectWithFiles extends Project {
  files: FileEntry[];
}

export interface GithubRepo {
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
}

export interface GithubStatus {
  linked: boolean;
  repoFullName?: string;
  branch?: string;
  localSha?: string;
  remoteSha?: string;
  inSync?: boolean;
  error?: string;
}

export interface ShareLink {
  id: string;
  projectId: string;
  token: string;
  permission: "read" | "write";
  createdBy: string;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  isActive: boolean;
  createdAt: string;
}

export interface HistoryGroup {
  groupId: string;
  userId: string | null;
  displayName: string;
  avatarUrl: string | null;
  source: "edit" | "github_pull" | "file_create" | "file_delete";
  summary: string | null;
  changedFiles: Array<{ path: string; diffType: string }>;
  createdAt: string;
  lastEditAt: string;
}

export interface HistoryGroupDetail {
  groupId: string;
  entries: Array<{
    filePath: string;
    diffType: string;
    unifiedDiff: string | null;
  }>;
}

export interface HistoryFileEntry {
  groupId: string;
  userId: string | null;
  displayName: string;
  avatarUrl: string | null;
  source: string;
  diffType: string;
  unifiedDiff: string | null;
  createdAt: string;
}
