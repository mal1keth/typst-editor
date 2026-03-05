import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.js";
import { eq, or, and } from "drizzle-orm";
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

// Get all file contents (for compiler)
projects.get(
  "/:projectId/files-all",
  requireProjectAccess("read"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const files = listProjectFiles(projectId);
    const binaryExts = [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".ttf", ".otf", ".woff", ".woff2"];

    const result: Array<{ path: string; content: string; binary: boolean }> = [];
    for (const file of files) {
      if (file.isDirectory) continue;
      const isBinary = binaryExts.some((ext) => file.path.toLowerCase().endsWith(ext));
      if (isBinary) {
        const content = readProjectFileBinary(projectId, file.path);
        if (content) {
          result.push({
            path: file.path,
            content: content.toString("base64"),
            binary: true,
          });
        }
      } else {
        const content = readProjectFile(projectId, file.path);
        if (content !== null) {
          result.push({ path: file.path, content, binary: false });
        }
      }
    }

    return c.json({ files: result });
  }
);

// ── File operations ──────────────────────────────

// Get file content
projects.get(
  "/:projectId/files/*",
  requireProjectAccess("read"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const filePath = c.req.path.replace(
      `/api/projects/${projectId}/files/`,
      ""
    );

    if (!filePath) {
      return c.json({ error: "File path required" }, 400);
    }

    // Check if binary by extension
    const binaryExts = [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".ttf", ".otf", ".woff", ".woff2"];
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
    const filePath = c.req.path.replace(
      `/api/projects/${projectId}/files/`,
      ""
    );

    if (!filePath) {
      return c.json({ error: "File path required" }, 400);
    }

    const body = await c.req.json<{ content: string }>();
    writeProjectFile(projectId, filePath, body.content);

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
    const filePath = c.req.path.replace(
      `/api/projects/${projectId}/files/`,
      ""
    );

    if (!filePath) {
      return c.json({ error: "File path required" }, 400);
    }

    deleteProjectFile(projectId, filePath);

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

export default projects;
