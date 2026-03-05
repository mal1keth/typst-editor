use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/health", get(health))
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}
