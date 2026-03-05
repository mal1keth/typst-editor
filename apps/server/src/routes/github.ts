import { Hono } from "hono";
import { Octokit } from "octokit";
import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { requireProjectAccess } from "../middleware/permissions.js";
import {
  writeProjectFile,
  listProjectFiles,
  readProjectFileBinary,
  ensureProjectDir,
} from "../lib/storage.js";
import { nanoid } from "nanoid";

const github = new Hono();

github.use("*", requireAuth);

function getOctokit(token: string) {
  return new Octokit({ auth: token });
}

async function getUserToken(userId: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { githubAccessToken: true },
  });
  return user?.githubAccessToken || null;
}

// Shared helper: download all files from a GitHub repo tree into a project
async function pullRepoFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  commitSha: string,
  projectId: string
): Promise<number> {
  const { data: tree } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: commitSha,
    recursive: "true",
  });

  ensureProjectDir(projectId);

  // Clear existing file metadata
  await db
    .delete(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, projectId));

  let fileCount = 0;
  for (const item of tree.tree) {
    if (item.type === "blob" && item.path && item.sha) {
      const { data: blob } = await octokit.rest.git.getBlob({
        owner,
        repo,
        file_sha: item.sha,
      });

      const content = Buffer.from(blob.content, "base64");
      writeProjectFile(projectId, item.path, content);

      await db.insert(schema.projectFiles).values({
        id: nanoid(),
        projectId,
        path: item.path,
        isDirectory: false,
        sizeBytes: content.length,
      });
      fileCount++;
    } else if (item.type === "tree" && item.path) {
      await db.insert(schema.projectFiles).values({
        id: nanoid(),
        projectId,
        path: item.path,
        isDirectory: true,
        sizeBytes: 0,
      });
    }
  }

  return fileCount;
}

// List user's repos
github.get("/repos", async (c) => {
  const { userId } = c.get("user");
  const token = await getUserToken(userId);
  if (!token) return c.json({ error: "GitHub not connected" }, 400);

  const octokit = getOctokit(token);
  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    sort: "updated",
    per_page: 50,
  });

  return c.json(
    data.map((r) => ({
      fullName: r.full_name,
      name: r.name,
      owner: r.owner.login,
      private: r.private,
      defaultBranch: r.default_branch,
    }))
  );
});

// Link project to GitHub repo
github.post(
  "/projects/:projectId/github/link",
  requireProjectAccess("owner"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const { userId } = c.get("user");
    const body = await c.req.json<{
      repoFullName: string;
      branch?: string;
    }>();

    const token = await getUserToken(userId);
    if (!token) return c.json({ error: "GitHub not connected" }, 400);

    const [owner, repo] = body.repoFullName.split("/");
    const branch = body.branch || "main";

    // Verify repo access
    const octokit = getOctokit(token);
    try {
      await octokit.rest.repos.get({ owner, repo });
    } catch {
      return c.json({ error: "Cannot access repository" }, 403);
    }

    await db
      .update(schema.projects)
      .set({
        githubRepoFullName: body.repoFullName,
        githubBranch: branch,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.projects.id, projectId));

    return c.json({ ok: true, repoFullName: body.repoFullName, branch });
  }
);

// Unlink project from GitHub
github.post(
  "/projects/:projectId/github/unlink",
  requireProjectAccess("owner"),
  async (c) => {
    const projectId = c.req.param("projectId");

    await db
      .update(schema.projects)
      .set({
        githubRepoFullName: null,
        githubBranch: null,
        githubLastSyncSha: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.projects.id, projectId));

    return c.json({ ok: true });
  }
);

// Pull from GitHub
github.post(
  "/projects/:projectId/github/pull",
  requireProjectAccess("write"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const { userId } = c.get("user");

    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
    });

    if (!project?.githubRepoFullName) {
      return c.json({ error: "Project not linked to GitHub" }, 400);
    }

    const token = await getUserToken(userId);
    if (!token) return c.json({ error: "GitHub not connected" }, 400);

    const [owner, repo] = project.githubRepoFullName.split("/");
    const branch = project.githubBranch || "main";
    const octokit = getOctokit(token);

    // Get latest commit
    const { data: ref } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const commitSha = ref.object.sha;

    const fileCount = await pullRepoFiles(octokit, owner, repo, commitSha, projectId);

    await db
      .update(schema.projects)
      .set({
        githubLastSyncSha: commitSha,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.projects.id, projectId));

    return c.json({
      ok: true,
      commitSha,
      fileCount,
    });
  }
);

// Push to GitHub
github.post(
  "/projects/:projectId/github/push",
  requireProjectAccess("write"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const { userId } = c.get("user");
    const body = await c.req.json<{ commitMessage: string }>();

    if (!body.commitMessage?.trim()) {
      return c.json({ error: "Commit message required" }, 400);
    }

    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
    });

    if (!project?.githubRepoFullName) {
      return c.json({ error: "Project not linked to GitHub" }, 400);
    }

    const token = await getUserToken(userId);
    if (!token) return c.json({ error: "GitHub not connected" }, 400);

    const [owner, repo] = project.githubRepoFullName.split("/");
    const branch = project.githubBranch || "main";
    const octokit = getOctokit(token);

    // Get current HEAD
    const { data: ref } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const parentSha = ref.object.sha;

    // Check for conflicts
    if (
      project.githubLastSyncSha &&
      project.githubLastSyncSha !== parentSha
    ) {
      return c.json(
        {
          error: "Remote has new commits. Pull first.",
          localSha: project.githubLastSyncSha,
          remoteSha: parentSha,
        },
        409
      );
    }

    // Create blobs and tree entries
    const files = listProjectFiles(projectId).filter((f) => !f.isDirectory);
    const treeEntries: Array<{
      path: string;
      mode: "100644";
      type: "blob";
      sha: string;
    }> = [];

    for (const file of files) {
      const content = readProjectFileBinary(projectId, file.path);
      if (!content) continue;

      const { data: blob } = await octokit.rest.git.createBlob({
        owner,
        repo,
        content: content.toString("base64"),
        encoding: "base64",
      });

      treeEntries.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }

    // Create tree
    const { data: tree } = await octokit.rest.git.createTree({
      owner,
      repo,
      tree: treeEntries,
      base_tree: parentSha,
    });

    // Create commit
    const { data: commit } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: body.commitMessage.trim(),
      tree: tree.sha,
      parents: [parentSha],
    });

    // Update ref
    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commit.sha,
    });

    // Update local sync sha
    await db
      .update(schema.projects)
      .set({
        githubLastSyncSha: commit.sha,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.projects.id, projectId));

    return c.json({ ok: true, commitSha: commit.sha });
  }
);

// Get sync status
github.get(
  "/projects/:projectId/github/status",
  requireProjectAccess("read"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const { userId } = c.get("user");

    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
    });

    if (!project?.githubRepoFullName) {
      return c.json({ linked: false });
    }

    const token = await getUserToken(userId);
    if (!token) return c.json({ error: "GitHub not connected" }, 400);

    const [owner, repo] = project.githubRepoFullName.split("/");
    const branch = project.githubBranch || "main";
    const octokit = getOctokit(token);

    try {
      const { data: ref } = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });

      const remoteSha = ref.object.sha;
      const localSha = project.githubLastSyncSha;

      return c.json({
        linked: true,
        repoFullName: project.githubRepoFullName,
        branch,
        localSha,
        remoteSha,
        inSync: localSha === remoteSha,
      });
    } catch {
      return c.json({
        linked: true,
        repoFullName: project.githubRepoFullName,
        branch,
        error: "Cannot reach repository",
      });
    }
  }
);

// Auto-pull: check if remote has new commits and pull if so.
// Returns { pulled: false } if already in sync or not linked,
// { pulled: true, commitSha, fileCount } on successful auto-pull.
github.post(
  "/projects/:projectId/github/auto-pull",
  requireProjectAccess("write"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const { userId } = c.get("user");

    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
    });

    if (!project?.githubRepoFullName) {
      return c.json({ pulled: false, reason: "not-linked" });
    }

    const token = await getUserToken(userId);
    if (!token) {
      return c.json({ pulled: false, reason: "no-github-token" });
    }

    const [owner, repo] = project.githubRepoFullName.split("/");
    const branch = project.githubBranch || "main";
    const octokit = getOctokit(token);

    try {
      const { data: ref } = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });

      const remoteSha = ref.object.sha;
      const localSha = project.githubLastSyncSha;

      if (localSha === remoteSha) {
        return c.json({ pulled: false, reason: "in-sync" });
      }

      // Out of sync — pull new files
      const fileCount = await pullRepoFiles(octokit, owner, repo, remoteSha, projectId);

      await db
        .update(schema.projects)
        .set({
          githubLastSyncSha: remoteSha,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.projects.id, projectId));

      return c.json({ pulled: true, commitSha: remoteSha, fileCount });
    } catch (e: any) {
      return c.json({ pulled: false, reason: "error", error: e?.message || String(e) });
    }
  }
);

// Check repo for .typ files
github.get("/repos/:owner/:repo/check", async (c) => {
  const { userId } = c.get("user");
  const owner = c.req.param("owner")!;
  const repo = c.req.param("repo")!;

  const token = await getUserToken(userId);
  if (!token) return c.json({ error: "GitHub not connected" }, 400);

  const octokit = getOctokit(token);

  try {
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
    const { data: ref } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${repoData.default_branch}`,
    });
    const { data: tree } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: ref.object.sha,
      recursive: "true",
    });

    const typFiles = tree.tree
      .filter((item) => item.type === "blob" && item.path?.endsWith(".typ"))
      .map((item) => item.path);

    return c.json({
      hasTypFiles: typFiles.length > 0,
      typFiles,
      defaultBranch: repoData.default_branch,
      totalFiles: tree.tree.filter((i) => i.type === "blob").length,
    });
  } catch {
    return c.json({ error: "Cannot access repository" }, 403);
  }
});

// Import GitHub repo as a new project
github.post("/import", async (c) => {
  const { userId } = c.get("user");
  const body = await c.req.json<{
    repoFullName: string;
    branch?: string;
    projectName?: string;
  }>();

  if (!body.repoFullName) {
    return c.json({ error: "Repository full name is required" }, 400);
  }

  const token = await getUserToken(userId);
  if (!token) return c.json({ error: "GitHub not connected" }, 400);

  const [owner, repo] = body.repoFullName.split("/");
  const octokit = getOctokit(token);

  // Verify repo access and get default branch
  let repoData;
  try {
    const { data } = await octokit.rest.repos.get({ owner, repo });
    repoData = data;
  } catch {
    return c.json({ error: "Cannot access repository" }, 403);
  }

  const actualBranch = body.branch || repoData.default_branch || "main";

  // Get commit SHA for the branch
  const { data: ref } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${actualBranch}`,
  });
  const commitSha = ref.object.sha;

  // Check for .typ files to determine mainFile
  const { data: treeData } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: commitSha,
    recursive: "true",
  });

  const typFiles = treeData.tree.filter(
    (item) => item.type === "blob" && item.path?.endsWith(".typ")
  );

  let mainFile = "main.typ";
  if (typFiles.length > 0) {
    const hasMainTyp = typFiles.some((f) => f.path === "main.typ");
    if (!hasMainTyp) {
      mainFile = typFiles[0].path!;
    }
  }

  // Create project
  const projectId = nanoid();
  const projectName = body.projectName || repo;

  await db.insert(schema.projects).values({
    id: projectId,
    name: projectName,
    ownerId: userId,
    mainFile,
    githubRepoFullName: body.repoFullName,
    githubBranch: actualBranch,
  });

  // Download all files
  const fileCount = await pullRepoFiles(octokit, owner, repo, commitSha, projectId);

  // Update sync SHA
  await db
    .update(schema.projects)
    .set({ githubLastSyncSha: commitSha })
    .where(eq(schema.projects.id, projectId));

  return c.json(
    {
      ok: true,
      projectId,
      projectName,
      fileCount,
      typFileCount: typFiles.length,
      mainFile,
    },
    201
  );
});

export default github;
