pub mod models;
pub mod schema;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::params;

pub type DbPool = Pool<SqliteConnectionManager>;

pub fn create_pool(data_dir: &str) -> DbPool {
    std::fs::create_dir_all(data_dir).expect("Failed to create data directory");

    let db_path = std::path::Path::new(data_dir)
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join("editor.db");

    let manager = SqliteConnectionManager::file(&db_path);
    let pool = Pool::builder()
        .max_size(10)
        .build(manager)
        .expect("Failed to create database pool");

    // Configure SQLite
    {
        let conn = pool.get().expect("Failed to get connection");
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .expect("Failed to set pragmas");
    }

    // Run migrations
    schema::create_tables(&pool);

    pool
}
