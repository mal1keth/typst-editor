use std::env;

#[derive(Clone)]
pub struct Config {
    pub jwt_secret: String,
    pub github_client_id: String,
    pub github_client_secret: String,
    pub base_url: String,
    pub cors_origin: String,
    pub port: u16,
    pub data_dir: String,
    pub is_production: bool,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            jwt_secret: env::var("JWT_SECRET")
                .unwrap_or_else(|_| "dev-secret-change-in-production".to_string()),
            github_client_id: env::var("GITHUB_CLIENT_ID").unwrap_or_default(),
            github_client_secret: env::var("GITHUB_CLIENT_SECRET").unwrap_or_default(),
            base_url: env::var("BASE_URL")
                .unwrap_or_else(|_| "http://localhost:5173".to_string()),
            cors_origin: env::var("CORS_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:5173".to_string()),
            port: env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3000),
            data_dir: env::var("DATA_DIR")
                .unwrap_or_else(|_| "data/projects".to_string()),
            is_production: env::var("NODE_ENV")
                .map(|v| v == "production")
                .unwrap_or(false),
        }
    }
}
