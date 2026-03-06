import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  authProvider: text("auth_provider").notNull().default("github"), // "github" | "google"
  authProviderId: text("auth_provider_id").notNull(), // provider-specific user ID
  email: text("email"),
  githubId: integer("github_id"),
  githubLogin: text("github_login"),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  githubAccessToken: text("github_access_token"),
  passwordHash: text("password_hash"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    mainFile: text("main_file").notNull().default("main.typ"),
    githubRepoFullName: text("github_repo_full_name"),
    githubBranch: text("github_branch").default("main"),
    githubLastSyncSha: text("github_last_sync_sha"),
    createdAt: text("created_at").default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").default(sql`(datetime('now'))`),
  },
  (table) => [index("projects_owner_idx").on(table.ownerId)]
);

export const projectFiles = sqliteTable(
  "project_files",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    isDirectory: integer("is_directory", { mode: "boolean" }).default(false),
    sizeBytes: integer("size_bytes"),
    lastModified: text("last_modified").default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex("files_project_path_idx").on(table.projectId, table.path),
  ]
);

export const shareLinks = sqliteTable("share_links", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  permission: text("permission", { enum: ["read", "write"] })
    .notNull()
    .default("read"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  expiresAt: text("expires_at"),
  maxUses: integer("max_uses"),
  useCount: integer("use_count").default(0),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const editHistory = sqliteTable(
  "edit_history",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id),
    source: text("source", {
      enum: ["edit", "github_pull", "file_create", "file_delete"],
    })
      .notNull()
      .default("edit"),
    summary: text("summary"),
    groupId: text("group_id").notNull(),
    createdAt: text("created_at").default(sql`(datetime('now'))`),
  },
  (table) => [index("edit_history_project_idx").on(table.projectId, table.createdAt)]
);

export const editHistoryFiles = sqliteTable(
  "edit_history_files",
  {
    id: text("id").primaryKey(),
    historyId: text("history_id")
      .notNull()
      .references(() => editHistory.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    diffType: text("diff_type", {
      enum: ["create", "modify", "delete"],
    })
      .notNull()
      .default("modify"),
    unifiedDiff: text("unified_diff"),
  },
  (table) => [index("edit_history_files_idx").on(table.historyId)]
);

export const collaborators = sqliteTable(
  "collaborators",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    permission: text("permission", { enum: ["read", "write", "admin"] })
      .notNull()
      .default("read"),
    addedViaShareLink: text("added_via_share_link").references(
      () => shareLinks.id
    ),
    createdAt: text("created_at").default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex("collab_project_user_idx").on(table.projectId, table.userId),
  ]
);
