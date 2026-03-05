use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Unauthorized")]
    Unauthorized,
    #[error("Forbidden: {0}")]
    Forbidden(String),
    #[error("Bad request: {0}")]
    BadRequest(String),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Gone: {0}")]
    Gone(String),
    #[error("Internal error: {0}")]
    Internal(String),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("R2D2 error: {0}")]
    Pool(#[from] r2d2::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "Unauthorized".to_string()),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg.clone()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, msg.clone()),
            AppError::Gone(msg) => (StatusCode::GONE, msg.clone()),
            AppError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
            AppError::Database(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
            AppError::Pool(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}
