import { createMiddleware } from "hono/factory";
import { db, schema } from "../db/index.js";
import { eq, and } from "drizzle-orm";

type Permission = "read" | "write" | "admin" | "owner";

export function requireProjectAccess(minPermission: Permission) {
  return createMiddleware(async (c, next) => {
    const user = c.get("user");
    const projectId = c.req.param("projectId");

    if (!projectId) {
      return c.json({ error: "Project ID required" }, 400);
    }

    // Check if owner
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
    });

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    if (project.ownerId === user.userId) {
      c.set("projectPermission" as any, "owner");
      await next();
      return;
    }

    if (minPermission === "owner") {
      return c.json({ error: "Owner access required" }, 403);
    }

    // Check collaborator permission
    const collab = await db.query.collaborators.findFirst({
      where: and(
        eq(schema.collaborators.projectId, projectId),
        eq(schema.collaborators.userId, user.userId)
      ),
    });

    if (!collab) {
      return c.json({ error: "Access denied" }, 403);
    }

    const permLevels: Record<string, number> = {
      read: 1,
      write: 2,
      admin: 3,
      owner: 4,
    };

    if (permLevels[collab.permission] < permLevels[minPermission]) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    c.set("projectPermission" as any, collab.permission);
    await next();
  });
}
