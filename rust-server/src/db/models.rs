use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub auth_provider: String,
    pub auth_provider_id: String,
    pub email: Option<String>,
    pub github_id: Option<i64>,
    pub github_login: Option<String>,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub github_access_token: Option<String>,
    pub password_hash: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub owner_id: String,
    pub main_file: String,
    pub github_repo_full_name: Option<String>,
    pub github_branch: Option<String>,
    pub github_last_sync_sha: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub id: String,
    pub project_id: String,
    pub path: String,
    pub is_directory: bool,
    pub size_bytes: Option<i64>,
    pub last_modified: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShareLink {
    pub id: String,
    pub project_id: String,
    pub token: String,
    pub permission: String,
    pub created_by: String,
    pub expires_at: Option<String>,
    pub max_uses: Option<i64>,
    pub use_count: Option<i64>,
    pub is_active: Option<bool>,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Collaborator {
    pub id: String,
    pub project_id: String,
    pub user_id: String,
    pub permission: String,
    pub added_via_share_link: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub is_directory: bool,
    pub size_bytes: i64,
}
