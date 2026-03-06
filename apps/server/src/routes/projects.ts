import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.js";
import { eq, or, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { requireProjectAccess } from "../middleware/permissions.js";
import {
  ensureProjectDir,
  writeProjectFile,
  readProjectFile,
  readProjectFileBinary,
  deleteProjectFile,
  deleteProjectDir,
  listProjectFiles,
} from "../lib/storage.js";
import { recordEdit } from "../lib/history.js";

const projects = new Hono();

projects.use("*", requireAuth);

// List projects (owned + collaborated)
projects.get("/", async (c) => {
  const { userId } = c.get("user");

  const owned = await db.query.projects.findMany({
    where: eq(schema.projects.ownerId, userId),
  });

  const collabs = await db.query.collaborators.findMany({
    where: eq(schema.collaborators.userId, userId),
  });

  const collabProjectIds = collabs.map((c) => c.projectId);
  let collaborated: (typeof owned)[number][] = [];
  if (collabProjectIds.length > 0) {
    collaborated = await db.query.projects.findMany({
      where: or(...collabProjectIds.map((id) => eq(schema.projects.id, id))),
    });
  }

  return c.json({
    owned: owned.map((p) => ({ ...p, role: "owner" as const })),
    collaborated: collaborated.map((p) => {
      const collab = collabs.find((c) => c.projectId === p.id);
      return { ...p, role: collab?.permission ?? "read" };
    }),
  });
});

// Create project
projects.post("/", async (c) => {
  const { userId } = c.get("user");
  const body = await c.req.json<{ name: string; mainFile?: string }>();

  if (!body.name?.trim()) {
    return c.json({ error: "Name is required" }, 400);
  }

  const id = nanoid();
  const mainFile = body.mainFile || "main.typ";

  await db.insert(schema.projects).values({
    id,
    name: body.name.trim(),
    ownerId: userId,
    mainFile,
  });

  // Create project directory with default main file
  ensureProjectDir(id);
  writeProjectFile(
    id,
    mainFile,
    `#set page(margin: 2cm)
#set text(size: 12pt)

= ${body.name.trim()}

Start writing here.
`
  );

  // Track the file in DB
  await db.insert(schema.projectFiles).values({
    id: nanoid(),
    projectId: id,
    path: mainFile,
    isDirectory: false,
    sizeBytes: 0,
  });

  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, id),
  });

  return c.json(project, 201);
});

// Get project with file list
projects.get(
  "/:projectId",
  requireProjectAccess("read"),
  async (c) => {
    const projectId = c.req.param("projectId");

    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
    });

    const files = listProjectFiles(projectId);

    return c.json({ ...project, files });
  }
);

// Update project metadata
projects.patch(
  "/:projectId",
  requireProjectAccess("owner"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const body = await c.req.json<{ name?: string; mainFile?: string }>();

    const updates: Record<string, string> = {};
    if (body.name) updates.name = body.name.trim();
    if (body.mainFile) updates.mainFile = body.mainFile;

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date().toISOString();
      await db
        .update(schema.projects)
        .set(updates)
        .where(eq(schema.projects.id, projectId));
    }

    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
    });

    return c.json(project);
  }
);

// Delete project
projects.delete(
  "/:projectId",
  requireProjectAccess("owner"),
  async (c) => {
    const projectId = c.req.param("projectId");
    await db
      .delete(schema.projects)
      .where(eq(schema.projects.id, projectId));
    deleteProjectDir(projectId);
    return c.json({ ok: true });
  }
);

// Binary extensions the Typst compiler can use (images, fonts).
// PDFs are excluded — the compiler doesn't need them and they bloat the VFS.
const VFS_BINARY_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".ttf", ".otf", ".woff", ".woff2"];
// Extensions to skip entirely from VFS (never needed by compiler)
const VFS_SKIP_EXTS = [".pdf"];
// Max binary file size for VFS (5 MB) — larger files cause compile timeouts
const VFS_MAX_BINARY_BYTES = 5 * 1024 * 1024;

/** Build the files-all response for compiler VFS mount. */
export function buildVfsFileList(
  projectId: string,
  files: ReturnType<typeof listProjectFiles>,
): Array<{ path: string; content: string; binary: boolean }> {
  const result: Array<{ path: string; content: string; binary: boolean }> = [];
  for (const file of files) {
    if (file.isDirectory) continue;
    const lower = file.path.toLowerCase();
    if (VFS_SKIP_EXTS.some((ext) => lower.endsWith(ext))) continue;
    const isBinary = VFS_BINARY_EXTS.some((ext) => lower.endsWith(ext));
    if (isBinary) {
      if (file.sizeBytes > VFS_MAX_BINARY_BYTES) continue;
      const content = readProjectFileBinary(projectId, file.path);
      if (content) {
        result.push({ path: file.path, content: content.toString("base64"), binary: true });
      }
    } else {
      const content = readProjectFile(projectId, file.path);
      if (content !== null) {
        result.push({ path: file.path, content, binary: false });
      }
    }
  }
  return result;
}

// Get all file contents (for compiler VFS mount)
projects.get(
  "/:projectId/files-all",
  requireProjectAccess("read"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const files = listProjectFiles(projectId);
    return c.json({ files: buildVfsFileList(projectId, files) });
  }
);

// ── File operations ──────────────────────────────

// Get file content
projects.get(
  "/:projectId/files/*",
  requireProjectAccess("read"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const filePath = decodeURIComponent(
      c.req.path.replace(`/api/projects/${projectId}/files/`, "")
    );

    if (!filePath) {
      return c.json({ error: "File path required" }, 400);
    }

    // Check if binary by extension
    const binaryExts = [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".svg", ".ttf", ".otf", ".woff", ".woff2"];
    const isBinary = binaryExts.some((ext) => filePath.toLowerCase().endsWith(ext));

    if (isBinary) {
      const content = readProjectFileBinary(projectId, filePath);
      if (content === null) {
        return c.json({ error: "File not found" }, 404);
      }
      return new Response(new Uint8Array(content), {
        headers: { "Content-Type": "application/octet-stream" },
      });
    }

    const content = readProjectFile(projectId, filePath);
    if (content === null) {
      return c.json({ error: "File not found" }, 404);
    }

    return c.json({ path: filePath, content });
  }
);

// Create or update file
projects.put(
  "/:projectId/files/*",
  requireProjectAccess("write"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const filePath = decodeURIComponent(
      c.req.path.replace(`/api/projects/${projectId}/files/`, "")
    );

    if (!filePath) {
      return c.json({ error: "File path required" }, 400);
    }

    const body = await c.req.json<{ content: string }>();
    const oldContent = readProjectFile(projectId, filePath);
    writeProjectFile(projectId, filePath, body.content);

    // Record edit history
    const { userId } = c.get("user");
    if (oldContent !== body.content) {
      recordEdit({
        projectId,
        userId,
        source: "edit",
        files: [{
          path: filePath,
          diffType: oldContent != null ? "modify" : "create",
          oldContent: oldContent,
          newContent: body.content,
        }],
      }).catch(() => {}); // Best-effort
    }

    // Upsert file metadata
    const existing = await db.query.projectFiles.findFirst({
      where: and(
        eq(schema.projectFiles.projectId, projectId),
        eq(schema.projectFiles.path, filePath)
      ),
    });

    if (existing) {
      await db
        .update(schema.projectFiles)
        .set({
          sizeBytes: Buffer.byteLength(body.content),
          lastModified: new Date().toISOString(),
        })
        .where(eq(schema.projectFiles.id, existing.id));
    } else {
      await db.insert(schema.projectFiles).values({
        id: nanoid(),
        projectId,
        path: filePath,
        isDirectory: false,
        sizeBytes: Buffer.byteLength(body.content),
      });
    }

    return c.json({ ok: true, path: filePath });
  }
);

// Create new file or directory
projects.post(
  "/:projectId/files",
  requireProjectAccess("write"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const body = await c.req.json<{
      path: string;
      content?: string;
      isDirectory?: boolean;
    }>();

    if (!body.path?.trim()) {
      return c.json({ error: "Path is required" }, 400);
    }

    const filePath = body.path.trim();

    if (body.isDirectory) {
      ensureProjectDir(projectId);
      const { mkdirSync } = await import("fs");
      const { getFilePath } = await import("../lib/storage.js");
      mkdirSync(getFilePath(projectId, filePath), { recursive: true });
    } else {
      writeProjectFile(projectId, filePath, body.content || "");

      // Record edit history for file creation
      const { userId } = c.get("user");
      recordEdit({
        projectId,
        userId,
        source: "file_create",
        files: [{
          path: filePath,
          diffType: "create",
          oldContent: null,
          newContent: body.content || "",
        }],
      }).catch(() => {});
    }

    await db.insert(schema.projectFiles).values({
      id: nanoid(),
      projectId,
      path: filePath,
      isDirectory: body.isDirectory || false,
      sizeBytes: body.content ? Buffer.byteLength(body.content) : 0,
    });

    return c.json({ ok: true, path: filePath }, 201);
  }
);

// Delete file
projects.delete(
  "/:projectId/files/*",
  requireProjectAccess("write"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const filePath = decodeURIComponent(
      c.req.path.replace(`/api/projects/${projectId}/files/`, "")
    );

    if (!filePath) {
      return c.json({ error: "File path required" }, 400);
    }

    // Read old content before deleting for history
    const oldContent = readProjectFile(projectId, filePath);

    deleteProjectFile(projectId, filePath);

    // Record edit history for file deletion
    const { userId } = c.get("user");
    recordEdit({
      projectId,
      userId,
      source: "file_delete",
      files: [{
        path: filePath,
        diffType: "delete",
        oldContent,
        newContent: null,
      }],
    }).catch(() => {});

    await db
      .delete(schema.projectFiles)
      .where(
        and(
          eq(schema.projectFiles.projectId, projectId),
          eq(schema.projectFiles.path, filePath)
        )
      );

    return c.json({ ok: true });
  }
);

// Download file (always returns raw content with Content-Disposition: attachment)
projects.get(
  "/:projectId/download/*",
  requireProjectAccess("read"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const filePath = decodeURIComponent(
      c.req.path.replace(`/api/projects/${projectId}/download/`, "")
    );

    if (!filePath) {
      return c.json({ error: "File path required" }, 400);
    }

    const content = readProjectFileBinary(projectId, filePath);
    if (content === null) {
      return c.json({ error: "File not found" }, 404);
    }

    const fileName = filePath.split("/").pop() || filePath;
    return new Response(new Uint8Array(content), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  }
);

// ── Edit History endpoints ──────────────────────────

// List edit history (grouped by group_id)
projects.get(
  "/:projectId/history",
  requireProjectAccess("read"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const limit = Math.min(parseInt(c.req.query("limit") || "50"), 200);
    const offset = parseInt(c.req.query("offset") || "0");

    // Get distinct groups with their latest entry
    const rows = await db.all<any>(sql`
      SELECT
        h.group_id,
        h.user_id,
        h.source,
        h.summary,
        MIN(h.created_at) as first_edit_at,
        MAX(h.created_at) as last_edit_at,
        u.display_name,
        u.avatar_url
      FROM edit_history h
      LEFT JOIN users u ON h.user_id = u.id
      WHERE h.project_id = ${projectId}
      GROUP BY h.group_id
      ORDER BY MAX(h.created_at) DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    // Get changed files for each group
    const groups = await Promise.all(
      rows.map(async (row: any) => {
        const files = await db.all<any>(sql`
          SELECT DISTINCT ehf.file_path, ehf.diff_type
          FROM edit_history_files ehf
          INNER JOIN edit_history eh ON ehf.history_id = eh.id
          WHERE eh.group_id = ${row.group_id}
        `);

        return {
          groupId: row.group_id,
          userId: row.user_id,
          displayName: row.display_name || "Unknown",
          avatarUrl: row.avatar_url,
          source: row.source,
          summary: row.summary,
          changedFiles: files.map((f: any) => ({
            path: f.file_path,
            diffType: f.diff_type,
          })),
          createdAt: row.first_edit_at,
          lastEditAt: row.last_edit_at,
        };
      })
    );

    return c.json(groups);
  }
);

// Get full details for a history group (all files with diffs)
projects.get(
  "/:projectId/history/group/:groupId",
  requireProjectAccess("read"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const groupId = c.req.param("groupId");

    // Get the latest diff per file path within the group
    // (multiple persist cycles may create duplicate entries for the same file)
    const entries = await db.all<any>(sql`
      SELECT ehf.file_path, ehf.diff_type, ehf.unified_diff
      FROM edit_history_files ehf
      INNER JOIN edit_history eh ON ehf.history_id = eh.id
      WHERE eh.project_id = ${projectId} AND eh.group_id = ${groupId}
        AND eh.created_at = (
          SELECT MAX(eh2.created_at)
          FROM edit_history eh2
          INNER JOIN edit_history_files ehf2 ON ehf2.history_id = eh2.id
          WHERE eh2.project_id = ${projectId} AND eh2.group_id = ${groupId}
            AND ehf2.file_path = ehf.file_path
        )
      GROUP BY ehf.file_path
      ORDER BY ehf.file_path
    `);

    return c.json({
      groupId,
      entries: entries.map((e: any) => ({
        filePath: e.file_path,
        diffType: e.diff_type,
        unifiedDiff: e.unified_diff,
      })),
    });
  }
);

// Get history for a specific file
projects.get(
  "/:projectId/history/file/*",
  requireProjectAccess("read"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const filePath = decodeURIComponent(
      c.req.path.replace(`/api/projects/${projectId}/history/file/`, "")
    );
    const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);

    const rows = await db.all<any>(sql`
      SELECT
        eh.group_id,
        eh.user_id,
        eh.source,
        MAX(eh.created_at) as created_at,
        ehf.diff_type,
        ehf.unified_diff,
        u.display_name,
        u.avatar_url
      FROM edit_history_files ehf
      INNER JOIN edit_history eh ON ehf.history_id = eh.id
      LEFT JOIN users u ON eh.user_id = u.id
      WHERE eh.project_id = ${projectId} AND ehf.file_path = ${filePath}
      GROUP BY eh.group_id
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);

    return c.json(
      rows.map((r: any) => ({
        groupId: r.group_id,
        userId: r.user_id,
        displayName: r.display_name || "Unknown",
        avatarUrl: r.avatar_url,
        source: r.source,
        diffType: r.diff_type,
        unifiedDiff: r.unified_diff,
        createdAt: r.created_at,
      }))
    );
  }
);

export default projects;
