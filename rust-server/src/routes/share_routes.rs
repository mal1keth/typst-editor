use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::middleware::AuthUser;
use crate::error::AppError;
use crate::middleware::permissions::check_project_access;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/projects/{project_id}/shares", post(create_share).get(list_shares))
        .route("/projects/{project_id}/shares/{share_id}", delete(revoke_share))
        .route("/shares/{token}", get(resolve_share))
        .route("/shares/{token}/join", post(join_share))
}

#[derive(Deserialize)]
struct CreateShareBody {
    permission: Option<String>,
    #[serde(rename = "expiresAt")]
    expires_at: Option<String>,
    #[serde(rename = "maxUses")]
    max_uses: Option<i64>,
}

async fn create_share(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
    Json(body): Json<CreateShareBody>,
) -> Result<Response, AppError> {
    check_project_access(&state.db, &user, &project_id, "admin")?;

    let token = {
        use rand::Rng;
        let bytes: Vec<u8> = rand::thread_rng().gen::<[u8; 32]>().to_vec();
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&bytes)
    };

    use base64::Engine;

    let id = nanoid::nanoid!();
    let permission = body.permission.unwrap_or_else(|| "read".to_string());

    let conn = state.db.get()?;
    conn.execute(
        "INSERT INTO share_links (id, project_id, token, permission, created_by, expires_at, max_uses)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, project_id, token, permission, user.user_id, body.expires_at, body.max_uses],
    )?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "id": id,
            "projectId": project_id,
            "token": token,
            "permission": permission,
            "createdBy": user.user_id,
            "expiresAt": body.expires_at,
            "maxUses": body.max_uses,
        })),
    )
        .into_response())
}

async fn list_shares(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<Value>>, AppError> {
    check_project_access(&state.db, &user, &project_id, "admin")?;

    let conn = state.db.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, project_id, token, permission, created_by, expires_at, max_uses,
                use_count, is_active, created_at
         FROM share_links WHERE project_id = ?1"
    )?;

    let links: Vec<Value> = stmt
        .query_map(params![project_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "projectId": row.get::<_, String>(1)?,
                "token": row.get::<_, String>(2)?,
                "permission": row.get::<_, String>(3)?,
                "createdBy": row.get::<_, String>(4)?,
                "expiresAt": row.get::<_, Option<String>>(5)?,
                "maxUses": row.get::<_, Option<i64>>(6)?,
                "useCount": row.get::<_, Option<i64>>(7)?,
                "isActive": row.get::<_, Option<bool>>(8)?,
                "createdAt": row.get::<_, Option<String>>(9)?,
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Json(links))
}

async fn revoke_share(
    State(state): State<AppState>,
    user: AuthUser,
    Path((project_id, share_id)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    check_project_access(&state.db, &user, &project_id, "admin")?;

    let conn = state.db.get()?;
    conn.execute(
        "UPDATE share_links SET is_active = 0 WHERE id = ?1",
        params![share_id],
    )?;

    Ok(Json(json!({ "ok": true })))
}

async fn resolve_share(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<Value>, AppError> {
    let conn = state.db.get()?;

    let link = conn
        .query_row(
            "SELECT id, project_id, permission, expires_at, max_uses, use_count, is_active
             FROM share_links WHERE token = ?1",
            params![token],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, Option<bool>>(6)?,
                ))
            },
        )
        .map_err(|_| AppError::NotFound("Invalid or expired share link".into()))?;

    let (_id, project_id, permission, expires_at, max_uses, use_count, is_active) = link;

    if !is_active.unwrap_or(true) {
        return Err(AppError::NotFound("Invalid or expired share link".into()));
    }

    if let Some(ref exp) = expires_at {
        if exp < &chrono::Utc::now().to_rfc3339() {
            return Err(AppError::Gone("Share link expired".into()));
        }
    }

    if let (Some(max), Some(count)) = (max_uses, use_count) {
        if count >= max {
            return Err(AppError::Gone("Share link usage limit reached".into()));
        }
    }

    let project_name: Option<String> = conn
        .query_row(
            "SELECT name FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .ok();

    Ok(Json(json!({
        "projectId": project_id,
        "projectName": project_name,
        "permission": permission,
    })))
}

async fn join_share(
    State(state): State<AppState>,
    user: AuthUser,
    Path(token): Path<String>,
) -> Result<Json<Value>, AppError> {
    let conn = state.db.get()?;

    let link = conn
        .query_row(
            "SELECT id, project_id, permission, expires_at, max_uses, use_count, is_active
             FROM share_links WHERE token = ?1",
            params![token],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, Option<bool>>(6)?,
                ))
            },
        )
        .map_err(|_| AppError::NotFound("Invalid or expired share link".into()))?;

    let (link_id, project_id, permission, expires_at, max_uses, use_count, is_active) = link;

    if !is_active.unwrap_or(true) {
        return Err(AppError::NotFound("Invalid or expired share link".into()));
    }

    if let Some(ref exp) = expires_at {
        if exp < &chrono::Utc::now().to_rfc3339() {
            return Err(AppError::Gone("Share link expired".into()));
        }
    }

    if let (Some(max), Some(count)) = (max_uses, use_count) {
        if count >= max {
            return Err(AppError::Gone("Share link usage limit reached".into()));
        }
    }

    // Check if already a collaborator
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM collaborators WHERE project_id = ?1 AND user_id = ?2",
            params![project_id, user.user_id],
            |row| row.get(0),
        )
        .ok();

    if existing.is_none() {
        conn.execute(
            "INSERT INTO collaborators (id, project_id, user_id, permission, added_via_share_link)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![nanoid::nanoid!(), project_id, user.user_id, permission, link_id],
        )?;
    }

    // Increment use count
    conn.execute(
        "UPDATE share_links SET use_count = COALESCE(use_count, 0) + 1 WHERE id = ?1",
        params![link_id],
    )?;

    Ok(Json(json!({ "projectId": project_id, "permission": permission })))
}
