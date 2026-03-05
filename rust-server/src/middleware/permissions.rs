use crate::auth::middleware::AuthUser;
use crate::db::DbPool;
use crate::error::AppError;
use rusqlite::params;

fn perm_level(p: &str) -> i32 {
    match p {
        "read" => 1,
        "write" => 2,
        "admin" => 3,
        "owner" => 4,
        _ => 0,
    }
}

/// Check if user has at least `min_permission` on the project.
/// Returns the actual permission level string.
pub fn check_project_access(
    db: &DbPool,
    user: &AuthUser,
    project_id: &str,
    min_permission: &str,
) -> Result<String, AppError> {
    let conn = db.get()?;

    // Check if project exists and if user is owner
    let owner_id: Option<String> = conn
        .query_row(
            "SELECT owner_id FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::NotFound("Project not found".to_string()))?;

    let owner_id = owner_id.ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if owner_id == user.user_id {
        return Ok("owner".to_string());
    }

    if min_permission == "owner" {
        return Err(AppError::Forbidden("Owner access required".to_string()));
    }

    // Check collaborator permission
    let collab_perm: Option<String> = conn
        .query_row(
            "SELECT permission FROM collaborators WHERE project_id = ?1 AND user_id = ?2",
            params![project_id, user.user_id],
            |row| row.get(0),
        )
        .ok();

    match collab_perm {
        Some(perm) => {
            if perm_level(&perm) < perm_level(min_permission) {
                Err(AppError::Forbidden("Insufficient permissions".to_string()))
            } else {
                Ok(perm)
            }
        }
        None => Err(AppError::Forbidden("Access denied".to_string())),
    }
}
