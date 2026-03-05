use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::middleware::AuthUser;
use crate::error::AppError;
use crate::middleware::permissions::check_project_access;
use crate::state::AppState;
use crate::storage;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/repos", get(list_repos))
        .route("/projects/{project_id}/github/link", post(link_repo))
        .route("/projects/{project_id}/github/unlink", post(unlink_repo))
        .route("/projects/{project_id}/github/pull", post(pull_from_github))
        .route("/projects/{project_id}/github/push", post(push_to_github))
        .route("/projects/{project_id}/github/status", get(sync_status))
        .route("/repos/{owner}/{repo}/check", get(check_repo))
        .route("/import", post(import_repo))
}

fn github_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("typst-editor")
        .build()
        .unwrap()
}

async fn get_user_token(state: &AppState, user_id: &str) -> Result<String, AppError> {
    let conn = state.db.get()?;
    let token: Option<String> = conn
        .query_row(
            "SELECT github_access_token FROM users WHERE id = ?1",
            params![user_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();
    token.ok_or_else(|| AppError::BadRequest("GitHub not connected".into()))
}

async fn github_api_get(client: &reqwest::Client, token: &str, url: &str) -> Result<Value, AppError> {
    let res = client
        .get(url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    res.json().await.map_err(|e| AppError::Internal(e.to_string()))
}

async fn github_api_post(client: &reqwest::Client, token: &str, url: &str, body: &Value) -> Result<Value, AppError> {
    let res = client
        .post(url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .json(body)
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    res.json().await.map_err(|e| AppError::Internal(e.to_string()))
}

async fn pull_repo_files(
    client: &reqwest::Client,
    token: &str,
    owner: &str,
    repo: &str,
    commit_sha: &str,
    state: &AppState,
    project_id: &str,
) -> Result<usize, AppError> {
    let tree_data = github_api_get(
        client,
        token,
        &format!("https://api.github.com/repos/{}/{}/git/trees/{}?recursive=1", owner, repo, commit_sha),
    ).await?;

    storage::ensure_project_dir(&state.config.data_dir, project_id);

    // Clear existing file metadata
    let conn = state.db.get()?;
    conn.execute("DELETE FROM project_files WHERE project_id = ?1", params![project_id])?;

    let empty_tree = vec![];
    let tree = tree_data["tree"].as_array().unwrap_or(&empty_tree);
    let mut file_count = 0;

    for item in tree {
        let item_type = item["type"].as_str().unwrap_or("");
        let path = item["path"].as_str().unwrap_or("");
        let sha = item["sha"].as_str().unwrap_or("");

        if path.is_empty() { continue; }

        if item_type == "blob" {
            let blob_data = github_api_get(
                client,
                token,
                &format!("https://api.github.com/repos/{}/{}/git/blobs/{}", owner, repo, sha),
            ).await?;

            if let Some(content_str) = blob_data["content"].as_str() {
                use base64::Engine;
                let clean = content_str.replace('\n', "");
                if let Ok(content) = base64::engine::general_purpose::STANDARD.decode(&clean) {
                    storage::write_project_file(&state.config.data_dir, project_id, path, &content);
                    conn.execute(
                        "INSERT INTO project_files (id, project_id, path, is_directory, size_bytes)
                         VALUES (?1, ?2, ?3, 0, ?4)",
                        params![nanoid::nanoid!(), project_id, path, content.len() as i64],
                    )?;
                    file_count += 1;
                }
            }
        } else if item_type == "tree" {
            conn.execute(
                "INSERT INTO project_files (id, project_id, path, is_directory, size_bytes)
                 VALUES (?1, ?2, ?3, 1, 0)",
                params![nanoid::nanoid!(), project_id, path],
            )?;
        }
    }

    Ok(file_count)
}

async fn list_repos(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<Value>>, AppError> {
    let token = get_user_token(&state, &user.user_id).await?;
    let client = github_client();

    let data = github_api_get(
        &client,
        &token,
        "https://api.github.com/user/repos?sort=updated&per_page=50",
    ).await?;

    let repos: Vec<Value> = data
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|r| {
            json!({
                "fullName": r["full_name"],
                "name": r["name"],
                "owner": r["owner"]["login"],
                "private": r["private"],
                "defaultBranch": r["default_branch"],
            })
        })
        .collect();

    Ok(Json(repos))
}

#[derive(Deserialize)]
struct LinkBody {
    #[serde(rename = "repoFullName")]
    repo_full_name: String,
    branch: Option<String>,
}

async fn link_repo(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
    Json(body): Json<LinkBody>,
) -> Result<Json<Value>, AppError> {
    check_project_access(&state.db, &user, &project_id, "owner")?;
    let token = get_user_token(&state, &user.user_id).await?;
    let branch = body.branch.unwrap_or_else(|| "main".to_string());

    // Verify access
    let parts: Vec<&str> = body.repo_full_name.split('/').collect();
    if parts.len() != 2 { return Err(AppError::BadRequest("Invalid repo name".into())); }

    let client = github_client();
    github_api_get(&client, &token, &format!("https://api.github.com/repos/{}", body.repo_full_name))
        .await
        .map_err(|_| AppError::Forbidden("Cannot access repository".into()))?;

    let conn = state.db.get()?;
    conn.execute(
        "UPDATE projects SET github_repo_full_name = ?1, github_branch = ?2,
         updated_at = datetime('now') WHERE id = ?3",
        params![body.repo_full_name, branch, project_id],
    )?;

    Ok(Json(json!({ "ok": true, "repoFullName": body.repo_full_name, "branch": branch })))
}

async fn unlink_repo(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    check_project_access(&state.db, &user, &project_id, "owner")?;

    let conn = state.db.get()?;
    conn.execute(
        "UPDATE projects SET github_repo_full_name = NULL, github_branch = NULL,
         github_last_sync_sha = NULL, updated_at = datetime('now') WHERE id = ?1",
        params![project_id],
    )?;

    Ok(Json(json!({ "ok": true })))
}

async fn pull_from_github(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    check_project_access(&state.db, &user, &project_id, "write")?;
    let token = get_user_token(&state, &user.user_id).await?;

    let conn = state.db.get()?;
    let (repo_name, branch): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT github_repo_full_name, github_branch FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| AppError::NotFound("Project not found".into()))?;

    let repo_name = repo_name.ok_or_else(|| AppError::BadRequest("Project not linked to GitHub".into()))?;
    let branch = branch.unwrap_or_else(|| "main".to_string());
    let parts: Vec<&str> = repo_name.split('/').collect();

    let client = github_client();
    let ref_data = github_api_get(
        &client,
        &token,
        &format!("https://api.github.com/repos/{}/git/ref/heads/{}", repo_name, branch),
    ).await?;

    let commit_sha = ref_data["object"]["sha"].as_str()
        .ok_or_else(|| AppError::Internal("Failed to get commit SHA".into()))?;

    let file_count = pull_repo_files(&client, &token, parts[0], parts[1], commit_sha, &state, &project_id).await?;

    conn.execute(
        "UPDATE projects SET github_last_sync_sha = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![commit_sha, project_id],
    )?;

    Ok(Json(json!({ "ok": true, "commitSha": commit_sha, "fileCount": file_count })))
}

#[derive(Deserialize)]
struct PushBody {
    #[serde(rename = "commitMessage")]
    commit_message: String,
}

async fn push_to_github(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
    Json(body): Json<PushBody>,
) -> Result<Json<Value>, AppError> {
    check_project_access(&state.db, &user, &project_id, "write")?;
    let token = get_user_token(&state, &user.user_id).await?;

    if body.commit_message.trim().is_empty() {
        return Err(AppError::BadRequest("Commit message required".into()));
    }

    let conn = state.db.get()?;
    let (repo_name, branch, last_sha): (Option<String>, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT github_repo_full_name, github_branch, github_last_sync_sha FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| AppError::NotFound("Project not found".into()))?;

    let repo_name = repo_name.ok_or_else(|| AppError::BadRequest("Project not linked to GitHub".into()))?;
    let branch = branch.unwrap_or_else(|| "main".to_string());

    let client = github_client();

    // Get HEAD
    let ref_data = github_api_get(
        &client,
        &token,
        &format!("https://api.github.com/repos/{}/git/ref/heads/{}", repo_name, branch),
    ).await?;
    let parent_sha = ref_data["object"]["sha"].as_str()
        .ok_or_else(|| AppError::Internal("Failed to get HEAD SHA".into()))?.to_string();

    // Check conflicts
    if let Some(ref local_sha) = last_sha {
        if local_sha != &parent_sha {
            return Err(AppError::Conflict("Remote has new commits. Pull first.".into()));
        }
    }

    // Create blobs and tree entries
    let files = storage::list_project_files(&state.config.data_dir, &project_id);
    let mut tree_entries = Vec::new();

    let parts: Vec<&str> = repo_name.split('/').collect();

    for file in files.iter().filter(|f| !f.is_directory) {
        if let Some(content) = storage::read_project_file_binary(&state.config.data_dir, &project_id, &file.path) {
            use base64::Engine;
            let encoded = base64::engine::general_purpose::STANDARD.encode(&content);

            let blob = github_api_post(&client, &token,
                &format!("https://api.github.com/repos/{}/git/blobs", repo_name),
                &json!({ "content": encoded, "encoding": "base64" }),
            ).await?;

            tree_entries.push(json!({
                "path": file.path,
                "mode": "100644",
                "type": "blob",
                "sha": blob["sha"],
            }));
        }
    }

    // Create tree
    let tree = github_api_post(&client, &token,
        &format!("https://api.github.com/repos/{}/git/trees", repo_name),
        &json!({ "tree": tree_entries, "base_tree": parent_sha }),
    ).await?;

    // Create commit
    let commit = github_api_post(&client, &token,
        &format!("https://api.github.com/repos/{}/git/commits", repo_name),
        &json!({
            "message": body.commit_message.trim(),
            "tree": tree["sha"],
            "parents": [parent_sha],
        }),
    ).await?;

    let commit_sha = commit["sha"].as_str()
        .ok_or_else(|| AppError::Internal("Failed to create commit".into()))?.to_string();

    // Update ref
    let _patch_res = client
        .patch(&format!("https://api.github.com/repos/{}/git/refs/heads/{}", repo_name, branch))
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .json(&json!({ "sha": commit_sha }))
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    conn.execute(
        "UPDATE projects SET github_last_sync_sha = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![commit_sha, project_id],
    )?;

    Ok(Json(json!({ "ok": true, "commitSha": commit_sha })))
}

async fn sync_status(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    check_project_access(&state.db, &user, &project_id, "read")?;

    let conn = state.db.get()?;
    let (repo_name, branch, last_sha): (Option<String>, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT github_repo_full_name, github_branch, github_last_sync_sha FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| AppError::NotFound("Project not found".into()))?;

    let repo_name = match repo_name {
        Some(name) => name,
        None => return Ok(Json(json!({ "linked": false }))),
    };

    let branch = branch.unwrap_or_else(|| "main".to_string());
    let token = get_user_token(&state, &user.user_id).await?;
    let client = github_client();

    match github_api_get(&client, &token, &format!("https://api.github.com/repos/{}/git/ref/heads/{}", repo_name, branch)).await {
        Ok(ref_data) => {
            let remote_sha = ref_data["object"]["sha"].as_str().map(String::from);
            Ok(Json(json!({
                "linked": true,
                "repoFullName": repo_name,
                "branch": branch,
                "localSha": last_sha,
                "remoteSha": remote_sha,
                "inSync": last_sha == remote_sha,
            })))
        }
        Err(_) => Ok(Json(json!({
            "linked": true,
            "repoFullName": repo_name,
            "branch": branch,
            "error": "Cannot reach repository",
        }))),
    }
}

async fn check_repo(
    State(state): State<AppState>,
    user: AuthUser,
    Path((owner, repo)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    let token = get_user_token(&state, &user.user_id).await?;
    let client = github_client();

    let repo_data = github_api_get(&client, &token, &format!("https://api.github.com/repos/{}/{}", owner, repo))
        .await
        .map_err(|_| AppError::Forbidden("Cannot access repository".into()))?;

    let default_branch = repo_data["default_branch"].as_str().unwrap_or("main");
    let ref_data = github_api_get(&client, &token, &format!("https://api.github.com/repos/{}/{}/git/ref/heads/{}", owner, repo, default_branch)).await?;

    let commit_sha = ref_data["object"]["sha"].as_str().unwrap_or("");
    let tree_data = github_api_get(&client, &token, &format!("https://api.github.com/repos/{}/{}/git/trees/{}?recursive=1", owner, repo, commit_sha)).await?;

    let empty_tree2 = vec![];
    let tree = tree_data["tree"].as_array().unwrap_or(&empty_tree2);
    let typ_files: Vec<&str> = tree
        .iter()
        .filter(|i| i["type"].as_str() == Some("blob") && i["path"].as_str().map_or(false, |p| p.ends_with(".typ")))
        .filter_map(|i| i["path"].as_str())
        .collect();

    Ok(Json(json!({
        "hasTypFiles": !typ_files.is_empty(),
        "typFiles": typ_files,
        "defaultBranch": default_branch,
        "totalFiles": tree.iter().filter(|i| i["type"].as_str() == Some("blob")).count(),
    })))
}

#[derive(Deserialize)]
struct ImportBody {
    #[serde(rename = "repoFullName")]
    repo_full_name: String,
    branch: Option<String>,
    #[serde(rename = "projectName")]
    project_name: Option<String>,
}

async fn import_repo(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<ImportBody>,
) -> Result<Response, AppError> {
    if body.repo_full_name.is_empty() {
        return Err(AppError::BadRequest("Repository full name is required".into()));
    }

    let token = get_user_token(&state, &user.user_id).await?;
    let client = github_client();
    let parts: Vec<&str> = body.repo_full_name.split('/').collect();
    if parts.len() != 2 { return Err(AppError::BadRequest("Invalid repo name".into())); }

    let repo_data = github_api_get(&client, &token, &format!("https://api.github.com/repos/{}", body.repo_full_name))
        .await
        .map_err(|_| AppError::Forbidden("Cannot access repository".into()))?;

    let actual_branch = body.branch.unwrap_or_else(||
        repo_data["default_branch"].as_str().unwrap_or("main").to_string()
    );

    let ref_data = github_api_get(&client, &token,
        &format!("https://api.github.com/repos/{}/git/ref/heads/{}", body.repo_full_name, actual_branch),
    ).await?;
    let commit_sha = ref_data["object"]["sha"].as_str()
        .ok_or_else(|| AppError::Internal("Failed to get commit SHA".into()))?.to_string();

    // Check for .typ files
    let tree_data = github_api_get(&client, &token,
        &format!("https://api.github.com/repos/{}/git/trees/{}?recursive=1", body.repo_full_name, commit_sha),
    ).await?;

    let empty_tree3 = vec![];
    let tree = tree_data["tree"].as_array().unwrap_or(&empty_tree3);
    let typ_files: Vec<&str> = tree
        .iter()
        .filter(|i| i["type"].as_str() == Some("blob") && i["path"].as_str().map_or(false, |p| p.ends_with(".typ")))
        .filter_map(|i| i["path"].as_str())
        .collect();

    let main_file = if typ_files.contains(&"main.typ") {
        "main.typ".to_string()
    } else {
        typ_files.first().map(|s| s.to_string()).unwrap_or_else(|| "main.typ".to_string())
    };

    let project_id = nanoid::nanoid!();
    let project_name = body.project_name.unwrap_or_else(|| parts[1].to_string());

    let conn = state.db.get()?;
    conn.execute(
        "INSERT INTO projects (id, name, owner_id, main_file, github_repo_full_name, github_branch)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![project_id, project_name, user.user_id, main_file, body.repo_full_name, actual_branch],
    )?;

    let file_count = pull_repo_files(&client, &token, parts[0], parts[1], &commit_sha, &state, &project_id).await?;

    conn.execute(
        "UPDATE projects SET github_last_sync_sha = ?1 WHERE id = ?2",
        params![commit_sha, project_id],
    )?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "ok": true,
            "projectId": project_id,
            "projectName": project_name,
            "fileCount": file_count,
            "typFileCount": typ_files.len(),
            "mainFile": main_file,
        })),
    )
        .into_response())
}
