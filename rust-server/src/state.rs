use crate::config::Config;
use crate::db::DbPool;
use crate::ws::yrs_server::CollabRooms;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db: DbPool,
    pub config: Arc<Config>,
    pub rooms: CollabRooms,
}
