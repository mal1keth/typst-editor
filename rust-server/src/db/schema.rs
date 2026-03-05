use super::DbPool;

pub fn create_tables(pool: &DbPool) {
    let conn = pool.get().expect("Failed to get connection for migrations");

    conn.execute_batch(
        "
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

        CREATE UNIQUE INDEX IF NOT EXISTS users_provider_idx
            ON users(auth_provider, auth_provider_id);

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

        CREATE UNIQUE INDEX IF NOT EXISTS files_project_path_idx
            ON project_files(project_id, path);

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

        CREATE UNIQUE INDEX IF NOT EXISTS collab_project_user_idx
            ON collaborators(project_id, user_id);
        ",
    )
    .expect("Failed to create tables");

    // Migration: add password_hash column if missing
    let _ = conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT", []);
}
