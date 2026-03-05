use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use rusqlite::params;

use crate::auth::{middleware::AuthUser, password, sign_token};
use crate::error::AppError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/set-password", post(set_password))
        .route("/github", get(github_redirect))
        .route("/connect-github", get(connect_github))
        .route("/github/callback", get(github_callback))
        .route("/logout", post(logout))
        .route("/dev-login", get(dev_login))
        .route("/me", get(me))
}

fn auth_cookie(jwt: &str, is_production: bool) -> String {
    let secure = if is_production { "; Secure" } else { "" };
    format!(
        "token={}; HttpOnly; SameSite=Lax; Max-Age={}; Path=/{}",
        jwt,
        7 * 24 * 60 * 60,
        secure
    )
}

fn clear_cookie() -> String {
    "token=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/".to_string()
}

#[derive(Deserialize)]
struct RegisterBody {
    email: String,
    password: String,
    #[serde(rename = "displayName")]
    display_name: String,
}

async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterBody>,
) -> Result<Response, AppError> {
    let email = body.email.trim().to_lowercase();
    let display_name = body.display_name.trim().to_string();

    if email.is_empty() || body.password.is_empty() || display_name.is_empty() {
        return Err(AppError::BadRequest("Email, password, and display name are required".into()));
    }

    if let Some(err) = password::validate_password_strength(&body.password) {
        return Err(AppError::BadRequest(err));
    }

    let conn = state.db.get()?;

    // Check existing
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM users WHERE auth_provider = 'email' AND email = ?1",
            params![email],
            |row| row.get(0),
        )
        .ok();

    if existing.is_some() {
        return Err(AppError::Conflict("An account with this email already exists".into()));
    }

    let hashed = password::hash_password(&body.password)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let user_id = nanoid::nanoid!();

    conn.execute(
        "INSERT INTO users (id, auth_provider, auth_provider_id, email, display_name, password_hash)
         VALUES (?1, 'email', ?2, ?2, ?3, ?4)",
        params![user_id, email, display_name, hashed],
    )?;

    let jwt = sign_token(&state.config.jwt_secret, &user_id, None)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok((
        StatusCode::CREATED,
        [("Set-Cookie", auth_cookie(&jwt, state.config.is_production))],
        Json(json!({ "ok": true, "userId": user_id })),
    )
        .into_response())
}

#[derive(Deserialize)]
struct LoginBody {
    email: String,
    password: String,
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Result<Response, AppError> {
    let email = body.email.trim().to_lowercase();
    if email.is_empty() || body.password.is_empty() {
        return Err(AppError::BadRequest("Email and password are required".into()));
    }

    let conn = state.db.get()?;

    let user: Option<(String, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT id, password_hash, github_login FROM users WHERE email = ?1",
            params![email],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok();

    let (user_id, pw_hash, github_login) = user
        .ok_or_else(|| AppError::Unauthorized)?;

    let pw_hash = pw_hash.ok_or(AppError::Unauthorized)?;

    if !password::verify_password(&body.password, &pw_hash) {
        return Err(AppError::Unauthorized);
    }

    let jwt = sign_token(
        &state.config.jwt_secret,
        &user_id,
        github_login.as_deref(),
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok((
        [("Set-Cookie", auth_cookie(&jwt, state.config.is_production))],
        Json(json!({ "ok": true })),
    )
        .into_response())
}

#[derive(Deserialize)]
struct SetPasswordBody {
    password: String,
    #[serde(rename = "currentPassword")]
    current_password: Option<String>,
}

async fn set_password(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<SetPasswordBody>,
) -> Result<Json<Value>, AppError> {
    if let Some(err) = password::validate_password_strength(&body.password) {
        return Err(AppError::BadRequest(err));
    }

    let conn = state.db.get()?;

    let existing_hash: Option<String> = conn
        .query_row(
            "SELECT password_hash FROM users WHERE id = ?1",
            params![user.user_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::NotFound("User not found".into()))?;

    if let Some(ref hash) = existing_hash {
        let current = body.current_password.as_deref()
            .ok_or_else(|| AppError::BadRequest("Current password required".into()))?;
        if !password::verify_password(current, hash) {
            return Err(AppError::Unauthorized);
        }
    }

    let hashed = password::hash_password(&body.password)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    conn.execute(
        "UPDATE users SET password_hash = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![hashed, user.user_id],
    )?;

    Ok(Json(json!({ "ok": true })))
}

async fn github_redirect(State(state): State<AppState>) -> Result<Response, AppError> {
    let github_state = nanoid::nanoid!();
    let params = format!(
        "client_id={}&redirect_uri={}/api/auth/github/callback&scope=repo%20user:email&state={}",
        state.config.github_client_id, state.config.base_url, github_state
    );

    Ok((
        [("Set-Cookie", format!(
            "oauth_state={}; HttpOnly; SameSite=Lax; Max-Age=600; Path=/",
            github_state
        ))],
        Redirect::temporary(&format!("https://github.com/login/oauth/authorize?{}", params)),
    )
        .into_response())
}

async fn connect_github(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Response, AppError> {
    let github_state = nanoid::nanoid!();
    let params = format!(
        "client_id={}&redirect_uri={}/api/auth/github/callback&scope=repo%20user:email&state={}",
        state.config.github_client_id, state.config.base_url, github_state
    );

    Ok((
        [(
            "Set-Cookie",
            format!(
                "connect_github_user_id={}; HttpOnly; SameSite=Lax; Max-Age=600; Path=/",
                user.user_id
            ),
        )],
        Redirect::temporary(&format!("https://github.com/login/oauth/authorize?{}", params)),
    )
        .into_response())
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: String,
    state: String,
}

#[derive(Deserialize)]
struct GithubTokenResponse {
    access_token: Option<String>,
}

#[derive(Deserialize)]
struct GithubUser {
    id: i64,
    login: String,
    name: Option<String>,
    avatar_url: String,
    email: Option<String>,
}

async fn github_callback(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(query): Query<CallbackQuery>,
) -> Result<Response, AppError> {
    // Exchange code for token
    let client = reqwest::Client::new();
    let token_res = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&json!({
            "client_id": state.config.github_client_id,
            "client_secret": state.config.github_client_secret,
            "code": query.code,
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let token_data: GithubTokenResponse = token_res
        .json()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let access_token = token_data
        .access_token
        .ok_or_else(|| AppError::BadRequest("Failed to get access token".into()))?;

    // Get GitHub user info
    let user_res = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "typst-editor")
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let github_user: GithubUser = user_res
        .json()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let conn = state.db.get()?;

    // Check if connecting to existing account
    let connect_user_id = jar.get("connect_github_user_id").map(|c| c.value().to_string());

    if let Some(connect_id) = connect_user_id {
        // Update existing user with GitHub credentials
        conn.execute(
            "UPDATE users SET github_id = ?1, github_login = ?2, github_access_token = ?3,
             avatar_url = ?4, updated_at = datetime('now') WHERE id = ?5",
            params![
                github_user.id,
                github_user.login,
                access_token,
                github_user.avatar_url,
                connect_id,
            ],
        )?;

        let jwt = sign_token(
            &state.config.jwt_secret,
            &connect_id,
            Some(&github_user.login),
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;

        return Ok((
            [
                ("Set-Cookie", auth_cookie(&jwt, state.config.is_production)),
            ],
            Redirect::temporary("/?github_connected=true"),
        )
            .into_response());
    }

    // Normal OAuth login - upsert user
    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM users WHERE auth_provider = 'github' AND auth_provider_id = ?1",
            params![github_user.id.to_string()],
            |row| row.get(0),
        )
        .ok();

    let user_id = if let Some(id) = existing_id {
        conn.execute(
            "UPDATE users SET display_name = ?1, avatar_url = ?2, email = ?3,
             github_login = ?4, github_access_token = ?5, updated_at = datetime('now')
             WHERE id = ?6",
            params![
                github_user.name.as_deref().unwrap_or(&github_user.login),
                github_user.avatar_url,
                github_user.email,
                github_user.login,
                access_token,
                id,
            ],
        )?;
        id
    } else {
        let id = nanoid::nanoid!();
        conn.execute(
            "INSERT INTO users (id, auth_provider, auth_provider_id, email, github_id, github_login,
             display_name, avatar_url, github_access_token)
             VALUES (?1, 'github', ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                github_user.id.to_string(),
                github_user.email,
                github_user.id,
                github_user.login,
                github_user.name.as_deref().unwrap_or(&github_user.login),
                github_user.avatar_url,
                access_token,
            ],
        )?;
        id
    };

    let jwt = sign_token(
        &state.config.jwt_secret,
        &user_id,
        Some(&github_user.login),
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok((
        [("Set-Cookie", auth_cookie(&jwt, state.config.is_production))],
        Redirect::temporary("/"),
    )
        .into_response())
}

async fn logout(State(state): State<AppState>) -> Response {
    (
        [("Set-Cookie", clear_cookie())],
        Json(json!({ "ok": true })),
    )
        .into_response()
}

async fn dev_login(State(state): State<AppState>) -> Result<Response, AppError> {
    if state.config.is_production {
        return Err(AppError::NotFound("Not available".into()));
    }

    let conn = state.db.get()?;

    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM users WHERE auth_provider = 'dev' AND auth_provider_id = '1'",
            [],
            |row| row.get(0),
        )
        .ok();

    let user_id = if let Some(id) = existing {
        id
    } else {
        let id = nanoid::nanoid!();
        conn.execute(
            "INSERT INTO users (id, auth_provider, auth_provider_id, display_name, github_login, github_id)
             VALUES (?1, 'dev', '1', 'Dev User', 'dev-user', 1)",
            params![id],
        )?;
        id
    };

    let jwt = sign_token(&state.config.jwt_secret, &user_id, Some("dev-user"))
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok((
        [("Set-Cookie", auth_cookie(&jwt, state.config.is_production))],
        Redirect::temporary("/"),
    )
        .into_response())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MeResponse {
    id: String,
    auth_provider: String,
    email: Option<String>,
    github_login: Option<String>,
    github_id: Option<i64>,
    display_name: String,
    avatar_url: Option<String>,
    has_password: bool,
    has_github: bool,
    created_at: Option<String>,
}

async fn me(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<MeResponse>, AppError> {
    let conn = state.db.get()?;

    let result = conn.query_row(
        "SELECT id, auth_provider, email, github_login, github_id, display_name, avatar_url,
                password_hash, created_at
         FROM users WHERE id = ?1",
        params![user.user_id],
        |row| {
            let password_hash: Option<String> = row.get(7)?;
            let github_login: Option<String> = row.get(3)?;
            Ok(MeResponse {
                id: row.get(0)?,
                auth_provider: row.get(1)?,
                email: row.get(2)?,
                github_login: github_login.clone(),
                github_id: row.get(4)?,
                display_name: row.get(5)?,
                avatar_url: row.get(6)?,
                has_password: password_hash.is_some(),
                has_github: github_login.is_some(),
                created_at: row.get(8)?,
            })
        },
    )
    .map_err(|_| AppError::NotFound("User not found".into()))?;

    Ok(Json(result))
}
