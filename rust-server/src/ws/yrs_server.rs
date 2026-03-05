use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio::time::{Duration, Instant};
use yrs::{Doc, GetString, Text, Transact, ReadTxn, updates::decoder::Decode, Update};
use serde::{Deserialize, Serialize};

use crate::storage;

pub type CollabRooms = Arc<RwLock<HashMap<String, Arc<RwLock<DocState>>>>>;

pub struct DocState {
    pub doc: Doc,
    pub conns: HashMap<usize, mpsc::UnboundedSender<String>>,
    pub dirty: bool,
    pub project_id: String,
    pub file_path: String,
    pub data_dir: String,
    next_conn_id: usize,
}

impl DocState {
    fn new(project_id: String, file_path: String, data_dir: String) -> Self {
        let doc = Doc::new();

        // Load initial content from disk
        if let Some(content) = storage::read_project_file(&data_dir, &project_id, &file_path) {
            let text = doc.get_or_insert_text("content");
            let mut txn = doc.transact_mut();
            text.insert(&mut txn, 0, &content);
        }

        Self {
            doc,
            conns: HashMap::new(),
            dirty: false,
            project_id,
            file_path,
            data_dir,
            next_conn_id: 0,
        }
    }

    fn add_conn(&mut self, sender: mpsc::UnboundedSender<String>) -> usize {
        let id = self.next_conn_id;
        self.next_conn_id += 1;
        self.conns.insert(id, sender);
        id
    }

    fn remove_conn(&mut self, id: usize) {
        self.conns.remove(&id);
    }

    fn persist(&mut self) {
        if !self.dirty { return; }
        let text = self.doc.get_or_insert_text("content");
        let txn = self.doc.transact();
        let content = text.get_string(&txn);
        storage::write_project_file(&self.data_dir, &self.project_id, &self.file_path, content.as_bytes());
        self.dirty = false;
    }

    fn broadcast(&self, msg: &str, exclude_conn: Option<usize>) {
        for (&id, sender) in &self.conns {
            if Some(id) == exclude_conn { continue; }
            let _ = sender.send(msg.to_string());
        }
    }

    fn broadcast_all(&self, msg: &str) {
        for sender in self.conns.values() {
            let _ = sender.send(msg.to_string());
        }
    }
}

#[derive(Serialize, Deserialize)]
struct WsMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    count: Option<usize>,
}

pub async fn handle_ws_connection(
    rooms: CollabRooms,
    project_id: String,
    file_path: String,
    permission: String,
    data_dir: String,
    ws_sender: mpsc::UnboundedSender<String>,
    mut ws_receiver: mpsc::UnboundedReceiver<String>,
) {
    let doc_key = format!("{}:{}", project_id, file_path);

    // Get or create room
    let room = {
        let mut rooms_guard = rooms.write().await;
        rooms_guard
            .entry(doc_key.clone())
            .or_insert_with(|| {
                Arc::new(RwLock::new(DocState::new(
                    project_id.clone(),
                    file_path.clone(),
                    data_dir.clone(),
                )))
            })
            .clone()
    };

    // Add connection
    let conn_id = {
        let mut state = room.write().await;
        let id = state.add_conn(ws_sender.clone());

        // Send initial sync
        let txn = state.doc.transact();
        let update = txn.encode_state_as_update_v1(&yrs::StateVector::default());
        let msg = serde_json::to_string(&WsMessage {
            msg_type: "sync".to_string(),
            data: Some(update),
            count: None,
        })
        .unwrap();
        let _ = ws_sender.send(msg);

        // Broadcast peer count
        let peer_count = state.conns.len();
        let peers_msg = serde_json::to_string(&WsMessage {
            msg_type: "peers".to_string(),
            data: None,
            count: Some(peer_count),
        })
        .unwrap();
        state.broadcast_all(&peers_msg);

        id
    };

    // Spawn save timer
    let save_room = room.clone();
    let save_handle = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let mut state = save_room.write().await;
            state.persist();
        }
    });

    // Handle incoming messages
    while let Some(msg_str) = ws_receiver.recv().await {
        let msg: WsMessage = match serde_json::from_str(&msg_str) {
            Ok(m) => m,
            Err(_) => continue,
        };

        match msg.msg_type.as_str() {
            "update" => {
                if permission == "read" { continue; }

                if let Some(data) = msg.data {
                    let mut state = room.write().await;
                    if let Ok(update) = Update::decode_v1(&data) {
                        let mut txn = state.doc.transact_mut();
                        txn.apply_update(update);
                        drop(txn);
                        state.dirty = true;

                        // Broadcast to other clients
                        let broadcast_msg = serde_json::to_string(&WsMessage {
                            msg_type: "update".to_string(),
                            data: Some(data),
                            count: None,
                        })
                        .unwrap();
                        state.broadcast(&broadcast_msg, Some(conn_id));
                    }
                }
            }
            "awareness" => {
                // Broadcast awareness to others
                let state = room.read().await;
                state.broadcast(&msg_str, Some(conn_id));
            }
            _ => {}
        }
    }

    // Cleanup on disconnect
    save_handle.abort();

    let should_gc = {
        let mut state = room.write().await;
        state.remove_conn(conn_id);

        // Notify remaining peers
        let peer_count = state.conns.len();
        let peers_msg = serde_json::to_string(&WsMessage {
            msg_type: "peers".to_string(),
            data: None,
            count: Some(peer_count),
        })
        .unwrap();
        state.broadcast_all(&peers_msg);

        state.conns.is_empty()
    };

    // Schedule GC if no connections left
    if should_gc {
        let rooms_clone = rooms.clone();
        let doc_key_clone = doc_key.clone();
        let room_clone = room.clone();

        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(60)).await;

            let mut state = room_clone.write().await;
            if state.conns.is_empty() {
                state.persist();
                drop(state);
                let mut rooms_guard = rooms_clone.write().await;
                rooms_guard.remove(&doc_key_clone);
            }
        });
    }
}
