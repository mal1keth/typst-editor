import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import app, { setupStaticServing } from "./app.js";
import { db, schema } from "./db/index.js";
import { sql } from "drizzle-orm";
import { verifyToken } from "./lib/jwt.js";
import { handleYjsConnection, type WsUserInfo } from "./ws/yjs-server.js";
import { eq, and } from "drizzle-orm";
import { getCookie } from "hono/cookie";

// Create tables if they don't exist
const sqlite = (db as any).$client;
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    auth_provider TEXT NOT NULL DEFAULT 'github',
    auth_provider_id TEXT NOT NULL,
    email TEXT,
    github_id INTEGER,
    github_login TEXT,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    github_access_token TEXT,
    password_hash TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Add password_hash column if it doesn't exist (migration for existing DBs)
  -- SQLite doesn't have IF NOT EXISTS for ALTER TABLE, so we handle this in code below

  CREATE UNIQUE INDEX IF NOT EXISTS users_provider_idx ON users(auth_provider, auth_provider_id);

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id),
    main_file TEXT NOT NULL DEFAULT 'main.typ',
    github_repo_full_name TEXT,
    github_branch TEXT DEFAULT 'main',
    github_last_sync_sha TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_id);

  CREATE TABLE IF NOT EXISTS project_files (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    is_directory INTEGER DEFAULT 0,
    size_bytes INTEGER,
    last_modified TEXT DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS files_project_path_idx ON project_files(project_id, path);

  CREATE TABLE IF NOT EXISTS share_links (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    permission TEXT NOT NULL DEFAULT 'read',
    created_by TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT,
    max_uses INTEGER,
    use_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS collaborators (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    permission TEXT NOT NULL DEFAULT 'read',
    added_via_share_link TEXT REFERENCES share_links(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS collab_project_user_idx ON collaborators(project_id, user_id);

  CREATE TABLE IF NOT EXISTS edit_history (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id),
    source TEXT NOT NULL DEFAULT 'edit',
    summary TEXT,
    group_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS edit_history_project_idx ON edit_history(project_id, created_at);

  CREATE TABLE IF NOT EXISTS edit_history_files (
    id TEXT PRIMARY KEY,
    history_id TEXT NOT NULL REFERENCES edit_history(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    diff_type TEXT NOT NULL DEFAULT 'modify',
    unified_diff TEXT
  );

  CREATE INDEX IF NOT EXISTS edit_history_files_idx ON edit_history_files(history_id);
`);

// Migration: add password_hash column to existing databases
try {
  sqlite.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`);
} catch {
  // Column already exists
}

// WebSocket setup
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get(
  "/ws/yjs/:projectId/:filePath{.+}",
  upgradeWebSocket(async (c) => {
    const projectId = c.req.param("projectId")!;
    const filePath = c.req.param("filePath")!;

    // Read token from httpOnly cookie (query param fallback for compat)
    const token = getCookie(c, "token") || c.req.query("token");
    const shareToken = c.req.query("shareToken");

    let permission = "read";
    let userInfo: WsUserInfo | null = null;
    let authenticated = false;

    if (token) {
      const payload = await verifyToken(token);
      if (payload) {
        authenticated = true;
        // Resolve user info for presence
        const user = await db.query.users.findFirst({
          where: eq(schema.users.id, payload.userId),
          columns: { id: true, displayName: true, avatarUrl: true },
        });
        if (user) {
          userInfo = {
            userId: user.id,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          };
        }

        // Check if owner
        const project = await db.query.projects.findFirst({
          where: eq(schema.projects.id, projectId),
        });

        if (project?.ownerId === payload.userId) {
          permission = "owner";
        } else {
          // Check collaborator permission
          const collab = await db.query.collaborators.findFirst({
            where: and(
              eq(schema.collaborators.projectId, projectId),
              eq(schema.collaborators.userId, payload.userId)
            ),
          });
          permission = collab?.permission || "read";
        }
      }
    }

    // If no auth (or auth gave no project access), fall back to share token.
    // Anonymous + valid share token grants the link's permission for that project.
    if (!authenticated && shareToken) {
      const link = await db.query.shareLinks.findFirst({
        where: eq(schema.shareLinks.token, shareToken),
      });
      const validLink =
        link &&
        link.isActive &&
        link.projectId === projectId &&
        (!link.expiresAt || new Date(link.expiresAt) >= new Date()) &&
        (!link.maxUses || (link.useCount ?? 0) < link.maxUses);

      if (validLink) {
        permission = link.permission;
      }
    }

    return {
      onOpen(_evt: any, ws: any) {
        handleYjsConnection(ws.raw, projectId, filePath, permission, userInfo);
      },
    };
  })
);

// Register SPA static serving AFTER WebSocket routes so /ws/ paths aren't caught by the catch-all
setupStaticServing();

const port = parseInt(process.env.PORT || "3000");

console.log(`Server starting on port ${port}`);

const server = serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});

injectWebSocket(server);

console.log(`Server running at http://localhost:${port}`);
