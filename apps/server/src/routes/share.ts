import { Hono } from "hono";
import { nanoid } from "nanoid";
import { randomBytes } from "crypto";
import { db, schema } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { requireProjectAccess } from "../middleware/permissions.js";
import {
  listProjectFiles,
  readProjectFile,
  readProjectFileBinary,
} from "../lib/storage.js";

const share = new Hono();

// Helper: validate share token and return link if valid
async function validateShareToken(token: string) {
  const link = await db.query.shareLinks.findFirst({
    where: eq(schema.shareLinks.token, token),
  });

  if (!link || !link.isActive) return null;
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) return null;
  if (link.maxUses && link.useCount! >= link.maxUses) return null;

  return link;
}

// Create share link (requires admin/owner)
share.post(
  "/projects/:projectId/shares",
  requireAuth,
  requireProjectAccess("admin"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const { userId } = c.get("user");
    const body = await c.req.json<{
      permission?: "read" | "write";
      expiresAt?: string;
      maxUses?: number;
    }>();

    const token = randomBytes(32).toString("base64url");

    const shareLink = {
      id: nanoid(),
      projectId,
      token,
      permission: body.permission || ("read" as const),
      createdBy: userId,
      expiresAt: body.expiresAt || null,
      maxUses: body.maxUses || null,
    };

    await db.insert(schema.shareLinks).values(shareLink);

    return c.json(shareLink, 201);
  }
);

// List share links for a project
share.get(
  "/projects/:projectId/shares",
  requireAuth,
  requireProjectAccess("admin"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const links = await db.query.shareLinks.findMany({
      where: eq(schema.shareLinks.projectId, projectId),
    });
    return c.json(links);
  }
);

// Delete (revoke) share link
share.delete(
  "/projects/:projectId/shares/:shareId",
  requireAuth,
  requireProjectAccess("admin"),
  async (c) => {
    const shareId = c.req.param("shareId");
    await db
      .update(schema.shareLinks)
      .set({ isActive: false })
      .where(eq(schema.shareLinks.id, shareId));
    return c.json({ ok: true });
  }
);

// Resolve share token (no auth required)
share.get("/shares/:token", async (c) => {
  const token = c.req.param("token");
  const link = await validateShareToken(token);

  if (!link) {
    return c.json({ error: "Invalid or expired share link" }, 404);
  }

  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, link.projectId),
    columns: { id: true, name: true },
  });

  return c.json({
    projectId: link.projectId,
    projectName: project?.name,
    permission: link.permission,
  });
});

// Join project via share token (authenticated users become collaborators)
share.post("/shares/:token/join", requireAuth, async (c) => {
  const token = c.req.param("token");
  const { userId } = c.get("user");

  const link = await validateShareToken(token);
  if (!link) {
    return c.json({ error: "Invalid or expired share link" }, 404);
  }

  // Check if already a collaborator
  const existing = await db.query.collaborators.findFirst({
    where: and(
      eq(schema.collaborators.projectId, link.projectId),
      eq(schema.collaborators.userId, userId)
    ),
  });

  if (!existing) {
    await db.insert(schema.collaborators).values({
      id: nanoid(),
      projectId: link.projectId,
      userId,
      permission: link.permission,
      addedViaShareLink: link.id,
    });
  }

  // Increment use count
  await db
    .update(schema.shareLinks)
    .set({ useCount: (link.useCount || 0) + 1 })
    .where(eq(schema.shareLinks.id, link.id));

  return c.json({ projectId: link.projectId, permission: link.permission });
});

// ── Anonymous access via share token (no auth required) ──────────────

// Get project with file list via share token
share.get("/shared/:token/project", async (c) => {
  const link = await validateShareToken(c.req.param("token"));
  if (!link) return c.json({ error: "Invalid share link" }, 404);

  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, link.projectId),
  });
  if (!project) return c.json({ error: "Project not found" }, 404);

  const files = listProjectFiles(link.projectId);
  return c.json({ ...project, files, permission: link.permission });
});

// Get all file contents via share token (for compiler VFS)
share.get("/shared/:token/files-all", async (c) => {
  const link = await validateShareToken(c.req.param("token"));
  if (!link) return c.json({ error: "Invalid share link" }, 404);

  const projectId = link.projectId;
  const files = listProjectFiles(projectId);
  const binaryExts = [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".ttf", ".otf", ".woff", ".woff2"];

  const result: Array<{ path: string; content: string; binary: boolean }> = [];
  for (const file of files) {
    if (file.isDirectory) continue;
    const isBinary = binaryExts.some((ext) => file.path.toLowerCase().endsWith(ext));
    if (isBinary) {
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

  return c.json({ files: result });
});

// Get individual file via share token
share.get("/shared/:token/files/*", async (c) => {
  const link = await validateShareToken(c.req.param("token"));
  if (!link) return c.json({ error: "Invalid share link" }, 404);

  const projectId = link.projectId;
  const filePath = decodeURIComponent(
    c.req.path.replace(/^\/api\/shared\/[^/]+\/files\//, "")
  );

  if (!filePath) return c.json({ error: "File path required" }, 400);

  const binaryExts = [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".ttf", ".otf", ".woff", ".woff2"];
  const isBinary = binaryExts.some((ext) => filePath.toLowerCase().endsWith(ext));

  if (isBinary) {
    const content = readProjectFileBinary(projectId, filePath);
    if (content === null) return c.json({ error: "File not found" }, 404);
    return new Response(new Uint8Array(content), {
      headers: { "Content-Type": "application/octet-stream" },
    });
  }

  const content = readProjectFile(projectId, filePath);
  if (content === null) return c.json({ error: "File not found" }, 404);
  return c.json({ path: filePath, content });
});

export default share;
