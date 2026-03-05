const BASE = "/api";

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
        `/projects/${projectId}/files/${path}`
      ),
    put: (projectId: string, path: string, content: string) =>
      request<{ ok: boolean }>(`/projects/${projectId}/files/${path}`, {
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
      request<{ ok: boolean }>(`/projects/${projectId}/files/${path}`, {
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
};

// Types
export interface User {
  id: string;
  authProvider: string;
  email: string | null;
  githubLogin: string | null;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
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
