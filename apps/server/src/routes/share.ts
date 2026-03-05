import { Hono } from "hono";
import { nanoid } from "nanoid";
import { randomBytes } from "crypto";
import { db, schema } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { requireProjectAccess } from "../middleware/permissions.js";

const share = new Hono();

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

// Resolve share token (no auth required for reading)
share.get("/shares/:token", async (c) => {
  const token = c.req.param("token");

  const link = await db.query.shareLinks.findFirst({
    where: eq(schema.shareLinks.token, token),
  });

  if (!link || !link.isActive) {
    return c.json({ error: "Invalid or expired share link" }, 404);
  }

  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return c.json({ error: "Share link expired" }, 410);
  }

  if (link.maxUses && link.useCount! >= link.maxUses) {
    return c.json({ error: "Share link usage limit reached" }, 410);
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

// Join project via share token
share.post("/shares/:token/join", requireAuth, async (c) => {
  const token = c.req.param("token");
  const { userId } = c.get("user");

  const link = await db.query.shareLinks.findFirst({
    where: eq(schema.shareLinks.token, token),
  });

  if (!link || !link.isActive) {
    return c.json({ error: "Invalid or expired share link" }, 404);
  }

  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return c.json({ error: "Share link expired" }, 410);
  }

  if (link.maxUses && link.useCount! >= link.maxUses) {
    return c.json({ error: "Share link usage limit reached" }, 410);
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

export default share;
