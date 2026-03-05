use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::middleware::AuthUser;
use crate::db::models::{FileEntry, Project};
use crate::error::AppError;
use crate::middleware::permissions::check_project_access;
use crate::state::AppState;
use crate::storage;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_projects).post(create_project))
        .route("/{project_id}", get(get_project).patch(update_project).delete(delete_project))
        .route("/{project_id}/files", post(create_file))
        .route("/{project_id}/files/*path", get(get_file).put(put_file).delete(delete_file))
}

fn row_to_project(row: &rusqlite::Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        owner_id: row.get(2)?,
        main_file: row.get(3)?,
        github_repo_full_name: row.get(4)?,
        github_branch: row.get(5)?,
        github_last_sync_sha: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

async fn list_projects(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let conn = state.db.get()?;

    let mut stmt = conn.prepare(
        "SELECT id, name, owner_id, main_file, github_repo_full_name, github_branch,
                github_last_sync_sha, created_at, updated_at
         FROM projects WHERE owner_id = ?1"
    )?;
    let owned: Vec<Value> = stmt
        .query_map(params![user.user_id], |row| {
            let p = row_to_project(row)?;
            Ok(serde_json::to_value(&p).unwrap())
        })?
        .filter_map(|r| r.ok())
        .map(|mut v| { v.as_object_mut().unwrap().insert("role".into(), json!("owner")); v })
        .collect();

    // Get collaborated projects
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.owner_id, p.main_file, p.github_repo_full_name, p.github_branch,
                p.github_last_sync_sha, p.created_at, p.updated_at, c.permission
         FROM collaborators c
         JOIN projects p ON p.id = c.project_id
         WHERE c.user_id = ?1"
    )?;
    let collaborated: Vec<Value> = stmt
        .query_map(params![user.user_id], |row| {
            let p = row_to_project(row)?;
            let perm: String = row.get(9)?;
            let mut v = serde_json::to_value(&p).unwrap();
            v.as_object_mut().unwrap().insert("role".into(), json!(perm));
            Ok(v)
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Json(json!({ "owned": owned, "collaborated": collaborated })))
}

#[derive(Deserialize)]
struct CreateProjectBody {
    name: String,
    #[serde(rename = "mainFile")]
    main_file: Option<String>,
}

async fn create_project(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateProjectBody>,
) -> Result<Response, AppError> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("Name is required".into()));
    }

    let id = nanoid::nanoid!();
    let main_file = body.main_file.unwrap_or_else(|| "main.typ".to_string());

    let conn = state.db.get()?;
    conn.execute(
        "INSERT INTO projects (id, name, owner_id, main_file) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, user.user_id, main_file],
    )?;

    // Create project directory with default main file
    storage::ensure_project_dir(&state.config.data_dir, &id);
    let default_content = format!(
        "#set page(margin: 2cm)\n#set text(size: 12pt)\n\n= {}\n\nStart writing here.\n",
        name
    );
    storage::write_project_file(&state.config.data_dir, &id, &main_file, default_content.as_bytes());

    // Track file in DB
    conn.execute(
        "INSERT INTO project_files (id, project_id, path, is_directory, size_bytes)
         VALUES (?1, ?2, ?3, 0, 0)",
        params![nanoid::nanoid!(), id, main_file],
    )?;

    let project = conn.query_row(
        "SELECT id, name, owner_id, main_file, github_repo_full_name, github_branch,
                github_last_sync_sha, created_at, updated_at
         FROM projects WHERE id = ?1",
        params![id],
        row_to_project,
    )?;

    Ok((StatusCode::CREATED, Json(serde_json::to_value(&project).unwrap())).into_response())
}

async fn get_project(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    check_project_access(&state.db, &user, &project_id, "read")?;

    let conn = state.db.get()?;
    let project = conn.query_row(
        "SELECT id, name, owner_id, main_file, github_repo_full_name, github_branch,
                github_last_sync_sha, created_at, updated_at
         FROM projects WHERE id = ?1",
        params![project_id],
        row_to_project,
    )
    .map_err(|_| AppError::NotFound("Project not found".into()))?;

    let files = storage::list_project_files(&state.config.data_dir, &project_id);

    let mut result = serde_json::to_value(&project).unwrap();
    result.as_object_mut().unwrap().insert("files".into(), serde_json::to_value(&files).unwrap());

    Ok(Json(result))
}

#[derive(Deserialize)]
struct UpdateProjectBody {
    name: Option<String>,
    #[serde(rename = "mainFile")]
    main_file: Option<String>,
}

async fn update_project(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
    Json(body): Json<UpdateProjectBody>,
) -> Result<Json<Value>, AppError> {
    check_project_access(&state.db, &user, &project_id, "owner")?;

    let conn = state.db.get()?;

    if let Some(ref name) = body.name {
        conn.execute(
            "UPDATE projects SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![name.trim(), project_id],
        )?;
    }
    if let Some(ref main_file) = body.main_file {
        conn.execute(
            "UPDATE projects SET main_file = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![main_file, project_id],
        )?;
    }

    let project = conn.query_row(
        "SELECT id, name, owner_id, main_file, github_repo_full_name, github_branch,
                github_last_sync_sha, created_at, updated_at
         FROM projects WHERE id = ?1",
        params![project_id],
        row_to_project,
    )?;

    Ok(Json(serde_json::to_value(&project).unwrap()))
}

async fn delete_project(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    check_project_access(&state.db, &user, &project_id, "owner")?;

    let conn = state.db.get()?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])?;
    storage::delete_project_dir(&state.config.data_dir, &project_id);

    Ok(Json(json!({ "ok": true })))
}

// File operations

async fn get_file(
    State(state): State<AppState>,
    user: AuthUser,
    Path((project_id, file_path)): Path<(String, String)>,
) -> Result<Response, AppError> {
    check_project_access(&state.db, &user, &project_id, "read")?;

    if file_path.is_empty() {
        return Err(AppError::BadRequest("File path required".into()));
    }

    let binary_exts = [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".ttf", ".otf", ".woff", ".woff2"];
    let is_binary = binary_exts.iter().any(|ext| file_path.to_lowercase().ends_with(ext));

    if is_binary {
        let content = storage::read_project_file_binary(&state.config.data_dir, &project_id, &file_path)
            .ok_or_else(|| AppError::NotFound("File not found".into()))?;
        Ok((
            [(axum::http::header::CONTENT_TYPE, "application/octet-stream")],
            content,
        )
            .into_response())
    } else {
        let content = storage::read_project_file(&state.config.data_dir, &project_id, &file_path)
            .ok_or_else(|| AppError::NotFound("File not found".into()))?;
        Ok(Json(json!({ "path": file_path, "content": content })).into_response())
    }
}

#[derive(Deserialize)]
struct PutFileBody {
    content: String,
}

async fn put_file(
    State(state): State<AppState>,
    user: AuthUser,
    Path((project_id, file_path)): Path<(String, String)>,
    Json(body): Json<PutFileBody>,
) -> Result<Json<Value>, AppError> {
    check_project_access(&state.db, &user, &project_id, "write")?;

    if file_path.is_empty() {
        return Err(AppError::BadRequest("File path required".into()));
    }

    storage::write_project_file(&state.config.data_dir, &project_id, &file_path, body.content.as_bytes());

    let conn = state.db.get()?;
    let size = body.content.len() as i64;

    // Upsert file metadata
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM project_files WHERE project_id = ?1 AND path = ?2",
            params![project_id, file_path],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = existing {
        conn.execute(
            "UPDATE project_files SET size_bytes = ?1, last_modified = datetime('now') WHERE id = ?2",
            params![size, id],
        )?;
    } else {
        conn.execute(
            "INSERT INTO project_files (id, project_id, path, is_directory, size_bytes)
             VALUES (?1, ?2, ?3, 0, ?4)",
            params![nanoid::nanoid!(), project_id, file_path, size],
        )?;
    }

    Ok(Json(json!({ "ok": true, "path": file_path })))
}

#[derive(Deserialize)]
struct CreateFileBody {
    path: String,
    content: Option<String>,
    #[serde(rename = "isDirectory")]
    is_directory: Option<bool>,
}

async fn create_file(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
    Json(body): Json<CreateFileBody>,
) -> Result<Response, AppError> {
    check_project_access(&state.db, &user, &project_id, "write")?;

    let file_path = body.path.trim().to_string();
    if file_path.is_empty() {
        return Err(AppError::BadRequest("Path is required".into()));
    }

    let is_directory = body.is_directory.unwrap_or(false);

    let content_size = if is_directory {
        let full_path = storage::get_file_path(&state.config.data_dir, &project_id, &file_path);
        std::fs::create_dir_all(&full_path).ok();
        0i64
    } else {
        let content = body.content.unwrap_or_default();
        let content_len = content.len() as i64;
        storage::write_project_file(&state.config.data_dir, &project_id, &file_path, content.as_bytes());
        content_len
    };

    let conn = state.db.get()?;
    let size = content_size;
    conn.execute(
        "INSERT INTO project_files (id, project_id, path, is_directory, size_bytes)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![nanoid::nanoid!(), project_id, file_path, is_directory, size],
    )?;

    Ok((StatusCode::CREATED, Json(json!({ "ok": true, "path": file_path }))).into_response())
}

async fn delete_file(
    State(state): State<AppState>,
    user: AuthUser,
    Path((project_id, file_path)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    check_project_access(&state.db, &user, &project_id, "write")?;

    if file_path.is_empty() {
        return Err(AppError::BadRequest("File path required".into()));
    }

    storage::delete_project_file(&state.config.data_dir, &project_id, &file_path);

    let conn = state.db.get()?;
    conn.execute(
        "DELETE FROM project_files WHERE project_id = ?1 AND path = ?2",
        params![project_id, file_path],
    )?;

    Ok(Json(json!({ "ok": true })))
}
