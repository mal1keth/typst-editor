use axum::{
    extract::{FromRequestParts, State},
    http::request::Parts,
};
use axum_extra::extract::CookieJar;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: String,
    pub github_login: Option<String>,
}

#[axum::async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        // Try cookie first
        let jar = CookieJar::from_headers(&parts.headers);
        let token = jar
            .get("token")
            .map(|c| c.value().to_string())
            .or_else(|| {
                // Try Authorization header
                parts
                    .headers
                    .get("Authorization")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.strip_prefix("Bearer "))
                    .map(|s| s.to_string())
            });

        let token = token.ok_or(AppError::Unauthorized)?;
        let payload = super::verify_token(&state.config.jwt_secret, &token)
            .ok_or(AppError::Unauthorized)?;

        Ok(AuthUser {
            user_id: payload.user_id,
            github_login: payload.github_login,
        })
    }
}
