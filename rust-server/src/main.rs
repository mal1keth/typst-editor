mod auth;
mod config;
mod db;
mod error;
mod middleware;
mod routes;
mod state;
mod storage;
mod ws;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State, WebSocketUpgrade,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use rusqlite::params;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::state::AppState;

#[tokio::main]
async fn main() {
    // Load .env
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let config = Config::from_env();
    let port = config.port;

    // Create database pool
    let pool = db::create_pool(&config.data_dir);

    let state = AppState {
        db: pool,
        config: Arc::new(config.clone()),
        rooms: Arc::new(RwLock::new(HashMap::new())),
    };

    // CORS
    let cors = CorsLayer::new()
        .allow_origin(
            config
                .cors_origin
                .parse::<axum::http::HeaderValue>()
                .unwrap_or_else(|_| "http://localhost:5173".parse().unwrap()),
        )
        .allow_methods(Any)
        .allow_headers(Any)
        .allow_credentials(true);

    // Build router
    let app = routes::create_router()
        .route("/ws/yjs/{project_id}/{*file_path}", get(ws_handler))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .expect("Failed to bind");

    tracing::info!("Server running at http://localhost:{}", port);

    axum::serve(listener, app).await.expect("Server failed");
}

#[derive(serde::Deserialize)]
struct WsQuery {
    token: Option<String>,
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path((project_id, file_path)): Path<(String, String)>,
    Query(query): Query<WsQuery>,
) -> impl IntoResponse {
    let permission = if let Some(ref token) = query.token {
        if let Some(payload) = auth::verify_token(&state.config.jwt_secret, token) {
            let conn = state.db.get().ok();
            if let Some(conn) = conn {
                let owner_id: Option<String> = conn
                    .query_row(
                        "SELECT owner_id FROM projects WHERE id = ?1",
                        params![project_id],
                        |row| row.get(0),
                    )
                    .ok();

                if owner_id.as_ref() == Some(&payload.user_id) {
                    "owner".to_string()
                } else {
                    let collab_perm: Option<String> = conn
                        .query_row(
                            "SELECT permission FROM collaborators WHERE project_id = ?1 AND user_id = ?2",
                            params![project_id, payload.user_id],
                            |row| row.get(0),
                        )
                        .ok();
                    collab_perm.unwrap_or_else(|| "read".to_string())
                }
            } else {
                "read".to_string()
            }
        } else {
            "read".to_string()
        }
    } else {
        "read".to_string()
    };

    let rooms = state.rooms.clone();
    let data_dir = state.config.data_dir.clone();

    ws.on_upgrade(move |socket| async move {
        handle_socket(socket, rooms, project_id, file_path, permission, data_dir).await
    })
}

async fn handle_socket(
    socket: WebSocket,
    rooms: ws::yrs_server::CollabRooms,
    project_id: String,
    file_path: String,
    permission: String,
    data_dir: String,
) {
    let (mut ws_write, mut ws_read) = socket.split();

    // Create channels to bridge axum WS with our handler
    let (to_ws_tx, mut to_ws_rx) = mpsc::unbounded_channel::<String>();
    let (from_ws_tx, from_ws_rx) = mpsc::unbounded_channel::<String>();

    // Forward messages from handler to WebSocket
    tokio::spawn(async move {
        while let Some(msg) = to_ws_rx.recv().await {
            if ws_write.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Forward messages from WebSocket to handler
    tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_read.next().await {
            match msg {
                Message::Text(text) => {
                    if from_ws_tx.send(text.to_string()).is_err() {
                        break;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
        // Signal disconnect by dropping the sender
    });

    // Run the collaboration handler
    ws::yrs_server::handle_ws_connection(
        rooms,
        project_id,
        file_path,
        permission,
        data_dir,
        to_ws_tx,
        from_ws_rx,
    )
    .await;
}
