pub mod auth_routes;
pub mod github_routes;
pub mod health;
pub mod project_routes;
pub mod share_routes;

use axum::Router;
use crate::state::AppState;

pub fn create_router() -> Router<AppState> {
    Router::new()
        .nest("/api/auth", auth_routes::router())
        .nest("/api/projects", project_routes::router())
        .nest("/api", share_routes::router())
        .nest("/api/github", github_routes::router())
        .merge(health::router())
}
